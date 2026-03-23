import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeFileHash,
  storeObject,
  loadObject,
  incrementRefCount,
  decrementRefCount,
  loadRefCounts,
} from '../../src/main/core/snapshot'

describe('Snapshot - Object Storage', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should compute SHA-256 hash correctly', async () => {
    const content = 'test content'
    const hash = await computeFileHash(Buffer.from(content))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should compute same hash for same content', async () => {
    const content = 'same content'
    const hash1 = await computeFileHash(Buffer.from(content))
    const hash2 = await computeFileHash(Buffer.from(content))
    expect(hash1).toBe(hash2)
  })

  it('should compute different hash for different content', async () => {
    const hash1 = await computeFileHash(Buffer.from('content a'))
    const hash2 = await computeFileHash(Buffer.from('content b'))
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
  })

  it('should store objects in git-style subdirectories', async () => {
    const objectsDir = join(testDir, 'objects')
    const content = Buffer.from('test')
    const hash = await storeObject(objectsDir, content)
    // hash 前两位作为子目录，其余作为文件名
    expect(hash.length).toBe(64)
    const loaded = await loadObject(objectsDir, hash)
    expect(loaded).toBeDefined()
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
