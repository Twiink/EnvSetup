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
  readlink,
  readdir,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AppPlatform, ObjectRefs, Snapshot, SnapshotMeta } from './contracts'
import {
  buildRemovePathCommand,
  buildCopyFileCommand,
  buildEnsureDirectoryCommand,
  buildReadFileBase64Command,
  executePlatformCommand,
  isPermissionError,
} from './elevation'

const execFileAsync = promisify(execFile)

type SnapshotManifest = {
  files: Record<
    string,
    {
      hash: string
      mode: number
      mtimeMs: number
      size: number
    }
  >
  shellConfigs: Record<
    string,
    {
      hash: string
      lines: number
      mode: number
      mtimeMs: number
      size: number
    }
  >
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))]
}

function getPathDelimiter(platform: AppPlatform): string {
  return platform === 'win32' ? ';' : ':'
}

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
const MANIFEST_FILE = 'snapshot-manifest.json'

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

async function loadSnapshotManifest(baseDir: string): Promise<SnapshotManifest> {
  try {
    const content = await readFile(join(baseDir, MANIFEST_FILE), 'utf8')
    const parsed = JSON.parse(content) as Partial<SnapshotManifest>
    return {
      files: typeof parsed.files === 'object' && parsed.files ? parsed.files : {},
      shellConfigs:
        typeof parsed.shellConfigs === 'object' && parsed.shellConfigs ? parsed.shellConfigs : {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return { files: {}, shellConfigs: {} }
    }
    throw error
  }
}

async function saveSnapshotManifest(baseDir: string, manifest: SnapshotManifest): Promise<void> {
  await writeFile(join(baseDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2))
}

function matchesManifestEntry(
  entry:
    | SnapshotManifest['files'][string]
    | SnapshotManifest['shellConfigs'][string]
    | undefined,
  target: { mode: number; mtimeMs: number; size: number },
): boolean {
  return Boolean(
    entry &&
      entry.mode === target.mode &&
      entry.mtimeMs === target.mtimeMs &&
      entry.size === target.size,
  )
}

async function hasStoredObject(objectsDir: string, hash: string): Promise<boolean> {
  try {
    await access(join(objectsDir, hash.slice(0, 2), hash.slice(2)), constants.F_OK)
    return true
  } catch {
    return false
  }
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
  const snapshotManifest = await loadSnapshotManifest(options.baseDir)
  const nextSnapshotManifest: SnapshotManifest = {
    files: { ...snapshotManifest.files },
    shellConfigs: { ...snapshotManifest.shellConfigs },
  }
  const files: Snapshot['files'] = {}
  const directories: NonNullable<Snapshot['directories']> = {}
  const symlinks: NonNullable<Snapshot['symlinks']> = {}
  const currentPlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform
  const pendingPaths: string[] = []
  const queuedPaths = new Set<string>()
  const maxWorkers = 8

  function enqueuePath(targetPath: string): void {
    const normalizedPath = resolve(targetPath)
    if (queuedPaths.has(normalizedPath)) {
      return
    }
    queuedPaths.add(normalizedPath)
    pendingPaths.push(targetPath)
  }

  async function collectTrackedPath(targetPath: string): Promise<void> {
    let targetStat

    try {
      targetStat = await lstat(targetPath)
    } catch {
      return
    }

    if (targetStat.isSymbolicLink()) {
      try {
        const target = await readlink(targetPath)
        let type: 'file' | 'dir' | 'junction' = process.platform === 'win32' ? 'file' : 'file'
        try {
          const targetStats = await stat(targetPath)
          if (targetStats.isDirectory()) {
            type = process.platform === 'win32' ? 'junction' : 'dir'
          }
        } catch {
          // Keep the default file-type symlink when the target is not accessible.
        }
        symlinks[targetPath] = { target, type }
      } catch {
        // 跳过不可读的符号链接
      }
      return
    }

    if (targetStat.isDirectory()) {
      directories[targetPath] = { mode: targetStat.mode }
      const entries = await readdir(targetPath, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = join(targetPath, entry.name)
        if (entry.isSymbolicLink() || entry.isDirectory() || entry.isFile()) {
          enqueuePath(entryPath)
          continue
        }

        try {
          const nestedStat = await lstat(entryPath)
          if (nestedStat.isDirectory() || nestedStat.isFile()) {
            enqueuePath(entryPath)
          }
        } catch {
          // 跳过瞬时消失或不可读的条目
        }
      }
      return
    }

    if (!targetStat.isFile()) {
      return
    }

    try {
      const cachedEntry = snapshotManifest.files[targetPath]
      if (matchesManifestEntry(cachedEntry, targetStat) && cachedEntry) {
        if (await hasStoredObject(objectsDir, cachedEntry.hash)) {
          files[targetPath] = { hash: cachedEntry.hash, mode: targetStat.mode, size: targetStat.size }
          nextSnapshotManifest.files[targetPath] = {
            hash: cachedEntry.hash,
            mode: targetStat.mode,
            mtimeMs: targetStat.mtimeMs,
            size: targetStat.size,
          }
          return
        }
      }

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
      nextSnapshotManifest.files[targetPath] = {
        hash,
        mode: targetStat.mode,
        mtimeMs: targetStat.mtimeMs,
        size: targetStat.size,
      }
    } catch {
      // 跳过不可读文件
    }
  }

  for (const trackedPath of options.trackedPaths) {
    enqueuePath(trackedPath)
  }

  const workerCount = Math.min(maxWorkers, Math.max(1, pendingPaths.length))
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (pendingPaths.length > 0) {
        const nextPath = pendingPaths.pop()
        if (!nextPath) {
          return
        }
        await collectTrackedPath(nextPath)
      }
    }),
  )
  const fileHashes = Object.values(files).map((entry) => entry.hash)

  const environment = {
    variables: { ...process.env } as Record<string, string>,
    path: (process.env.PATH ?? '').split(delimiter),
    userVariables:
      process.platform === 'win32'
        ? await loadWindowsUserEnvironment().catch(() => undefined)
        : undefined,
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
        const configStat = await stat(configPath)
        const cachedEntry = snapshotManifest.shellConfigs[configPath]
        if (matchesManifestEntry(cachedEntry, configStat) && cachedEntry) {
          if (await hasStoredObject(objectsDir, cachedEntry.hash)) {
            return {
              configPath,
              hash: cachedEntry.hash,
              lines: cachedEntry.lines,
              mode: configStat.mode,
              mtimeMs: configStat.mtimeMs,
              size: configStat.size,
            } as const
          }
        }

        const content = await readFile(configPath)
        const hash = await storeObject(objectsDir, content)
        const lines = content.toString('utf8').split('\n').length
        return {
          configPath,
          hash,
          lines,
          mode: configStat.mode,
          mtimeMs: configStat.mtimeMs,
          size: configStat.size,
        } as const
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
      nextSnapshotManifest.shellConfigs[r.configPath] = {
        hash: r.hash,
        lines: r.lines,
        mode: r.mode,
        mtimeMs: r.mtimeMs,
        size: r.size,
      }
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
    trackedPaths: uniqueStrings(options.trackedPaths),
    files,
    directories,
    symlinks,
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
  await saveSnapshotManifest(options.baseDir, nextSnapshotManifest)

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
        await rm(objectPath, { maxRetries: 3, retryDelay: 100 })
      } catch {
        // 文件已不存在或删除失败，忽略
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
  await rm(join(baseDir, 'snapshots', `snapshot-${snapshotId}.json`), {
    maxRetries: 3,
    retryDelay: 100,
  })
}

async function loadWindowsUserEnvironment(): Promise<Record<string, string>> {
  if (process.platform !== 'win32') {
    return {}
  }

  const { stdout } = await execFileAsync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    "[Environment]::GetEnvironmentVariables('User') | ConvertTo-Json -Compress",
  ])

  const trimmed = stdout.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  )
}

async function readFileWithElevation(targetPath: string, platform: AppPlatform): Promise<Buffer> {
  const { stdout } = await executePlatformCommand(
    buildReadFileBase64Command(targetPath, platform),
    platform,
    { elevated: true, timeoutMs: 60_000 },
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
      { elevated: true, timeoutMs: 60_000 },
    )
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

async function removePathWithElevation(
  targetPath: string,
  platform: AppPlatform,
  allowElevation?: boolean,
): Promise<void> {
  try {
    await rm(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch (error) {
    if (!allowElevation || !isPermissionError(error)) {
      throw error
    }

    await executePlatformCommand(buildRemovePathCommand(targetPath, platform), platform, {
      elevated: true,
      timeoutMs: 60_000,
    })
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
  const snapshotSymlinks = snapshot.symlinks ?? {}
  const snapshotFilePaths = Object.keys(snapshot.files)
  const snapshotDirectoryPaths = Object.keys(snapshotDirectories)
  const snapshotSymlinkPaths = Object.keys(snapshotSymlinks)
  const pathSeparator = process.platform === 'win32' ? '\\' : '/'
  const currentPlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform

  function collectDescendants(sortedPaths: string[], rootPath: string): string[] {
    const normalizedRoot = resolve(rootPath)
    const prefix = `${normalizedRoot}${pathSeparator}`
    let lo = 0
    let hi = sortedPaths.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (sortedPaths[mid] < prefix) lo = mid + 1
      else hi = mid
    }
    const matches: string[] = []
    while (lo < sortedPaths.length && sortedPaths[lo].startsWith(prefix)) {
      matches.push(sortedPaths[lo])
      lo++
    }
    return matches
  }

  // 确定要恢复的文件列表
  let filesToRestore: string[]
  let directoriesToRestore: string[]
  let symlinksToRestore: string[]
  const result: ApplySnapshotResult = {
    filesRestored: 0,
    filesSkipped: 0,
    envVariablesRestored: 0,
    errors: [],
  }

  if (options.mode === 'full') {
    filesToRestore = snapshotFilePaths
    directoriesToRestore = snapshotDirectoryPaths
    symlinksToRestore = snapshotSymlinkPaths
  } else {
    const sortedDirPaths = [...snapshotDirectoryPaths].map((p) => resolve(p)).sort()
    const sortedSymlinkPaths = [...snapshotSymlinkPaths].map((p) => resolve(p)).sort()
    const sortedFilePaths = [...snapshotFilePaths].map((p) => resolve(p)).sort()

    const matchedTargets = new Set<string>()
    const fileSet = new Set<string>()
    const directorySet = new Set<string>()
    const symlinkSet = new Set<string>()

    for (const requestedPath of options.filePaths ?? []) {
      if (requestedPath in snapshot.files) {
        fileSet.add(requestedPath)
        matchedTargets.add(requestedPath)
      }

      if (requestedPath in snapshotDirectories) {
        directorySet.add(requestedPath)
        matchedTargets.add(requestedPath)
      }

      if (requestedPath in snapshotSymlinks) {
        symlinkSet.add(requestedPath)
        matchedTargets.add(requestedPath)
      }

      for (const dirPath of collectDescendants(sortedDirPaths, requestedPath)) {
        directorySet.add(dirPath)
        matchedTargets.add(requestedPath)
      }

      for (const slPath of collectDescendants(sortedSymlinkPaths, requestedPath)) {
        symlinkSet.add(slPath)
        matchedTargets.add(requestedPath)
      }

      for (const fPath of collectDescendants(sortedFilePaths, requestedPath)) {
        fileSet.add(fPath)
        matchedTargets.add(requestedPath)
      }
    }

    filesToRestore = Array.from(fileSet)
    directoriesToRestore = Array.from(directorySet)
    symlinksToRestore = Array.from(symlinkSet)

    const skippedCount = (options.filePaths ?? []).filter(
      (path) => !matchedTargets.has(path),
    ).length
    if (skippedCount > 0) {
      // partial 模式下，filePaths 中不在快照里的路径计为 skipped
      result.filesSkipped += skippedCount
    }
  }

  directoriesToRestore = directoriesToRestore.sort((a, b) => a.length - b.length)
  symlinksToRestore = symlinksToRestore.sort((a, b) => a.length - b.length)

  async function removeConflictingPath(
    targetPath: string,
    shouldRemove: (stats: Awaited<ReturnType<typeof lstat>>) => boolean,
  ) {
    try {
      const targetStats = await lstat(targetPath)
      if (shouldRemove(targetStats)) {
        await removePathWithElevation(targetPath, currentPlatform, options.allowElevation)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }
  }

  for (const directoryPath of directoriesToRestore) {
    const directoryEntry = snapshotDirectories[directoryPath]
    if (!directoryEntry) {
      continue
    }

    try {
      await removeConflictingPath(directoryPath, (targetStats) => !targetStats.isDirectory())
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
            { elevated: true, timeoutMs: 60_000 },
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

  for (const symlinkPath of symlinksToRestore) {
    const symlinkEntry = snapshotSymlinks[symlinkPath]
    if (!symlinkEntry) {
      result.filesSkipped++
      continue
    }

    try {
      await mkdir(dirname(symlinkPath), { recursive: true })
      await removeConflictingPath(symlinkPath, () => true)
      await symlink(symlinkEntry.target, symlinkPath, symlinkEntry.type)
      result.filesRestored++
    } catch (error) {
      result.errors.push({
        path: symlinkPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const pendingFiles = [...filesToRestore]
  const maxRestoreWorkers = 8
  const restoreWorkerCount = Math.min(maxRestoreWorkers, Math.max(1, pendingFiles.length))

  await Promise.all(
    Array.from({ length: restoreWorkerCount }, async () => {
      while (pendingFiles.length > 0) {
        const filePath = pendingFiles.pop()
        if (!filePath) return

        const fileEntry = snapshot.files[filePath]
        if (!fileEntry) {
          result.filesSkipped++
          continue
        }

        try {
          const content = await loadObject(objectsDir, fileEntry.hash)
          await removeConflictingPath(filePath, (targetStats) => !targetStats.isFile())
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
                error:
                  elevatedError instanceof Error ? elevatedError.message : String(elevatedError),
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
    }),
  )

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
 * 将环境变量恢复到快照记录的精确状态
 * 返回成功恢复的环境变量数量
 */
export async function restoreEnvironment(
  environment: Snapshot['environment'],
  platform: AppPlatform,
): Promise<number> {
  const nextEnvironment = {
    ...environment.variables,
    PATH: environment.path.join(getPathDelimiter(platform)),
  }

  let restoredCount = 0
  const currentKeys = new Set(Object.keys(process.env))
  for (const key of currentKeys) {
    if (!(key in nextEnvironment)) {
      delete process.env[key]
      restoredCount++
    }
  }

  for (const [key, value] of Object.entries(nextEnvironment)) {
    if (process.env[key] !== value) {
      process.env[key] = value
      restoredCount++
    }
  }

  if (platform !== 'win32' || !environment.userVariables) {
    return restoredCount
  }

  const currentUserVariables = await loadWindowsUserEnvironment().catch(() => ({}))
  for (const key of Object.keys(currentUserVariables)) {
    if (!(key in environment.userVariables)) {
      await execFileAsync('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `[Environment]::SetEnvironmentVariable('${key.replace(/'/g, "''")}', $null, 'User')`,
      ])
      restoredCount++
    }
  }

  for (const [key, value] of Object.entries(environment.userVariables)) {
    if (currentUserVariables[key] === value) {
      continue
    }
    await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `[Environment]::SetEnvironmentVariable('${key.replace(/'/g, "''")}', '${value.replace(/'/g, "''")}', 'User')`,
    ])
    restoredCount++
  }

  return restoredCount
}

export type ReconcileSnapshotStateResult = {
  directoriesRemoved: number
  errors: Array<{ path: string; error: string }>
}

export async function reconcileSnapshotState(options: {
  baseDir: string
  snapshotId: string
  paths?: string[]
  allowElevation?: boolean
}): Promise<ReconcileSnapshotStateResult> {
  const snapshot = await loadSnapshot(options.baseDir, options.snapshotId)
  const snapshotDirectories = new Set(
    Object.keys(snapshot.directories ?? {}).map((entry) => resolve(entry)),
  )
  const snapshotFiles = new Set(Object.keys(snapshot.files).map((entry) => resolve(entry)))
  const snapshotSymlinks = new Set(
    Object.keys(snapshot.symlinks ?? {}).map((entry) => resolve(entry)),
  )
  const sortedSnapshotPaths = [...snapshotDirectories, ...snapshotFiles, ...snapshotSymlinks].sort()
  const roots = uniqueStrings(
    (options.paths && options.paths.length > 0 ? options.paths : snapshot.trackedPaths).map(
      (entry) => resolve(entry),
    ),
  )
  const pathSeparator = process.platform === 'win32' ? '\\' : '/'
  const currentPlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform
  const result: ReconcileSnapshotStateResult = {
    directoriesRemoved: 0,
    errors: [],
  }

  function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
    return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${pathSeparator}`)
  }

  function snapshotContainsPath(targetPath: string): boolean {
    return (
      snapshotDirectories.has(targetPath) ||
      snapshotFiles.has(targetPath) ||
      snapshotSymlinks.has(targetPath)
    )
  }

  function snapshotHasDescendant(targetPath: string): boolean {
    const prefix = `${targetPath}${pathSeparator}`
    let lo = 0
    let hi = sortedSnapshotPaths.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (sortedSnapshotPaths[mid] < prefix) lo = mid + 1
      else hi = mid
    }
    return lo < sortedSnapshotPaths.length && sortedSnapshotPaths[lo].startsWith(prefix)
  }

  async function prunePath(targetPath: string): Promise<void> {
    let targetStats
    try {
      targetStats = await lstat(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      // On Windows, a recently-executed .exe may deny lstat with EPERM.
      // Attempt removal directly; if the file is truly gone, that's fine.
      if (isPermissionError(error) && process.platform === 'win32') {
        try {
          await removePathWithElevation(targetPath, currentPlatform, options.allowElevation)
        } catch {
          // Ignore — the file may already be gone or truly unremovable.
        }
        return
      }
      result.errors.push({
        path: targetPath,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const normalizedPath = resolve(targetPath)
    const shouldKeep = snapshotContainsPath(normalizedPath) || snapshotHasDescendant(normalizedPath)
    if (!shouldKeep) {
      try {
        await removePathWithElevation(targetPath, currentPlatform, options.allowElevation)
        if (targetStats.isDirectory()) {
          result.directoriesRemoved++
        }
      } catch (error) {
        result.errors.push({
          path: targetPath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    if (!targetStats.isDirectory()) {
      return
    }

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      for (const entry of entries) {
        await prunePath(join(targetPath, entry.name))
      }
    } catch (error) {
      result.errors.push({
        path: targetPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const rootPath of roots) {
    await prunePath(rootPath)
  }

  return result
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
