/**
 * mysql-plugin 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'mysql  Ver 9.0.0', stderr: '' })
  }),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../src/main/core/download', () => ({
  downloadArtifacts: vi.fn().mockResolvedValue([
    {
      artifact: {
        tool: 'homebrew',
        url: 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh',
      },
      localPath: '/tmp/cache/homebrew-install.sh',
      cacheHit: true,
    },
  ]),
  validateOfficialDownloads: vi.fn(),
}))

import mysqlEnvPlugin from '../../src/main/plugins/mysqlEnvPlugin'

describe('mysql env plugin', () => {
  it('builds a Homebrew dry-run install plan on darwin', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'package',
      installRootDir: '/tmp/mysql-toolchain',
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
    expect(result.commands.join('\n')).toContain('install mysql')
    expect(result.rollbackCommands?.join('\n')).toContain('uninstall --formula mysql')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'PATH',
          value: process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin',
        }),
      ]),
    )
  })

  it('builds a Scoop dry-run install plan on win32', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'package',
      installRootDir: 'C:\\envsetup\\mysql',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.commands.join('\n')).toContain('scoop install mysql')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall mysql')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })

  it('returns localized dry-run verify copy in english', async () => {
    const installResult = await mysqlEnvPlugin.install({
      mysqlManager: 'package',
      installRootDir: '/tmp/mysql-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await mysqlEnvPlugin.verify({
      mysqlManager: 'package',
      installRootDir: '/tmp/mysql-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('Homebrew')
    expect(verifyResult.checks[2]).toContain('raw.githubusercontent.com')
  })

  it('runs real-run install commands when dryRun is false', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'package',
      installRootDir: '/tmp/mysql-toolchain',
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
})
