import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { ensureAppPaths, getAppPaths } from '../../src/main/core/appPaths'

describe('getAppPaths', () => {
  it('returns correct sub-paths under baseDir', () => {
    const base = '/some/base'
    const paths = getAppPaths(base)
    expect(paths.rootDir).toBe(base)
    expect(paths.tasksDir).toBe(join(base, 'tasks'))
    expect(paths.pluginsDir).toBe(join(base, 'plugins'))
    expect(paths.pluginStagingDir).toBe(join(base, 'plugin-staging'))
    expect(paths.snapshotsDir).toBe(join(base, 'snapshots'))
    expect(paths.downloadCacheDir).toBe(join(base, 'downloads-cache'))
  })

  it('uses ENVSETUP_DATA_DIR when baseDir is omitted', () => {
    const originalOverride = process.env.ENVSETUP_DATA_DIR
    process.env.ENVSETUP_DATA_DIR = '/tmp/envsetup-custom-data'

    try {
      const paths = getAppPaths()
      expect(paths.rootDir).toBe('/tmp/envsetup-custom-data')
      expect(paths.tasksDir).toBe(join('/tmp/envsetup-custom-data', 'tasks'))
    } finally {
      if (originalOverride === undefined) {
        delete process.env.ENVSETUP_DATA_DIR
      } else {
        process.env.ENVSETUP_DATA_DIR = originalOverride
      }
    }
  })
})

describe('ensureAppPaths', () => {
  it('creates all required subdirectories', async () => {
    const base = await mkdtemp(join(tmpdir(), 'envsetup-apppaths-'))
    const paths = await ensureAppPaths(base)

    for (const dir of [
      paths.rootDir,
      paths.tasksDir,
      paths.pluginsDir,
      paths.pluginStagingDir,
      paths.snapshotsDir,
      paths.downloadCacheDir,
    ]) {
      const s = await stat(dir)
      expect(s.isDirectory()).toBe(true)
    }
  })

  it('is idempotent when directories already exist', async () => {
    const base = await mkdtemp(join(tmpdir(), 'envsetup-apppaths-idem-'))
    await ensureAppPaths(base)
    // second call must not throw
    await expect(ensureAppPaths(base)).resolves.toBeDefined()
  })
})
