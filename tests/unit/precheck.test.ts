import { describe, expect, it } from 'vitest'

import { runPrecheck } from '../../src/main/core/precheck'

describe('precheck', () => {
  it('returns block when install directory is not writable', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: false,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('block')
  })

  it('returns warn when existing environment is detected', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: true,
    })

    expect(result.level).toBe('warn')
  })

  it('blocks when network is unavailable', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
      networkAvailable: false,
    })

    expect(result.items.some((item) => item.code === 'NETWORK_UNAVAILABLE')).toBe(true)
    expect(result.level).toBe('block')
  })

  it('warns when elevation is required', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
      elevationRequired: true,
    })

    expect(result.items.some((item) => item.code === 'ELEVATION_REQUIRED')).toBe(true)
    expect(result.level).toBe('warn')
  })
})
