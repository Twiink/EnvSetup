import type { FailureAnalysis, RollbackResult, RollbackSuggestion } from './contracts'
import { applySnapshot, loadSnapshotMeta } from './snapshot'

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
 */
export async function executeRollback(
  baseDir: string,
  snapshotId: string,
  trackedPaths: string[],
): Promise<RollbackResult> {
  try {
    const mode = trackedPaths.length > 0 ? 'partial' : 'full'
    const result = await applySnapshot({
      baseDir,
      snapshotId,
      mode,
      filePaths: trackedPaths.length > 0 ? trackedPaths : undefined,
      restoreEnv: true,
    })

    const hasErrors = result.errors.length > 0
    return {
      success: !hasErrors,
      snapshotId,
      filesRestored: result.filesRestored,
      errors: result.errors,
      message: hasErrors
        ? `Restored ${result.filesRestored} file(s) with ${result.errors.length} error(s)`
        : `Successfully restored ${result.filesRestored} file(s)`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      snapshotId,
      filesRestored: 0,
      errors: [{ path: '', error: errorMessage }],
      message: `Rollback failed: ${errorMessage}`,
    }
  }
}
