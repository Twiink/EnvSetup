/**
 * 校验官方下载源、下载工件，并将其写入本地下载缓存。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { DownloadArtifact, ErrorCode } from './contracts'

const OFFICIAL_DOWNLOAD_HOSTS: Record<DownloadArtifact['tool'], Set<string>> = {
  node: new Set(['nodejs.org']),
  nvm: new Set(['github.com']),
  'nvm-windows': new Set(['github.com']),
  temurin: new Set(['github.com', 'api.adoptium.net']),
  sdkman: new Set(['get.sdkman.io', 'api.sdkman.io', 'github.com']),
  'sdkman-cli': new Set(['api.sdkman.io']),
  'sdkman-native': new Set(['api.sdkman.io']),
  python: new Set(['www.python.org', 'bootstrap.pypa.io']),
  miniconda: new Set(['repo.anaconda.com']),
  git: new Set(['sourceforge.net', 'git-scm.com']),
  'git-for-windows': new Set(['github.com', 'gitforwindows.org']),
  mysql: new Set(['dev.mysql.com', 'cdn.mysql.com']),
  redis: new Set(['download.redis.io', 'download.memurai.com', 'www.memurai.com']),
  maven: new Set(['archive.apache.org', 'downloads.apache.org', 'dlcdn.apache.org']),
  homebrew: new Set(['github.com', 'brew.sh', 'raw.githubusercontent.com']),
  scoop: new Set(['github.com', 'raw.githubusercontent.com', 'get.scoop.sh']),
}

const DOWNLOAD_RETRYABLE_CODES = new Set<ErrorCode>(['DOWNLOAD_FAILED'])

type DownloadError = Error & { code: ErrorCode }

export type DownloadResolvedArtifact = {
  artifact: DownloadArtifact
  localPath: string
  cacheHit: boolean
}

export type DownloadArtifactsOptions = {
  downloads: DownloadArtifact[]
  cacheDir: string
  fetchImpl?: typeof fetch
  retryCount?: number
}

const inFlightDownloads = new Map<string, Promise<DownloadResolvedArtifact>>()
const inFlightChecksums = new Map<string, Promise<string>>()
// 以缓存文件路径为键做并发去重，避免多个插件同时下载同一个工件。

function makeError(code: ErrorCode, message: string): DownloadError {
  const error = new Error(message) as DownloadError
  error.code = code
  return error
}

function getDownloadableArtifacts(downloads: DownloadArtifact[]): DownloadArtifact[] {
  return downloads.filter(
    (download) => download.kind === 'archive' || download.kind === 'installer',
  )
}

function ensureOfficialHost(download: DownloadArtifact): void {
  const host = new URL(download.url).host
  ensureOfficialHostForTool(download.tool, host, download.url)

  if (download.checksumUrl) {
    const checksumHost = new URL(download.checksumUrl).host
    ensureOfficialHostForTool(download.tool, checksumHost, download.checksumUrl, 'checksum')
  }
}

function ensureOfficialHostForTool(
  tool: DownloadArtifact['tool'],
  host: string,
  url: string,
  kind: 'download' | 'checksum' = 'download',
): void {
  const allowedHosts = OFFICIAL_DOWNLOAD_HOSTS[tool]
  if (!allowedHosts.has(host)) {
    throw makeError('DOWNLOAD_HOST_UNTRUSTED', `Unofficial ${kind} host: ${url}`)
  }
}

function buildCacheKey(download: DownloadArtifact): string {
  const payload = JSON.stringify({
    kind: download.kind,
    url: download.url,
    checksumUrl: download.checksumUrl,
    checksumAlgorithm: download.checksumAlgorithm,
  })
  return createHash('sha256').update(payload).digest('hex')
}

function buildChecksumCacheKey(download: DownloadArtifact): string {
  const payload = JSON.stringify({
    checksumUrl: download.checksumUrl,
    checksumAlgorithm: download.checksumAlgorithm,
  })
  return createHash('sha256').update(payload).digest('hex')
}

function inferFileName(download: DownloadArtifact): string {
  if (download.fileName) {
    return download.fileName
  }

  const urlPath = new URL(download.url).pathname
  return basename(urlPath)
}

function inferChecksumTargetName(download: DownloadArtifact): string {
  if (download.fileName) {
    return download.fileName
  }

  return basename(new URL(download.url).pathname)
}

function resolveCacheFile(cacheDir: string, download: DownloadArtifact): string {
  return join(cacheDir, `${buildCacheKey(download)}-${inferFileName(download)}`)
}

function resolveChecksumCacheFile(cacheDir: string, download: DownloadArtifact): string {
  return join(cacheDir, 'checksums', `${buildChecksumCacheKey(download)}.txt`)
}

async function fetchWithRetry(options: {
  url: string
  fetchImpl: typeof fetch
  retryCount: number
}): Promise<Response> {
  const maxAttempts = Math.max(1, options.retryCount + 1)
  let lastError: unknown

  // 对网络抖动类错误做有限重试；命中非重试错误时立即返回。
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await options.fetchImpl(options.url)
      if (!response.ok) {
        throw makeError('DOWNLOAD_FAILED', `Download failed (${response.status}): ${options.url}`)
      }
      return response
    } catch (error) {
      lastError = error
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      const retryable = code === undefined || DOWNLOAD_RETRYABLE_CODES.has(code as ErrorCode)
      if (!retryable || attempt >= maxAttempts) {
        break
      }
    }
  }

  if (lastError instanceof Error && 'code' in lastError && lastError.code === 'DOWNLOAD_FAILED') {
    throw makeError(
      'DOWNLOAD_RETRY_EXHAUSTED',
      `Download retries exhausted: ${options.url}. ${lastError.message}`,
    )
  }

  if (lastError instanceof Error) {
    throw makeError(
      'DOWNLOAD_RETRY_EXHAUSTED',
      `Download retries exhausted: ${options.url}. ${lastError.message}`,
    )
  }

  throw makeError('DOWNLOAD_RETRY_EXHAUSTED', `Download retries exhausted: ${options.url}`)
}

async function loadChecksumText(options: {
  download: DownloadArtifact
  cacheDir: string
  fetchImpl: typeof fetch
  retryCount: number
}): Promise<string> {
  if (!options.download.checksumUrl) {
    return ''
  }

  const cacheFile = resolveChecksumCacheFile(options.cacheDir, options.download)

  try {
    return await readFile(cacheFile, 'utf8')
  } catch {
    // checksum 文本未命中缓存时，再走网络请求。
  }

  const inFlight = inFlightChecksums.get(cacheFile)
  if (inFlight) {
    return inFlight
  }

  const nextPromise = (async () => {
    const response = await fetchWithRetry({
      url: options.download.checksumUrl!,
      fetchImpl: options.fetchImpl,
      retryCount: options.retryCount,
    })
    const checksumText = await response.text()
    await mkdir(join(options.cacheDir, 'checksums'), { recursive: true })
    await writeFile(cacheFile, checksumText, 'utf8')
    return checksumText
  })()

  inFlightChecksums.set(cacheFile, nextPromise)
  try {
    return await nextPromise
  } finally {
    inFlightChecksums.delete(cacheFile)
  }
}

async function downloadArtifact(options: {
  download: DownloadArtifact
  cacheDir: string
  cacheFile: string
  fetchImpl: typeof fetch
  retryCount: number
}): Promise<DownloadResolvedArtifact> {
  try {
    const cacheStat = await stat(options.cacheFile)
    if (cacheStat.isFile()) {
      // 已有缓存文件时仍重新校验 checksum，避免脏缓存被静默复用。
      await verifyChecksumIfNeeded(
        options.download,
        options.cacheFile,
        options.cacheDir,
        options.fetchImpl,
        options.retryCount,
      )
      return {
        artifact: options.download,
        localPath: options.cacheFile,
        cacheHit: true,
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const response = await fetchDownloadPayload({
    download: options.download,
    fetchImpl: options.fetchImpl,
    retryCount: options.retryCount,
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(options.cacheFile, bytes)

  await verifyChecksumIfNeeded(
    options.download,
    options.cacheFile,
    options.cacheDir,
    options.fetchImpl,
    options.retryCount,
  )

  return {
    artifact: options.download,
    localPath: options.cacheFile,
    cacheHit: false,
  }
}

async function fetchDownloadPayload(options: {
  download: DownloadArtifact
  fetchImpl: typeof fetch
  retryCount: number
}): Promise<Response> {
  const initialResponse = await fetchWithRetry({
    url: options.download.url,
    fetchImpl: options.fetchImpl,
    retryCount: options.retryCount,
  })

  const contentType = initialResponse.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return initialResponse
  }

  const payload = await initialResponse.json().catch(() => undefined)
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('url' in payload) ||
    typeof payload.url !== 'string' ||
    payload.url.length === 0
  ) {
    throw makeError(
      'DOWNLOAD_FAILED',
      `Download indirection did not return a valid url: ${options.download.url}`,
    )
  }

  const resolvedUrl = payload.url
  ensureOfficialHostForTool(options.download.tool, new URL(resolvedUrl).host, resolvedUrl)

  return fetchWithRetry({
    url: resolvedUrl,
    fetchImpl: options.fetchImpl,
    retryCount: options.retryCount,
  })
}

async function verifyChecksumIfNeeded(
  download: DownloadArtifact,
  localPath: string,
  cacheDir: string,
  fetchImpl: typeof fetch,
  retryCount: number,
): Promise<void> {
  if (!download.checksumUrl || download.checksumAlgorithm !== 'sha256') {
    return
  }

  const checksumText = await loadChecksumText({
    download,
    cacheDir,
    fetchImpl,
    retryCount,
  })
  const targetName = inferChecksumTargetName(download)
  const expectedHash = parseExpectedChecksum(checksumText, targetName)

  if (!expectedHash) {
    throw makeError(
      'DOWNLOAD_CHECKSUM_FAILED',
      `Unable to locate checksum for ${targetName} from ${download.checksumUrl}`,
    )
  }

  const fileContent = await readFile(localPath)
  const actualHash = createHash('sha256').update(fileContent).digest('hex')

  if (actualHash !== expectedHash) {
    throw makeError(
      'DOWNLOAD_CHECKSUM_FAILED',
      `SHA-256 mismatch for ${targetName}: expected ${expectedHash}, got ${actualHash}`,
    )
  }
}

function parseExpectedChecksum(checksumText: string, fileName: string): string | undefined {
  const line = checksumText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(` ${fileName}`) || entry.endsWith(`*${fileName}`))

  if (!line) {
    return undefined
  }

  const [hash] = line.split(/\s+/)
  return hash?.toLowerCase()
}

export function validateOfficialDownloads(downloads: DownloadArtifact[]): void {
  for (const download of downloads) {
    ensureOfficialHost(download)
  }
}

export async function downloadArtifacts(
  options: DownloadArtifactsOptions,
): Promise<DownloadResolvedArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const retryCount = options.retryCount ?? 2

  await mkdir(options.cacheDir, { recursive: true })

  const downloadableArtifacts = getDownloadableArtifacts(options.downloads)
  validateOfficialDownloads(downloadableArtifacts)

  return Promise.all(
    downloadableArtifacts.map(async (download) => {
      const cacheFile = resolveCacheFile(options.cacheDir, download)
      const inFlight = inFlightDownloads.get(cacheFile)
      if (inFlight) {
        return inFlight
      }

      const nextPromise = (async () => {
        try {
          return await downloadArtifact({
            download,
            cacheDir: options.cacheDir,
            cacheFile,
            fetchImpl,
            retryCount,
          })
        } catch (error) {
          if ((error as { code?: ErrorCode }).code === 'DOWNLOAD_CHECKSUM_FAILED') {
            // 校验失败通常意味着缓存文件损坏；删掉后重新执行完整下载。
            await rm(cacheFile, { force: true }).catch(() => undefined)
            return downloadArtifact({
              download,
              cacheDir: options.cacheDir,
              cacheFile,
              fetchImpl,
              retryCount,
            })
          }
          throw error
        }
      })()

      inFlightDownloads.set(cacheFile, nextPromise)
      try {
        return await nextPromise
      } finally {
        inFlightDownloads.delete(cacheFile)
      }
    }),
  )
}
