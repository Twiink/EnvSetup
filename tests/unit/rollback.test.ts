import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SnapshotMeta, FailureAnalysis, Snapshot } from '../../src/main/core/contracts'
import { suggestRollbackSnapshots, executeRollback } from '../../src/main/core/rollback'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file, _args, callback) => {
    callback(null, { stdout: '', stderr: '' })
  }),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../src/main/core/snapshot', () => ({
  loadSnapshotMeta: vi.fn(),
  applySnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  reconcileSnapshotState: vi.fn(),
  restoreShellConfigs: vi.fn(),
}))

import {
  loadSnapshotMeta,
  applySnapshot,
  loadSnapshot,
  reconcileSnapshotState,
  restoreShellConfigs,
} from '../../src/main/core/snapshot'

const mockLoadSnapshotMeta = vi.mocked(loadSnapshotMeta)
const mockApplySnapshot = vi.mocked(applySnapshot)
const mockLoadSnapshot = vi.mocked(loadSnapshot)
const mockReconcileSnapshotState = vi.mocked(reconcileSnapshotState)
const mockRestoreShellConfigs = vi.mocked(restoreShellConfigs)

vi.mock('../../src/main/core/environment', () => ({
  isCleanupAllowedPath: vi.fn().mockReturnValue(true),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    snapshots: [],
    maxSnapshots: 5,
    ...overrides,
  }
}

function makeSnapEntry(
  id: string,
  taskId: string,
  type: 'auto' | 'manual',
  createdAt: string,
  label?: string,
): SnapshotMeta['snapshots'][0] {
  return { id, taskId, createdAt, type, label, canDelete: false }
}

// ---------------------------------------------------------------------------
// suggestRollbackSnapshots
// ---------------------------------------------------------------------------

describe('suggestRollbackSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no snapshots exist', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(makeMeta())

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result).toEqual([])
  })

  it('assigns high confidence to the latest auto snapshot with same taskId', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-1', 'task-1', 'auto', '2024-01-01T10:00:00Z'),
          makeSnapEntry('snap-2', 'task-1', 'auto', '2024-01-01T11:00:00Z'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result[0].confidence).toBe('high')
    expect(result[0].snapshotId).toBe('snap-2') // most recent
  })

  it('assigns medium confidence to older auto snapshots with same taskId', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-1', 'task-1', 'auto', '2024-01-01T09:00:00Z'),
          makeSnapEntry('snap-2', 'task-1', 'auto', '2024-01-01T10:00:00Z'),
          makeSnapEntry('snap-3', 'task-1', 'auto', '2024-01-01T11:00:00Z'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result[0].confidence).toBe('high')
    expect(result[0].snapshotId).toBe('snap-3')
    expect(result[1].confidence).toBe('medium')
    expect(result[2].confidence).toBe('medium')
  })

  it('assigns medium confidence to auto snapshots from different taskId', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [makeSnapEntry('snap-other', 'task-other', 'auto', '2024-01-01T08:00:00Z')],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result[0].confidence).toBe('medium')
    expect(result[0].snapshotId).toBe('snap-other')
  })

  it('assigns low confidence to manual snapshots', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-manual', 'task-1', 'manual', '2024-01-01T10:00:00Z', 'my backup'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result[0].confidence).toBe('low')
    expect(result[0].snapshotId).toBe('snap-manual')
    expect(result[0].snapshotLabel).toBe('my backup')
  })

  it('returns at most 3 suggestions', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-1', 'task-1', 'auto', '2024-01-01T10:00:00Z'),
          makeSnapEntry('snap-2', 'task-1', 'auto', '2024-01-01T11:00:00Z'),
          makeSnapEntry('snap-3', 'task-1', 'manual', '2024-01-01T12:00:00Z'),
          makeSnapEntry('snap-4', 'task-other', 'auto', '2024-01-01T09:00:00Z'),
          makeSnapEntry('snap-5', 'task-other', 'manual', '2024-01-01T08:00:00Z'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('sorts results high > medium > low', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-manual', 'task-1', 'manual', '2024-01-01T09:00:00Z'),
          makeSnapEntry('snap-other', 'task-other', 'auto', '2024-01-01T10:00:00Z'),
          makeSnapEntry('snap-same', 'task-1', 'auto', '2024-01-01T11:00:00Z'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    const confidences = result.map((r) => r.confidence)
    expect(confidences[0]).toBe('high')
    expect(confidences[1]).toBe('medium')
    expect(confidences[2]).toBe('low')
  })

  it('for conflict failures, assigns high confidence to pre-task (other taskId) auto snapshot', async () => {
    const failureAnalysis: FailureAnalysis = {
      category: 'conflict',
      message: 'File already exists',
      retryable: false,
    }

    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-pre', 'task-other', 'auto', '2024-01-01T09:00:00Z'),
          makeSnapEntry('snap-current', 'task-1', 'auto', '2024-01-01T11:00:00Z'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1', failureAnalysis)

    expect(result[0].confidence).toBe('high')
    expect(result[0].snapshotId).toBe('snap-pre')
  })

  it('for conflict failures, assigns medium confidence to same-task auto snapshot', async () => {
    const failureAnalysis: FailureAnalysis = {
      category: 'conflict',
      message: 'File already exists',
      retryable: false,
    }

    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [makeSnapEntry('snap-current', 'task-1', 'auto', '2024-01-01T11:00:00Z')],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1', failureAnalysis)

    expect(result[0].confidence).toBe('medium')
    expect(result[0].snapshotId).toBe('snap-current')
  })

  it('populates snapshotLabel when label is present', async () => {
    mockLoadSnapshotMeta.mockResolvedValue(
      makeMeta({
        snapshots: [
          makeSnapEntry('snap-1', 'task-1', 'auto', '2024-01-01T10:00:00Z', 'before install'),
        ],
      }),
    )

    const result = await suggestRollbackSnapshots('/base', 'task-1')

    expect(result[0].snapshotLabel).toBe('before install')
  })
})

// ---------------------------------------------------------------------------
// executeRollback
// ---------------------------------------------------------------------------

describe('executeRollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileMock.mockImplementation((_file, _args, callback) => {
      callback(null, { stdout: '', stderr: '' })
    })
    // Default: loadSnapshot returns a snapshot with empty shellConfigs
    mockLoadSnapshot.mockResolvedValue({
      id: 'snap-1',
      taskId: 'task-1',
      type: 'auto',
      createdAt: '2024-01-01T10:00:00Z',
      trackedPaths: [],
      files: {},
      environment: { variables: {}, path: [] },
      shellConfigs: {},
      metadata: { platform: 'darwin', diskUsage: 0, fileCount: 0 },
    } satisfies Snapshot)
    mockReconcileSnapshotState.mockResolvedValue({
      directoriesRemoved: 0,
      errors: [],
    })
    mockRestoreShellConfigs.mockResolvedValue(0)
  })

  it('uses full mode when trackedPaths is empty', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 5,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })

    const result = await executeRollback('/base', 'snap-1', [])

    expect(mockApplySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'full', filePaths: undefined }),
    )
    expect(result.success).toBe(true)
    expect(result.filesRestored).toBe(5)
    expect(result.errors).toEqual([])
    expect(result.message).toContain('Successfully restored 5')
  })

  it('uses partial mode when trackedPaths is non-empty', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 2,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })

    const paths = ['/usr/local/bin/node', '/home/user/.nvmrc']
    await executeRollback('/base', 'snap-1', paths)

    expect(mockApplySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'partial', filePaths: paths }),
    )
  })

  it('returns success: false when there are errors', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 3,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [{ path: '/usr/local/bin/node', error: 'Permission denied' }],
    })

    const result = await executeRollback('/base', 'snap-1', [])

    expect(result.success).toBe(false)
    expect(result.filesRestored).toBe(3)
    expect(result.errors).toHaveLength(1)
    expect(result.message).toContain('1 error(s)')
  })

  it('returns success: false and wraps thrown error', async () => {
    mockApplySnapshot.mockRejectedValue(new Error('Snapshot file not found'))

    const result = await executeRollback('/base', 'snap-missing', [])

    expect(result.success).toBe(false)
    expect(result.filesRestored).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toContain('Snapshot file not found')
    expect(result.message).toContain('Rollback failed')
  })

  it('sets snapshotId correctly in result', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 1,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })

    const result = await executeRollback('/base', 'snap-abc', [])

    expect(result.snapshotId).toBe('snap-abc')
  })

  it('passes restoreEnv: true to applySnapshot', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 0,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })

    await executeRollback('/base', 'snap-1', [])

    expect(mockApplySnapshot).toHaveBeenCalledWith(expect.objectContaining({ restoreEnv: true }))
  })

  it('returns a dry-run rollback plan without mutating files', async () => {
    const result = await executeRollback(
      '/base',
      'snap-1',
      ['/tmp/toolchain'],
      ['/tmp/toolchain'],
      {
        dryRun: true,
        rollbackCommands: ['brew uninstall git'],
      },
    )

    expect(mockLoadSnapshot).toHaveBeenCalledWith('/base', 'snap-1')
    expect(mockApplySnapshot).not.toHaveBeenCalled()
    expect(mockReconcileSnapshotState).not.toHaveBeenCalled()
    expect(mockRestoreShellConfigs).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.executionMode).toBe('dry_run')
    expect(result.filesRestored).toBe(0)
    expect(result.directoriesRemoved).toBe(0)
    expect(result.message).toContain('Dry-run rollback plan prepared')
    expect(result.message).toContain('run 1 rollback command(s)')
  })

  it('executes plugin rollback commands during real-run rollback', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 1,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })

    const result = await executeRollback('/base', 'snap-1', [], undefined, {
      rollbackCommands: ['brew uninstall git'],
    })

    expect(execFileMock).toHaveBeenCalledWith(
      'sh',
      ['-c', 'brew uninstall git'],
      expect.any(Function),
    )
    expect(result.success).toBe(true)
    expect(result.message).toContain('ran 1 rollback command(s)')
  })

  it('retries rollback commands with administrator elevation after permission errors', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 1,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })

    execFileMock
      .mockImplementationOnce((_file, _args, callback) => {
        callback(new Error('Permission denied'))
      })
      .mockImplementationOnce((_file, _args, callback) => {
        callback(null, { stdout: '', stderr: '' })
      })

    const result = await executeRollback('/base', 'snap-1', [], undefined, {
      rollbackCommands: ['brew uninstall git'],
    })

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'sh',
      ['-c', 'brew uninstall git'],
      expect.any(Function),
    )
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'osascript',
      [expect.any(String), expect.stringContaining('with administrator privileges')],
      expect.any(Function),
    )
    expect(result.success).toBe(true)
  })

  it('reconciles tracked filesystem roots against the snapshot', async () => {
    mockApplySnapshot.mockResolvedValue({
      filesRestored: 1,
      filesSkipped: 0,
      envVariablesRestored: 0,
      errors: [],
    })
    mockLoadSnapshot.mockResolvedValueOnce({
      id: 'snap-1',
      taskId: 'task-1',
      type: 'auto',
      createdAt: '2024-01-01T10:00:00Z',
      trackedPaths: ['/tmp/toolchain', '/tmp/npm-cache'],
      files: {},
      environment: { variables: {}, path: [] },
      shellConfigs: {},
      metadata: { platform: 'darwin', diskUsage: 0, fileCount: 0 },
    } satisfies Snapshot)
    mockReconcileSnapshotState.mockResolvedValueOnce({
      directoriesRemoved: 2,
      errors: [],
    })

    const result = await executeRollback('/base', 'snap-1', [])

    expect(mockReconcileSnapshotState).toHaveBeenCalledWith({
      baseDir: '/base',
      snapshotId: 'snap-1',
      paths: ['/tmp/toolchain', '/tmp/npm-cache'],
      allowElevation: true,
    })
    expect(result.directoriesRemoved).toBe(2)
  })
})
