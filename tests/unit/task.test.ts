import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyPluginResult,
  cancelTask,
  createTask,
  executeTask,
  loadTask,
  persistTask,
  shouldRerunPlugin,
} from '../../src/main/core/task'
import type { InstallTask, PluginInstallResult, PluginVerifyResult } from '../../src/main/core/contracts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeInstallResult(overrides: Partial<PluginInstallResult> = {}): PluginInstallResult {
  return {
    status: 'installed_unverified',
    executionMode: 'dry_run',
    version: '20.11.1',
    paths: {
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
    },
    envChanges: [],
    downloads: [],
    commands: [],
    logs: [],
    summary: '',
    ...overrides,
  }
}

function makeVerifyResult(overrides: Partial<PluginVerifyResult> = {}): PluginVerifyResult {
  return { status: 'verified_success', checks: [], ...overrides }
}

function makeTask(pluginIds: string[] = ['frontend-env']): InstallTask {
  return createTask({
    templateId: 'frontend-template',
    templateVersion: '0.1.0',
    locale: 'zh-CN',
    params: {},
    plugins: pluginIds.map((id) => ({ pluginId: id, version: '0.1.0', params: {} })),
  })
}

describe('task', () => {
  it('creates task with draft status and plugin snapshots', () => {
    const task = createTask({
      templateId: 'frontend-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      params: {},
      plugins: [{ pluginId: 'frontend-env', version: '0.1.0', params: { nodeVersion: '20.11.1' } }],
    })

    expect(task.status).toBe('draft')
    expect(task.plugins[0].status).toBe('not_started')
  })

  it('marks plugin for rerun when parameters changed', () => {
    expect(
      shouldRerunPlugin({
        previous: { params: { a: 1 }, version: '1', context: {} },
        next: { params: { a: 2 }, version: '1', context: {} },
      }),
    ).toBe(true)
  })

  it('aggregates successful plugin verification into succeeded task', () => {
    const task = createTask({
      templateId: 'frontend-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      params: {},
      plugins: [{ pluginId: 'frontend-env', version: '0.1.0', params: { nodeVersion: '20.11.1' } }],
    })

    const nextTask = applyPluginResult(
      task,
      'frontend-env',
      {
        status: 'installed_unverified',
        executionMode: 'dry_run',
        version: '20.11.1',
        paths: {
          installRootDir: '/tmp/toolchain',
          npmCacheDir: '/tmp/npm-cache',
          npmGlobalPrefix: '/tmp/npm-global',
        },
        envChanges: [],
        downloads: [
          {
            kind: 'archive',
            tool: 'node',
            url: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz',
            official: true,
            checksumUrl: 'https://nodejs.org/dist/v20.11.1/SHASUMS256.txt',
            checksumAlgorithm: 'sha256',
          },
        ],
        commands: ['echo plan'],
        logs: ['token=secret-123'],
        summary: 'Dry-run plan prepared.',
      },
      {
        status: 'verified_success',
        checks: ['node version planned'],
      },
    )

    expect(nextTask.plugins[0].status).toBe('verified_success')
    expect(nextTask.status).toBe('succeeded')
  })

  it('derives partially_succeeded when some plugins succeed and others fail', () => {
    let task = makeTask(['plugin-a', 'plugin-b'])
    task = applyPluginResult(task, 'plugin-a', makeInstallResult(), makeVerifyResult())
    task = applyPluginResult(
      task,
      'plugin-b',
      makeInstallResult({ status: 'failed', error: 'oops' }),
      makeVerifyResult({ status: 'verify_failed', error: 'oops' }),
    )

    expect(task.plugins[0].status).toBe('verified_success')
    expect(task.plugins[1].status).toBe('failed')
    expect(task.status).toBe('partially_succeeded')
  })

  it('derives failed when all plugins fail', () => {
    let task = makeTask(['plugin-a', 'plugin-b'])
    task = applyPluginResult(
      task,
      'plugin-a',
      makeInstallResult({ status: 'failed', error: 'err-a' }),
      makeVerifyResult({ status: 'verify_failed', error: 'err-a' }),
    )
    task = applyPluginResult(
      task,
      'plugin-b',
      makeInstallResult({ status: 'failed', error: 'err-b' }),
      makeVerifyResult({ status: 'verify_failed', error: 'err-b' }),
    )

    expect(task.status).toBe('failed')
  })

  it('assigns VERIFY_FAILED errorCode when verify step fails', () => {
    const task = makeTask()
    const updated = applyPluginResult(
      task,
      'frontend-env',
      makeInstallResult(),
      makeVerifyResult({ status: 'verify_failed', error: 'binary not found' }),
    )

    expect(updated.plugins[0].errorCode).toBe('VERIFY_FAILED')
    expect(updated.plugins[0].error).toBe('binary not found')
  })

  it('assigns PLUGIN_EXECUTION_FAILED errorCode when install fails but verify does not error', () => {
    const task = makeTask()
    const updated = applyPluginResult(
      task,
      'frontend-env',
      makeInstallResult({ status: 'failed', error: 'install error' }),
      makeVerifyResult({ status: 'verify_failed' }),
    )

    expect(updated.plugins[0].errorCode).toBe('PLUGIN_EXECUTION_FAILED')
  })

  it('does not rerun plugin when nothing changed', () => {
    expect(
      shouldRerunPlugin({
        previous: { params: { a: 1 }, version: '1', context: {} },
        next: { params: { a: 1 }, version: '1', context: {} },
      }),
    ).toBe(false)
  })

  it('reruns plugin when version changes', () => {
    expect(
      shouldRerunPlugin({
        previous: { params: {}, version: '1.0.0', context: {} },
        next: { params: {}, version: '2.0.0', context: {} },
      }),
    ).toBe(true)
  })

  it('reruns plugin when context changes', () => {
    expect(
      shouldRerunPlugin({
        previous: { params: {}, version: '1', context: { platform: 'darwin' } },
        next: { params: {}, version: '1', context: { platform: 'win32' } },
      }),
    ).toBe(true)
  })

  it('throws when applying result for an unknown plugin id', () => {
    const task = makeTask()
    expect(() =>
      applyPluginResult(task, 'nonexistent', makeInstallResult(), makeVerifyResult()),
    ).toThrow('Unknown plugin snapshot: nonexistent')
  })

  it('sanitises secrets from plugin logs', () => {
    const task = makeTask()
    const updated = applyPluginResult(
      task,
      'frontend-env',
      makeInstallResult({ logs: ['token=supersecret', 'password=abc123'] }),
      makeVerifyResult({ checks: ['ok'] }),
    )

    const allLogs = updated.plugins[0].logs.join('\n')
    expect(allLogs).not.toContain('supersecret')
    expect(allLogs).not.toContain('abc123')
  })
})

// ---------------------------------------------------------------------------
// cancelTask
// ---------------------------------------------------------------------------

describe('cancelTask', () => {
  let tasksDir: string

  beforeEach(async () => {
    tasksDir = await mkdtemp(join(tmpdir(), 'envsetup-cancel-'))
  })

  afterEach(async () => {
    await rm(tasksDir, { recursive: true, force: true })
  })

  it('marks not_started plugins as failed with USER_CANCELLED when cancelling', async () => {
    const task = makeTask(['plugin-a', 'plugin-b'])
    const cancelled = await cancelTask({ task, tasksDir })

    for (const plugin of cancelled.plugins) {
      expect(plugin.status).toBe('failed')
      expect(plugin.errorCode).toBe('USER_CANCELLED')
    }
  })

  it('is idempotent: cancelling an already-cancelled task returns it unchanged', async () => {
    // Build a task that is already in cancelled state by manually constructing it
    const base = makeTask()
    // Force status to cancelled via a direct object spread (bypasses finalizeTaskStatus)
    const cancelledTask: typeof base = { ...base, status: 'cancelled' }
    const second = await cancelTask({ task: cancelledTask, tasksDir })

    expect(second.status).toBe('cancelled')
    // Returned object is the same reference when already cancelled
    expect(second).toBe(cancelledTask)
  })

  it('does not cancel an already-succeeded task', async () => {
    let task = makeTask()
    task = applyPluginResult(task, 'frontend-env', makeInstallResult(), makeVerifyResult())
    expect(task.status).toBe('succeeded')

    const result = await cancelTask({ task, tasksDir })
    expect(result.status).toBe('succeeded')
  })
})

// ---------------------------------------------------------------------------
// persistTask / loadTask round-trip
// ---------------------------------------------------------------------------

describe('persistTask / loadTask', () => {
  let tasksDir: string

  beforeEach(async () => {
    tasksDir = await mkdtemp(join(tmpdir(), 'envsetup-persist-'))
  })

  afterEach(async () => {
    await rm(tasksDir, { recursive: true, force: true })
  })

  it('round-trips a task to disk', async () => {
    const task = makeTask()
    await persistTask(task, tasksDir)
    const loaded = await loadTask(task.id, tasksDir)

    expect(loaded.id).toBe(task.id)
    expect(loaded.status).toBe('draft')
    expect(loaded.plugins).toHaveLength(1)
  })

  it('defaults missing locale to zh-CN on load', async () => {
    const task = makeTask()
    // write a task without the locale field to simulate old data
    const { writeFile } = await import('node:fs/promises')
    const { join: pathJoin } = await import('node:path')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(tasksDir, { recursive: true })
    const taskWithoutLocale = { ...task, locale: undefined }
    await writeFile(pathJoin(tasksDir, `${task.id}.json`), JSON.stringify(taskWithoutLocale), 'utf8')

    const loaded = await loadTask(task.id, tasksDir)
    expect(loaded.locale).toBe('zh-CN')
  })
})

// ---------------------------------------------------------------------------
// executeTask
// ---------------------------------------------------------------------------

describe('executeTask', () => {
  let tasksDir: string

  beforeEach(async () => {
    tasksDir = await mkdtemp(join(tmpdir(), 'envsetup-exec-'))
  })

  afterEach(async () => {
    await rm(tasksDir, { recursive: true, force: true })
  })

  it('marks plugin failed when no implementation is registered', async () => {
    const task = makeTask(['missing-plugin'])
    const result = await executeTask({
      task,
      registry: {},
      platform: 'darwin',
      tasksDir,
      dryRun: true,
    })

    expect(result.plugins[0].status).toBe('failed')
    expect(result.plugins[0].errorCode).toBe('PLUGIN_DEPENDENCY_MISSING')
    expect(result.status).toBe('failed')
  })

  it('executes a plugin and produces succeeded task', async () => {
    const task = makeTask(['test-plugin'])
    const registry = {
      'test-plugin': {
        install: vi.fn().mockResolvedValue(makeInstallResult()),
        verify: vi.fn().mockResolvedValue(makeVerifyResult()),
      },
    }

    const result = await executeTask({
      task,
      registry,
      platform: 'darwin',
      tasksDir,
      dryRun: true,
    })

    expect(result.status).toBe('succeeded')
    expect(registry['test-plugin'].install).toHaveBeenCalledOnce()
    expect(registry['test-plugin'].verify).toHaveBeenCalledOnce()
  })

  it('marks plugin failed when install throws', async () => {
    const task = makeTask(['err-plugin'])
    const registry = {
      'err-plugin': {
        install: vi.fn().mockRejectedValue(new Error('network timeout')),
        verify: vi.fn(),
      },
    }

    const result = await executeTask({
      task,
      registry,
      platform: 'darwin',
      tasksDir,
      dryRun: true,
    })

    expect(result.plugins[0].status).toBe('failed')
    expect(result.plugins[0].error).toBe('network timeout')
    expect(result.status).toBe('failed')
  })

  it('skips already-verified plugins when no pluginFilter is set', async () => {
    let task = makeTask(['plugin-a'])
    task = applyPluginResult(task, 'plugin-a', makeInstallResult(), makeVerifyResult())
    expect(task.plugins[0].status).toBe('verified_success')

    const mockInstall = vi.fn().mockResolvedValue(makeInstallResult())
    const registry = {
      'plugin-a': { install: mockInstall, verify: vi.fn().mockResolvedValue(makeVerifyResult()) },
    }

    await executeTask({ task, registry, platform: 'darwin', tasksDir, dryRun: true })
    expect(mockInstall).not.toHaveBeenCalled()
  })
})
