/**
 * preload 模块的单元测试。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const on = vi.fn()
const removeAllListeners = vi.fn()
const exposeInMainWorld = vi.fn()

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    on,
    removeAllListeners,
  },
  contextBridge: {
    exposeInMainWorld,
  },
}))

describe('preload', () => {
  beforeEach(() => {
    vi.resetModules()
    invoke.mockReset()
    on.mockReset()
    removeAllListeners.mockReset()
    exposeInMainWorld.mockReset()
  })

  async function getApi() {
    await import('../../src/preload/index')
    return exposeInMainWorld.mock.calls[0][1]
  }

  it('exposes envSetup api in main world', async () => {
    await import('../../src/preload/index')

    expect(exposeInMainWorld).toHaveBeenCalledOnce()
    expect(exposeInMainWorld).toHaveBeenCalledWith('envSetup', expect.any(Object))
  })

  it('maps listTemplates to template:list invoke', async () => {
    const api = await getApi()

    api.listTemplates()
    expect(invoke).toHaveBeenCalledWith('template:list')
  })

  it('maps loadBootstrap to bootstrap:load invoke', async () => {
    const api = await getApi()

    api.loadBootstrap()
    expect(invoke).toHaveBeenCalledWith('bootstrap:load')
  })

  it('maps task cancel and cleanup actions to IPC invokes', async () => {
    const api = await getApi()
    const detection = { id: 'node:1', tool: 'node' }

    api.cancelTask('task-1')
    api.cleanupEnvironment(detection)
    api.cleanupEnvironments([detection])

    expect(invoke).toHaveBeenNthCalledWith(1, 'task:cancel', 'task-1')
    expect(invoke).toHaveBeenNthCalledWith(2, 'environment:cleanup', detection)
    expect(invoke).toHaveBeenNthCalledWith(3, 'environment:cleanup-batch', [detection])
  })

  it('maps snapshot actions to IPC invokes', async () => {
    const api = await getApi()

    api.listSnapshots()
    api.createSnapshot({ taskId: 'task-1', label: 'before install' })
    api.deleteSnapshot('snapshot-1')

    expect(invoke).toHaveBeenNthCalledWith(1, 'snapshot:list')
    expect(invoke).toHaveBeenNthCalledWith(2, 'snapshot:create', {
      taskId: 'task-1',
      label: 'before install',
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'snapshot:delete', 'snapshot-1')
  })

  it('maps rollback actions to IPC invokes', async () => {
    const api = await getApi()

    api.suggestRollback({
      taskId: 'task-1',
      failureAnalysis: { category: 'conflict', message: 'conflict', retryable: false },
    })
    api.executeRollback({ snapshotId: 'snapshot-1', trackedPaths: ['/tmp/toolchain'] })

    expect(invoke).toHaveBeenNthCalledWith(1, 'rollback:suggest', {
      taskId: 'task-1',
      failureAnalysis: { category: 'conflict', message: 'conflict', retryable: false },
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'rollback:execute', {
      snapshotId: 'snapshot-1',
      trackedPaths: ['/tmp/toolchain'],
    })
  })

  it('maps enhanced precheck to IPC invoke', async () => {
    const api = await getApi()
    const payload = [{ pluginId: 'node-env', status: 'installed_unverified' }]

    api.runEnhancedPrecheck(payload)

    expect(invoke).toHaveBeenCalledWith('precheck:enhanced', payload)
  })

  it('registers and removes task progress listener', async () => {
    const api = await getApi()
    const callback = vi.fn()

    api.onTaskProgress(callback)
    expect(on).toHaveBeenCalledWith('task:progress', expect.any(Function))

    const handler = on.mock.calls[0][1]
    handler(
      {},
      {
        taskId: 'task-1',
        pluginId: 'node-env',
        type: 'command_done',
        message: 'ok',
        timestamp: new Date().toISOString(),
      },
    )
    expect(callback).toHaveBeenCalled()

    api.removeTaskProgressListener()
    expect(removeAllListeners).toHaveBeenCalledWith('task:progress')
  })
})
