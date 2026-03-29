/**
 * i18n 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import { getPrecheckMessage } from '../../src/main/core/i18n'

describe('getPrecheckMessage', () => {
  const mappedCodes = [
    'PLATFORM_UNSUPPORTED',
    'ARCH_UNSUPPORTED',
    'PATH_NOT_WRITABLE',
    'PLUGIN_DEPENDENCY_MISSING',
    'VERSION_INCOMPATIBLE',
    'NETWORK_UNAVAILABLE',
    'EXISTING_ENV_DETECTED',
    'ELEVATION_REQUIRED',
  ] as const

  for (const code of mappedCodes) {
    it(`returns zh-CN message for ${code}`, () => {
      const msg = getPrecheckMessage(code, 'zh-CN')
      expect(typeof msg).toBe('string')
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toBe(code)
    })

    it(`returns en message for ${code}`, () => {
      const msg = getPrecheckMessage(code, 'en')
      expect(typeof msg).toBe('string')
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toBe(code)
    })
  }

  it('falls back to the code itself for unmapped error codes', () => {
    // PERMISSION_DENIED 没有在 precheckMessages 中映射
    const msg = getPrecheckMessage('PERMISSION_DENIED', 'zh-CN')
    expect(msg).toBe('PERMISSION_DENIED')
  })

  it('zh-CN message for PLATFORM_UNSUPPORTED mentions 操作系统', () => {
    const msg = getPrecheckMessage('PLATFORM_UNSUPPORTED', 'zh-CN')
    expect(msg).toContain('操作系统')
  })

  it('en message for NETWORK_UNAVAILABLE mentions Network', () => {
    const msg = getPrecheckMessage('NETWORK_UNAVAILABLE', 'en')
    expect(msg).toContain('Network')
  })
})
