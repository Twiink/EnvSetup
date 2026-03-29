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
  downloadArtifacts: vi.fn().mockResolvedValue([
    {
      artifact: {
        tool: 'maven',
        url: 'https://archive.apache.org/dist/maven/maven-3/3.9.11/binaries/apache-maven-3.9.11-bin.tar.gz',
      },
      localPath: '/tmp/cache/apache-maven-3.9.11-bin.tar.gz',
      cacheHit: true,
    },
  ]),
  validateOfficialDownloads: vi.fn(),
}))

import mavenEnvPlugin from '../../src/main/plugins/mavenEnvPlugin'

describe('maven env plugin', () => {
  it('builds an official-source dry-run install plan on darwin', async () => {
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

  it('builds a Windows dry-run install plan with Expand-Archive', async () => {
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
    expect(verifyResult.checks[0]).toContain('Planned Maven version: 3.9.11')
    expect(verifyResult.checks[2]).toContain('archive.apache.org')
  })

  it('runs real-run install commands when dryRun is false', async () => {
    const result = await mavenEnvPlugin.install({
      mavenManager: 'maven',
      mavenVersion: '3.9.11',
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
})
