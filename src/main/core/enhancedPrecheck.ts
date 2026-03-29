/**
 * 基于插件结果与环境信息生成更丰富的增强预检结果。
 */

import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import type {
  ConflictItem,
  EnhancedPrecheckResult,
  FileOperation,
  ImpactSummary,
  InstallPlan,
  PluginInstallResult,
} from './contracts'

const DEFAULT_FILE_SIZE = 1_048_576 // 1 MB
const DEFAULT_DOWNLOAD_SIZE = 10_485_760 // 10 MB
const MS_PER_COMMAND = 5_000
const MS_PER_10MB_DOWNLOAD = 3_000

/**
 * 从插件安装结果生成执行计划
 * 使用 PluginInstallResult.downloads 推断文件操作（从 URL 提取文件名）
 */
export function generateInstallPlan(pluginResults: PluginInstallResult[]): InstallPlan {
  const fileOperations: FileOperation[] = []
  const envChanges: InstallPlan['envChanges'] = []
  let estimatedDownloadSize = 0

  for (const result of pluginResults) {
    // 从 downloads 推断文件操作（create 操作，从 URL 提取文件名）
    for (const d of result.downloads) {
      estimatedDownloadSize += DEFAULT_DOWNLOAD_SIZE
      // 从 URL 推断目标文件名（URL 无效时跳过）
      let fileName = ''
      try {
        fileName = basename(new URL(d.url).pathname)
      } catch {
        // 无效 URL，跳过文件名推断
      }
      if (fileName) {
        fileOperations.push({ type: 'create', path: fileName, size: DEFAULT_DOWNLOAD_SIZE })
      }
    }

    // 从 paths 推断文件操作
    for (const [, filePath] of Object.entries(result.paths)) {
      if (filePath && !fileOperations.some((f) => f.path === filePath)) {
        fileOperations.push({ type: 'create', path: filePath, size: DEFAULT_FILE_SIZE })
      }
    }

    // 收集环境变量变更（映射 EnvChange.kind → action）
    for (const e of result.envChanges) {
      const action: 'set' | 'append' | 'remove' =
        e.kind === 'env' ? 'set' : e.kind === 'path' ? 'append' : 'set'
      envChanges.push({ key: e.key, value: e.value, action })
    }
  }

  // 磁盘占用：所有 create/modify 操作的 size 之和
  const estimatedDiskUsage = fileOperations
    .filter((f) => f.type === 'create' || f.type === 'modify')
    .reduce((sum, f) => sum + (f.size ?? DEFAULT_FILE_SIZE), 0)

  // 预估时间：commands * 5s + 每 10MB 下载 * 3s
  const totalCommands = pluginResults.reduce((sum, r) => sum + r.commands.length, 0)
  const downloadChunks = estimatedDownloadSize / (10 * 1_048_576)
  const estimatedDurationMs =
    totalCommands * MS_PER_COMMAND + Math.ceil(downloadChunks) * MS_PER_10MB_DOWNLOAD

  return {
    fileOperations,
    envChanges,
    estimatedDiskUsage,
    estimatedDownloadSize,
    estimatedDurationMs,
    pluginCount: pluginResults.length,
  }
}

/**
 * 检测安装计划中的冲突
 */
export function detectConflicts(
  plan: InstallPlan,
  existingPaths: string[],
  existingEnvVars: Record<string, string>,
  installedVersions?: Record<string, string>,
): ConflictItem[] {
  const conflicts: ConflictItem[] = []
  const existingSet = new Set(existingPaths)

  // file_exists：create 操作的目标文件已存在
  for (const op of plan.fileOperations) {
    if (op.type === 'create' && existingSet.has(op.path)) {
      conflicts.push({
        type: 'file_exists',
        path: op.path,
        detail: `File already exists: ${op.path}`,
      })
    }
  }

  // env_conflict：set 操作的 key 在现有环境变量中已有值
  for (const change of plan.envChanges) {
    if (change.action === 'set' && change.key in existingEnvVars) {
      conflicts.push({
        type: 'env_conflict',
        key: change.key,
        detail: `Environment variable already set: ${change.key}=${existingEnvVars[change.key]}`,
      })
    }
  }

  // version_mismatch：检测已安装版本与计划版本冲突
  if (installedVersions) {
    for (const change of plan.envChanges) {
      if (change.action === 'set') {
        // 检查 key 是否形如 TOOL_VERSION
        const versionKeyMatch = change.key.match(/^(.+)_VERSION$/i)
        if (versionKeyMatch) {
          const toolName = versionKeyMatch[1].toLowerCase()
          const installedVersion = installedVersions[toolName]
          const requestedVersion = change.value
          if (installedVersion && installedVersion !== requestedVersion) {
            conflicts.push({
              type: 'version_mismatch',
              key: toolName,
              detail: `Installed: ${installedVersion}, requested: ${requestedVersion}`,
            })
          }
        }
      }
    }
  }

  return conflicts
}

/**
 * 生成影响摘要
 */
export function generateImpactSummary(plan: InstallPlan): ImpactSummary {
  let filesCreated = 0
  let filesModified = 0
  let filesDeleted = 0

  for (const op of plan.fileOperations) {
    if (op.type === 'create' || op.type === 'symlink') filesCreated++
    else if (op.type === 'modify') filesModified++
    else if (op.type === 'delete') filesDeleted++
  }

  return {
    filesCreated,
    filesModified,
    filesDeleted,
    envVarsChanged: plan.envChanges.length,
    totalDiskUsage: plan.estimatedDiskUsage,
    estimatedDurationMs: plan.estimatedDurationMs,
  }
}

/**
 * 整合：生成完整的增强预检结果
 */
export function runEnhancedPrecheck(
  pluginResults: PluginInstallResult[],
  existingPaths: string[],
  existingEnvVars: Record<string, string>,
  installedVersions?: Record<string, string>,
): EnhancedPrecheckResult {
  const plan = generateInstallPlan(pluginResults)
  const conflicts = detectConflicts(plan, existingPaths, existingEnvVars, installedVersions)
  const impact = generateImpactSummary(plan)

  // 只有 file_exists 或 env_conflict 类型的冲突才阻断安装
  const blockingConflicts = conflicts.filter(
    (c) => c.type === 'file_exists' || c.type === 'env_conflict',
  )

  return {
    plan,
    conflicts,
    impact,
    canProceed: blockingConflicts.length === 0,
  }
}

/**
 * 集成增强预检：自动读取磁盘状态后调用 runEnhancedPrecheck
 */
export async function runPrecheck(
  pluginResults: PluginInstallResult[],
  installedVersions?: Record<string, string>,
): Promise<EnhancedPrecheckResult> {
  // 收集所有计划文件路径，检查磁盘已存在的文件
  const allPaths = pluginResults.flatMap((r) => Object.values(r.paths))
  const existingPaths = allPaths.filter((p) => p && existsSync(p))

  const existingEnvVars = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

  return runEnhancedPrecheck(pluginResults, existingPaths, existingEnvVars, installedVersions)
}
