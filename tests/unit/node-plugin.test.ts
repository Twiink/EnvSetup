import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'ok', stderr: '' })
  }),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../src/main/core/download', () => ({
  downloadArtifacts: vi.fn().mockResolvedValue([
    {
      artifact: { url: 'https://mock.test/file.tar.gz' },
      localPath: '/tmp/cached',
      cacheHit: true,
    },
  ]),
  validateOfficialDownloads: vi.fn(),
}))

import nodePlugin from '../../fixtures/plugins/node-env/index'

describe('node env plugin', () => {
  it('returns install result with version paths and env changes', async () => {
    const result = await nodePlugin.install({
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
    const installResult = await nodePlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    const verifyResult = await nodePlugin.verify({
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
    const installResult = await nodePlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await nodePlugin.verify({
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
    const result = await nodePlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      downloadCacheDir: '/tmp/download-cache',
      dryRun: false,
      platform: 'darwin',
      onProgress: vi.fn(),
    })

    expect(result.executionMode).toBe('real_run')
    expect(result.logs).toEqual(expect.arrayContaining([expect.stringContaining('mode=real-run')]))
  })

  it('builds standalone node downloads from nodejs.org with checksum verification', async () => {
    const result = await nodePlugin.install({
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

  it('uses .NET SHA256 instead of Get-FileHash on win32 direct installs', async () => {
    const result = await nodePlugin.install({
      nodeManager: 'node',
      nodeVersion: '20.11.1',
      installRootDir: 'C:\\envsetup\\toolchain',
      npmCacheDir: 'C:\\envsetup\\npm-cache',
      npmGlobalPrefix: 'C:\\envsetup\\npm-global',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.commands.join('\n')).toContain('System.Security.Cryptography.SHA256')
    expect(result.commands.join('\n')).not.toContain('Get-FileHash')
    expect(result.commands.join('\n')).toContain('Failed to locate Node.js checksum entry.')
  })

  it('prepends standalone node bin to PATH during darwin real-run verify', async () => {
    execFileMock.mockClear()

    const installResult = await nodePlugin.install({
      nodeManager: 'node',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    await nodePlugin.verify({
      nodeManager: 'node',
      nodeVersion: '20.11.1',
      installRootDir: '/tmp/toolchain',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: false,
      platform: 'darwin',
      installResult,
    })

    const shellCommands = execFileMock.mock.calls
      .filter(([file, args]) => file === 'sh' && Array.isArray(args) && args[0] === '-c')
      .map(([, args]) => args[1])

    expect(shellCommands).toEqual(
      expect.arrayContaining([
        'export PATH="/tmp/toolchain/node-v20.11.1/bin:$PATH" && node --version',
        'export PATH="/tmp/toolchain/node-v20.11.1/bin:$PATH" && npm config get cache',
        'export PATH="/tmp/toolchain/node-v20.11.1/bin:$PATH" && npm config get prefix',
      ]),
    )
  })
})
