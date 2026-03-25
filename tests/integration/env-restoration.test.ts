import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let snapshotsDir: string

// Mock homedir so restoreEnvironment writes to tmpDir instead of real ~/.zshrc
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return {
    ...original,
    homedir: () => tmpDir,
  }
})

const { createSnapshot, updateSnapshotMeta } = await import('../../src/main/core/snapshot')
const { executeRollback } = await import('../../src/main/core/rollback')

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-env-restore-'))
  snapshotsDir = join(tmpDir, 'snapshots')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('env restoration via rollback', () => {
  it('executeRollback writes environment variables to shell config', async () => {
    const trackedFile = join(tmpDir, 'state.txt')
    await writeFile(trackedFile, 'original')

    const snapshot = await createSnapshot({
      baseDir: snapshotsDir,
      taskId: 'env-test-task',
      type: 'auto',
      trackedPaths: [trackedFile],
    })
    await updateSnapshotMeta(snapshotsDir, snapshot)

    // Mutate the tracked file
    await writeFile(trackedFile, 'mutated')

    const result = await executeRollback(snapshotsDir, snapshot.id, [trackedFile])

    expect(result.success).toBe(true)
    expect(result.filesRestored).toBe(1)
    expect(await readFile(trackedFile, 'utf8')).toBe('original')

    // Verify env restoration wrote to .zshrc
    const zshrcPath = join(tmpDir, '.zshrc')
    const zshrcContent = await readFile(zshrcPath, 'utf8')
    expect(zshrcContent).toContain('# EnvSetup managed block - begin')
    expect(zshrcContent).toContain('# EnvSetup managed block - end')
    expect(zshrcContent).toContain('export PATH=')
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

    await writeFile(trackedFile, 'after')

    const result = await executeRollback(snapshotsDir, snapshot.id, [trackedFile])

    expect(result.success).toBe(true)
    expect(result.envVariablesRestored).toBeGreaterThan(0)
  })

  it('file restoration and env restoration both succeed', async () => {
    const file1 = join(tmpDir, 'config.json')
    const file2 = join(tmpDir, 'env.sh')
    await writeFile(file1, '{"version":"original"}')
    await writeFile(file2, 'export HOME=/original')

    const snapshot = await createSnapshot({
      baseDir: snapshotsDir,
      taskId: 'dual-restore-task',
      type: 'auto',
      trackedPaths: [file1, file2],
    })
    await updateSnapshotMeta(snapshotsDir, snapshot)

    // Mutate both files
    await writeFile(file1, 'corrupted')
    await writeFile(file2, 'corrupted')

    const result = await executeRollback(snapshotsDir, snapshot.id, [file1, file2])

    // File restoration
    expect(result.success).toBe(true)
    expect(result.filesRestored).toBe(2)
    expect(await readFile(file1, 'utf8')).toBe('{"version":"original"}')
    expect(await readFile(file2, 'utf8')).toBe('export HOME=/original')

    // Env restoration
    expect(result.envVariablesRestored).toBeGreaterThan(0)
    const zshrcContent = await readFile(join(tmpDir, '.zshrc'), 'utf8')
    expect(zshrcContent).toContain('# EnvSetup managed block - begin')
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

    await writeFile(trackedFile, 'mutated')

    // Empty array triggers full mode
    const result = await executeRollback(snapshotsDir, snapshot.id, [])

    expect(result.success).toBe(true)
    expect(result.filesRestored).toBe(1)
    expect(result.envVariablesRestored).toBeGreaterThan(0)
    expect(await readFile(trackedFile, 'utf8')).toBe('full-original')
  })
})
