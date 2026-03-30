/**
 * mysql-plugin 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'mysql  Ver 8.4.8', stderr: '' })
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

import mysqlEnvPlugin from '../../src/main/plugins/mysqlEnvPlugin'

describe('mysql env plugin', () => {
  it('builds an official direct dry-run install plan on darwin', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'mysql',
      mysqlVersion: '8.4.7',
      installRootDir: '/tmp/mysql-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('8.4.7')
    expect(result.downloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'mysql',
          url: expect.stringContaining('cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.7'),
        }),
      ]),
    )
    expect(result.commands.join('\n')).toContain('tar -xzf')
    expect(result.commands.join('\n')).toContain('/tmp/mysql-toolchain/mysql/bin/mysql')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'MYSQL_HOME', value: '/tmp/mysql-toolchain/mysql' }),
        expect.objectContaining({ key: 'PATH', value: '/tmp/mysql-toolchain/mysql/bin' }),
      ]),
    )
  })

  it('builds a Homebrew package dry-run install plan on darwin', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'package',
      mysqlVersion: '8.4.8',
      installRootDir: '/tmp/mysql-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.version).toBe('8.4.8')
    expect(result.commands.join('\n')).toContain('install --formula "$MYSQL_FORMULA"')
    expect(result.commands.join('\n')).toContain("MYSQL_FORMULA='mysql@8.4'")
    expect(result.commands.join('\n')).not.toContain('mkdir -p')
    expect(result.rollbackCommands?.join('\n')).toContain('uninstall --formula mysql@8.4')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'PATH',
          value:
            process.arch === 'x64'
              ? '/usr/local/opt/mysql@8.4/bin'
              : '/opt/homebrew/opt/mysql@8.4/bin',
        }),
      ]),
    )
  })

  it('builds a Windows direct dry-run install plan with Expand-Archive', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'mysql',
      mysqlVersion: '8.4.7',
      installRootDir: 'C:\\envsetup\\mysql',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.version).toBe('8.4.7')
    expect(result.downloads[0].url).toContain('mysql-8.4.7-winx64.zip')
    expect(result.commands.join('\n')).toContain('Expand-Archive')
    expect(result.commands.join('\n')).toContain('mysql.exe')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'MYSQL_HOME', value: 'C:\\envsetup\\mysql\\mysql' }),
      ]),
    )
  })

  it('builds a Scoop dry-run install plan on win32', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'package',
      mysqlVersion: '8.4.8',
      installRootDir: 'C:\\envsetup\\mysql',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.version).toBe('8.4.8')
    expect(result.commands.join('\n')).toContain('scoop install mysql@8.4.8')
    expect(result.commands.join('\n')).not.toContain('New-Item -ItemType Directory -Force')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall mysql')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })

  it('returns localized dry-run verify copy in english for direct installs', async () => {
    const installResult = await mysqlEnvPlugin.install({
      mysqlManager: 'mysql',
      mysqlVersion: '8.4.7',
      installRootDir: '/tmp/mysql-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await mysqlEnvPlugin.verify({
      mysqlManager: 'mysql',
      mysqlVersion: '8.4.7',
      installRootDir: '/tmp/mysql-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('Planned MySQL manager: mysql')
    expect(verifyResult.checks[2]).toContain('cdn.mysql.com')
  })

  it('runs real-run install commands when dryRun is false', async () => {
    const result = await mysqlEnvPlugin.install({
      mysqlManager: 'mysql',
      mysqlVersion: '8.4.7',
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
