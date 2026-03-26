import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type AppPaths = {
  rootDir: string
  tasksDir: string
  pluginsDir: string
  pluginStagingDir: string
  snapshotsDir: string
  downloadCacheDir: string
}

function resolveDefaultAppDataDir(): string {
  const overriddenBaseDir = process.env.ENVSETUP_DATA_DIR

  return overriddenBaseDir && overriddenBaseDir.trim().length > 0
    ? overriddenBaseDir
    : join(process.cwd(), '.envsetup-data')
}

export function getAppPaths(baseDir = resolveDefaultAppDataDir()): AppPaths {
  return {
    rootDir: baseDir,
    tasksDir: join(baseDir, 'tasks'),
    pluginsDir: join(baseDir, 'plugins'),
    pluginStagingDir: join(baseDir, 'plugin-staging'),
    snapshotsDir: join(baseDir, 'snapshots'),
    downloadCacheDir: join(baseDir, 'downloads-cache'),
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
  ])
  return paths
}
