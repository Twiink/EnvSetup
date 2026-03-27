import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, _options, callback) => {
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
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
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

    expect(execFileMock).toHaveBeenCalledWith(
      'osascript',
      [expect.any(String), expect.stringContaining('with administrator privileges')],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('retries with elevation after permission errors', async () => {
    execFileMock
      .mockImplementationOnce((_file, _args, _options, callback) => {
        callback(new Error('Permission denied'))
      })
      .mockImplementationOnce((_file, _args, _options, callback) => {
        callback(null, { stdout: 'ok', stderr: '' })
      })

    const result = await executePlatformCommandWithElevationFallback('rm -rf /tmp/tool', 'darwin')

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'sh',
      ['-c', 'rm -rf /tmp/tool'],
      expect.any(Object),
      expect.any(Function),
    )
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'osascript',
      [expect.any(String), expect.stringContaining('with administrator privileges')],
      expect.any(Object),
      expect.any(Function),
    )
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
