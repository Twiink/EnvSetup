import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'git version 2.47.1', stderr: '' })
  }),
}))

vi.mock('../../src/main/core/download', () => ({
  downloadArtifacts: vi.fn().mockResolvedValue([
    {
      artifact: { url: 'https://mock.test/git-installer' },
      localPath: '/tmp/cached',
      cacheHit: true,
    },
  ]),
  validateOfficialDownloads: vi.fn(),
}))

import gitPlugin from '../../fixtures/plugins/git-env/index'

describe('git env plugin', () => {
  it('returns dry-run result for direct git install on darwin', async () => {
    const result = await gitPlugin.install({
      gitManager: 'git',
      gitVersion: '2.47.1',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.downloads[0].url).toContain('sourceforge.net')
    expect(result.commands.join('\n')).toContain('hdiutil attach')
    expect(result.commands.join('\n')).toContain('.Trashes')
    expect(result.commands.join('\n')).toContain('pkgutil --expand')
  })

  it('returns dry-run result for direct git install on win32', async () => {
    const result = await gitPlugin.install({
      gitManager: 'git',
      gitVersion: '2.47.1',
      installRootDir: 'C:\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.downloads[0].url).toContain('github.com/git-for-windows/git')
    expect(result.commands.join('\n')).toContain('/VERYSILENT')
    expect(result.commands.join('\n')).toContain('/NOCANCEL')
    expect(result.commands.join('\n')).toContain('/SP-')
    expect(result.commands.join('\n')).not.toContain('/CLOSEAPPLICATIONS')
    expect(result.commands.join('\n')).not.toContain('/RESTARTAPPLICATIONS')
    expect(result.commands.join('\n')).toContain('$gitInstallerArgs = @(')
    expect(result.commands.join('\n')).toContain(
      'Start-Process -FilePath $installer -ArgumentList $gitInstallerArgs -Wait -PassThru',
    )
  })

  it('returns dry-run result for homebrew mode on darwin', async () => {
    const result = await gitPlugin.install({
      gitManager: 'homebrew',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.downloads[0].url).toContain('raw.githubusercontent.com/Homebrew/install')
    expect(result.commands).toHaveLength(1)
    expect(result.commands.join('\n')).toContain('NONINTERACTIVE=1')
    expect(result.commands.join('\n')).toContain('"$BREW_BIN" install git')
    expect(result.rollbackCommands?.join('\n')).toContain('uninstall --formula git')
  })

  it('returns dry-run result for scoop mode on win32', async () => {
    const result = await gitPlugin.install({
      gitManager: 'scoop',
      installRootDir: 'C:\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.downloads[0].url).toContain('get.scoop.sh')
    expect(result.commands).toHaveLength(1)
    expect(result.commands.join('\n')).toContain('Invoke-WebRequest')
    expect(result.commands.join('\n')).not.toContain('Import-Module Microsoft.PowerShell.Security')
    expect(result.commands.join('\n')).toContain('& $installer')
    expect(result.commands.join('\n')).toContain('& $scoop install git')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall git')
  })

  it('rejects homebrew mode on win32', async () => {
    await expect(
      gitPlugin.install({
        gitManager: 'homebrew',
        installRootDir: 'C:\\toolchain',
        dryRun: true,
        platform: 'win32',
      }),
    ).rejects.toThrow('homebrew')
  })

  it('rejects scoop mode on darwin', async () => {
    await expect(
      gitPlugin.install({
        gitManager: 'scoop',
        installRootDir: '/tmp/toolchain',
        dryRun: true,
        platform: 'darwin',
      }),
    ).rejects.toThrow('scoop')
  })

  it('returns english verify copy in dry-run mode', async () => {
    const installResult = await gitPlugin.install({
      gitManager: 'git',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await gitPlugin.verify({
      gitManager: 'git',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('Planned Git manager')
  })

  it('returns real-run result when dryRun is false', async () => {
    const result = await gitPlugin.install({
      gitManager: 'git',
      installRootDir: '/tmp/toolchain',
      downloadCacheDir: '/tmp/download-cache',
      dryRun: false,
      platform: 'darwin',
      onProgress: vi.fn(),
    })

    expect(result.executionMode).toBe('real_run')
    expect(result.logs).toEqual(expect.arrayContaining([expect.stringContaining('mode=real-run')]))
  })
})
