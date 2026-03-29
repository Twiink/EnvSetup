/**
 * redis-plugin 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'Redis server v=8.0.0', stderr: '' })
  }),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../src/main/core/download', () => ({
  downloadArtifacts: vi.fn().mockResolvedValue([
    {
      artifact: { tool: 'scoop', url: 'https://get.scoop.sh' },
      localPath: 'C:\\cache\\install.ps1',
      cacheHit: true,
    },
  ]),
  validateOfficialDownloads: vi.fn(),
}))

import redisEnvPlugin from '../../src/main/plugins/redisEnvPlugin'

describe('redis env plugin', () => {
  it('builds a Homebrew dry-run install plan on darwin', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'package',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('latest')
    expect(result.downloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'homebrew',
          url: expect.stringContaining('raw.githubusercontent.com/Homebrew/install'),
        }),
      ]),
    )
    expect(result.commands.join('\n')).toContain('install redis')
    expect(result.rollbackCommands?.join('\n')).toContain('uninstall --formula redis')
  })

  it('builds a Scoop dry-run install plan on win32', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'package',
      installRootDir: 'C:\\envsetup\\redis',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.commands.join('\n')).toContain('scoop install redis')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall redis')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })

  it('returns localized dry-run verify copy in english', async () => {
    const installResult = await redisEnvPlugin.install({
      redisManager: 'package',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await redisEnvPlugin.verify({
      redisManager: 'package',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('Homebrew')
    expect(verifyResult.checks[2]).toContain('official download sources')
  })

  it('runs real-run install commands when dryRun is false', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'package',
      installRootDir: 'C:\\envsetup\\redis',
      downloadCacheDir: 'C:\\envsetup\\download-cache',
      dryRun: false,
      platform: 'win32',
      onProgress: vi.fn(),
    })

    expect(result.executionMode).toBe('real_run')
    expect(result.logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mode=real-run'),
        expect.stringContaining('download_cache_hit=true'),
      ]),
    )
  })
})
