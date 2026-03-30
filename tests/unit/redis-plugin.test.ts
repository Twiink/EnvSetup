/**
 * redis-plugin 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, optionsOrCallback, maybeCallback) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    callback(null, { stdout: 'Redis server v=7.4.7', stderr: '' })
  }),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../src/main/core/download', () => ({
  downloadArtifacts: vi.fn(async ({ downloads }) =>
    downloads.map((artifact: { fileName?: string; tool: string; url: string }) => ({
      artifact,
      localPath: `/tmp/cache/${artifact.fileName ?? artifact.tool}`,
      cacheHit: true,
    })),
  ),
  validateOfficialDownloads: vi.fn(),
}))

import redisEnvPlugin from '../../src/main/plugins/redisEnvPlugin'

describe('redis env plugin', () => {
  it('builds an official direct dry-run install plan on darwin', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'redis',
      redisVersion: '7.4.6',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('7.4.6')
    expect(result.downloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'redis',
          url: expect.stringContaining('download.redis.io/releases/redis-7.4.6.tar.gz'),
        }),
      ]),
    )
    expect(result.commands.join('\n')).toContain('make BUILD_TLS=no MALLOC=libc')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'REDIS_HOME', value: '/tmp/redis-toolchain/redis' }),
        expect.objectContaining({ key: 'PATH', value: '/tmp/redis-toolchain/redis/src' }),
      ]),
    )
  })

  it('builds a Homebrew dry-run install plan on darwin', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'package',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.commands.join('\n')).toContain('install redis')
    expect(result.commands.join('\n')).not.toContain('mkdir -p')
    expect(result.rollbackCommands?.join('\n')).toContain('uninstall --formula redis')
  })

  it('builds a Memurai-based direct dry-run install plan on win32', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'redis',
      redisVersion: '7.4.7',
      installRootDir: 'C:\\envsetup\\redis',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.downloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'redis',
          url: 'https://www.memurai.com/api/request-download-link?version=windows-redis',
        }),
      ]),
    )
    expect(result.version).toBe('7.4.7')
    expect(result.commands.join('\n')).toContain('Memurai setup requires administrator privileges.')
    expect(result.commands.join('\n')).toContain('& cmd.exe /d /s /c $installCommand')
    expect(result.commands.join('\n')).toContain('/l*v "{2}"')
    expect(result.commands.join('\n')).toContain('$($msiExitCode)')
    expect(result.commands.join('\n')).toContain('Memurai for Redis installed')
    expect(result.rollbackCommands?.join('\n')).toContain('DisplayName -like')
    expect(result.rollbackCommands?.join('\n')).toContain(
      'Memurai uninstall requires administrator privileges.',
    )
    expect(result.rollbackCommands?.join('\n')).toContain('& cmd.exe /d /s /c $uninstallCommand')
    expect(result.rollbackCommands?.join('\n')).toContain('$($uninstallExitCode)')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'REDIS_HOME', value: 'C:\\envsetup\\redis\\redis' }),
      ]),
    )
  })

  it('builds a Scoop dry-run install plan on win32', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'package',
      installRootDir: 'C:\\envsetup\\redis',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.commands.join('\n')).toContain('scoop install redis')
    expect(result.commands.join('\n')).not.toContain('New-Item -ItemType Directory -Force')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall redis')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })

  it('returns localized dry-run verify copy in english for direct installs', async () => {
    const installResult = await redisEnvPlugin.install({
      redisManager: 'redis',
      redisVersion: '7.4.6',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await redisEnvPlugin.verify({
      redisManager: 'redis',
      redisVersion: '7.4.6',
      installRootDir: '/tmp/redis-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('Planned Redis manager: redis')
    expect(verifyResult.checks[2]).toContain('download.redis.io')
  })

  it('runs real-run install commands when dryRun is false', async () => {
    const result = await redisEnvPlugin.install({
      redisManager: 'redis',
      redisVersion: '7.4.6',
      installRootDir: '/tmp/redis-toolchain',
      downloadCacheDir: '/tmp/download-cache',
      dryRun: false,
      platform: 'darwin',
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

  it('retries win32 direct real-run installs with elevation after Memurai admin checks fail', async () => {
    execFileMock.mockReset()
    execFileMock
      .mockImplementationOnce((_file, _args, callback) => {
        const error = Object.assign(new Error('Memurai setup requires administrator privileges.'), {
          stderr: 'Memurai setup requires administrator privileges.',
        })
        callback(error)
      })
      .mockImplementationOnce((_file, _args, _options, callback) => {
        callback(null, { stdout: 'Memurai for Redis installed', stderr: '' })
      })

    const result = await redisEnvPlugin.install({
      redisManager: 'redis',
      redisVersion: '7.4.7',
      installRootDir: 'C:\\envsetup\\redis',
      downloadCacheDir: 'C:\\envsetup\\cache',
      dryRun: false,
      platform: 'win32',
    })

    expect(result.executionMode).toBe('real_run')
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining([
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        expect.stringContaining('Memurai setup requires administrator privileges.'),
      ]),
      expect.any(Function),
    )
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining([
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        expect.stringContaining('-Verb RunAs'),
      ]),
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('verifies Scoop installs by resolving the Redis command from the Scoop prefix', async () => {
    execFileMock.mockClear()

    await redisEnvPlugin.verify({
      redisManager: 'package',
      installRootDir: 'C:\\envsetup\\redis',
      dryRun: false,
      platform: 'win32',
      installResult: {
        status: 'installed_unverified',
        executionMode: 'real_run',
        version: 'latest',
        paths: {},
        envChanges: [],
        downloads: [],
        commands: [],
        logs: [],
        summary: 'installed',
      },
    })

    expect(execFileMock).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining([
        '-Command',
        expect.stringMatching(/function Get-ScoopRedisCommand \{\nparam/),
      ]),
      expect.any(Function),
    )
  })
})
