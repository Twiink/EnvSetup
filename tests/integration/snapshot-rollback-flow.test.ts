/**
 * Integration coverage for snapshot creation and rollback restoration across multi-step workflows.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { InstallTask } from '../../src/main/core/contracts'
import { createTask } from '../../src/main/core/task'
import {
  createSnapshot,
  loadSnapshotMeta,
  markSnapshotDeletable,
  deleteSnapshot,
  updateSnapshotMeta,
} from '../../src/main/core/snapshot'
import { suggestRollbackSnapshots } from '../../src/main/core/rollback'

let tmpDir: string
let snapshotsDir: string
let tasksDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-integration-'))
  snapshotsDir = join(tmpDir, 'snapshots')
  tasksDir = join(tmpDir, 'tasks')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeTask(overrides: Partial<InstallTask> = {}): InstallTask {
  return createTask({
    templateId: 'test-template',
    templateVersion: '1.0.0',
    params: {},
    plugins: [{ pluginId: 'test-plugin', version: '1.0.0', params: {} }],
    ...overrides,
  })
}

describe('snapshot-rollback integration flow', () => {
  async function makeSnapshot(taskId: string, type: 'auto' | 'manual' = 'auto') {
    const snapshot = await createSnapshot({
      baseDir: snapshotsDir,
      taskId,
      type,
      trackedPaths: [],
    })
    await updateSnapshotMeta(snapshotsDir, snapshot)
    return snapshot
  }

  it('creates a snapshot and lists it', async () => {
    const task = makeTask()
    const snapshot = await makeSnapshot(task.id)

    expect(snapshot.id).toBeTruthy()
    expect(snapshot.taskId).toBe(task.id)
    expect(snapshot.type).toBe('auto')

    const meta = await loadSnapshotMeta(snapshotsDir)
    expect(meta.snapshots).toHaveLength(1)
    expect(meta.snapshots[0].id).toBe(snapshot.id)
    expect(meta.snapshots[0].canDelete).toBe(false)
  })

  it('marks snapshot deletable after task succeeds', async () => {
    const task = makeTask()
    const snapshot = await makeSnapshot(task.id)

    await markSnapshotDeletable(snapshotsDir, snapshot.id)

    const meta = await loadSnapshotMeta(snapshotsDir)
    expect(meta.snapshots[0].canDelete).toBe(true)
  })

  it('suggests rollback snapshots after task fails', async () => {
    const task = makeTask()
    const snapshot = await makeSnapshot(task.id)

    // 模拟任务失败后查找回滚建议
    const suggestions = await suggestRollbackSnapshots(snapshotsDir, task.id)

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].snapshotId).toBe(snapshot.id)
    expect(suggestions[0].confidence).toBe('high') // 同 taskId 的 auto 快照 → high
  })

  it('deletes snapshot from meta via maxSnapshots cleanup', async () => {
    // 创建 5 个可删除快照，再添加第 6 个触发自动清理
    const task = makeTask()
    for (let i = 0; i < 5; i++) {
      const s = await makeSnapshot(task.id)
      await markSnapshotDeletable(snapshotsDir, s.id)
    }

    // meta 此时有 5 个，再加 1 个触发清理（删除第一个可删除的）
    await makeSnapshot(task.id)

    const meta = await loadSnapshotMeta(snapshotsDir)
    expect(meta.snapshots).toHaveLength(5)
  })

  it('returns empty suggestions when no snapshots exist', async () => {
    const suggestions = await suggestRollbackSnapshots(snapshotsDir, 'nonexistent-task-id')
    expect(suggestions).toHaveLength(0)
  })

  it('creates multiple snapshots respecting maxSnapshots limit', async () => {
    const task = makeTask()
    // 默认 maxSnapshots=5，创建 3 个快照不应触发清理
    for (let i = 0; i < 3; i++) {
      await makeSnapshot(task.id)
    }

    const meta = await loadSnapshotMeta(snapshotsDir)
    expect(meta.snapshots).toHaveLength(3)
  })
})
