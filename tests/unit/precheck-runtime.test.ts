import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NetworkCheckResult, ResolvedTemplate } from '../../src/main/core/contracts'
import { buildRuntimePrecheckInput, runPrecheck } from '../../src/main/core/precheck'

vi.mock('../../src/main/core/environment', () => ({
  detectTemplateEnvironments: vi.fn(async () => []),
  findExecutable: vi.fn(async () => '/bin/bash'),
}))

vi.mock('../../src/main/core/networkCheck', () => ({
  runTemplateNetworkChecks: vi.fn(async () => []),
}))

function makeNodeTemplate(): ResolvedTemplate {
  return {
    id: 'node-template',
    name: { 'zh-CN': 'Node 模板', en: 'Node Template' },
    version: '0.1.0',
    platforms: ['darwin', 'win32'],
    description: { 'zh-CN': '描述', en: 'Description' },
    plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
    defaults: {},
    overrides: {},
    checks: ['node'],
    fields: {},
  }
}

describe('buildRuntimePrecheckInput', () => {
  beforeEach(async () => {
    const networkCheckMod = await import('../../src/main/core/networkCheck')
    vi.mocked(networkCheckMod.runTemplateNetworkChecks).mockReset()
  })

  it('carries network probe details into precheck input and blocks when one site is unreachable', async () => {
    const checks: NetworkCheckResult[] = [
      {
        id: 'nvm:https://github.com/nvm-sh/nvm/archive/refs/tags/v0.40.4.tar.gz',
        tool: 'nvm',
        kind: 'archive',
        host: 'github.com',
        url: 'https://github.com/nvm-sh/nvm/archive/refs/tags/v0.40.4.tar.gz',
        reachable: true,
        durationMs: 42,
        statusCode: 200,
      },
      {
        id: 'node:https://nodejs.org/dist',
        tool: 'node',
        kind: 'mirror',
        host: 'nodejs.org',
        url: 'https://nodejs.org/dist',
        reachable: false,
        durationMs: 120,
        error: 'connect ETIMEDOUT',
      },
    ]

    const networkCheckMod = await import('../../src/main/core/networkCheck')
    vi.mocked(networkCheckMod.runTemplateNetworkChecks).mockResolvedValueOnce(checks)

    const input = await buildRuntimePrecheckInput(makeNodeTemplate(), {
      'node.nodeManager': 'nvm',
      'node.nodeVersion': '20.11.1',
      'node.installRootDir': '/tmp/toolchain',
      'node.npmCacheDir': '/tmp/npm-cache',
      'node.npmGlobalPrefix': '/tmp/npm-global',
    })

    expect(input.networkAvailable).toBe(false)
    expect(input.networkChecks).toEqual(checks)

    const result = await runPrecheck(input, 'zh-CN')

    expect(result.level).toBe('block')
    expect(result.items.some((item) => item.code === 'NETWORK_UNAVAILABLE')).toBe(true)
    expect(result.networkChecks).toEqual(checks)
  })
})
