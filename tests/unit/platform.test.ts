import { describe, expect, it } from 'vitest'

import { buildPlatformStrategy } from '../../src/main/core/platform'

describe('platform', () => {
  it('returns zsh/bash strategy for darwin', () => {
    const strategy = buildPlatformStrategy('darwin')
    expect(strategy.shellTargets).toEqual(['zsh', 'bash'])
  })

  it('returns powershell strategy for win32', () => {
    const strategy = buildPlatformStrategy('win32')
    expect(strategy.shellTargets).toEqual(['powershell'])
  })
})
