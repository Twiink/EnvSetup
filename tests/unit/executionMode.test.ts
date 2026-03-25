import { afterEach, describe, expect, it } from 'vitest'

import { resolveDryRun } from '../../src/main/core/executionMode'

describe('resolveDryRun', () => {
  const originalEnvSetupRealRun = process.env.ENVSETUP_REAL_RUN

  afterEach(() => {
    if (originalEnvSetupRealRun === undefined) {
      delete process.env.ENVSETUP_REAL_RUN
      return
    }

    process.env.ENVSETUP_REAL_RUN = originalEnvSetupRealRun
  })

  it('defaults to dry-run in development mode (isPackaged=false)', () => {
    delete process.env.ENVSETUP_REAL_RUN

    expect(resolveDryRun(false)).toBe(true)
  })

  it('defaults to real-run in packaged mode (isPackaged=true)', () => {
    delete process.env.ENVSETUP_REAL_RUN

    expect(resolveDryRun(true)).toBe(false)
  })

  it('forces real-run when ENVSETUP_REAL_RUN=1 regardless of packaging', () => {
    process.env.ENVSETUP_REAL_RUN = '1'

    expect(resolveDryRun(false)).toBe(false)
    expect(resolveDryRun(true)).toBe(false)
  })

  it('forces dry-run when ENVSETUP_REAL_RUN=0 regardless of packaging', () => {
    process.env.ENVSETUP_REAL_RUN = '0'

    expect(resolveDryRun(false)).toBe(true)
    expect(resolveDryRun(true)).toBe(true)
  })

  it('ignores unsupported override values and falls back to packaging state', () => {
    process.env.ENVSETUP_REAL_RUN = 'unexpected'

    expect(resolveDryRun(false)).toBe(true)
    expect(resolveDryRun(true)).toBe(false)
  })
})
