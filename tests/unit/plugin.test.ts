import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import {
  importPluginFromDirectory,
  importPluginFromZip,
  validatePluginManifest,
} from '../../src/main/core/plugin'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function createZipArchive(sourceDir: string, zipPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const command = `Compress-Archive -LiteralPath '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
    await execFileAsync('powershell', ['-NoProfile', '-Command', command])
    return
  }

  if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-c', '-k', '--keepParent', sourceDir, zipPath])
    return
  }

  await execFileAsync('zip', ['-qr', zipPath, '.'], { cwd: sourceDir })
}

async function createPluginFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'envsetup-plugin-'))
  tempDirs.push(dir)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'manifest.json'),
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
    'utf8',
  )
  await writeFile(join(dir, 'index.ts'), 'export default {}', 'utf8')
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('plugin import', () => {
  it('accepts a valid plugin manifest', () => {
    expect(() =>
      validatePluginManifest({
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
    ).not.toThrow()
  })

  it('rejects manifest without entry', () => {
    expect(() => validatePluginManifest({ id: 'x' })).toThrow()
  })

  it('imports a plugin from a directory', async () => {
    const pluginDir = await createPluginFixtureDir()
    const imported = await importPluginFromDirectory(pluginDir)

    expect(imported.manifest.id).toBe('node-env')
    expect(imported.entryPath).toContain('index.ts')
  })

  it('imports a plugin from a zip archive', async () => {
    const pluginDir = await createPluginFixtureDir()
    const stagingDir = await mkdtemp(join(tmpdir(), 'envsetup-staging-'))
    tempDirs.push(stagingDir)
    const zipPath = join(stagingDir, 'node-env.zip')
    await createZipArchive(pluginDir, zipPath)

    const imported = await importPluginFromZip(zipPath, stagingDir)

    expect(imported.manifest.id).toBe('node-env')
    expect(imported.entryPath).toContain('index.ts')
  })
})
