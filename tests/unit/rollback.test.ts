import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SnapshotMeta, FailureAnalysis } from '../../src/main/core/contracts'
import { suggestRollbackSnapshots, executeRollback } from '../../src/main/core/rollback'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/main/core/snapshot', () => ({
  loadSnapshotMeta: vi.fn(),
  applySnapshot: vi.fn(),
}))

import { loadSnapshotMeta, applySnapshot } from '../../src/main/core/snapshot'

const mockLoadSnapshotMeta = vi.mocked(loadSnapshotMeta)
const mockApplySnapshot = vi.mocked(applySnapshot)

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
})
