import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'ok', stderr: '' })
  }),
}))

import frontendPlugin from '../../fixtures/plugins/frontend-env/index'

describe('frontend env plugin', () => {
  it('returns install result with version paths and env changes', async () => {
    const result = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('20.11.1')
    expect(result.paths.installRootDir).toBe('/tmp/toolchain')
    expect(result.paths.npmCacheDir).toBe('/tmp/npm-cache')
    expect(result.envChanges.length).toBeGreaterThan(0)
    expect(result.downloads.map((download) => download.url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('github.com/nvm-sh/nvm'),
        expect.stringContaining('nodejs.org/dist'),
      ]),
    )
    expect(result.commands.join('\n')).not.toContain('raw.githubusercontent.com')
  })

  it('verifies dry-run output without touching the system', async () => {
    const installResult = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    const verifyResult = await frontendPlugin.verify({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('计划安装')
    expect(verifyResult.checks[2]).toContain('github.com')
    expect(verifyResult.checks[2]).toContain('nodejs.org')
  })

  it('returns english validation and verify copy when locale is english', async () => {
    const installResult = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await frontendPlugin.verify({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(installResult.summary).toContain('official-source')
    expect(verifyResult.checks[2]).toContain('official download sources')
  })

  it('returns real-run result when dryRun is false', async () => {
    const result = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: false,
      platform: 'darwin',
      onProgress: vi.fn(),
    })

    expect(result.executionMode).toBe('real_run')
    expect(result.logs).toEqual(expect.arrayContaining([expect.stringContaining('mode=real-run')]))
  })

  it('builds standalone node downloads from nodejs.org with checksum verification', async () => {
    const result = await frontendPlugin.install({
      nodeManager: 'node',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.downloads).toHaveLength(1)
    expect(result.downloads[0].url).toContain('nodejs.org/dist/v20.11.1/')
    expect(result.downloads[0].checksumUrl).toContain('nodejs.org/dist/v20.11.1/SHASUMS256.txt')
    expect(result.commands.join('\n')).toContain('shasum -a 256 -c -')
  })
})
