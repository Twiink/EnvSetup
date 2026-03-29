/**
 * 在安装或清理失败后根据快照恢复环境状态。
 */

import { lstat, rm } from 'node:fs/promises'

import type { AppPlatform, FailureAnalysis, RollbackResult, RollbackSuggestion } from './contracts'
import { executePlatformCommandWithElevationFallback } from './elevation'
import {
  applySnapshot,
  loadSnapshot,
  loadSnapshotMeta,
  reconcileSnapshotState,
  restoreShellConfigs,
} from './snapshot'
import { isCleanupAllowedPath } from './environment'

type ExecuteRollbackOptions = {
  dryRun?: boolean
  rollbackCommands?: string[]
  skipRollbackCommands?: boolean
}

/**
 * 根据失败分析找到最合适的回滚快照
 * 返回建议列表（按置信度排序，最多 3 个）
 */
export async function suggestRollbackSnapshots(
  baseDir: string,
  taskId: string,
  failureAnalysis?: FailureAnalysis,
): Promise<RollbackSuggestion[]> {
  const meta = await loadSnapshotMeta(baseDir)

  if (meta.snapshots.length === 0) return []

  // 按 createdAt 降序排列（最新在前）
  const sorted = [...meta.snapshots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  const isConflict = failureAnalysis?.category === 'conflict'

  type Scored = {
    snap: (typeof sorted)[0]
    confidence: 'high' | 'medium' | 'low'
    reason: string
  }

  const scored: Scored[] = []
  let foundFirstAutoSameTask = false
  let foundFirstAutoOtherTask = false

  for (const snap of sorted) {
    const sameTask = snap.taskId === taskId
    const isAuto = snap.type === 'auto'

    if (isConflict) {
      // conflict 类别：优先找任务开始前（其他 taskId）的快照
      if (!sameTask && isAuto && !foundFirstAutoOtherTask) {
        foundFirstAutoOtherTask = true
        scored.push({
          snap,
          confidence: 'high',
          reason: 'Pre-task auto snapshot, best candidate for resolving conflicts',
        })
      } else if (sameTask && isAuto && !foundFirstAutoSameTask) {
        foundFirstAutoSameTask = true
        scored.push({
          snap,
          confidence: 'medium',
          reason: 'Auto snapshot from the current task',
        })
      } else if (isAuto) {
        scored.push({
          snap,
          confidence: 'medium',
          reason: sameTask
            ? 'Auto snapshot from the current task'
            : 'Auto snapshot from another task',
        })
      } else {
        scored.push({
          snap,
          confidence: 'low',
          reason: 'Manual snapshot',
        })
      }
    } else {
      // 普通失败：最新的同 taskId auto 快照为最佳候选
      if (isAuto && sameTask && !foundFirstAutoSameTask) {
        foundFirstAutoSameTask = true
        scored.push({
          snap,
          confidence: 'high',
          reason: 'Latest auto snapshot from the current task',
        })
      } else if (isAuto) {
        scored.push({
          snap,
          confidence: 'medium',
          reason: sameTask
            ? 'Auto snapshot from the current task'
            : 'Auto snapshot from another task',
        })
      } else {
        scored.push({
          snap,
          confidence: 'low',
          reason: 'Manual snapshot',
        })
      }
    }
  }

  // 按置信度排序：high > medium > low，同等置信度保持原有时间顺序
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  scored.sort((a, b) => order[a.confidence] - order[b.confidence])

  return scored.slice(0, 3).map(({ snap, confidence, reason }) => ({
    snapshotId: snap.id,
    snapshotLabel: snap.label,
    createdAt: snap.createdAt,
    reason,
    confidence,
  }))
}

/**
 * 执行回滚到指定快照
 * trackedPaths 非空时使用 partial 模式，否则使用 full 模式
 * installPaths 可选，指定需要删除的安装目录
 */
export async function executeRollback(
  baseDir: string,
  snapshotId: string,
  trackedPaths: string[],
  installPaths?: string[],
  options: ExecuteRollbackOptions = {},
): Promise<RollbackResult> {
  try {
    const rollbackCommands = options.rollbackCommands ?? []
    const currentPlatform = (process.platform === 'win32' ? 'win32' : 'darwin') as AppPlatform
    const snapshot = await loadSnapshot(baseDir, snapshotId)

    if (options.dryRun) {
      const plannedFiles =
        trackedPaths.length > 0
          ? trackedPaths.filter((filePath) => filePath in snapshot.files).length
          : Object.keys(snapshot.files).length
      const plannedShellConfigs = Object.keys(snapshot.shellConfigs).length
      const removablePaths = [
        ...(trackedPaths.length > 0 ? trackedPaths : snapshot.trackedPaths),
        ...(installPaths ?? []),
      ]
      const errors = removablePaths
        .filter((dirPath) => !isCleanupAllowedPath(dirPath))
        .map((dirPath) => ({
          path: dirPath,
          error: `Refusing to remove protected path: ${dirPath}`,
        }))
      const plannedDirectoriesRemoved = removablePaths.length - errors.length
      const hasErrors = errors.length > 0

      return {
        success: !hasErrors,
        executionMode: 'dry_run',
        snapshotId,
        filesRestored: 0,
        envVariablesRestored: 0,
        shellConfigsRestored: 0,
        directoriesRemoved: 0,
        errors,
        message: hasErrors
          ? `Dry-run rollback plan prepared: would restore ${plannedFiles} file(s), ${plannedShellConfigs} shell config(s), run ${rollbackCommands.length} rollback command(s), remove ${plannedDirectoriesRemoved} dir(s), with ${errors.length} protected path error(s)`
          : `Dry-run rollback plan prepared: would restore ${plannedFiles} file(s), ${plannedShellConfigs} shell config(s), run ${rollbackCommands.length} rollback command(s), remove ${plannedDirectoriesRemoved} dir(s)`,
      }
    }

    const mode = trackedPaths.length > 0 ? 'partial' : 'full'
    const result = await applySnapshot({
      baseDir,
      snapshotId,
      mode,
      filePaths: trackedPaths.length > 0 ? trackedPaths : undefined,
      restoreEnv: true,
      allowElevation: true,
    })

    // 第 2 步：恢复 shell 配置文件，让终端初始化脚本回到快照时状态。
    let shellConfigsRestored = 0
    try {
      if (snapshot.shellConfigs && Object.keys(snapshot.shellConfigs).length > 0) {
        shellConfigsRestored = await restoreShellConfigs(baseDir, snapshot.shellConfigs, {
          allowElevation: true,
          platform: currentPlatform,
        })
      }
    } catch (shellError) {
      result.errors.push({
        path: 'shellConfigs',
        error: shellError instanceof Error ? shellError.message : String(shellError),
      })
    }

    // 第 3 步：把受追踪路径恢复为快照中的精确内容，补回缺失文件并清理新增文件。
    // installPaths 语义是「必须彻底删除」，不参与快照协调，避免被 snapshotHasDescendant 保护。
    const trackedRoots = trackedPaths.length > 0 ? trackedPaths : snapshot.trackedPaths
    const allRoots = [...trackedRoots, ...(installPaths ?? [])]
    const protectedPathErrors = allRoots
      .filter((dirPath) => !isCleanupAllowedPath(dirPath))
      .map((dirPath) => ({
        path: dirPath,
        error: `Refusing to remove protected path: ${dirPath}`,
      }))
    result.errors.push(...protectedPathErrors)

    let directoriesRemoved = 0
    const allowedTrackedRoots = trackedRoots.filter((dirPath) => isCleanupAllowedPath(dirPath))
    if (allowedTrackedRoots.length > 0) {
      const reconcileResult = await reconcileSnapshotState({
        baseDir,
        snapshotId,
        paths: allowedTrackedRoots,
        allowElevation: true,
      })
      directoriesRemoved = reconcileResult.directoriesRemoved
      result.errors.push(...reconcileResult.errors)
    }

    // installPaths 强制删除：reconcile 不处理它们，这里单独 rm。
    const allowedInstallPaths = (installPaths ?? []).filter((dirPath) =>
      isCleanupAllowedPath(dirPath),
    )
    for (const installPath of allowedInstallPaths) {
      try {
        const st = await lstat(installPath).catch(() => null)
        if (st !== null) {
          await rm(installPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
          if (st.isDirectory()) {
            directoriesRemoved++
          }
        }
      } catch (error) {
        result.errors.push({
          path: installPath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 第 4 步：补跑插件级回滚命令，处理快照机制无法覆盖的外部副作用。
    if (!options.skipRollbackCommands && rollbackCommands.length > 0) {
      const commandErrors = await runRollbackCommands(rollbackCommands, currentPlatform)
      result.errors.push(...commandErrors)
    }

    const hasErrors = result.errors.length > 0
    const rollbackCommandCount = options.skipRollbackCommands ? 0 : rollbackCommands.length
    return {
      success: !hasErrors,
      executionMode: 'real_run',
      snapshotId,
      filesRestored: result.filesRestored,
      envVariablesRestored: result.envVariablesRestored,
      shellConfigsRestored,
      directoriesRemoved,
      errors: result.errors,
      message: hasErrors
        ? `Restored ${result.filesRestored} file(s), ${shellConfigsRestored} shell config(s), ran ${rollbackCommandCount} rollback command(s), removed ${directoriesRemoved} dir(s) with ${result.errors.length} error(s)`
        : `Successfully restored ${result.filesRestored} file(s), ${shellConfigsRestored} shell config(s), ran ${rollbackCommandCount} rollback command(s), removed ${directoriesRemoved} dir(s)`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      executionMode: options.dryRun ? 'dry_run' : 'real_run',
      snapshotId,
      filesRestored: 0,
      envVariablesRestored: 0,
      shellConfigsRestored: 0,
      directoriesRemoved: 0,
      errors: [{ path: '', error: errorMessage }],
      message: `Rollback failed: ${errorMessage}`,
    }
  }
}

async function runRollbackCommands(
  commands: string[],
  platform: AppPlatform,
): Promise<Array<{ path: string; error: string }>> {
  const errors: Array<{ path: string; error: string }> = []

  for (const [index, command] of commands.entries()) {
    try {
      await executePlatformCommandWithElevationFallback(command, platform)
    } catch (error) {
      errors.push({
        path: `rollback:command:${index + 1}`,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return errors
}
