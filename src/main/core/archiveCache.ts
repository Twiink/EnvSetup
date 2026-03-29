/**
 * 缓存已解压的归档文件，避免重复安装时再次解包。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MANIFEST_FILE = '.extract-meta.json'

type ArchiveFormat = 'tar.gz' | 'zip'

type ExtractionManifest = {
  archivePath: string
  format: ArchiveFormat
  mtimeMs: number
  size: number
  singleRootName?: string
}

export type PreparedExtractedArchive = {
  cacheHit: boolean
  extractionDir: string
  extractedRootDir?: string
}

const inFlightExtractions = new Map<string, Promise<PreparedExtractedArchive>>()
// 解压流程也按缓存键做并发去重，避免多个任务同时写同一目录。

function quotePowerShell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function buildExtractionKey(archivePath: string, format: ArchiveFormat): string {
  return createHash('sha256').update(`${archivePath}:${format}`).digest('hex')
}

async function loadManifest(extractionDir: string): Promise<ExtractionManifest | undefined> {
  try {
    const content = await readFile(join(extractionDir, MANIFEST_FILE), 'utf8')
    return JSON.parse(content) as ExtractionManifest
  } catch {
    return undefined
  }
}

async function detectSingleRootName(extractionDir: string): Promise<string | undefined> {
  const entries = await readdir(extractionDir, { withFileTypes: true })
  const relevantEntries = entries.filter((entry) => entry.name !== MANIFEST_FILE)
  if (relevantEntries.length !== 1 || !relevantEntries[0]?.isDirectory()) {
    return undefined
  }

  return relevantEntries[0].name
}

async function hasExtractedEntries(extractionDir: string): Promise<boolean> {
  try {
    const entries = await readdir(extractionDir)
    return entries.some((entry) => entry !== MANIFEST_FILE)
  } catch {
    return false
  }
}

async function isCacheUsable(
  extractionDir: string,
  archivePath: string,
  format: ArchiveFormat,
): Promise<PreparedExtractedArchive | undefined> {
  const [manifest, archiveStat] = await Promise.all([
    loadManifest(extractionDir),
    stat(archivePath),
  ])

  if (
    !manifest ||
    manifest.archivePath !== archivePath ||
    manifest.format !== format ||
    manifest.size !== archiveStat.size ||
    manifest.mtimeMs !== archiveStat.mtimeMs ||
    !(await hasExtractedEntries(extractionDir))
  ) {
    return undefined
  }

  const extractedRootDir = manifest.singleRootName
    ? join(extractionDir, manifest.singleRootName)
    : undefined

  if (extractedRootDir) {
    try {
      const rootStat = await stat(extractedRootDir)
      if (!rootStat.isDirectory()) {
        return undefined
      }
    } catch {
      return undefined
    }
  }

  return {
    cacheHit: true,
    extractionDir,
    extractedRootDir,
  }
}

async function extractArchive(
  archivePath: string,
  format: ArchiveFormat,
  destinationDir: string,
): Promise<void> {
  if (format === 'tar.gz') {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', destinationDir])
    return
  }

  if (process.platform === 'win32') {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destinationDir)} -Force`,
    ])
    return
  }

  await execFileAsync('ditto', ['-x', '-k', archivePath, destinationDir])
}

export async function prepareExtractedArchive(options: {
  archivePath: string
  cacheDir: string
  format: ArchiveFormat
}): Promise<PreparedExtractedArchive> {
  const cacheKey = buildExtractionKey(options.archivePath, options.format)
  const extractionDir = join(options.cacheDir, cacheKey)
  const inFlightKey = `${options.cacheDir}:${cacheKey}`
  const cached = await isCacheUsable(extractionDir, options.archivePath, options.format)
  if (cached) {
    return cached
  }

  const pending = inFlightExtractions.get(inFlightKey)
  if (pending) {
    return pending
  }

  const nextPromise = (async () => {
    await mkdir(options.cacheDir, { recursive: true })
    const tempExtractionDir = join(
      options.cacheDir,
      `.tmp-${cacheKey}-${process.pid}-${Date.now().toString(36)}`,
    )

    try {
      // 先写临时目录，最后整体替换正式缓存目录，避免中断后留下半成品缓存。
      await rm(tempExtractionDir, { recursive: true, force: true })
      await mkdir(tempExtractionDir, { recursive: true })
      await extractArchive(options.archivePath, options.format, tempExtractionDir)
      const singleRootName = await detectSingleRootName(tempExtractionDir)
      const archiveStat = await stat(options.archivePath)
      const manifest: ExtractionManifest = {
        archivePath: options.archivePath,
        format: options.format,
        mtimeMs: archiveStat.mtimeMs,
        size: archiveStat.size,
        singleRootName,
      }

      await writeFile(join(tempExtractionDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2))
      await rm(extractionDir, { recursive: true, force: true })
      await rename(tempExtractionDir, extractionDir)

      return {
        cacheHit: false,
        extractionDir,
        extractedRootDir: singleRootName ? join(extractionDir, singleRootName) : undefined,
      }
    } catch (error) {
      await rm(tempExtractionDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  })()

  inFlightExtractions.set(inFlightKey, nextPromise)
  try {
    return await nextPromise
  } finally {
    inFlightExtractions.delete(inFlightKey)
  }
}
