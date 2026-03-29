/**
 * plugin-win32 模块的单元测试。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

import { importPluginFromZip } from '../../src/main/core/plugin'

const tempDirs: string[] = []
const originalPlatform = process.platform

async function createZipPlaceholder(stagingDir: string): Promise<string> {
  const zipPath = join(stagingDir, 'node-env.zip')
  await writeFile(zipPath, 'zip-placeholder', 'utf8')
  return zipPath
}

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  execFileMock.mockReset()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('plugin import on win32', () => {
  it('extracts zip imports via canonicalized PowerShell args', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    execFileMock.mockImplementation((_file, args, callback) => {
      const extractionDir = args[4]
      mkdirSync(extractionDir, { recursive: true })
      writeFileSync(
        join(extractionDir, 'manifest.json'),
        JSON.stringify({
          id: 'node-env',
          name: 'Node.js Env',
          version: '0.1.0',
          mainAppVersion: '^0.1.0',
          platforms: ['darwin', 'win32'],
          permissions: ['download', 'write_path', 'modify_env'],
          parameters: {},
          dependencies: [],
          entry: 'index.ts',
        }),
      )
      writeFileSync(join(extractionDir, 'index.ts'), 'export default {}')
      callback(null, { stdout: '', stderr: '' })
    })

    const stagingDir = await mkdtemp(join(tmpdir(), 'envsetup-win32-plugin-'))
    tempDirs.push(stagingDir)
    const zipPath = await createZipPlaceholder(stagingDir)

    const imported = await importPluginFromZip(zipPath, stagingDir)

    expect(imported.manifest.id).toBe('node-env')
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining([
        '-NoProfile',
        '-Command',
        expect.stringContaining('param([string]$archivePathArg, [string]$destinationPathArg)'),
        zipPath,
      ]),
      expect.any(Function),
    )

    const [, args] = execFileMock.mock.calls[0]
    expect(args[2]).toContain('& {')
    expect(args[2]).toContain('Get-Item -LiteralPath $archivePathArg')
    expect(args[2]).toContain('Get-Item -LiteralPath $destinationPathArg')
    expect(args[2]).toContain(
      'Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force',
    )
    expect(args[3]).toBe(zipPath)
    expect(String(args[4])).toContain(join(stagingDir, 'node-env-'))
  })
})
