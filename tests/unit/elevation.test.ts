/**
 * elevation 模块的单元测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, optionsOrCallback, maybeCallback) => {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    callback(null, { stdout: 'ok', stderr: '' })
  }),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

import {
  buildCopyFileCommand,
  buildEnsureDirectoryCommand,
  buildReadFileBase64Command,
  buildRemovePathCommand,
  executePlatformCommand,
  executePlatformCommandWithElevationFallback,
  isPermissionError,
} from '../../src/main/core/elevation'

describe('elevation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileMock.mockImplementation((_file, _args, optionsOrCallback, maybeCallback) => {
      const callback =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      callback(null, { stdout: 'ok', stderr: '' })
    })
  })

  it('detects permission-style errors', () => {
    expect(isPermissionError(Object.assign(new Error('blocked'), { code: 'EPERM' }))).toBe(true)
    expect(isPermissionError(new Error('Access is denied'))).toBe(true)
    expect(isPermissionError(new Error('network timeout'))).toBe(false)
  })

  it('uses osascript for elevated darwin commands', async () => {
    await executePlatformCommand('rm -rf /tmp/tool', 'darwin', { elevated: true })

    const [file, args, maybeOptions, maybeCallback] = execFileMock.mock.calls[0]
    expect(file).toBe('osascript')
    expect(args).toEqual([
      expect.any(String),
      expect.stringContaining('with administrator privileges'),
    ])
    expect(typeof (maybeCallback ?? maybeOptions)).toBe('function')
  })

  it('retries with elevation after permission errors', async () => {
    execFileMock
      .mockImplementationOnce((_file, _args, optionsOrCallback, maybeCallback) => {
        const callback =
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
        callback(new Error('Permission denied'))
      })
      .mockImplementationOnce((_file, _args, optionsOrCallback, maybeCallback) => {
        const callback =
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
        callback(null, { stdout: 'ok', stderr: '' })
      })

    const result = await executePlatformCommandWithElevationFallback('rm -rf /tmp/tool', 'darwin')

    const firstCall = execFileMock.mock.calls[0]
    expect(firstCall[0]).toBe('sh')
    expect(firstCall[1]).toEqual(['-c', 'rm -rf /tmp/tool'])
    expect(typeof firstCall[firstCall.length - 1]).toBe('function')

    const secondCall = execFileMock.mock.calls[1]
    expect(secondCall[0]).toBe('osascript')
    expect(secondCall[1]).toEqual([
      expect.any(String),
      expect.stringContaining('with administrator privileges'),
    ])
    expect(typeof secondCall[secondCall.length - 1]).toBe('function')
    expect(result.elevated).toBe(true)
  })

  it('builds cross-platform filesystem commands', () => {
    expect(buildRemovePathCommand('/usr/bin/git', 'darwin')).toContain('rm -rf')
    expect(buildEnsureDirectoryCommand('/Library/Java', 'darwin', 0o755)).toContain('chmod 755')
    expect(buildCopyFileCommand('/tmp/source', '/usr/bin/git', 'darwin', 0o755)).toContain('cp -f')
    expect(buildReadFileBase64Command('/usr/bin/git', 'darwin')).toContain('base64')
    expect(buildRemovePathCommand('C:\\Git', 'win32')).toContain('Remove-Item')
  })
})
