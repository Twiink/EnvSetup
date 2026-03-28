import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'

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
    expect(result.downloads[0].url).toContain('Git-2.47.1-64-bit.tar.bz2')
    expect(result.commands.join('\n')).toContain('tar -xjf $archive -C $extractRoot')
    expect(result.commands.join('\n')).toContain('Move-Item -LiteralPath $_.FullName')
    expect(result.commands.join('\n')).not.toContain('Start-Process -FilePath $installer')
    expect(result.commands.join('\n')).not.toContain('Git-2.47.1-64-bit.exe')
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
    expect(result.commands.join('\n')).toContain(
      `Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'`,
    )
    expect(result.commands.join('\n')).toContain(`Get-Command 'scoop.cmd'`)
    expect(result.commands.join('\n')).toContain(`function Get-ExecutionPolicy { 'ByPass' }`)
    expect(result.commands.join('\n')).not.toContain(
      'Import-Module Microsoft.PowerShell.Security -ErrorAction SilentlyContinue',
    )
    expect(result.commands.join('\n')).not.toContain(
      '& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer',
    )
    expect(result.commands.join('\n')).toContain('& $scoop install git')
    expect(result.commands.join('\n')).toContain('Scoop git install failed with exit code')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall git')
    expect(result.rollbackCommands?.join('\n')).toContain(
      'Scoop git uninstall failed with exit code',
    )
    expect(result.rollbackCommands?.join('\n')).toContain(
      "foreach ($shimName in @('git.cmd', 'git.exe', 'git.ps1'))",
    )
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

  it('verifies scoop installs by resolving the git executable from the scoop prefix', async () => {
    vi.mocked(execFile).mockClear()

    await gitPlugin.verify({
      gitManager: 'scoop',
      installRootDir: 'C:\\toolchain',
      dryRun: false,
      platform: 'win32',
      installResult: {
        status: 'installed_unverified',
        executionMode: 'real_run',
        version: '2.47.1',
        paths: {},
        envChanges: [],
        downloads: [],
        commands: [],
        logs: [],
        summary: '',
        context: {},
      },
    })

    expect(vi.mocked(execFile)).toHaveBeenCalled()
    const verifyCall = vi.mocked(execFile).mock.calls.at(-1)
    expect(verifyCall?.[0]).toBe('powershell')
    expect(verifyCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Get-ChildItem -Path $prefix -Recurse -File'),
        expect.stringContaining("Where-Object { $_.Name -in @('git.exe', 'git.cmd') }"),
      ]),
    )
    expect(verifyCall?.[1]).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Join-Path $shimDir 'git.cmd'")]),
    )
  })
})
