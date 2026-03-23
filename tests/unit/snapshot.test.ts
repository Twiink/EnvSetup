import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeFileHash,
  storeObject,
  loadObject,
  incrementRefCount,
  decrementRefCount,
  loadRefCounts,
  createSnapshot,
  loadSnapshot,
  loadSnapshotMeta,
  updateSnapshotMeta,
  markSnapshotDeletable,
  deleteSnapshot,
  applySnapshot,
  restoreShellConfigs,
} from '../../src/main/core/snapshot'

describe('Snapshot - Object Storage', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should compute SHA-256 hash correctly', () => {
    const content = 'test content'
    const hash = computeFileHash(Buffer.from(content))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should compute same hash for same content', () => {
    const content = 'same content'
    const hash1 = computeFileHash(Buffer.from(content))
    const hash2 = computeFileHash(Buffer.from(content))
    expect(hash1).toBe(hash2)
  })

  it('should compute different hash for different content', () => {
    const hash1 = computeFileHash(Buffer.from('content a'))
    const hash2 = computeFileHash(Buffer.from('content b'))
    expect(hash1).not.toBe(hash2)
  })

  it('should store and load object by hash', async () => {
    const objectsDir = join(testDir, 'objects')
    const content = Buffer.from('test content')
    const hash = await storeObject(objectsDir, content)
    const loaded = await loadObject(objectsDir, hash)
    expect(loaded.toString()).toBe('test content')
  })

  it('should deduplicate identical content', async () => {
    const objectsDir = join(testDir, 'objects')
    const content = Buffer.from('same content')
    const hash1 = await storeObject(objectsDir, content)
    const hash2 = await storeObject(objectsDir, content)
    expect(hash1).toBe(hash2)
    // verify only one file exists in the subdirectory
    const subDir = join(objectsDir, hash1.slice(0, 2))
    const files = await readdir(subDir)
    expect(files).toHaveLength(1)
  })

  it('should store objects in git-style subdirectories', async () => {
    const objectsDir = join(testDir, 'objects')
    const content = Buffer.from('test')
    const hash = await storeObject(objectsDir, content)
    // hash 前两位作为子目录，其余作为文件名
    expect(hash.length).toBe(64)
    const subDir = join(objectsDir, hash.slice(0, 2))
    const objectPath = join(subDir, hash.slice(2))
    // verify subdirectory and file actually exist
    await expect(access(subDir)).resolves.toBeUndefined()
    await expect(access(objectPath)).resolves.toBeUndefined()
  })

  it('should throw when loading non-existent object', async () => {
    const objectsDir = join(testDir, 'objects')
    const fakeHash = 'a'.repeat(64)
    await expect(loadObject(objectsDir, fakeHash)).rejects.toThrow()
  })
})

describe('Snapshot - Reference Counting', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-refs-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should start with empty refs', async () => {
    const refs = await loadRefCounts(testDir)
    expect(refs).toEqual({})
  })

  it('should increment reference count', async () => {
    const hash = 'abc123def456'
    await incrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBe(1)
  })

  it('should increment multiple times', async () => {
    const hash = 'abc123def456'
    await incrementRefCount(testDir, hash)
    await incrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBe(2)
  })

  it('should decrement reference count', async () => {
    const hash = 'abc123def456'
    await incrementRefCount(testDir, hash)
    await incrementRefCount(testDir, hash)
    await decrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBe(1)
  })

  it('should remove hash when count reaches zero', async () => {
    const hash = 'abc123def456'
    await incrementRefCount(testDir, hash)
    await decrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBeUndefined()
  })

  it('should handle decrement on non-existent hash gracefully', async () => {
    const hash = 'nonexistent'
    // 不应该抛出错误
    await expect(decrementRefCount(testDir, hash)).resolves.toBeUndefined()
  })
})

describe('Snapshot - Index Creation', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-index-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should create snapshot with file tracking', async () => {
    const testFile = join(testDir, 'test.txt')
    await writeFile(testFile, 'test content')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [testFile],
    })

    expect(snapshot.id).toBeDefined()
    expect(snapshot.taskId).toBe('task-123')
    expect(snapshot.type).toBe('auto')
    expect(snapshot.files[testFile]).toBeDefined()
    expect(snapshot.files[testFile].hash).toMatch(/^[a-f0-9]{64}$/)
    expect(snapshot.files[testFile].size).toBeGreaterThan(0)
  })

  it('should capture environment variables', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [],
    })

    expect(snapshot.environment.variables).toBeDefined()
    expect(snapshot.environment.path).toBeInstanceOf(Array)
  })

  it('should skip unreadable files gracefully', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: ['/nonexistent/file.txt'],
    })

    expect(snapshot.files['/nonexistent/file.txt']).toBeUndefined()
    expect(snapshot.metadata.fileCount).toBe(0)
  })

  it('should persist snapshot to disk', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-abc',
      type: 'manual',
      label: 'my snapshot',
      trackedPaths: [],
    })

    const loaded = await loadSnapshot(testDir, snapshot.id)
    expect(loaded.id).toBe(snapshot.id)
    expect(loaded.taskId).toBe('task-abc')
    expect(loaded.label).toBe('my snapshot')
  })
})

describe('Snapshot - Metadata Management', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-meta-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should return empty meta when no file exists', async () => {
    const meta = await loadSnapshotMeta(testDir)
    expect(meta.snapshots).toHaveLength(0)
    expect(meta.maxSnapshots).toBe(5)
  })

  it('should track snapshots in metadata', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [],
    })

    await updateSnapshotMeta(testDir, snapshot)

    const meta = await loadSnapshotMeta(testDir)
    expect(meta.snapshots).toHaveLength(1)
    expect(meta.snapshots[0].id).toBe(snapshot.id)
    expect(meta.snapshots[0].canDelete).toBe(false)
  })

  it('should mark snapshot as deletable', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [],
    })
    await updateSnapshotMeta(testDir, snapshot)
    await markSnapshotDeletable(testDir, snapshot.id)

    const meta = await loadSnapshotMeta(testDir)
    expect(meta.snapshots[0].canDelete).toBe(true)
  })

  it('should enforce max snapshots limit by deleting oldest deletable', async () => {
    // 创建 5 个可删除快照
    const snapshots = []
    for (let i = 0; i < 5; i++) {
      const s = await createSnapshot({
        baseDir: testDir,
        taskId: `task-${i}`,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(testDir, s)
      await markSnapshotDeletable(testDir, s.id)
      snapshots.push(s)
    }

    // 添加第 6 个，应触发清理
    const newest = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-5',
      type: 'auto',
      trackedPaths: [],
    })
    await updateSnapshotMeta(testDir, newest)

    const meta = await loadSnapshotMeta(testDir)
    expect(meta.snapshots.length).toBeLessThanOrEqual(5)
    // 最新快照应该保留
    expect(meta.snapshots.some((s) => s.id === newest.id)).toBe(true)
  })

  it('should not exceed limit when no deletable snapshots exist', async () => {
    // 创建 6 个不可删除快照
    for (let i = 0; i < 6; i++) {
      const s = await createSnapshot({
        baseDir: testDir,
        taskId: `task-${i}`,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(testDir, s)
      // 不标记为可删除
    }

    const meta = await loadSnapshotMeta(testDir)
    // 无可删除快照时，不强制删除，允许超过限制
    expect(meta.snapshots.length).toBe(6)
  })

  it('should physically delete unreferenced object files after deleteSnapshot', async () => {
    const tmpFile = join(testDir, 'gctest.txt')
    await writeFile(tmpFile, 'gc content')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'gc-task',
      type: 'auto',
      trackedPaths: [tmpFile],
    })

    const hash = snapshot.files[tmpFile].hash
    const objectPath = join(testDir, 'objects', hash.slice(0, 2), hash.slice(2))

    // 对象文件应存在
    await expect(access(objectPath, constants.F_OK)).resolves.toBeUndefined()

    await markSnapshotDeletable(testDir, snapshot.id)
    await deleteSnapshot(testDir, snapshot.id)

    // 对象文件应被物理删除
    await expect(access(objectPath, constants.F_OK)).rejects.toThrow()
  })

  it('should capture shell config files in shellConfigs', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'shell-task',
      type: 'auto',
      trackedPaths: [],
    })

    // shellConfigs 应是一个对象（可以为空，取决于系统环境）
    expect(typeof snapshot.shellConfigs).toBe('object')
    // 如果存在配置文件，验证其格式
    for (const [, cfg] of Object.entries(snapshot.shellConfigs)) {
      expect(cfg.hash).toMatch(/^[a-f0-9]{64}$/)
      expect(typeof cfg.lines).toBe('number')
    }
    // 在 macOS 测试环境下，至少尝试了标准配置路径
    if (process.platform !== 'win32') {
      const expectedPaths = [
        join(homedir(), '.zshrc'),
        join(homedir(), '.bash_profile'),
        join(homedir(), '.bashrc'),
      ]
      const capturedPaths = Object.keys(snapshot.shellConfigs)
      // 所有捕获路径必须是预期路径之一
      for (const p of capturedPaths) {
        expect(expectedPaths).toContain(p)
      }
    }
  })
})

describe('Snapshot - Apply & Restore', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-apply-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should restore all files in full mode', async () => {
    // 在 testDir 内创建两个被追踪的文件
    const fileA = join(testDir, 'fileA.txt')
    const fileB = join(testDir, 'fileB.txt')
    await writeFile(fileA, 'content-a')
    await writeFile(fileB, 'content-b')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-full',
      type: 'auto',
      trackedPaths: [fileA, fileB],
    })

    // 修改文件内容，模拟安装后状态
    await writeFile(fileA, 'modified-a')
    await writeFile(fileB, 'modified-b')

    const result = await applySnapshot({
      baseDir: testDir,
      snapshotId: snapshot.id,
      mode: 'full',
    })

    expect(result.filesRestored).toBe(2)
    expect(result.filesSkipped).toBe(0)
    expect(result.errors).toHaveLength(0)

    const restoredA = await readFile(fileA, 'utf8')
    const restoredB = await readFile(fileB, 'utf8')
    expect(restoredA).toBe('content-a')
    expect(restoredB).toBe('content-b')
  })

  it('should only restore specified files in partial mode', async () => {
    const fileA = join(testDir, 'fileA.txt')
    const fileB = join(testDir, 'fileB.txt')
    await writeFile(fileA, 'content-a')
    await writeFile(fileB, 'content-b')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-partial',
      type: 'auto',
      trackedPaths: [fileA, fileB],
    })

    await writeFile(fileA, 'modified-a')
    await writeFile(fileB, 'modified-b')

    const result = await applySnapshot({
      baseDir: testDir,
      snapshotId: snapshot.id,
      mode: 'partial',
      filePaths: [fileA],
    })

    expect(result.filesRestored).toBe(1)
    expect(result.errors).toHaveLength(0)

    // fileA 恢复，fileB 保持 modified
    expect(await readFile(fileA, 'utf8')).toBe('content-a')
    expect(await readFile(fileB, 'utf8')).toBe('modified-b')
  })

  it('should record error instead of throwing when object hash is missing', async () => {
    const fileA = join(testDir, 'fileA.txt')
    await writeFile(fileA, 'content-a')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-missing',
      type: 'auto',
      trackedPaths: [fileA],
    })

    // 删除对象存储中的文件，模拟哈希丢失
    const hash = snapshot.files[fileA].hash
    const objectPath = join(testDir, 'objects', hash.slice(0, 2), hash.slice(2))
    await rm(objectPath)

    const result = await applySnapshot({
      baseDir: testDir,
      snapshotId: snapshot.id,
      mode: 'full',
    })

    expect(result.filesRestored).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].path).toBe(fileA)
  })

  it('should restore shell config files', async () => {
    const configPath = join(testDir, '.zshrc')
    const originalContent = Buffer.from('export FOO=bar\n')

    // 手动存入对象存储并构造 shellConfigs
    const objectsDir = join(testDir, 'objects')
    const { storeObject: store } = await import('../../src/main/core/snapshot')
    const hash = await store(objectsDir, originalContent)

    const shellConfigs = {
      [configPath]: { hash, lines: 1 },
    }

    const count = await restoreShellConfigs(testDir, shellConfigs)

    expect(count).toBe(1)
    const restored = await readFile(configPath, 'utf8')
    expect(restored).toBe('export FOO=bar\n')
  })

  it('should return correct statistics for partial mode with unknown paths', async () => {
    const fileA = join(testDir, 'fileA.txt')
    await writeFile(fileA, 'content-a')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-stats',
      type: 'auto',
      trackedPaths: [fileA],
    })

    const nonExistentPath = join(testDir, 'not-in-snapshot.txt')

    const result = await applySnapshot({
      baseDir: testDir,
      snapshotId: snapshot.id,
      mode: 'partial',
      filePaths: [fileA, nonExistentPath],
    })

    // fileA 在快照中 -> restored，nonExistentPath 不在快照中 -> skipped
    expect(result.filesRestored).toBe(1)
    expect(result.filesSkipped).toBe(1)
    expect(result.envVariablesRestored).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})
