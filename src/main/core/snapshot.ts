import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AppPlatform, ObjectRefs, Snapshot, SnapshotMeta } from './contracts'
import {
  buildCopyFileCommand,
  buildEnsureDirectoryCommand,
  buildReadFileBase64Command,
  executePlatformCommand,
  isPermissionError,
} from './elevation'

const execFileAsync = promisify(execFile)

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
    const parsed = JSON.parse(content) as ObjectRefs
    // 结构校验：损坏时恢复为空引用表
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
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
 * 批量增加对象引用计数（一次 load+save，避免串行多次 I/O）
 */
async function batchIncrementRefCounts(baseDir: string, hashes: string[]): Promise<void> {
  if (hashes.length === 0) return
  const refs = await loadRefCounts(baseDir)
  for (const hash of hashes) {
    refs[hash] = (refs[hash] ?? 0) + 1
  }
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

/**
 * 批量减少对象引用计数（一次 load+save，避免 N 次串行 I/O）
 */
async function batchDecrementRefCounts(baseDir: string, hashes: string[]): Promise<void> {
  if (hashes.length === 0) return
  const refs = await loadRefCounts(baseDir)
  for (const hash of hashes) {
    if (refs[hash] !== undefined) {
      refs[hash]--
      if (refs[hash] <= 0) delete refs[hash]
    }
  }
  await saveRefCounts(baseDir, refs)
}

// ============================================================
// 快照创建与加载
// ============================================================

/**
 * 创建快照：递归备份 trackedPaths 中的文件/目录，并记录当前环境变量
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
  const directories: NonNullable<Snapshot['directories']> = {}
  const currentPlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform

  async function collectTrackedPath(targetPath: string): Promise<void> {
    let targetStat

    try {
      targetStat = await lstat(targetPath)
    } catch {
      return
    }

    if (targetStat.isSymbolicLink()) {
      return
    }

    if (targetStat.isDirectory()) {
      directories[targetPath] = { mode: targetStat.mode }
      const entries = await readdir(targetPath, { withFileTypes: true })

      await Promise.all(
        entries.map(async (entry) => {
          const entryPath = join(targetPath, entry.name)
          if (entry.isSymbolicLink()) {
            return
          }
          if (entry.isDirectory() || entry.isFile()) {
            await collectTrackedPath(entryPath)
            return
          }

          try {
            const nestedStat = await lstat(entryPath)
            if (nestedStat.isDirectory() || nestedStat.isFile()) {
              await collectTrackedPath(entryPath)
            }
          } catch {
            // 跳过瞬时消失或不可读的条目
          }
        }),
      )
      return
    }

    if (!targetStat.isFile()) {
      return
    }

    try {
      let content: Buffer
      try {
        content = await readFile(targetPath)
      } catch (error) {
        if (!isPermissionError(error)) {
          throw error
        }
        content = await readFileWithElevation(targetPath, currentPlatform)
      }
      const hash = await storeObject(objectsDir, content)
      files[targetPath] = { hash, mode: targetStat.mode, size: targetStat.size }
    } catch {
      // 跳过不可读文件
    }
  }

  await Promise.all(options.trackedPaths.map((trackedPath) => collectTrackedPath(trackedPath)))
  const fileHashes = Object.values(files).map((entry) => entry.hash)

  const environment = {
    variables: { ...process.env } as Record<string, string>,
    path: (process.env.PATH ?? '').split(delimiter),
  }

  // 并行捕获 shell 配置文件
  const shellConfigs: Snapshot['shellConfigs'] = {}
  const homeDir = homedir()
  const configPaths =
    process.platform === 'win32'
      ? [join(homeDir, '.profile')]
      : [join(homeDir, '.zshrc'), join(homeDir, '.bash_profile'), join(homeDir, '.bashrc')]

  const shellResults = await Promise.all(
    configPaths.map(async (configPath) => {
      try {
        const content = await readFile(configPath)
        const hash = await storeObject(objectsDir, content)
        const lines = content.toString('utf8').split('\n').length
        return { configPath, hash, lines } as const
      } catch {
        return null
      }
    }),
  )

  const shellHashes: string[] = []
  for (const r of shellResults) {
    if (r) {
      shellConfigs[r.configPath] = { hash: r.hash, lines: r.lines }
      shellHashes.push(r.hash)
    }
  }

  // 批量更新引用计数（一次 I/O）
  await batchIncrementRefCounts(options.baseDir, [...fileHashes, ...shellHashes])

  const snapshot: Snapshot = {
    id: randomUUID(),
    taskId: options.taskId,
    createdAt: new Date().toISOString(),
    type: options.type,
    label: options.label,
    files,
    directories,
    environment,
    shellConfigs,
    metadata: {
      platform: process.platform as AppPlatform,
      diskUsage: Object.values(files).reduce((sum, f) => sum + f.size, 0),
      fileCount: Object.keys(files).length,
      directoryCount: Object.keys(directories).length,
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
    const parsed = JSON.parse(content) as SnapshotMeta
    // 结构校验：损坏时恢复为空 meta
    if (!Array.isArray(parsed?.snapshots)) {
      return { snapshots: [], maxSnapshots: DEFAULT_MAX_SNAPSHOTS }
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return { snapshots: [], maxSnapshots: DEFAULT_MAX_SNAPSHOTS }
    }
    throw error
  }
}

export async function saveSnapshotMeta(baseDir: string, meta: SnapshotMeta): Promise<void> {
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

  // 清理超过限制的可删除快照（先删除物理文件，成功后再 splice，避免异常时 meta 提前变脏）
  const failedIds = new Set<string>()
  while (meta.snapshots.length > meta.maxSnapshots) {
    const deletableIdx = meta.snapshots.findIndex((s) => s.canDelete && !failedIds.has(s.id))
    if (deletableIdx === -1) break
    const toDelete = meta.snapshots[deletableIdx]
    try {
      await deleteSnapshot(baseDir, toDelete.id)
      meta.snapshots.splice(deletableIdx, 1)
    } catch {
      failedIds.add(toDelete.id)
    }
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

  // 批量减少引用计数（一次 load+save，避免 N 次串行 I/O）
  await batchDecrementRefCounts(baseDir, hashes)

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

async function readFileWithElevation(targetPath: string, platform: AppPlatform): Promise<Buffer> {
  const { stdout } = await executePlatformCommand(
    buildReadFileBase64Command(targetPath, platform),
    platform,
    { elevated: true },
  )

  return Buffer.from(stdout.trim(), 'base64')
}

async function restoreFileWithElevation(
  targetPath: string,
  content: Buffer,
  mode: number | undefined,
  platform: AppPlatform,
): Promise<void> {
  const stagingDir = await mkdtemp(join(tmpdir(), 'envsetup-restore-'))
  const stagingPath = join(stagingDir, 'payload')

  try {
    await writeFile(stagingPath, content)
    await executePlatformCommand(
      buildCopyFileCommand(stagingPath, targetPath, platform, mode),
      platform,
      { elevated: true },
    )
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
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
  /** 遇到权限错误时，尝试提升为系统管理员权限后重试 */
  allowElevation?: boolean
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
  const snapshotDirectories = snapshot.directories ?? {}
  const snapshotFilePaths = Object.keys(snapshot.files)
  const snapshotDirectoryPaths = Object.keys(snapshotDirectories)
  const pathSeparator = process.platform === 'win32' ? '\\' : '/'
  const currentPlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform

  function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
    const normalizedCandidate = resolve(candidatePath)
    const normalizedRoot = resolve(rootPath)
    return (
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}${pathSeparator}`)
    )
  }

  // 确定要恢复的文件列表
  let filesToRestore: string[]
  let directoriesToRestore: string[]
  const result: ApplySnapshotResult = {
    filesRestored: 0,
    filesSkipped: 0,
    envVariablesRestored: 0,
    errors: [],
  }

  if (options.mode === 'full') {
    filesToRestore = snapshotFilePaths
    directoriesToRestore = snapshotDirectoryPaths
  } else {
    const matchedTargets = new Set<string>()
    const fileSet = new Set<string>()
    const directorySet = new Set<string>()

    for (const requestedPath of options.filePaths ?? []) {
      if (requestedPath in snapshot.files) {
        fileSet.add(requestedPath)
        matchedTargets.add(requestedPath)
      }

      if (requestedPath in snapshotDirectories) {
        directorySet.add(requestedPath)
        matchedTargets.add(requestedPath)
      }

      for (const directoryPath of snapshotDirectoryPaths) {
        if (isPathWithinRoot(directoryPath, requestedPath)) {
          directorySet.add(directoryPath)
          matchedTargets.add(requestedPath)
        }
      }

      for (const filePath of snapshotFilePaths) {
        if (isPathWithinRoot(filePath, requestedPath)) {
          fileSet.add(filePath)
          matchedTargets.add(requestedPath)
        }
      }
    }

    filesToRestore = Array.from(fileSet)
    directoriesToRestore = Array.from(directorySet)

    const skippedCount = (options.filePaths ?? []).filter(
      (path) => !matchedTargets.has(path),
    ).length
    if (skippedCount > 0) {
      // partial 模式下，filePaths 中不在快照里的路径计为 skipped
      result.filesSkipped += skippedCount
    }
  }

  directoriesToRestore = directoriesToRestore.sort((a, b) => a.length - b.length)

  for (const directoryPath of directoriesToRestore) {
    const directoryEntry = snapshotDirectories[directoryPath]
    if (!directoryEntry) {
      continue
    }

    try {
      await mkdir(directoryPath, { recursive: true })
      if (process.platform !== 'win32') {
        await chmod(directoryPath, directoryEntry.mode)
      }
    } catch (error) {
      if (options.allowElevation && isPermissionError(error)) {
        try {
          await executePlatformCommand(
            buildEnsureDirectoryCommand(directoryPath, currentPlatform, directoryEntry.mode),
            currentPlatform,
            { elevated: true },
          )
          continue
        } catch (elevatedError) {
          result.errors.push({
            path: directoryPath,
            error: elevatedError instanceof Error ? elevatedError.message : String(elevatedError),
          })
          continue
        }
      }

      result.errors.push({
        path: directoryPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
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
      if (options.allowElevation && isPermissionError(error)) {
        try {
          const content = await loadObject(objectsDir, fileEntry.hash)
          await restoreFileWithElevation(filePath, content, fileEntry.mode, currentPlatform)
          result.filesRestored++
          continue
        } catch (elevatedError) {
          result.errors.push({
            path: filePath,
            error: elevatedError instanceof Error ? elevatedError.message : String(elevatedError),
          })
          continue
        }
      }

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
        await execFileAsync('setx', [key, value])
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
  options: { allowElevation?: boolean; platform?: AppPlatform } = {},
): Promise<number> {
  const objectsDir = join(baseDir, 'objects')
  const currentPlatform =
    options.platform ?? ((process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform)
  let count = 0

  for (const [configPath, config] of Object.entries(shellConfigs)) {
    try {
      const content = await loadObject(objectsDir, config.hash)
      await mkdir(dirname(configPath), { recursive: true })
      await writeFile(configPath, content)
      count++
    } catch (error) {
      if (options.allowElevation && isPermissionError(error)) {
        try {
          const content = await loadObject(objectsDir, config.hash)
          await restoreFileWithElevation(configPath, content, undefined, currentPlatform)
          count++
        } catch {
          // 忽略单条失败
        }
      }
    }
  }

  return count
}
