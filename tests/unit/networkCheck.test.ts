/**
 * networkCheck 模块的单元测试。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Primitive, ResolvedTemplate } from '../../src/main/core/contracts'
import { runTemplateNetworkChecks } from '../../src/main/core/networkCheck'

function makeGitTemplate(): ResolvedTemplate {
  return {
    id: 'git-template',
    name: { 'zh-CN': 'Git 模板', en: 'Git Template' },
    version: '0.1.0',
    platforms: ['darwin', 'win32'],
    description: { 'zh-CN': '描述', en: 'Description' },
    plugins: [{ pluginId: 'git-env', version: '0.1.0' }],
    defaults: {},
    overrides: {},
    checks: ['git'],
    fields: {},
  }
}

describe('runTemplateNetworkChecks', () => {
  afterEach(() => {
    delete process.env.ENVSETUP_SKIP_NETWORK_CHECKS
  })

  it('short-circuits network probes when local simulation disables checks', async () => {
    process.env.ENVSETUP_SKIP_NETWORK_CHECKS = '1'
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should not be called when network checks are skipped')
    })

    const values: Record<string, Primitive> = {
      'git.gitManager': process.platform === 'win32' ? 'scoop' : 'homebrew',
      'git.gitVersion': process.platform === 'win32' ? '2.49.1' : '2.33.0',
      'git.installRootDir': '/tmp/toolchain',
    }

    const result = await runTemplateNetworkChecks(makeGitTemplate(), values, { fetchImpl })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((entry) => entry.reachable)).toBe(true)
    expect(result.every((entry) => entry.statusCode === 200)).toBe(true)
  })
})
