/**
 * maven-plugin 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'Apache Maven 3.9.11', stderr: '' })
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

import mavenEnvPlugin from '../../src/main/plugins/mavenEnvPlugin'

describe('maven env plugin', () => {
  it('builds an official-source dry-run direct install plan on darwin', async () => {
    const result = await mavenEnvPlugin.install({
      mavenManager: 'maven',
      mavenVersion: '3.9.11',
      installRootDir: '/tmp/maven-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('3.9.11')
    expect(result.downloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'maven',
          url: expect.stringContaining('archive.apache.org/dist/maven'),
        }),
      ]),
    )
    expect(result.commands.join('\n')).toContain('tar -xzf')
    expect(result.envChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'MAVEN_HOME', value: '/tmp/maven-toolchain/maven-3.9.11' }),
        expect.objectContaining({ key: 'M2_HOME', value: '/tmp/maven-toolchain/maven-3.9.11' }),
      ]),
    )
  })

  it('builds a Homebrew package dry-run install plan on darwin', async () => {
    const result = await mavenEnvPlugin.install({
      mavenManager: 'package',
      mavenVersion: '3.9.11',
      installRootDir: '/tmp/maven-toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.version).toBe('3.9.11')
    expect(result.commands.join('\n')).toContain('version-install "$MAVEN_FORMULA"')
    expect(result.commands.join('\n')).toContain("MAVEN_FORMULA='maven@3.9.11'")
    expect(result.commands.join('\n')).not.toContain('mkdir -p')
    expect(result.rollbackCommands?.join('\n')).toContain('uninstall --formula maven@3.9.11')
    expect(result.envChanges).toEqual([
      expect.objectContaining({
        key: 'PATH',
        value:
          process.arch === 'x64'
            ? '/usr/local/opt/maven@3.9.11/bin'
            : '/opt/homebrew/opt/maven@3.9.11/bin',
      }),
    ])
  })

  it('builds a Windows dry-run direct install plan with Expand-Archive', async () => {
    const result = await mavenEnvPlugin.install({
      mavenManager: 'maven',
      mavenVersion: '3.9.11',
      installRootDir: 'C:\\envsetup\\maven',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.commands.join('\n')).toContain('Expand-Archive')
    expect(result.commands.join('\n')).toContain('mvn.cmd')
  })

  it('builds a Scoop package dry-run install plan on win32', async () => {
    const result = await mavenEnvPlugin.install({
      mavenManager: 'package',
      mavenVersion: '3.9.11',
      installRootDir: 'C:\\envsetup\\maven',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.version).toBe('3.9.11')
    expect(result.commands.join('\n')).toContain('scoop install maven@3.9.11')
    expect(result.commands.join('\n')).not.toContain('New-Item -ItemType Directory -Force')
    expect(result.rollbackCommands?.join('\n')).toContain('scoop uninstall maven')
    expect(result.envChanges).toEqual([
      expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
    ])
  })

  it('returns localized dry-run verify copy in english', async () => {
    const installResult = await mavenEnvPlugin.install({
      mavenManager: 'maven',
      mavenVersion: '3.9.11',
      installRootDir: '/tmp/maven-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await mavenEnvPlugin.verify({
      mavenManager: 'maven',
      mavenVersion: '3.9.11',
      installRootDir: '/tmp/maven-toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('Planned Maven manager: maven')
    expect(verifyResult.checks[2]).toContain('archive.apache.org')
  })

  it('runs real-run install commands when dryRun is false', async () => {
    const result = await mavenEnvPlugin.install({
      mavenManager: 'package',
      installRootDir: '/tmp/maven-toolchain',
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

  it('verifies Scoop installs by resolving the Maven command from the Scoop prefix', async () => {
    execFileMock.mockClear()

    await mavenEnvPlugin.verify({
      mavenManager: 'package',
      installRootDir: 'C:\\envsetup\\maven',
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
        expect.stringMatching(/function Get-ScoopMavenCommand \{\nparam/),
      ]),
      expect.any(Function),
    )
  })
})
