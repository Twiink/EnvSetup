import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const originalEnv = { ...process.env }

let tmpDir: string
let snapshotsDir: string

const { createSnapshot, updateSnapshotMeta } = await import('../../src/main/core/snapshot')
const { executeRollback } = await import('../../src/main/core/rollback')

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-env-restore-'))
  snapshotsDir = join(tmpDir, 'snapshots')
  process.env = {
    KEEP_ME: 'initial',
    STALE_ONLY: 'stale',
    PATH: '/stale/path',
  }
})

afterEach(async () => {
  process.env = { ...originalEnv }
  await rm(tmpDir, { recursive: true, force: true })
})

describe('env restoration via rollback', () => {
  it('executeRollback restores process.env to the snapshot state', async () => {
    const trackedFile = join(tmpDir, 'state.txt')
    await writeFile(trackedFile, 'original')

    const snapshot = await createSnapshot({
      baseDir: snapshotsDir,
      taskId: 'env-test-task',
      type: 'auto',
      trackedPaths: [trackedFile],
    })
    await updateSnapshotMeta(snapshotsDir, snapshot)

    process.env = {
      KEEP_ME: 'mutated',
      NEW_ONLY: 'new',
      PATH: '/mutated/path',
    }
    await writeFile(trackedFile, 'mutated')

    const result = await executeRollback(snapshotsDir, snapshot.id, [trackedFile])

    expect(result.success).toBe(true)
    expect(result.filesRestored).toBe(1)
    expect(await readFile(trackedFile, 'utf8')).toBe('original')
    expect(process.env.KEEP_ME).toBe('initial')
    expect(process.env.STALE_ONLY).toBe('stale')
    expect(process.env.NEW_ONLY).toBeUndefined()
    expect(process.env.PATH).toBe('/stale/path')
  })

  it('rollbackResult reports envVariablesRestored > 0', async () => {
    const trackedFile = join(tmpDir, 'data.txt')
    await writeFile(trackedFile, 'before')

    const snapshot = await createSnapshot({
      baseDir: snapshotsDir,
      taskId: 'env-count-task',
      type: 'auto',
      trackedPaths: [trackedFile],
    })
    await updateSnapshotMeta(snapshotsDir, snapshot)

    process.env.NEW_ONLY = 'after'
    process.env.PATH = '/after/path'
    await writeFile(trackedFile, 'after')

    const result = await executeRollback(snapshotsDir, snapshot.id, [trackedFile])

    expect(result.success).toBe(true)
    expect(result.envVariablesRestored).toBeGreaterThan(0)
    expect(process.env.NEW_ONLY).toBeUndefined()
  })

  it('full-mode rollback (empty trackedPaths) also restores env', async () => {
    const trackedFile = join(tmpDir, 'full-mode.txt')
    await writeFile(trackedFile, 'full-original')

    const snapshot = await createSnapshot({
      baseDir: snapshotsDir,
      taskId: 'full-mode-task',
      type: 'auto',
      trackedPaths: [trackedFile],
    })
    await updateSnapshotMeta(snapshotsDir, snapshot)

    process.env.PATH = '/another/path'
    await writeFile(trackedFile, 'mutated')

    const result = await executeRollback(snapshotsDir, snapshot.id, [])

    expect(result.success).toBe(true)
    expect(result.filesRestored).toBe(1)
    expect(result.envVariablesRestored).toBeGreaterThan(0)
    expect(await readFile(trackedFile, 'utf8')).toBe('full-original')
    expect(process.env.PATH).toBe('/stale/path')
  })
})
