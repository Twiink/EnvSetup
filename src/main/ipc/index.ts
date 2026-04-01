/**
 * 注册渲染层可调用的模板、任务、快照与回滚 IPC 接口。
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getMainWindow } from '../index'
import { ensureAppPaths } from '../core/appPaths'
import { applyEnvChanges, previewEnvChanges } from '../core/envPersistence'
import {
  cleanupDetectedEnvironment,
  cleanupDetectedEnvironments,
  collectCleanupTrackedPaths,
} from '../core/environment'
import { resolveDryRun } from '../core/executionMode'
import { runPrecheck as runEnhancedPrecheck } from '../core/enhancedPrecheck'
import { listNodeLtsVersions as fetchNodeLtsVersions } from '../core/nodeVersions'
import { listJavaLtsVersions as fetchJavaLtsVersions } from '../core/javaVersions'
import { listPythonVersions as fetchPythonVersions } from '../core/pythonVersions'
import { listGitVersions as fetchGitVersions } from '../core/gitVersions'
import { listMysqlVersions as fetchMysqlVersions } from '../core/mysqlVersions'
import { listRedisVersions as fetchRedisVersions } from '../core/redisVersions'
import { listMavenVersions as fetchMavenVersions } from '../core/mavenVersions'
import {
  importPluginFromDirectory,
  importPluginFromZip,
  listImportedPluginsFromRegistry,
  loadPluginLifecycle,
} from '../core/plugin'
import { buildRuntimePrecheckInput, runPrecheck } from '../core/precheck'
import { executeRollback, suggestRollbackSnapshots } from '../core/rollback'
import { createRuntimeCache } from '../core/runtimeCache'
import {
  createSnapshot,
  deleteSnapshot,
  loadSnapshot,
  loadSnapshotMeta,
  markSnapshotDeletable,
  saveSnapshotMeta,
  updateSnapshotMeta,
} from '../core/snapshot'
import {
  cancelTask,
  createTask,
  executeTask,
  loadTask,
  prepareTaskPluginRetry,
  persistTask,
  type PluginRegistry,
} from '../core/task'
import {
  buildImportedPluginTemplate,
  loadTemplatesFromDirectory,
  mapTemplateValuesToPluginParams,
} from '../core/template'
import type {
  BootstrapData,
  DetectedEnvironment,
  EnvChange,
  FailureAnalysis,
  ImportedPluginRegistration,
  InstallTask,
  PluginInstallResult,
  Primitive,
  ResolvedTemplate,
  TaskProgressEvent,
} from '../core/contracts'
import nodeEnvPlugin from '../plugins/nodeEnvPlugin'
import javaEnvPlugin from '../plugins/javaEnvPlugin'
import pythonEnvPlugin from '../plugins/pythonEnvPlugin'
import gitEnvPlugin from '../plugins/gitEnvPlugin'
import mysqlEnvPlugin from '../plugins/mysqlEnvPlugin'
import redisEnvPlugin from '../plugins/redisEnvPlugin'
import mavenEnvPlugin from '../plugins/mavenEnvPlugin'
import { normalizeLocale } from '../../shared/locale'

const BUILTIN_TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/templates',
)
const BUILTIN_PLUGINS: PluginRegistry = {
  'node-env': nodeEnvPlugin,
  'java-env': javaEnvPlugin,
  'python-env': pythonEnvPlugin,
  'git-env': gitEnvPlugin,
  'mysql-env': mysqlEnvPlugin,
  'redis-env': redisEnvPlugin,
  'maven-env': mavenEnvPlugin,
}

const TEMPLATE_CACHE_TTL_MS = 60_000
const VERSION_CACHE_TTL_MS = 5 * 60_000
const BOOTSTRAP_CACHE_TTL_MS = 60_000
const PRECHECK_CACHE_TTL_MS = 15_000
const PRECHECK_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'JAVA_HOME',
  'SDKMAN_DIR',
  'CONDA_PREFIX',
  'VIRTUAL_ENV',
  'PYENV_ROOT',
  'NVM_DIR',
  'NVM_HOME',
  'NVM_SYMLINK',
  'npm_config_prefix',
  'GIT_HOME',
  'SCOOP',
  'MYSQL_HOME',
  'REDIS_HOME',
  'MAVEN_HOME',
  'M2_HOME',
] as const

const templatesCache = createRuntimeCache<ResolvedTemplate[]>()
const versionsCache = createRuntimeCache<string[]>()
const bootstrapCache = createRuntimeCache<BootstrapData>()
const precheckCache =
  createRuntimeCache<ReturnType<typeof runPrecheck> extends Promise<infer T> ? T : never>()
// 主进程缓存只保存派生数据，安装/清理/回滚后统一失效，避免界面继续读到旧状态。

const taskCache = new Map<string, InstallTask>()
const runningTaskControllers = new Map<string, AbortController>()
const runningTaskExecutions = new Map<string, Promise<void>>()
let ipcRegistered = false

async function listTemplates(): Promise<ResolvedTemplate[]> {
  return templatesCache.getOrLoad('builtin-templates', TEMPLATE_CACHE_TTL_MS, async () => {
    const [paths, builtinTemplates] = await Promise.all([
      ensureAppPaths(),
      loadTemplatesFromDirectory(BUILTIN_TEMPLATE_DIR),
    ])
    const importedPlugins = await listImportedPluginsFromRegistry(paths.pluginsDir, {
      appVersion: app.getVersion(),
    })
    const importedTemplates = importedPlugins.map((plugin) =>
      buildImportedPluginTemplate(plugin.manifest, {
        dataRootDir: paths.rootDir,
      }),
    )

    return [...builtinTemplates, ...importedTemplates]
  })
}

function buildPrecheckEnvironmentFingerprint(): string {
  // 把预检依赖的关键环境变量折叠成指纹，环境变化后自动绕开旧缓存。
  return JSON.stringify(
    Object.fromEntries(PRECHECK_ENV_KEYS.map((key) => [key, process.env[key] ?? ''])),
  )
}

async function listNodeLtsVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('node-lts', VERSION_CACHE_TTL_MS, () => fetchNodeLtsVersions())
}

async function listJavaLtsVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('java-lts', VERSION_CACHE_TTL_MS, () => fetchJavaLtsVersions())
}

async function listPythonVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('python', VERSION_CACHE_TTL_MS, () => fetchPythonVersions())
}

async function listGitVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('git', VERSION_CACHE_TTL_MS, () =>
    fetchGitVersions(process.platform === 'win32' ? 'win32' : 'darwin'),
  )
}

async function listMysqlVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('mysql', VERSION_CACHE_TTL_MS, () => fetchMysqlVersions())
}

async function listRedisVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('redis', VERSION_CACHE_TTL_MS, () =>
    fetchRedisVersions(process.platform === 'win32' ? 'win32' : 'darwin'),
  )
}

async function listMavenVersionsCached(): Promise<string[]> {
  return versionsCache.getOrLoad('maven', VERSION_CACHE_TTL_MS, () => fetchMavenVersions())
}

async function loadBootstrap(): Promise<BootstrapData> {
  return bootstrapCache.getOrLoad('bootstrap', BOOTSTRAP_CACHE_TTL_MS, async () => {
    // 首屏把模板和版本列表一次性并发拉齐，减少 renderer 多次 IPC 往返。
    const [
      templates,
      nodeLtsVersions,
      javaLtsVersions,
      pythonVersions,
      gitVersions,
      mysqlVersions,
      redisVersions,
      mavenVersions,
    ] = await Promise.all([
      listTemplates(),
      listNodeLtsVersionsCached(),
      listJavaLtsVersionsCached(),
      listPythonVersionsCached(),
      listGitVersionsCached(),
      listMysqlVersionsCached(),
      listRedisVersionsCached(),
      listMavenVersionsCached(),
    ])

    return {
      templates,
      nodeLtsVersions,
      javaLtsVersions,
      pythonVersions,
      gitVersions,
      mysqlVersions,
      redisVersions,
      mavenVersions,
      loadedAt: new Date().toISOString(),
    }
  })
}

function clearRuntimeDerivedCaches(): void {
  precheckCache.clear()
  bootstrapCache.delete('bootstrap')
  templatesCache.clear()
}

function emitTaskProgress(event: TaskProgressEvent): void {
  if (event.taskSnapshot) {
    taskCache.set(event.taskSnapshot.id, event.taskSnapshot)
  }
  getMainWindow()?.webContents.send('task:progress', event)
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

async function buildPluginRegistry(paths: { pluginsDir: string }): Promise<PluginRegistry> {
  const importedPlugins = await listImportedPluginsFromRegistry(paths.pluginsDir, {
    appVersion: app.getVersion(),
  })
  const importedRegistry: PluginRegistry = {}

  for (const plugin of importedPlugins) {
    const lifecycle = await loadPluginLifecycle(plugin)
    const versionKey = `${plugin.manifest.id}@${plugin.manifest.version}`
    importedRegistry[versionKey] = lifecycle

    if (!(plugin.manifest.id in importedRegistry)) {
      importedRegistry[plugin.manifest.id] = lifecycle
    }
  }

  return {
    ...BUILTIN_PLUGINS,
    ...importedRegistry,
  }
}

async function getExecutionOptions(paths: {
  tasksDir: string
  downloadCacheDir: string
  extractedCacheDir: string
  pluginsDir: string
}) {
  return {
    registry: await buildPluginRegistry(paths),
    platform: (process.platform === 'win32' ? 'win32' : 'darwin') as 'win32' | 'darwin',
    tasksDir: paths.tasksDir,
    dryRun: resolveDryRun(app.isPackaged),
    runtimeContext: {
      downloadCacheDir: paths.downloadCacheDir,
      extractedCacheDir: paths.extractedCacheDir,
    },
    onProgress: emitTaskProgress,
  }
}

function collectTaskTrackedPaths(task: InstallTask): string[] {
  return [
    ...new Set(
      task.plugins.flatMap((plugin) => {
        const candidates = [
          plugin.params.installRootDir,
          plugin.params.npmCacheDir,
          plugin.params.npmGlobalPrefix,
        ]
        return candidates.filter((path): path is string => typeof path === 'string' && path.length > 0)
      }),
    ),
  ]
}

function markTaskAsRunning(task: InstallTask): InstallTask {
  const now = new Date().toISOString()
  return {
    ...task,
    status: 'running',
    startedAt: task.startedAt ?? now,
    updatedAt: now,
    finishedAt: undefined,
    resultLevel: undefined,
    rollbackSuggestions: undefined,
    plugins: task.plugins.map((plugin) => ({
      ...plugin,
      finishedAt: plugin.status === 'failed' ? undefined : plugin.finishedAt,
    })),
  }
}

async function finalizeBackgroundTask(
  task: InstallTask,
  paths: { snapshotsDir: string; tasksDir: string },
): Promise<InstallTask> {
  let nextTask = task

  if (nextTask.status === 'succeeded' && nextTask.snapshotId) {
    try {
      await markSnapshotDeletable(paths.snapshotsDir, nextTask.snapshotId)
    } catch (err) {
      console.warn(`[task:finalize] markSnapshotDeletable failed for snapshot ${nextTask.snapshotId}:`, err)
    }
  }

  if ((nextTask.status === 'failed' || nextTask.status === 'partially_succeeded') && nextTask.snapshotId) {
    try {
      const rollbackSuggestions = await suggestRollbackSnapshots(paths.snapshotsDir, nextTask.id)
      nextTask = { ...nextTask, rollbackSuggestions }
    } catch (err) {
      console.warn(`[task:finalize] suggestRollbackSnapshots failed for task ${nextTask.id}:`, err)
    }
  }

  taskCache.set(nextTask.id, nextTask)
  await persistTask(nextTask, paths.tasksDir)
  emitTaskProgress({
    taskId: nextTask.id,
    pluginId: 'task',
    type: 'task_done',
    message: `Task ${nextTask.status}`,
    timestamp: new Date().toISOString(),
    taskSnapshot: nextTask,
  })

  return nextTask
}

async function beginTaskExecution(options: {
  task: InstallTask
  paths: Awaited<ReturnType<typeof ensureAppPaths>>
}): Promise<InstallTask> {
  const executionOptions = await getExecutionOptions(options.paths)
  const controller = new AbortController()
  const runningTask = markTaskAsRunning(options.task)

  taskCache.set(runningTask.id, runningTask)
  await persistTask(runningTask, options.paths.tasksDir)

  const execution = executeTask({
    task: runningTask,
    ...executionOptions,
    abortSignal: controller.signal,
    emitTaskDone: false,
  })
    .then(async (nextTask) =>
      finalizeBackgroundTask(
        {
          ...nextTask,
          snapshotId: runningTask.snapshotId,
        },
        options.paths,
      ),
    )
    .catch(async (error) => {
      const failedTask: InstallTask = {
        ...runningTask,
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        plugins: runningTask.plugins.map((plugin) =>
          plugin.status === 'not_started' || plugin.status === 'running'
            ? {
                ...plugin,
                status: 'failed',
                errorCode: controller.signal.aborted ? 'USER_CANCELLED' : 'PLUGIN_EXECUTION_FAILED',
                error: error instanceof Error ? error.message : String(error),
                finishedAt: new Date().toISOString(),
              }
            : plugin,
        ),
      }

      return finalizeBackgroundTask(failedTask, options.paths)
    })
    .finally(() => {
      runningTaskControllers.delete(runningTask.id)
      runningTaskExecutions.delete(runningTask.id)
    })

  runningTaskControllers.set(runningTask.id, controller)
  runningTaskExecutions.set(runningTask.id, execution)

  return runningTask
}

export function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return
  }

  ipcRegistered = true

  ipcMain.handle('bootstrap:load', async () => loadBootstrap())
  ipcMain.handle('template:list', async () => listTemplates())
  ipcMain.handle('node:list-lts-versions', async () => listNodeLtsVersionsCached())
  ipcMain.handle('java:list-lts-versions', async () => listJavaLtsVersionsCached())
  ipcMain.handle('python:list-versions', async () => listPythonVersionsCached())
  ipcMain.handle('git:list-versions', async () => listGitVersionsCached())
  ipcMain.handle('mysql:list-versions', async () => listMysqlVersionsCached())
  ipcMain.handle('redis:list-versions', async () => listRedisVersionsCached())
  ipcMain.handle('maven:list-versions', async () => listMavenVersionsCached())
  ipcMain.handle('environment:cleanup', async (_event, detection: DetectedEnvironment) => {
    const result = await cleanupDetectedEnvironment(detection)
    clearRuntimeDerivedCaches()
    return result
  })
  ipcMain.handle('environment:cleanup-batch', async (_event, detections: DetectedEnvironment[]) => {
    const cleanupTargets = (detections ?? []).filter((detection) => detection.cleanupSupported)
    if (cleanupTargets.length === 0) {
      throw new Error('No cleanup-supported environments were provided')
    }

    const paths = await ensureAppPaths()
    const trackedPaths = await collectCleanupTrackedPaths(cleanupTargets)
    const snapshot = await createSnapshot({
      baseDir: paths.snapshotsDir,
      taskId: `cleanup-${Date.now()}`,
      type: 'manual',
      label: 'cleanup-backup',
      trackedPaths,
    })
    await updateSnapshotMeta(paths.snapshotsDir, snapshot)

    const cleanupResult = await cleanupDetectedEnvironments(cleanupTargets)
    clearRuntimeDerivedCaches()
    return {
      snapshotId: snapshot.id,
      ...cleanupResult,
    }
  })
  ipcMain.handle('environment:preview-changes', async (_event, changes: EnvChange[]) =>
    previewEnvChanges(changes ?? []),
  )
  ipcMain.handle('environment:apply-changes', async (_event, payload: { changes: EnvChange[] }) => {
    const result = await applyEnvChanges({
      changes: payload.changes ?? [],
      platform: (process.platform === 'win32' ? 'win32' : 'darwin') as 'win32' | 'darwin',
    })
    clearRuntimeDerivedCaches()
    return result
  })

  ipcMain.handle(
    'task:precheck',
    async (
      _event,
      payload: { templateId: string; values: Record<string, Primitive>; locale: string },
    ) => {
      const normalizedLocale = normalizeLocale(payload.locale)
      const cacheKey = JSON.stringify({
        templateId: payload.templateId,
        values: payload.values,
        locale: normalizedLocale,
        environment: buildPrecheckEnvironmentFingerprint(),
      })

      return precheckCache.getOrLoad(cacheKey, PRECHECK_CACHE_TTL_MS, async () => {
        const [template, paths] = await Promise.all([
          getTemplate(payload.templateId),
          ensureAppPaths(),
        ])
        const input = await buildRuntimePrecheckInput(template, payload.values, {
          downloadCacheDir: paths.downloadCacheDir,
        })
        return runPrecheck(input, normalizedLocale)
      })
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
        rollbackBaseSnapshotId?: string
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
        rollbackBaseSnapshotId: payload.rollbackBaseSnapshotId,
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

    if (runningTaskExecutions.has(task.id)) {
      return taskCache.get(task.id) ?? task
    }

    // 任务开始前创建快照，收集各插件会写入的路径
    const pluginTrackedPaths = collectTaskTrackedPaths(task)

    let snapshotId: string | undefined
    try {
      const snapshot = await createSnapshot({
        baseDir: paths.snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [...new Set(pluginTrackedPaths)],
      })
      await updateSnapshotMeta(paths.snapshotsDir, snapshot)
      snapshotId = snapshot.id
    } catch (err) {
      console.warn(`[task:start] createSnapshot failed for task ${task.id}, proceeding without rollback support:`, err)
    }

    return beginTaskExecution({
      task: {
        ...task,
        snapshotId,
      },
      paths,
    })
  })

  ipcMain.handle('task:cancel', async (_event, taskId: string) => {
    const paths = await ensureAppPaths()
    runningTaskControllers.get(taskId)?.abort()
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
      const nextTask = await prepareTaskPluginRetry({
        task,
        pluginId: payload.pluginId,
        tasksDir: paths.tasksDir,
      })

      return beginTaskExecution({
        task: {
          ...nextTask,
          snapshotId: task.snapshotId,
        },
        paths,
      })
    },
  )

  ipcMain.handle('plugin:import', async (_event, payload: { path: string }) => {
    const paths = await ensureAppPaths()
    const pathStat = await stat(payload.path)
    let importedPlugin

    if (pathStat.isDirectory()) {
      importedPlugin = await importPluginFromDirectory(payload.path, {
        registryDir: paths.pluginsDir,
        appVersion: app.getVersion(),
      })
    } else if (extname(payload.path).toLowerCase() === '.zip') {
      importedPlugin = await importPluginFromZip(payload.path, paths.pluginStagingDir, {
        registryDir: paths.pluginsDir,
        appVersion: app.getVersion(),
      })
    } else {
      throw new Error(`Unsupported plugin import path: ${payload.path}`)
    }

    clearRuntimeDerivedCaches()
    return {
      ...importedPlugin,
      templateId: `imported-${importedPlugin.manifest.id}-${importedPlugin.manifest.version}`,
    } satisfies ImportedPluginRegistration
  })

  ipcMain.handle('dialog:pick-directory', async (_event, payload?: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? undefined, {
      defaultPath: payload?.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })

    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle('dialog:pick-plugin-import', async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? undefined, {
      properties: ['openFile', 'openDirectory'],
      filters: [
        {
          name: 'Plugin bundle',
          extensions: ['zip'],
        },
      ],
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
      // 手动快照优先复用任务缓存中的追踪路径，保证快照范围与安装过程一致。
      const cachedTask = taskCache.get(payload.taskId)
      const manualTrackedPaths = cachedTask ? collectTaskTrackedPaths(cachedTask) : []
      const snapshot = await createSnapshot({
        baseDir: paths.snapshotsDir,
        taskId: payload.taskId,
        type: 'manual',
        label: payload.label,
        trackedPaths: manualTrackedPaths,
      })
      await updateSnapshotMeta(paths.snapshotsDir, snapshot)
      return snapshot
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
    async (
      _event,
      payload: { snapshotId: string; trackedPaths?: string[]; installPaths?: string[] },
    ) => {
      const paths = await ensureAppPaths()
      let rollbackCommands: string[] = []
      let targetSnapshotId = payload.snapshotId
      let skipRollbackCommands = false

      try {
        const snapshot = await loadSnapshot(paths.snapshotsDir, payload.snapshotId)
        const task = await getTask(snapshot.taskId, paths.tasksDir)
        if (task.rollbackBaseSnapshotId && task.snapshotId === payload.snapshotId) {
          // 如果当前失败任务是建立在清理快照之上的，则回滚到清理前的基线快照。
          targetSnapshotId = task.rollbackBaseSnapshotId
          skipRollbackCommands = true
        }
        rollbackCommands = [
          ...new Set(task.plugins.flatMap((plugin) => plugin.lastResult?.rollbackCommands ?? [])),
        ]
      } catch {
        rollbackCommands = []
      }

      const rollbackResult = await executeRollback(
        paths.snapshotsDir,
        targetSnapshotId,
        payload.trackedPaths ?? [],
        payload.installPaths,
        {
          dryRun: resolveDryRun(app.isPackaged),
          rollbackCommands,
          skipRollbackCommands,
        },
      )
      clearRuntimeDerivedCaches()
      return rollbackResult
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
