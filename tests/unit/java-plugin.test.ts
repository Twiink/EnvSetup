import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'ok', stderr: '' })
  }),
}))

vi.mock('../../src/main/core/download', () => ({
  downloadArtifacts: vi.fn().mockResolvedValue([
    {
      artifact: { tool: 'temurin', url: 'https://mock.test/file.tar.gz' },
      localPath: '/tmp/cached',
      cacheHit: true,
    },
  ]),
  validateOfficialDownloads: vi.fn(),
}))

vi.mock('../../src/main/core/archiveCache', () => ({
  prepareExtractedArchive: vi.fn().mockResolvedValue({
    cacheHit: true,
    extractionDir: '/tmp/extracted/java-cache',
    extractedRootDir: '/tmp/extracted/java-cache/root',
  }),
}))

import javaPlugin from '../../src/main/plugins/javaEnvPlugin'

describe('java env plugin', () => {
  it('returns dry-run install result with jdk manager on darwin', async () => {
    const result = await javaPlugin.install({
      javaManager: 'jdk',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('21')
    expect(result.paths.installRootDir).toBe('/tmp/toolchain')
    expect(result.envChanges.length).toBeGreaterThan(0)
    expect(result.envChanges.some((e) => e.key === 'JAVA_HOME')).toBe(true)
    expect(result.downloads.length).toBe(1)
    expect(result.downloads[0].tool).toBe('temurin')
    expect(result.downloads[0].url).toContain('api.adoptium.net')
    expect(result.commands.length).toBeGreaterThan(0)
  })

  it('returns dry-run install result with sdkman manager on darwin', async () => {
    const result = await javaPlugin.install({
      javaManager: 'sdkman',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.downloads.length).toBe(1)
    expect(result.downloads[0].tool).toBe('sdkman')
    expect(result.downloads[0].url).toContain('get.sdkman.io')
    expect(result.envChanges.some((e) => e.key === 'SDKMAN_DIR')).toBe(true)
    const commands = result.commands.join('\n')
    expect(commands).toContain('sdk list java 2>&1')
    expect(commands).toContain('SDKMAN_LIST_FILE="$(mktemp)"')
    expect(commands).toContain('case "$token" in 21*-[A-Za-z]*)')
    expect(commands).toContain('sdk install java "$SDKMAN_JAVA_VERSION"')
    expect(commands).toContain('sdk default java "$SDKMAN_JAVA_VERSION"')
    expect(commands).toContain('sdkman-init.sh')
    expect(commands).not.toContain('grep -oE')
  })

  it('returns dry-run install result with jdk manager on win32', async () => {
    const result = await javaPlugin.install({
      javaManager: 'jdk',
      javaVersion: '17',
      installRootDir: 'C:\\envsetup\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.downloads[0].url).toContain('windows')
    expect(result.commands.join('\n')).toContain('Expand-Archive')
    expect(result.downloads[0].checksumUrl).toBeUndefined()
  })

  it('returns dry-run install result with sdkman on win32', async () => {
    const result = await javaPlugin.install({
      javaManager: 'sdkman',
      javaVersion: '21',
      installRootDir: 'C:\\envsetup\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.commands.join('\n')).toContain("Get-Command 'bash.exe'")
    expect(result.commands.join('\n')).toContain('$gitInstallerArgs = @(')
    expect(result.commands.join('\n')).toContain('/SUPPRESSMSGBOXES')
    expect(result.commands.join('\n')).toContain(
      'Start-Process -FilePath $gitInstaller -ArgumentList $gitInstallerArgs -Wait -PassThru',
    )
    const commands = result.commands.join('\n')
    expect(commands).toContain('& $gitBash -lc')
    expect(commands).toContain('sdk list java 2>&1')
    expect(commands).toContain('SDKMAN_LIST_FILE="$(mktemp)"')
    expect(commands).toContain('case "$token" in 21*-[A-Za-z]*)')
    expect(commands).not.toContain('grep -oE')
    expect(commands).not.toContain('node -e')
  })

  it('verifies dry-run output without touching the system', async () => {
    const installResult = await javaPlugin.install({
      javaManager: 'jdk',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    const verifyResult = await javaPlugin.verify({
      javaManager: 'jdk',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('计划安装')
  })

  it('returns english verify copy when locale is english', async () => {
    const installResult = await javaPlugin.install({
      javaManager: 'sdkman',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await javaPlugin.verify({
      javaManager: 'sdkman',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.checks[0]).toContain('Planned Java version')
  })

  it('returns real-run result when dryRun is false', async () => {
    const result = await javaPlugin.install({
      javaManager: 'jdk',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      downloadCacheDir: '/tmp/download-cache',
      dryRun: false,
      platform: 'darwin',
      onProgress: vi.fn(),
    })

    expect(result.executionMode).toBe('real_run')
    expect(result.logs).toEqual(expect.arrayContaining([expect.stringContaining('mode=real-run')]))
  })

  it('reuses extracted archive cache for real-run jdk installs when available', async () => {
    const result = await javaPlugin.install({
      javaManager: 'jdk',
      javaVersion: '21',
      installRootDir: '/tmp/toolchain',
      downloadCacheDir: '/tmp/download-cache',
      extractedCacheDir: '/tmp/extracted-cache',
      dryRun: false,
      platform: 'darwin',
      onProgress: vi.fn(),
    })

    expect(result.commands.join('\n')).toContain("cp -R '/tmp/extracted/java-cache/root/.'")
    expect(result.commands.join('\n')).not.toContain('tar -xzf')
    expect(result.logs).toEqual(
      expect.arrayContaining([expect.stringContaining('extract_cache_hit=true temurin')]),
    )
  })

  it('throws for invalid javaManager', async () => {
    await expect(
      javaPlugin.install({
        javaManager: 'invalid' as 'jdk',
        javaVersion: '21',
        installRootDir: '/tmp/toolchain',
        dryRun: true,
        platform: 'darwin',
      }),
    ).rejects.toThrow()
  })

  it('throws for missing javaVersion', async () => {
    await expect(
      javaPlugin.install({
        javaManager: 'jdk',
        javaVersion: '',
        installRootDir: '/tmp/toolchain',
        dryRun: true,
        platform: 'darwin',
      }),
    ).rejects.toThrow()
  })
})
