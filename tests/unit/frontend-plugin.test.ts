import { describe, expect, it } from 'vitest'

import frontendPlugin from '../../fixtures/plugins/frontend-env/index'

describe('frontend env plugin', () => {
  it('returns install result with version paths and env changes', async () => {
    const result = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('20.11.1')
    expect(result.paths.npmCacheDir).toBe('/tmp/npm-cache')
    expect(result.envChanges.length).toBeGreaterThan(0)
  })

  it('verifies dry-run output without touching the system', async () => {
    const installResult = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    const verifyResult = await frontendPlugin.verify({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('计划安装')
  })

  it('returns english validation and verify copy when locale is english', async () => {
    const installResult = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await frontendPlugin.verify({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(installResult.summary).toContain('Prepared')
    expect(verifyResult.checks[0]).toContain('Node version')
  })
})
