/**
 * 统一管理下载缓存、解包缓存、快照和插件状态等用户级目录。
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type AppPaths = {
  rootDir: string
  tasksDir: string
  pluginsDir: string
  pluginStagingDir: string
  snapshotsDir: string
  downloadCacheDir: string
  extractedCacheDir: string
}

function resolveDefaultAppDataDir(): string {
  const overriddenBaseDir = process.env.ENVSETUP_DATA_DIR

  return overriddenBaseDir && overriddenBaseDir.trim().length > 0
    ? overriddenBaseDir
    : join(process.cwd(), '.envsetup-data')
}

function resolveOptionalDirOverride(envKey: string): string | undefined {
  const value = process.env[envKey]
  return value && value.trim().length > 0 ? value : undefined
}

export function getAppPaths(baseDir = resolveDefaultAppDataDir()): AppPaths {
  const downloadCacheDir =
    resolveOptionalDirOverride('ENVSETUP_DOWNLOAD_CACHE_DIR') ?? join(baseDir, 'downloads-cache')
  const extractedCacheDir =
    resolveOptionalDirOverride('ENVSETUP_EXTRACTED_CACHE_DIR') ?? join(baseDir, 'extracted-cache')

  return {
    rootDir: baseDir,
    tasksDir: join(baseDir, 'tasks'),
    pluginsDir: join(baseDir, 'plugins'),
    pluginStagingDir: join(baseDir, 'plugin-staging'),
    snapshotsDir: join(baseDir, 'snapshots'),
    downloadCacheDir,
    extractedCacheDir,
  }
}

export async function ensureAppPaths(baseDir?: string): Promise<AppPaths> {
  const paths = getAppPaths(baseDir)
  await Promise.all([
    mkdir(paths.rootDir, { recursive: true }),
    mkdir(paths.tasksDir, { recursive: true }),
    mkdir(paths.pluginsDir, { recursive: true }),
    mkdir(paths.pluginStagingDir, { recursive: true }),
    mkdir(paths.snapshotsDir, { recursive: true }),
    mkdir(paths.downloadCacheDir, { recursive: true }),
    mkdir(paths.extractedCacheDir, { recursive: true }),
  ])
  return paths
}
