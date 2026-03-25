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
    expect(result.detections).toEqual([])
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

  it('blocks when platform is not supported', async () => {
    const result = await runPrecheck({
      platformSupported: false,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('block')
    expect(result.items.some((item) => item.code === 'PLATFORM_UNSUPPORTED')).toBe(true)
  })

  it('blocks when arch is not supported', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: false,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('block')
    expect(result.items.some((item) => item.code === 'ARCH_UNSUPPORTED')).toBe(true)
  })

  it('blocks when version is not compatible', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: false,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('block')
    expect(result.items.some((item) => item.code === 'VERSION_INCOMPATIBLE')).toBe(true)
  })

  it('blocks when dependency is not satisfied', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: false,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('block')
    expect(result.items.some((item) => item.code === 'PLUGIN_DEPENDENCY_MISSING')).toBe(true)
  })

  it('warns when failedTemplateChecks contains tool names', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
      failedTemplateChecks: ['node', 'python'],
    })

    expect(result.level).toBe('warn')
    const warnItem = result.items.find((item) => item.code === 'EXISTING_ENV_DETECTED')
    expect(warnItem?.message).toContain('node')
    expect(warnItem?.message).toContain('python')
  })

  it('returns pass when all conditions are satisfied', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('pass')
    expect(result.items).toHaveLength(0)
  })

  it('block takes precedence over warn when both conditions apply', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: false,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: true,
    })

    expect(result.level).toBe('block')
  })

  it('returns zh-CN messages when locale is zh-CN', async () => {
    const result = await runPrecheck(
      {
        platformSupported: false,
        archSupported: true,
        writable: true,
        dependencySatisfied: true,
        versionCompatible: true,
        existingEnvConflict: false,
      },
      'zh-CN',
    )

    const item = result.items.find((i) => i.code === 'PLATFORM_UNSUPPORTED')
    expect(item?.message).toContain('操作系统')
  })

  it('returns en messages when locale is en', async () => {
    const result = await runPrecheck(
      {
        platformSupported: false,
        archSupported: true,
        writable: true,
        dependencySatisfied: true,
        versionCompatible: true,
        existingEnvConflict: false,
      },
      'en',
    )

    const item = result.items.find((i) => i.code === 'PLATFORM_UNSUPPORTED')
    expect(item?.message).toContain('operating system')
  })

  it('result includes a createdAt ISO timestamp', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('warns when gitBashMissing is true', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
      gitBashMissing: true,
    })

    expect(result.level).toBe('warn')
    const item = result.items.find((i) => i.code === 'PLUGIN_DEPENDENCY_MISSING')
    expect(item).toBeDefined()
    expect(item?.message).toContain('Git Bash')
  })

  it('returns zh-CN Git Bash message when locale is zh-CN', async () => {
    const result = await runPrecheck(
      {
        platformSupported: true,
        archSupported: true,
        writable: true,
        dependencySatisfied: true,
        versionCompatible: true,
        existingEnvConflict: false,
        gitBashMissing: true,
      },
      'zh-CN',
    )

    const item = result.items.find((i) => i.code === 'PLUGIN_DEPENDENCY_MISSING')
    expect(item?.message).toContain('SDKMAN')
    expect(item?.message).toContain('Git for Windows')
  })

  it('does not block when gitBashMissing is false', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
      gitBashMissing: false,
    })

    expect(result.level).toBe('pass')
    expect(result.items.find((i) => i.message?.includes('Git Bash'))).toBeUndefined()
  })

  it('does not block when gitBashMissing is undefined', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    })

    expect(result.level).toBe('pass')
    expect(result.items.find((i) => i.message?.includes('Git Bash'))).toBeUndefined()
  })
})
