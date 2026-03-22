import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type AppPaths = {
  rootDir: string
  tasksDir: string
  pluginsDir: string
  pluginStagingDir: string
}

export function getAppPaths(baseDir = join(process.cwd(), '.envsetup-data')): AppPaths {
  return {
    rootDir: baseDir,
    tasksDir: join(baseDir, 'tasks'),
    pluginsDir: join(baseDir, 'plugins'),
    pluginStagingDir: join(baseDir, 'plugin-staging'),
  }
}

export async function ensureAppPaths(baseDir?: string): Promise<AppPaths> {
  const paths = getAppPaths(baseDir)
  await Promise.all([
    mkdir(paths.rootDir, { recursive: true }),
    mkdir(paths.tasksDir, { recursive: true }),
    mkdir(paths.pluginsDir, { recursive: true }),
    mkdir(paths.pluginStagingDir, { recursive: true }),
  ])
  return paths
}
