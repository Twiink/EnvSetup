/**
 * python-plugin 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: 'ok', stderr: '' })
  }),
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

import { execFile } from 'node:child_process'
import pythonPlugin from '../../src/main/plugins/pythonEnvPlugin'

const execFileMock = vi.mocked(execFile)

describe('python env plugin', () => {
  it('returns dry-run install result with python manager on darwin', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('3.12.10')
    expect(result.paths.installRootDir).toBe('/tmp/toolchain')
    expect(result.envChanges.length).toBeGreaterThan(0)
    expect(result.downloads.length).toBe(1)
    expect(result.downloads[0].tool).toBe('python')
    expect(result.downloads[0].url).toContain('www.python.org')
    expect(result.commands.length).toBeGreaterThan(0)
    expect(result.commands.join('\n')).toContain('pkgutil')
  })

  it('returns dry-run install result with conda manager on darwin', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.downloads.length).toBe(1)
    expect(result.downloads[0].tool).toBe('miniconda')
    expect(result.downloads[0].url).toContain('repo.anaconda.com')
    expect(result.commands.join('\n')).toContain('conda')
  })

  it('returns dry-run install result with python manager on win32', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      installRootDir: 'C:\\envsetup\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.downloads[0].url).toContain('embed-amd64.zip')
    expect(result.commands.join('\n')).toContain('Expand-Archive')
    expect(result.commands.join('\n')).toContain('get-pip.py')
  })

  it('returns dry-run install result with conda on win32', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: 'C:\\envsetup\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.downloads[0].url).toContain('Windows')
    expect(result.commands.join('\n')).toContain('conda')
  })

  it('creates named conda environment when condaEnvName is not base', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      condaEnvName: 'myenv',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.commands.join('\n')).toContain('conda create')
    expect(result.commands.join('\n')).toContain('myenv')
    expect(result.context.condaEnvName).toBe('myenv')
  })

  it('verifies dry-run output without touching the system', async () => {
    const installResult = await pythonPlugin.install({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    const verifyResult = await pythonPlugin.verify({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('计划安装')
  })

  it('returns english verify copy when locale is english', async () => {
    const installResult = await pythonPlugin.install({
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
    })

    const verifyResult = await pythonPlugin.verify({
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      locale: 'en',
      installResult,
    })

    expect(verifyResult.checks[0]).toContain('Planned Python version')
  })

  it('verifies standalone Python with python -m pip on darwin', async () => {
    execFileMock.mockClear()

    await pythonPlugin.verify({
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: false,
      platform: 'darwin',
      installResult: {
        status: 'installed_unverified',
        executionMode: 'real_run',
        version: '3.12.10',
        paths: { installRootDir: '/tmp/toolchain', pythonDir: '/tmp/toolchain/python-3.12.10' },
        envChanges: [],
        downloads: [],
        commands: [],
        logs: [],
        summary: 'ok',
        context: {},
      },
    })

    expect(execFileMock).toHaveBeenCalledWith(
      'sh',
      ['-c', "'/tmp/toolchain/python-3.12.10/bin/python3' -m pip --version"],
      expect.any(Function),
    )
  })

  it('returns real-run result when dryRun is false', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      downloadCacheDir: '/tmp/download-cache',
      dryRun: false,
      platform: 'darwin',
      onProgress: vi.fn(),
    })

    expect(result.executionMode).toBe('real_run')
    expect(result.logs).toEqual(expect.arrayContaining([expect.stringContaining('mode=real-run')]))
  })

  it('throws for invalid pythonManager', async () => {
    await expect(
      pythonPlugin.install({
        pythonManager: 'invalid' as 'python',
        pythonVersion: '3.12.10',
        installRootDir: '/tmp/toolchain',
        dryRun: true,
        platform: 'darwin',
      }),
    ).rejects.toThrow()
  })

  it('throws for missing pythonVersion', async () => {
    await expect(
      pythonPlugin.install({
        pythonManager: 'python',
        pythonVersion: '',
        installRootDir: '/tmp/toolchain',
        dryRun: true,
        platform: 'darwin',
      }),
    ).rejects.toThrow()
  })

  it('returns dry-run install result with pkg manager on darwin', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'pkg',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.executionMode).toBe('dry_run')
    expect(result.version).toBe('3.12.10')
    expect(result.downloads.length).toBe(1)
    expect(result.downloads[0].tool).toBe('python')
    expect(result.downloads[0].kind).toBe('installer')
    expect(result.downloads[0].url).toContain('macos11.pkg')
    expect(result.commands.join('\n')).toContain('pkgutil --expand-full')
    expect(result.commands.join('\n')).toContain('export PYTHON_ROOT=')
    expect(result.commands.join('\n')).toContain('export PYTHON_BIN_DIR=')
    expect(result.commands.join('\n')).toContain('export PYTHON_MAJOR_MINOR=')
    expect(result.commands.join('\n')).toContain("python3 - <<'PY'")
    expect(result.commands.join('\n')).toContain('Python_Framework.pkg/Payload')
    expect(result.commands.join('\n')).toContain('Python.framework')
    expect(result.commands.join('\n')).not.toContain("payload_bytes[:4] == b'pbzx'")
    expect(result.commands.join('\n')).toContain('DYLD_ROOT_PATH')
    expect(result.envChanges.length).toBeGreaterThan(0)
  })

  it('normalizes conda.exe to an absolute path on win32', async () => {
    const result = await pythonPlugin.install({
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      installRootDir: 'C:\\envsetup\\toolchain',
      dryRun: true,
      platform: 'win32',
    })

    expect(result.commands.join('\n')).toContain('/InstallationType=JustMe')
    expect(result.commands.join('\n')).toContain('/RegisterPython=0')
    expect(result.commands.join('\n')).toContain('/AddToPath=0')
    expect(result.commands.join('\n')).toContain('$condaCandidates = @(')
    expect(result.commands.join('\n')).toContain('condabin\\conda.bat')
    expect(result.commands.join('\n')).toContain('install -y -c conda-forge python=3.12.10')
  })

  it('pkg manager throws on win32', async () => {
    await expect(
      pythonPlugin.install({
        pythonManager: 'pkg',
        pythonVersion: '3.12.10',
        installRootDir: 'C:\\envsetup\\toolchain',
        dryRun: true,
        platform: 'win32',
      }),
    ).rejects.toThrow('macOS')
  })

  it('verifies dry-run output for pkg manager', async () => {
    const installResult = await pythonPlugin.install({
      pythonManager: 'pkg',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
    })

    const verifyResult = await pythonPlugin.verify({
      pythonManager: 'pkg',
      pythonVersion: '3.12.10',
      installRootDir: '/tmp/toolchain',
      dryRun: true,
      platform: 'darwin',
      installResult,
    })

    expect(verifyResult.status).toBe('verified_success')
    expect(verifyResult.checks[0]).toContain('计划安装')
    expect(verifyResult.checks[2]).toContain('macos11.pkg')
  })
})
