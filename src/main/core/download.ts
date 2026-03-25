import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { DownloadArtifact, ErrorCode } from './contracts'

const OFFICIAL_DOWNLOAD_HOSTS: Record<DownloadArtifact['tool'], Set<string>> = {
  node: new Set(['nodejs.org']),
  nvm: new Set(['github.com']),
  'nvm-windows': new Set(['github.com']),
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

function makeError(code: ErrorCode, message: string): DownloadError {
  const error = new Error(message) as DownloadError
  error.code = code
  return error
}

function getArchiveArtifacts(downloads: DownloadArtifact[]): DownloadArtifact[] {
  return downloads.filter((download) => download.kind === 'archive')
}

function ensureOfficialHost(download: DownloadArtifact): void {
  const allowedHosts = OFFICIAL_DOWNLOAD_HOSTS[download.tool]
  const host = new URL(download.url).host
  if (!allowedHosts.has(host)) {
    throw makeError('DOWNLOAD_HOST_UNTRUSTED', `Unofficial download host: ${download.url}`)
  }

  if (download.checksumUrl) {
    const checksumHost = new URL(download.checksumUrl).host
    if (!allowedHosts.has(checksumHost)) {
      throw makeError('DOWNLOAD_HOST_UNTRUSTED', `Unofficial checksum host: ${download.checksumUrl}`)
    }
  }
}

function buildCacheKey(download: DownloadArtifact): string {
  const payload = JSON.stringify({
    url: download.url,
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

async function fetchWithRetry(options: {
  url: string
  fetchImpl: typeof fetch
  retryCount: number
}): Promise<Response> {
  const maxAttempts = Math.max(1, options.retryCount + 1)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await options.fetchImpl(options.url)
      if (!response.ok) {
        throw makeError('DOWNLOAD_FAILED', `Download failed (${response.status}): ${options.url}`)
      }
      return response
    } catch (error) {
      lastError = error
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
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

async function downloadArchive(options: {
  download: DownloadArtifact
  cacheDir: string
  fetchImpl: typeof fetch
  retryCount: number
}): Promise<DownloadResolvedArtifact> {
  const cacheKey = buildCacheKey(options.download)
  const cacheFile = join(options.cacheDir, `${cacheKey}-${inferFileName(options.download)}`)

  try {
    const cacheStat = await stat(cacheFile)
    if (cacheStat.isFile()) {
      await verifyChecksumIfNeeded(options.download, cacheFile, options.fetchImpl, options.retryCount)
      return {
        artifact: options.download,
        localPath: cacheFile,
        cacheHit: true,
      }
    }
  } catch {
    // cache miss
  }

  const response = await fetchWithRetry({
    url: options.download.url,
    fetchImpl: options.fetchImpl,
    retryCount: options.retryCount,
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(cacheFile, bytes)

  await verifyChecksumIfNeeded(options.download, cacheFile, options.fetchImpl, options.retryCount)

  return {
    artifact: options.download,
    localPath: cacheFile,
    cacheHit: false,
  }
}

async function verifyChecksumIfNeeded(
  download: DownloadArtifact,
  localPath: string,
  fetchImpl: typeof fetch,
  retryCount: number,
): Promise<void> {
  if (!download.checksumUrl || download.checksumAlgorithm !== 'sha256') {
    return
  }

  const response = await fetchWithRetry({
    url: download.checksumUrl,
    fetchImpl,
    retryCount,
  })

  const checksumText = await response.text()
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
  for (const download of getArchiveArtifacts(downloads)) {
    ensureOfficialHost(download)
  }
}

export async function downloadArtifacts(
  options: DownloadArtifactsOptions,
): Promise<DownloadResolvedArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const retryCount = options.retryCount ?? 2

  await mkdir(options.cacheDir, { recursive: true })

  const archiveDownloads = getArchiveArtifacts(options.downloads)
  validateOfficialDownloads(archiveDownloads)

  const resolved: DownloadResolvedArtifact[] = []
  for (const download of archiveDownloads) {
    resolved.push(
      await downloadArchive({
        download,
        cacheDir: options.cacheDir,
        fetchImpl,
        retryCount,
      }),
    )
  }

  return resolved
}
