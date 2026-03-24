import { BrowserWindow, dialog, ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureAppPaths } from '../core/appPaths'
import { cleanupDetectedEnvironment } from '../core/environment'
import { runPrecheck as runEnhancedPrecheck } from '../core/enhancedPrecheck'
import { listNodeLtsVersions } from '../core/nodeVersions'
import { importPluginFromDirectory, importPluginFromZip } from '../core/plugin'
import { buildRuntimePrecheckInput, runPrecheck } from '../core/precheck'
import { executeRollback, suggestRollbackSnapshots } from '../core/rollback'
import {
  createSnapshot,
  deleteSnapshot,
  loadSnapshotMeta,
  markSnapshotDeletable,
  saveSnapshotMeta,
} from '../core/snapshot'
import {
  cancelTask,
  createTask,
  executeTask,
  loadTask,
  persistTask,
  retryTaskPlugin,
  type PluginRegistry,
} from '../core/task'
import { loadTemplatesFromDirectory, mapTemplateValuesToPluginParams } from '../core/template'
import type {
  DetectedEnvironment,
  FailureAnalysis,
  InstallTask,
  PluginInstallResult,
  Primitive,
  ResolvedTemplate,
} from '../core/contracts'
import frontendEnvPlugin from '../plugins/frontendEnvPlugin'
import { normalizeLocale } from '../../shared/locale'

const BUILTIN_TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/templates')
const BUILTIN_PLUGINS: PluginRegistry = {
  'frontend-env': frontendEnvPlugin,
}

const taskCache = new Map<string, InstallTask>()
let ipcRegistered = false

async function listTemplates(): Promise<ResolvedTemplate[]> {
  return loadTemplatesFromDirectory(BUILTIN_TEMPLATE_DIR)
}

async function getTemplate(templateId: string): Promise<ResolvedTemplate> {
  const template = (await listTemplates()).find((entry) => entry.id === templateId)
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }
  return template
}

async function getTask(taskId: string, tasksDir: string): Promise<InstallTask> {
  return taskCache.get(taskId) ?? loadTask(taskId, tasksDir)
}

export function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return
  }

  ipcRegistered = true

  ipcMain.handle('template:list', async () => listTemplates())
  ipcMain.handle('node:list-lts-versions', async () => listNodeLtsVersions())
  ipcMain.handle('environment:cleanup', async (_event, detection: DetectedEnvironment) =>
    cleanupDetectedEnvironment(detection),
  )

  ipcMain.handle(
    'task:precheck',
    async (
      _event,
      payload: { templateId: string; values: Record<string, Primitive>; locale: string },
    ) => {
      const template = await getTemplate(payload.templateId)
      const input = await buildRuntimePrecheckInput(template, payload.values)
      return runPrecheck(input, normalizeLocale(payload.locale))
    },
  )

  ipcMain.handle(
    'task:create',
    async (
      _event,
      payload: {
        templateId: string
        values: Record<string, Primitive>
        precheck?: InstallTask['precheck']
        locale: string
      },
    ) => {
      const [paths, template] = await Promise.all([
        ensureAppPaths(),
        getTemplate(payload.templateId),
      ])
      const task = createTask({
        templateId: template.id,
        templateVersion: template.version,
        locale: normalizeLocale(payload.locale),
        params: payload.values,
        precheck: payload.precheck,
        plugins: template.plugins.map((plugin) => ({
          pluginId: plugin.pluginId,
          version: plugin.version,
          params: mapTemplateValuesToPluginParams(plugin.pluginId, payload.values),
        })),
      })

      taskCache.set(task.id, task)
      await persistTask(task, paths.tasksDir)

      return task
    },
  )

  ipcMain.handle('task:start', async (_event, taskId: string) => {
    const paths = await ensureAppPaths()
    const task = await getTask(taskId, paths.tasksDir)

    // 任务开始前创建快照，收集各插件会写入的路径
    const pluginTrackedPaths = task.plugins.flatMap((plugin) => {
      const candidates = [
        plugin.params.installRootDir,
        plugin.params.npmCacheDir,
        plugin.params.npmGlobalPrefix,
      ]
      return candidates.filter((p): p is string => typeof p === 'string' && p.length > 0)
    })

    let snapshotId: string | undefined
    try {
      const snapshot = await createSnapshot({
        baseDir: paths.snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [...new Set(pluginTrackedPaths)],
      })
      snapshotId = snapshot.id
    } catch {
      // 快照创建失败不阻断任务执行
    }

    const nextTask = await executeTask({
      task,
      registry: BUILTIN_PLUGINS,
      platform: process.platform === 'win32' ? 'win32' : 'darwin',
      tasksDir: paths.tasksDir,
      dryRun: process.env.ENVSETUP_REAL_RUN !== '1',
    })

    const taskWithSnapshot: typeof nextTask = { ...nextTask, snapshotId }

    // 任务成功时标记快照可删除
    if (nextTask.status === 'succeeded' && snapshotId) {
      try {
        await markSnapshotDeletable(paths.snapshotsDir, snapshotId)
      } catch {
        // 非关键操作，忽略错误
      }
    }

    // 任务失败时生成回滚建议
    if (nextTask.status === 'failed' && snapshotId) {
      try {
        const rollbackSuggestions = await suggestRollbackSnapshots(paths.snapshotsDir, task.id)
        Object.assign(taskWithSnapshot, { rollbackSuggestions })
      } catch {
        // 非关键操作，忽略错误
      }
    }

    taskCache.set(taskWithSnapshot.id, taskWithSnapshot)
    return taskWithSnapshot
  })

  ipcMain.handle('task:cancel', async (_event, taskId: string) => {
    const paths = await ensureAppPaths()
    const task = await getTask(taskId, paths.tasksDir)
    const nextTask = await cancelTask({ task, tasksDir: paths.tasksDir })
    taskCache.set(nextTask.id, nextTask)
    return nextTask
  })

  ipcMain.handle(
    'task:retry-plugin',
    async (_event, payload: { taskId: string; pluginId: string }) => {
      const paths = await ensureAppPaths()
      const task = await getTask(payload.taskId, paths.tasksDir)
      const nextTask = await retryTaskPlugin({
        task,
        pluginId: payload.pluginId,
        registry: BUILTIN_PLUGINS,
        platform: process.platform === 'win32' ? 'win32' : 'darwin',
        tasksDir: paths.tasksDir,
        dryRun: process.env.ENVSETUP_REAL_RUN !== '1',
      })
      taskCache.set(nextTask.id, nextTask)
      return nextTask
    },
  )

  ipcMain.handle('plugin:import', async (_event, payload: { path: string }) => {
    const paths = await ensureAppPaths()
    const pathStat = await stat(payload.path)

    if (pathStat.isDirectory()) {
      return importPluginFromDirectory(payload.path, {
        registryDir: paths.pluginsDir,
      })
    }

    if (extname(payload.path).toLowerCase() === '.zip') {
      return importPluginFromZip(payload.path, paths.pluginStagingDir, {
        registryDir: paths.pluginsDir,
      })
    }

    throw new Error(`Unsupported plugin import path: ${payload.path}`)
  })

  ipcMain.handle('dialog:pick-directory', async (_event, payload?: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? undefined, {
      defaultPath: payload?.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })

    return result.canceled ? undefined : result.filePaths[0]
  })

  // 快照管理
  ipcMain.handle('snapshot:list', async () => {
    const paths = await ensureAppPaths()
    return loadSnapshotMeta(paths.snapshotsDir)
  })

  ipcMain.handle(
    'snapshot:create',
    async (_event, payload: { taskId?: string; label?: string }) => {
      if (!payload.taskId) {
        throw new Error('taskId is required to create a snapshot')
      }
      const paths = await ensureAppPaths()
      // Collect tracked paths from the cached task if available
      const cachedTask = taskCache.get(payload.taskId)
      const manualTrackedPaths = cachedTask
        ? [
            ...new Set(
              cachedTask.plugins.flatMap((plugin) => {
                const candidates = [
                  plugin.params.installRootDir,
                  plugin.params.npmCacheDir,
                  plugin.params.npmGlobalPrefix,
                ]
                return candidates.filter((p): p is string => typeof p === 'string' && p.length > 0)
              }),
            ),
          ]
        : []
      return createSnapshot({
        baseDir: paths.snapshotsDir,
        taskId: payload.taskId,
        type: 'manual',
        label: payload.label,
        trackedPaths: manualTrackedPaths,
      })
    },
  )

  ipcMain.handle('snapshot:delete', async (_event, snapshotId: string) => {
    const paths = await ensureAppPaths()
    await deleteSnapshot(paths.snapshotsDir, snapshotId)
    // 同步移除 meta 中的条目，保证列表与磁盘一致
    const meta = await loadSnapshotMeta(paths.snapshotsDir)
    meta.snapshots = meta.snapshots.filter((s) => s.id !== snapshotId)
    await saveSnapshotMeta(paths.snapshotsDir, meta)
  })

  // 回滚
  ipcMain.handle(
    'rollback:suggest',
    async (_event, payload: { taskId: string; failureAnalysis?: FailureAnalysis }) => {
      const paths = await ensureAppPaths()
      return suggestRollbackSnapshots(paths.snapshotsDir, payload.taskId, payload.failureAnalysis)
    },
  )

  ipcMain.handle(
    'rollback:execute',
    async (_event, payload: { snapshotId: string; trackedPaths?: string[] }) => {
      const paths = await ensureAppPaths()
      return executeRollback(paths.snapshotsDir, payload.snapshotId, payload.trackedPaths ?? [])
    },
  )

  // 增强预检
  ipcMain.handle(
    'precheck:enhanced',
    async (
      _event,
      payload: { pluginResults: PluginInstallResult[]; installedVersions?: Record<string, string> },
    ) => {
      return runEnhancedPrecheck(payload.pluginResults, payload.installedVersions)
    },
  )
}
