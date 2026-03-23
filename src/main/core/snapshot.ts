import { exec } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { AppPlatform, ObjectRefs, Snapshot, SnapshotMeta } from './contracts'

const execAsync = promisify(exec)

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

  // 捕获 shell 配置文件
  const shellConfigs: Snapshot['shellConfigs'] = {}
  const homeDir = homedir()
  const configPaths =
    process.platform === 'win32'
      ? [join(homeDir, '.profile')]
      : [join(homeDir, '.zshrc'), join(homeDir, '.bash_profile'), join(homeDir, '.bashrc')]

  for (const configPath of configPaths) {
    try {
      const content = await readFile(configPath)
      const hash = await storeObject(objectsDir, content)
      await incrementRefCount(options.baseDir, hash)
      const lines = content.toString('utf8').split('\n').length
      shellConfigs[configPath] = { hash, lines }
    } catch {
      // 配置文件不存在时跳过
    }
  }

  const snapshot: Snapshot = {
    id: randomUUID(),
    taskId: options.taskId,
    createdAt: new Date().toISOString(),
    type: options.type,
    label: options.label,
    files,
    environment,
    shellConfigs,
    metadata: {
      platform: process.platform as AppPlatform,
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
 * 删除快照：减少引用计数、物理 GC 归零对象文件、移除快照索引文件
 */
export async function deleteSnapshot(baseDir: string, snapshotId: string): Promise<void> {
  const snapshot = await loadSnapshot(baseDir, snapshotId)
  const objectsDir = join(baseDir, 'objects')

  // 收集所有被引用的 hash（文件 + shellConfigs）
  const hashes = [
    ...Object.values(snapshot.files).map((f) => f.hash),
    ...Object.values(snapshot.shellConfigs).map((c) => c.hash),
  ]

  // 减少引用计数
  for (const hash of hashes) {
    await decrementRefCount(baseDir, hash)
  }

  // 加载更新后的引用计数，物理删除归零的对象文件
  const updatedRefs = await loadRefCounts(baseDir)
  for (const hash of hashes) {
    if (!(hash in updatedRefs)) {
      const objectPath = join(objectsDir, hash.slice(0, 2), hash.slice(2))
      try {
        await rm(objectPath)
      } catch {
        // 文件已不存在，忽略
      }
      // 尝试删除空子目录
      try {
        await rmdir(join(objectsDir, hash.slice(0, 2)))
      } catch {
        // 非空或已不存在，忽略
      }
    }
  }

  // 删除快照索引文件
  await rm(join(baseDir, 'snapshots', `snapshot-${snapshotId}.json`))
}

// ============================================================
// 快照应用与恢复
// ============================================================

export type ApplySnapshotOptions = {
  baseDir: string
  snapshotId: string
  mode: 'full' | 'partial'
  /** 部分恢复时指定要恢复的文件路径列表 */
  filePaths?: string[]
  /** 是否恢复环境变量 */
  restoreEnv?: boolean
}

export type ApplySnapshotResult = {
  filesRestored: number
  filesSkipped: number
  envVariablesRestored: number
  errors: Array<{ path: string; error: string }>
}

/**
 * 全量或部分恢复快照中的文件，可选恢复环境变量
 */
export async function applySnapshot(options: ApplySnapshotOptions): Promise<ApplySnapshotResult> {
  const snapshot = await loadSnapshot(options.baseDir, options.snapshotId)
  const objectsDir = join(options.baseDir, 'objects')

  // 确定要恢复的文件列表
  let filesToRestore: string[]
  if (options.mode === 'full') {
    filesToRestore = Object.keys(snapshot.files)
  } else {
    // partial：只恢复 filePaths 中同时存在于快照的文件
    filesToRestore = (options.filePaths ?? []).filter((p) => p in snapshot.files)
  }

  const result: ApplySnapshotResult = {
    filesRestored: 0,
    filesSkipped: 0,
    envVariablesRestored: 0,
    errors: [],
  }

  // partial 模式下，filePaths 中不在快照里的路径计为 skipped
  if (options.mode === 'partial') {
    const skippedCount = (options.filePaths ?? []).filter((p) => !(p in snapshot.files)).length
    result.filesSkipped += skippedCount
  }

  for (const filePath of filesToRestore) {
    const fileEntry = snapshot.files[filePath]
    if (!fileEntry) {
      result.filesSkipped++
      continue
    }

    try {
      const content = await loadObject(objectsDir, fileEntry.hash)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, content)
      if (process.platform !== 'win32') {
        await chmod(filePath, fileEntry.mode)
      }
      result.filesRestored++
    } catch (error) {
      result.errors.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (options.restoreEnv) {
    try {
      result.envVariablesRestored = await restoreEnvironment(
        snapshot.environment,
        snapshot.metadata.platform,
      )
    } catch (error) {
      result.errors.push({
        path: 'environment',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

/**
 * 将环境变量写入 shell 配置文件（macOS/Linux 写入 ~/.zshrc，Windows 调用 setx）
 * 返回成功恢复的环境变量数量
 */
export async function restoreEnvironment(
  environment: Snapshot['environment'],
  platform: AppPlatform,
): Promise<number> {
  // 构建条目：非 PATH 变量 + 由 path 数组合并而来的 PATH
  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(environment.variables)) {
    if (key === 'PATH') continue
    entries.push([key, value])
  }
  const pathValue = environment.path.join(delimiter)
  entries.push(['PATH', pathValue])

  let count = 0

  if (platform === 'win32') {
    for (const [key, value] of entries) {
      // 防止命令注入：key 只允许合法环境变量名，value 通过参数数组传入
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
      try {
        await execAsync(`setx ${key} "${value.replace(/"/g, '')}"`)
        count++
      } catch {
        // 忽略单条失败，继续处理其余变量
      }
    }
  } else {
    const configPath = join(homedir(), '.zshrc')
    const blockStart = '# EnvSetup managed block - begin'
    const blockEnd = '# EnvSetup managed block - end'

    const exportLines = entries.map(([key, value]) => `export ${key}="${value}"`)
    const managedBlock = `${blockStart}\n${exportLines.join('\n')}\n${blockEnd}`

    let existingContent = ''
    try {
      existingContent = await readFile(configPath, 'utf8')
    } catch {
      // 文件不存在时从空白开始
    }

    // 移除旧的 managed block
    const escapedStart = blockStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedEnd = blockEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const blockRegex = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, 'g')
    const cleaned = existingContent.replace(blockRegex, '')

    await writeFile(configPath, `${cleaned.trimEnd()}\n${managedBlock}\n`)
    count = entries.length
  }

  return count
}

/**
 * 从对象存储读取每个 shell 配置文件内容并写回原路径
 * 返回成功恢复的文件数量
 */
export async function restoreShellConfigs(
  baseDir: string,
  shellConfigs: Snapshot['shellConfigs'],
): Promise<number> {
  const objectsDir = join(baseDir, 'objects')
  let count = 0

  for (const [configPath, config] of Object.entries(shellConfigs)) {
    try {
      const content = await loadObject(objectsDir, config.hash)
      await mkdir(dirname(configPath), { recursive: true })
      await writeFile(configPath, content)
      count++
    } catch {
      // 忽略单条失败
    }
  }

  return count
}
