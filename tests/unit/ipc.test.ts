/**
 * ipc 模块的单元测试。
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallTask, Primitive, Snapshot } from '../../src/main/core/contracts'
import type { CreateTaskInput } from '../../src/main/core/task'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown

const handlers = new Map<string, IpcHandler>()
const handle = vi.fn((channel: string, fn: IpcHandler) => {
  handlers.set(channel, fn)
})

const snapshotStub: Snapshot = {
  id: 'snapshot-1',
  taskId: 'task-1',
  createdAt: '2026-03-25T00:00:00.000Z',
  type: 'auto',
  trackedPaths: [],
  files: {},
  environment: {
    variables: {},
    path: [],
  },
  shellConfigs: {},
  metadata: {
    platform: 'darwin',
    diskUsage: 0,
    fileCount: 0,
  },
}

const showOpenDialog = vi.fn()
const getFocusedWindow = vi.fn()
const send = vi.fn()
const isPackaged = false
const runtimePlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as const

vi.mock('electron', () => ({
  app: { isPackaged },
  BrowserWindow: { getFocusedWindow },
  dialog: { showOpenDialog },
  ipcMain: { handle },
}))

vi.mock('../../src/main/index', () => ({
  getMainWindow: vi.fn(() => ({ webContents: { send } })),
}))

vi.mock('../../src/main/core/appPaths', () => ({
  ensureAppPaths: vi.fn(async () => ({
    rootDir: '/tmp/envsetup-data',
    tasksDir: '/tmp/tasks',
    downloadCacheDir: '/tmp/cache',
    extractedCacheDir: '/tmp/extracted-cache',
    pluginsDir: '/tmp/plugins',
    pluginStagingDir: '/tmp/staging',
    snapshotsDir: '/tmp/snapshots',
  })),
}))

vi.mock('../../src/main/core/envPersistence', () => ({
  previewEnvChanges: vi.fn(async (changes) => ({
    envCount: changes.length,
    pathCount: 0,
    profileCount: 0,
    targets: [],
  })),
  applyEnvChanges: vi.fn(async ({ changes, platform }) => ({
    applied: changes,
    skipped: [],
    platform,
  })),
}))

vi.mock('../../src/main/core/environment', () => ({
  cleanupDetectedEnvironment: vi.fn(async (detection) => ({ ok: true, detection })),
  cleanupDetectedEnvironments: vi.fn(async (detections) => ({
    results: detections.map((detection) => ({
      detectionId: detection.id,
      message: `cleaned ${detection.id}`,
    })),
    errors: [],
    message: `cleaned ${detections.length}`,
  })),
  collectCleanupTrackedPaths: vi.fn(async (detections) =>
    detections
      .map((detection) => detection.cleanupPath)
      .filter((path): path is string => typeof path === 'string'),
  ),
}))

vi.mock('../../src/main/core/executionMode', () => ({ resolveDryRun: vi.fn(() => true) }))
vi.mock('../../src/main/core/enhancedPrecheck', () => ({
  runPrecheck: vi.fn(async (pluginResults) => ({
    plan: {
      fileOperations: [],
      envChanges: [],
      estimatedDiskUsage: 0,
      estimatedDownloadSize: 0,
      estimatedDurationMs: 0,
      pluginCount: pluginResults.length,
    },
    conflicts: [],
    impact: {
      filesCreated: 0,
      filesModified: 0,
      filesDeleted: 0,
      envVarsChanged: 0,
      totalDiskUsage: 0,
      estimatedDurationMs: 0,
    },
    canProceed: true,
  })),
}))
vi.mock('../../src/main/core/nodeVersions', () => ({
  listNodeLtsVersions: vi.fn(async () => ['20.11.1']),
}))
vi.mock('../../src/main/core/javaVersions', () => ({
  listJavaLtsVersions: vi.fn(async () => ['21.0.6+7']),
}))
vi.mock('../../src/main/core/pythonVersions', () => ({
  listPythonVersions: vi.fn(async () => ['3.12.1']),
}))
vi.mock('../../src/main/core/gitVersions', () => ({
  listGitVersions: vi.fn(async () => ['2.47.1']),
}))
vi.mock('../../src/main/core/mavenVersions', () => ({
  listMavenVersions: vi.fn(async () => ['3.9.11']),
}))
vi.mock('../../src/main/core/plugin', () => ({
  importPluginFromDirectory: vi.fn(),
  importPluginFromZip: vi.fn(),
}))
vi.mock('../../src/main/core/precheck', () => ({
  buildRuntimePrecheckInput: vi.fn(async () => ({ ok: true })),
  runPrecheck: vi.fn(async () => ({
    level: 'pass',
    items: [],
    detections: [],
    createdAt: new Date().toISOString(),
  })),
}))
vi.mock('../../src/main/core/rollback', () => ({
  executeRollback: vi.fn(async (baseDir, snapshotId, trackedPaths, _installPaths, options) => ({
    success: true,
    executionMode: options?.dryRun ? 'dry_run' : 'real_run',
    snapshotId,
    filesRestored: trackedPaths.length,
    envVariablesRestored: 0,
    shellConfigsRestored: 0,
    directoriesRemoved: 0,
    errors: [],
    message: `rolled back from ${baseDir}`,
  })),
  suggestRollbackSnapshots: vi.fn(async () => []),
}))
vi.mock('../../src/main/core/snapshot', () => ({
  createSnapshot: vi.fn(async () => ({ id: 'snapshot-1' })),
  deleteSnapshot: vi.fn(async () => undefined),
  loadSnapshot: vi.fn(async (_baseDir, snapshotId) => ({
    id: snapshotId,
    taskId: 'task-1',
    createdAt: '2026-03-25T00:00:00.000Z',
    type: 'auto',
    trackedPaths: [],
    files: {},
    environment: { variables: {}, path: [] },
    shellConfigs: {},
    metadata: { platform: 'darwin', diskUsage: 0, fileCount: 0 },
  })),
  loadSnapshotMeta: vi.fn(async () => ({ snapshots: [], maxSnapshots: 5 })),
  markSnapshotDeletable: vi.fn(async () => undefined),
  saveSnapshotMeta: vi.fn(async () => undefined),
  updateSnapshotMeta: vi.fn(async () => undefined),
}))
vi.mock('../../src/main/core/task', () => ({
  cancelTask: vi.fn(async ({ task }) => ({ ...task, status: 'cancelled' })),
  createTask: vi.fn(
    (input: CreateTaskInput): InstallTask => ({
      id: 'task-created',
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      locale: input.locale,
      status: 'draft',
      params: input.params,
      precheck: input.precheck,
      plugins: input.plugins.map((plugin) => ({
        pluginId: plugin.pluginId,
        version: plugin.version,
        status: 'not_started',
        params: plugin.params as Record<string, Primitive>,
        logs: [],
        context: {},
      })),
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z',
    }),
  ),
  executeTask: vi.fn(async ({ task, onProgress }) => {
    onProgress?.({
      taskId: task.id,
      pluginId: task.plugins[0]?.pluginId ?? 'node-env',
      type: 'command_done',
      message: 'ok',
      timestamp: '2026-03-25T00:00:00.000Z',
    })
    return { ...task, status: 'succeeded' }
  }),
  loadTask: vi.fn(async (taskId) => ({
    id: taskId,
    templateId: 'tpl-1',
    templateVersion: '0.1.0',
    locale: 'zh-CN',
    status: 'draft',
    params: {},
    plugins: [
      {
        pluginId: 'node-env',
        version: '0.1.0',
        status: 'not_started',
        params: {
          installRootDir: '/tmp/toolchain',
          npmCacheDir: '/tmp/npm-cache',
          npmGlobalPrefix: '/tmp/npm-global',
        },
        lastResult: {
          status: 'installed_unverified',
          executionMode: 'real_run',
          version: '20.11.1',
          paths: {},
          envChanges: [],
          downloads: [],
          commands: [],
          rollbackCommands: ['brew uninstall git'],
          logs: [],
          summary: 'ok',
        },
        logs: [],
        context: {},
      },
    ],
    createdAt: '2026-03-25T00:00:00.000Z',
    updatedAt: '2026-03-25T00:00:00.000Z',
  })),
  persistTask: vi.fn(async () => undefined),
  retryTaskPlugin: vi.fn(async ({ task, pluginId }) => ({
    ...task,
    retriedPluginId: pluginId,
    status: 'running',
  })),
}))
vi.mock('../../src/main/core/template', () => ({
  loadTemplatesFromDirectory: vi.fn(async () => [
    {
      id: 'tpl-1',
      version: '0.1.0',
      name: { 'zh-CN': '模板', en: 'Template' },
      description: { 'zh-CN': '描述', en: 'Desc' },
      platforms: ['darwin'],
      plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
      defaults: {},
      overrides: {},
      checks: [],
      fields: {},
    },
  ]),
  mapTemplateValuesToPluginParams: vi.fn((pluginId, values) => ({ ...values, pluginId })),
}))
vi.mock('../../src/shared/locale', () => ({ normalizeLocale: vi.fn((locale) => locale) }))
vi.mock('../../src/main/plugins/nodeEnvPlugin', () => ({ default: {} }))
vi.mock('../../src/main/plugins/javaEnvPlugin', () => ({ default: {} }))
vi.mock('../../src/main/plugins/pythonEnvPlugin', () => ({ default: {} }))
vi.mock('../../src/main/plugins/gitEnvPlugin', () => ({ default: {} }))
vi.mock('../../src/main/plugins/mysqlEnvPlugin', () => ({ default: {} }))
vi.mock('../../src/main/plugins/redisEnvPlugin', () => ({ default: {} }))
vi.mock('../../src/main/plugins/mavenEnvPlugin', () => ({ default: {} }))

beforeAll(async () => {
  const mod = await import('../../src/main/ipc/index')
  mod.registerIpcHandlers()
})

beforeEach(async () => {
  showOpenDialog.mockReset()
  getFocusedWindow.mockReset()
  send.mockReset()

  const envMod = await import('../../src/main/core/envPersistence')
  const envCoreMod = await import('../../src/main/core/environment')
  const rollbackMod = await import('../../src/main/core/rollback')
  const snapshotMod = await import('../../src/main/core/snapshot')
  const taskMod = await import('../../src/main/core/task')
  const templateMod = await import('../../src/main/core/template')

  vi.mocked(envMod.previewEnvChanges).mockClear()
  vi.mocked(envMod.applyEnvChanges).mockClear()
  vi.mocked(envCoreMod.cleanupDetectedEnvironment).mockClear()
  vi.mocked(envCoreMod.cleanupDetectedEnvironments).mockClear()
  vi.mocked(envCoreMod.collectCleanupTrackedPaths).mockClear()
  vi.mocked(rollbackMod.executeRollback).mockClear()
  vi.mocked(rollbackMod.suggestRollbackSnapshots).mockClear()
  vi.mocked(snapshotMod.createSnapshot).mockClear()
  vi.mocked(snapshotMod.deleteSnapshot).mockClear()
  vi.mocked(snapshotMod.loadSnapshotMeta).mockClear()
  vi.mocked(snapshotMod.markSnapshotDeletable).mockClear()
  vi.mocked(snapshotMod.saveSnapshotMeta).mockClear()
  vi.mocked(snapshotMod.updateSnapshotMeta).mockClear()
  vi.mocked(taskMod.cancelTask).mockClear()
  vi.mocked(taskMod.createTask).mockClear()
  vi.mocked(taskMod.executeTask).mockClear()
  vi.mocked(taskMod.loadTask).mockClear()
  vi.mocked(taskMod.persistTask).mockClear()
  vi.mocked(taskMod.retryTaskPlugin).mockClear()
  vi.mocked(templateMod.mapTemplateValuesToPluginParams).mockClear()

  vi.mocked(rollbackMod.suggestRollbackSnapshots).mockResolvedValue([])
  vi.mocked(snapshotMod.createSnapshot).mockResolvedValue(snapshotStub)
  vi.mocked(snapshotMod.loadSnapshot).mockClear()
  vi.mocked(snapshotMod.loadSnapshotMeta).mockResolvedValue({ snapshots: [], maxSnapshots: 5 })
})

describe('registerIpcHandlers', () => {
  it('registers key channels', () => {
    expect(handlers.has('bootstrap:load')).toBe(true)
    expect(handlers.has('template:list')).toBe(true)
    expect(handlers.has('task:create')).toBe(true)
    expect(handlers.has('task:start')).toBe(true)
    expect(handlers.has('task:cancel')).toBe(true)
    expect(handlers.has('task:retry-plugin')).toBe(true)
    expect(handlers.has('environment:cleanup')).toBe(true)
    expect(handlers.has('environment:cleanup-batch')).toBe(true)
    expect(handlers.has('environment:preview-changes')).toBe(true)
    expect(handlers.has('environment:apply-changes')).toBe(true)
    expect(handlers.has('snapshot:list')).toBe(true)
    expect(handlers.has('snapshot:create')).toBe(true)
    expect(handlers.has('snapshot:delete')).toBe(true)
    expect(handlers.has('rollback:suggest')).toBe(true)
    expect(handlers.has('rollback:execute')).toBe(true)
    expect(handlers.has('dialog:pick-directory')).toBe(true)
    expect(handlers.has('precheck:enhanced')).toBe(true)
  })

  it('creates task with mapped plugin params and persists it', async () => {
    const taskMod = await import('../../src/main/core/task')
    const templateMod = await import('../../src/main/core/template')
    const payload = {
      templateId: 'tpl-1',
      values: { 'node.nodeManager': 'nvm', installRootDir: '/tmp/toolchain' },
      precheck: { level: 'pass', items: [], detections: [], createdAt: '2026-03-25T00:00:00.000Z' },
      locale: 'zh-CN',
    }

    const result = await handlers.get('task:create')?.({}, payload)

    expect(templateMod.mapTemplateValuesToPluginParams).toHaveBeenCalledWith(
      'node-env',
      payload.values,
    )
    expect(taskMod.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'tpl-1',
        templateVersion: '0.1.0',
        locale: 'zh-CN',
        params: payload.values,
        precheck: payload.precheck,
        plugins: [
          expect.objectContaining({
            pluginId: 'node-env',
            version: '0.1.0',
            params: expect.objectContaining({ 'node.nodeManager': 'nvm', pluginId: 'node-env' }),
          }),
        ],
      }),
    )
    expect(taskMod.persistTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-created' }),
      '/tmp/tasks',
    )
    expect(result.id).toBe('task-created')
  })

  it('starts task, creates snapshot, sends progress, and marks snapshot deletable on success', async () => {
    const snapshotMod = await import('../../src/main/core/snapshot')
    const taskMod = await import('../../src/main/core/task')

    const result = await handlers.get('task:start')?.({}, 'task-1')

    expect(snapshotMod.createSnapshot).toHaveBeenCalledWith({
      baseDir: '/tmp/snapshots',
      taskId: 'task-1',
      type: 'auto',
      trackedPaths: ['/tmp/toolchain', '/tmp/npm-cache', '/tmp/npm-global'],
    })
    expect(taskMod.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ id: 'task-1' }),
        tasksDir: '/tmp/tasks',
        dryRun: true,
      }),
    )
    expect(send).toHaveBeenCalledWith(
      'task:progress',
      expect.objectContaining({ taskId: 'task-1', pluginId: 'node-env', type: 'command_done' }),
    )
    expect(snapshotMod.markSnapshotDeletable).toHaveBeenCalledWith('/tmp/snapshots', 'snapshot-1')
    expect(result.snapshotId).toBe('snapshot-1')
    expect(result.status).toBe('succeeded')
  })

  it('starts task and attaches rollback suggestions when execution fails', async () => {
    const rollbackMod = await import('../../src/main/core/rollback')
    const taskMod = await import('../../src/main/core/task')
    const failedTask: InstallTask = {
      ...(await taskMod.loadTask('task-2', '/tmp/tasks')),
      status: 'failed',
    }

    vi.mocked(taskMod.executeTask).mockResolvedValueOnce(failedTask)
    vi.mocked(rollbackMod.suggestRollbackSnapshots).mockResolvedValueOnce([
      {
        snapshotId: 'snapshot-1',
        createdAt: '2026-03-25T00:00:00.000Z',
        reason: '失败前自动快照',
        confidence: 'high',
      },
    ])

    const result = await handlers.get('task:start')?.({}, 'task-2')

    expect(rollbackMod.suggestRollbackSnapshots).toHaveBeenCalledWith('/tmp/snapshots', 'task-2')
    expect(result.status).toBe('failed')
    expect(result.snapshotId).toBe('snapshot-1')
    expect(result.rollbackSuggestions).toEqual([
      expect.objectContaining({ snapshotId: 'snapshot-1', confidence: 'high' }),
    ])
  })

  it('cancels task and returns updated task', async () => {
    const taskMod = await import('../../src/main/core/task')

    const result = await handlers.get('task:cancel')?.({}, 'task-1')

    expect(taskMod.cancelTask).toHaveBeenCalledWith({
      task: expect.objectContaining({ id: 'task-1' }),
      tasksDir: '/tmp/tasks',
    })
    expect(result.status).toBe('cancelled')
  })

  it('retries a plugin with mapped execution options', async () => {
    const taskMod = await import('../../src/main/core/task')

    const result = await handlers.get('task:retry-plugin')?.(
      {},
      { taskId: 'task-1', pluginId: 'node-env' },
    )

    expect(taskMod.retryTaskPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ id: 'task-1' }),
        pluginId: 'node-env',
        tasksDir: '/tmp/tasks',
        dryRun: true,
      }),
    )
    expect(result.retriedPluginId).toBe('node-env')
  })

  it('delegates cleanup handler to cleanupDetectedEnvironment', async () => {
    const envMod = await import('../../src/main/core/environment')
    const detection = {
      id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
      tool: 'node',
      kind: 'manager_root',
      path: '/tmp/.nvm',
      source: 'NVM_DIR',
      cleanupSupported: true,
      cleanupPath: '/tmp/.nvm',
      cleanupEnvKey: 'NVM_DIR',
    }

    const result = await handlers.get('environment:cleanup')?.({}, detection)

    expect(envMod.cleanupDetectedEnvironment).toHaveBeenCalledWith(detection)
    expect(result).toEqual({ ok: true, detection })
  })

  it('creates cleanup snapshot before batch cleanup and returns snapshot id', async () => {
    const envMod = await import('../../src/main/core/environment')
    const snapshotMod = await import('../../src/main/core/snapshot')
    const detections = [
      {
        id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
        tool: 'node',
        kind: 'manager_root',
        path: '/tmp/.nvm',
        source: 'NVM_DIR',
        cleanupSupported: true,
        cleanupPath: '/tmp/.nvm',
        cleanupEnvKey: 'NVM_DIR',
      },
    ]

    const result = await handlers.get('environment:cleanup-batch')?.({}, detections)

    expect(envMod.collectCleanupTrackedPaths).toHaveBeenCalledWith(detections)
    expect(snapshotMod.createSnapshot).toHaveBeenCalledWith({
      baseDir: '/tmp/snapshots',
      taskId: expect.stringMatching(/^cleanup-/),
      type: 'manual',
      label: 'cleanup-backup',
      trackedPaths: ['/tmp/.nvm'],
    })
    expect(snapshotMod.updateSnapshotMeta).toHaveBeenCalledWith('/tmp/snapshots', snapshotStub)
    expect(envMod.cleanupDetectedEnvironments).toHaveBeenCalledWith(detections)
    expect(result).toEqual({
      snapshotId: 'snapshot-1',
      results: [
        {
          detectionId: 'node:manager_root:NVM_DIR:/tmp/.nvm',
          message: 'cleaned node:manager_root:NVM_DIR:/tmp/.nvm',
        },
      ],
      errors: [],
      message: 'cleaned 1',
    })
  })

  it('preview changes handler delegates to previewEnvChanges', async () => {
    const envMod = await import('../../src/main/core/envPersistence')
    const result = await handlers.get('environment:preview-changes')?.({}, [
      { kind: 'env', key: 'A', value: '1', scope: 'user', description: 'a' },
    ])
    expect(envMod.previewEnvChanges).toHaveBeenCalled()
    expect(result.envCount).toBe(1)
  })

  it('apply changes handler delegates to applyEnvChanges', async () => {
    const envMod = await import('../../src/main/core/envPersistence')
    const payload = {
      changes: [{ kind: 'env', key: 'A', value: '1', scope: 'user', description: 'a' }],
    }
    const result = await handlers.get('environment:apply-changes')?.({}, payload)
    expect(envMod.applyEnvChanges).toHaveBeenCalledWith({
      changes: payload.changes,
      platform: runtimePlatform,
    })
    expect(result.applied).toHaveLength(1)
  })

  it('lists snapshots from snapshot meta', async () => {
    const snapshotMod = await import('../../src/main/core/snapshot')
    vi.mocked(snapshotMod.loadSnapshotMeta).mockResolvedValueOnce({
      snapshots: [
        {
          id: 'snapshot-1',
          taskId: 'task-1',
          createdAt: '2026-03-25T00:00:00.000Z',
          type: 'auto',
          canDelete: false,
        },
      ],
      maxSnapshots: 5,
    })

    const result = await handlers.get('snapshot:list')?.({})

    expect(snapshotMod.loadSnapshotMeta).toHaveBeenCalledWith('/tmp/snapshots')
    expect(result.snapshots).toHaveLength(1)
  })

  it('creates manual snapshot using cached task tracked paths', async () => {
    const snapshotMod = await import('../../src/main/core/snapshot')

    await handlers.get('task:create')?.(
      {},
      {
        templateId: 'tpl-1',
        values: {
          installRootDir: '/tmp/toolchain',
          npmCacheDir: '/tmp/npm-cache',
          npmGlobalPrefix: '/tmp/npm-global',
        },
        locale: 'zh-CN',
      },
    )

    await handlers.get('snapshot:create')?.({}, { taskId: 'task-created', label: 'before retry' })

    expect(snapshotMod.createSnapshot).toHaveBeenLastCalledWith({
      baseDir: '/tmp/snapshots',
      taskId: 'task-created',
      type: 'manual',
      label: 'before retry',
      trackedPaths: ['/tmp/toolchain', '/tmp/npm-cache', '/tmp/npm-global'],
    })
  })

  it('deletes snapshot and rewrites meta without deleted entry', async () => {
    const snapshotMod = await import('../../src/main/core/snapshot')
    vi.mocked(snapshotMod.loadSnapshotMeta).mockResolvedValueOnce({
      snapshots: [
        {
          id: 'snapshot-1',
          taskId: 'task-1',
          createdAt: '2026-03-25T00:00:00.000Z',
          type: 'auto',
          canDelete: false,
        },
        {
          id: 'snapshot-2',
          taskId: 'task-2',
          createdAt: '2026-03-25T00:00:00.000Z',
          type: 'manual',
          canDelete: true,
        },
      ],
      maxSnapshots: 5,
    })

    await handlers.get('snapshot:delete')?.({}, 'snapshot-1')

    expect(snapshotMod.deleteSnapshot).toHaveBeenCalledWith('/tmp/snapshots', 'snapshot-1')
    expect(snapshotMod.saveSnapshotMeta).toHaveBeenCalledWith('/tmp/snapshots', {
      snapshots: [
        {
          id: 'snapshot-2',
          taskId: 'task-2',
          createdAt: '2026-03-25T00:00:00.000Z',
          type: 'manual',
          canDelete: true,
        },
      ],
      maxSnapshots: 5,
    })
  })

  it('delegates rollback suggest and execute handlers', async () => {
    const rollbackMod = await import('../../src/main/core/rollback')
    vi.mocked(rollbackMod.suggestRollbackSnapshots).mockResolvedValueOnce([
      {
        snapshotId: 'snapshot-1',
        createdAt: '2026-03-25T00:00:00.000Z',
        reason: '最近可用快照',
        confidence: 'high',
      },
    ])

    const suggestions = await handlers.get('rollback:suggest')?.(
      {},
      {
        taskId: 'task-1',
        failureAnalysis: { category: 'conflict', message: 'conflict', retryable: false },
      },
    )
    const rollbackResult = await handlers.get('rollback:execute')?.(
      {},
      {
        snapshotId: 'snapshot-1',
        trackedPaths: ['/tmp/toolchain'],
      },
    )

    expect(rollbackMod.suggestRollbackSnapshots).toHaveBeenCalledWith('/tmp/snapshots', 'task-1', {
      category: 'conflict',
      message: 'conflict',
      retryable: false,
    })
    expect(rollbackMod.executeRollback).toHaveBeenCalledWith(
      '/tmp/snapshots',
      'snapshot-1',
      ['/tmp/toolchain'],
      undefined,
      { dryRun: true, rollbackCommands: ['brew uninstall git'], skipRollbackCommands: false },
    )
    expect(suggestions).toHaveLength(1)
    expect(rollbackResult.success).toBe(true)
    expect(rollbackResult.executionMode).toBe('dry_run')
  })

  it('uses rollbackBaseSnapshotId as the authoritative restore target for task rollbacks', async () => {
    const rollbackMod = await import('../../src/main/core/rollback')
    const snapshotMod = await import('../../src/main/core/snapshot')
    const taskMod = await import('../../src/main/core/task')
    const rollbackTaskId = 'task-rollback-1'

    vi.mocked(snapshotMod.loadSnapshot).mockResolvedValueOnce({
      ...snapshotStub,
      id: 'snapshot-1',
      taskId: rollbackTaskId,
    })

    vi.mocked(taskMod.loadTask).mockResolvedValueOnce({
      ...(await taskMod.loadTask(rollbackTaskId, '/tmp/tasks')),
      id: rollbackTaskId,
      snapshotId: 'snapshot-1',
      rollbackBaseSnapshotId: 'snapshot-cleanup-1',
    })

    await handlers.get('rollback:execute')?.(
      {},
      {
        snapshotId: 'snapshot-1',
      },
    )

    expect(rollbackMod.executeRollback).toHaveBeenCalledWith(
      '/tmp/snapshots',
      'snapshot-cleanup-1',
      [],
      undefined,
      { dryRun: true, rollbackCommands: ['brew uninstall git'], skipRollbackCommands: true },
    )
  })

  it('delegates enhanced precheck handler', async () => {
    const enhancedPrecheckMod = await import('../../src/main/core/enhancedPrecheck')
    const payload = {
      pluginResults: [{ pluginId: 'node-env' }],
      installedVersions: { node: '20.11.1' },
    }

    const result = await handlers.get('precheck:enhanced')?.({}, payload)

    expect(enhancedPrecheckMod.runPrecheck).toHaveBeenCalledWith(
      payload.pluginResults,
      payload.installedVersions,
    )
    expect(result.canProceed).toBe(true)
  })

  it('dialog pick-directory returns selected path or undefined when canceled', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/chosen'] })
    const selected = await handlers.get('dialog:pick-directory')?.({}, { defaultPath: '/tmp' })
    expect(selected).toBe('/tmp/chosen')

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const canceled = await handlers.get('dialog:pick-directory')?.({}, { defaultPath: '/tmp' })
    expect(canceled).toBeUndefined()
  })

  describe.each([
    ['node', 'node'],
    ['node', 'nvm'],
    ['java', 'jdk'],
    ['java', 'sdkman'],
    ['python', 'python'],
    ['python', 'conda'],
    ['git', 'git'],
    ['git', 'homebrew'],
    ['mysql', 'package'],
    ['redis', 'package'],
    ['maven', 'maven'],
  ])('task:create action matrix for %s via %s', (tool, manager) => {
    it('passes manager-specific values through mapping and task creation', async () => {
      const taskMod = await import('../../src/main/core/task')
      const payload = {
        templateId: 'tpl-1',
        values: {
          [`${tool}.${tool}Manager`]: manager,
          installRootDir: `/tmp/${tool}`,
          ...(!['mysql', 'redis'].includes(tool) ? { [`${tool}.${tool}Version`]: '1.0.0' } : {}),
        },
        locale: 'zh-CN',
      }

      await handlers.get('task:create')?.({}, payload)

      expect(taskMod.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          params: payload.values,
          plugins: [expect.objectContaining({ params: expect.objectContaining(payload.values) })],
        }),
      )
    })
  })
})
