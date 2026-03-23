import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { ObjectRefs, Snapshot, SnapshotMeta } from './contracts'

// ============================================================
// 对象存储（内容寻址）
// ============================================================

/**
 * 计算 Buffer 内容的 SHA-256 哈希
 */
export function computeFileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 将内容存储到对象存储中（内容寻址，自动去重）
 * 使用 Git-style 两级目录结构：objects/{hash[0:2]}/{hash[2:]}
 */
export async function storeObject(objectsDir: string, content: Buffer): Promise<string> {
  const hash = computeFileHash(content)
  const subDir = join(objectsDir, hash.slice(0, 2))
  const objectPath = join(subDir, hash.slice(2))

  try {
    await access(objectPath, constants.F_OK)
    return hash
  } catch {
    // file does not exist, proceed to write
  }

  await mkdir(subDir, { recursive: true })
  await writeFile(objectPath, content)

  return hash
}

/**
 * 从对象存储中读取内容
 */
export async function loadObject(objectsDir: string, hash: string): Promise<Buffer> {
  const objectPath = join(objectsDir, hash.slice(0, 2), hash.slice(2))
  return readFile(objectPath)
}

// ============================================================
// 引用计数（用于垃圾回收）
// ============================================================

const REFS_FILE = 'objects-refs.json'

/**
 * 加载对象引用计数表
 */
export async function loadRefCounts(baseDir: string): Promise<ObjectRefs> {
  try {
    const content = await readFile(join(baseDir, REFS_FILE), 'utf8')
    return JSON.parse(content) as ObjectRefs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function saveRefCounts(baseDir: string, refs: ObjectRefs): Promise<void> {
  await writeFile(join(baseDir, REFS_FILE), JSON.stringify(refs, null, 2))
}

/**
 * 增加对象引用计数
 */
export async function incrementRefCount(baseDir: string, hash: string): Promise<void> {
  const refs = await loadRefCounts(baseDir)
  refs[hash] = (refs[hash] ?? 0) + 1
  await saveRefCounts(baseDir, refs)
}

/**
 * 减少对象引用计数，计数为 0 时从引用表中删除
 */
export async function decrementRefCount(baseDir: string, hash: string): Promise<void> {
  const refs = await loadRefCounts(baseDir)
  if (refs[hash] === undefined) {
    return
  }
  refs[hash]--
  if (refs[hash] <= 0) {
    delete refs[hash]
  }
  await saveRefCounts(baseDir, refs)
}

// ============================================================
// 快照创建与加载
// ============================================================

/**
 * 创建快照：对 trackedPaths 中的文件进行内容寻址存储，并记录当前环境变量
 */
export async function createSnapshot(options: {
  baseDir: string
  taskId: string
  type: 'auto' | 'manual'
  label?: string
  trackedPaths: string[]
}): Promise<Snapshot> {
  const objectsDir = join(options.baseDir, 'objects')
  const files: Snapshot['files'] = {}

  for (const filePath of options.trackedPaths) {
    try {
      const content = await readFile(filePath)
      const fileStat = await stat(filePath)
      const hash = await storeObject(objectsDir, content)
      await incrementRefCount(options.baseDir, hash)

      files[filePath] = {
        hash,
        mode: fileStat.mode,
        size: fileStat.size,
      }
    } catch {
      // 跳过无法读取的文件（不存在、权限问题等）
    }
  }

  const environment = {
    variables: { ...process.env } as Record<string, string>,
    path: (process.env.PATH ?? '').split(delimiter),
  }

  const snapshot: Snapshot = {
    id: randomUUID(),
    taskId: options.taskId,
    createdAt: new Date().toISOString(),
    type: options.type,
    label: options.label,
    files,
    environment,
    shellConfigs: {},
    metadata: {
      platform: process.platform as 'darwin' | 'win32',
      diskUsage: Object.values(files).reduce((sum, f) => sum + f.size, 0),
      fileCount: Object.keys(files).length,
    },
  }

  const snapshotsDir = join(options.baseDir, 'snapshots')
  await mkdir(snapshotsDir, { recursive: true })
  await writeFile(
    join(snapshotsDir, `snapshot-${snapshot.id}.json`),
    JSON.stringify(snapshot, null, 2),
  )

  return snapshot
}

/**
 * 从磁盘加载快照
 */
export async function loadSnapshot(baseDir: string, snapshotId: string): Promise<Snapshot> {
  const snapshotPath = join(baseDir, 'snapshots', `snapshot-${snapshotId}.json`)
  const content = await readFile(snapshotPath, 'utf8')
  return JSON.parse(content) as Snapshot
}

// ============================================================
// 快照元数据管理
// ============================================================

const META_FILE = 'snapshot-meta.json'
const DEFAULT_MAX_SNAPSHOTS = 5

/**
 * 加载快照元数据索引
 */
export async function loadSnapshotMeta(baseDir: string): Promise<SnapshotMeta> {
  try {
    const content = await readFile(join(baseDir, META_FILE), 'utf8')
    return JSON.parse(content) as SnapshotMeta
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { snapshots: [], maxSnapshots: DEFAULT_MAX_SNAPSHOTS }
    }
    throw error
  }
}

async function saveSnapshotMeta(baseDir: string, meta: SnapshotMeta): Promise<void> {
  await writeFile(join(baseDir, META_FILE), JSON.stringify(meta, null, 2))
}

/**
 * 将快照记录追加到元数据，并在超过限制时清理最早的可删除快照
 */
export async function updateSnapshotMeta(baseDir: string, snapshot: Snapshot): Promise<void> {
  const meta = await loadSnapshotMeta(baseDir)

  meta.snapshots.push({
    id: snapshot.id,
    taskId: snapshot.taskId,
    createdAt: snapshot.createdAt,
    type: snapshot.type,
    label: snapshot.label,
    canDelete: false,
  })

  // 清理超过限制的可删除快照
  while (meta.snapshots.length > meta.maxSnapshots) {
    const deletableIdx = meta.snapshots.findIndex((s) => s.canDelete)
    if (deletableIdx === -1) break
    const toDelete = meta.snapshots[deletableIdx]
    meta.snapshots.splice(deletableIdx, 1)
    await deleteSnapshot(baseDir, toDelete.id)
  }

  await saveSnapshotMeta(baseDir, meta)
}

/**
 * 将指定快照标记为可删除
 */
export async function markSnapshotDeletable(baseDir: string, snapshotId: string): Promise<void> {
  const meta = await loadSnapshotMeta(baseDir)
  const entry = meta.snapshots.find((s) => s.id === snapshotId)
  if (entry) {
    entry.canDelete = true
    await saveSnapshotMeta(baseDir, meta)
  }
}

/**
 * 删除快照：减少引用计数并移除快照索引文件
 */
export async function deleteSnapshot(baseDir: string, snapshotId: string): Promise<void> {
  const snapshot = await loadSnapshot(baseDir, snapshotId)

  // 减少对象引用计数
  for (const file of Object.values(snapshot.files)) {
    await decrementRefCount(baseDir, file.hash)
  }

  // 删除快照索引文件
  await rm(join(baseDir, 'snapshots', `snapshot-${snapshotId}.json`))
}
