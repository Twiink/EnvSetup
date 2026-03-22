import { describe, expect, it } from 'vitest'

import { applyPluginResult, createTask, shouldRerunPlugin } from '../../src/main/core/task'

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
          npmCacheDir: '/tmp/npm-cache',
          npmGlobalPrefix: '/tmp/npm-global',
        },
        envChanges: [],
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
})
