import { existsSync } from 'node:fs'

import type {
  ConflictItem,
  EnhancedPrecheckResult,
  FileOperation,
  ImpactSummary,
  InstallPlan,
} from './contracts'

type PluginDryRunResult = {
  downloads?: Array<{ url: string; size?: number }>
  commands?: string[]
  envChanges?: Array<{ key: string; value: string; action: 'set' | 'append' | 'remove' }>
  files?: Array<{ path: string; action: 'create' | 'modify' | 'delete' | 'symlink'; size?: number }>
}

const DEFAULT_FILE_SIZE = 1_048_576   // 1 MB
const DEFAULT_DOWNLOAD_SIZE = 10_485_760  // 10 MB
const MS_PER_COMMAND = 5_000
const MS_PER_10MB_DOWNLOAD = 3_000

export function generateInstallPlan(pluginResults: PluginDryRunResult[]): InstallPlan {
  const fileOperations: FileOperation[] = []
  const envChanges: InstallPlan['envChanges'] = []
  let estimatedDownloadSize = 0

  for (const result of pluginResults) {
    // Collect file operations
    for (const f of result.files ?? []) {
      fileOperations.push({ type: f.action, path: f.path, size: f.size })
    }

    // Collect env changes
    for (const e of result.envChanges ?? []) {
      envChanges.push({ key: e.key, value: e.value, action: e.action })
    }

    // Sum download sizes
    for (const d of result.downloads ?? []) {
      estimatedDownloadSize += d.size ?? DEFAULT_DOWNLOAD_SIZE
    }
  }

  // Disk usage: sum of create/modify file sizes
  const estimatedDiskUsage = fileOperations
    .filter((f) => f.type === 'create' || f.type === 'modify')
    .reduce((sum, f) => sum + (f.size ?? DEFAULT_FILE_SIZE), 0)

  // Duration: commands * 5s + download chunks * 3s per 10MB
  const totalCommands = pluginResults.reduce((sum, r) => sum + (r.commands?.length ?? 0), 0)
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

const SEMVER_RE = /\d+\.\d+\.\d+/

export function detectConflicts(
  plan: InstallPlan,
  existingPaths: string[],
  existingEnvVars: Record<string, string>,
  installedVersions?: Record<string, string>,
): ConflictItem[] {
  const conflicts: ConflictItem[] = []
  const existingPathSet = new Set(existingPaths)

  // file_exists: create operations targeting existing paths
  for (const op of plan.fileOperations) {
    if (op.type === 'create' && existingPathSet.has(op.path)) {
      conflicts.push({
        type: 'file_exists',
        path: op.path,
        detail: `File already exists: ${op.path}`,
      })
    }
  }

  // env_conflict: set operations on already-defined env vars
  for (const change of plan.envChanges) {
    if (change.action === 'set' && change.key in existingEnvVars) {
      conflicts.push({
        type: 'env_conflict',
        key: change.key,
        detail: `Environment variable already set: ${change.key}=${existingEnvVars[change.key]}`,
      })
    }
  }

  // version_mismatch: detect when installed tool version differs from requested
  if (installedVersions) {
    for (const change of plan.envChanges) {
      // Match keys like NODE_VERSION, JAVA_VERSION, PYTHON_VERSION, or any *_VERSION key
      const keyMatch = change.key.match(/^([A-Z][A-Z0-9]*)_VERSION$/i)
      const requestedMatch = change.value.match(SEMVER_RE)
      if (keyMatch && requestedMatch) {
        const toolName = keyMatch[1].toLowerCase()
        const requestedVersion = requestedMatch[0]
        const installedVersion = installedVersions[toolName]
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

  return conflicts
}

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

export function runEnhancedPrecheck(
  pluginResults: PluginDryRunResult[],
  existingPaths: string[],
  existingEnvVars: Record<string, string>,
  installedVersions?: Record<string, string>,
): EnhancedPrecheckResult {
  const plan = generateInstallPlan(pluginResults)
  const conflicts = detectConflicts(plan, existingPaths, existingEnvVars, installedVersions)
  const impact = generateImpactSummary(plan)

  return {
    plan,
    conflicts,
    impact,
    canProceed: conflicts.length === 0,
  }
}

/**
 * Integrated enhanced precheck: automatically reads disk state (existingPaths, existingEnvVars)
 * then calls runEnhancedPrecheck.
 */
export async function runPrecheck(
  pluginResults: PluginDryRunResult[],
  installedVersions?: Record<string, string>,
): Promise<EnhancedPrecheckResult> {
  // Collect all file paths referenced in plugin results
  const allPaths = pluginResults.flatMap((r) => (r.files ?? []).map((f) => f.path))
  // Check which paths already exist on disk
  const existingPaths = allPaths.filter((p) => existsSync(p))
  // Use current process environment as existing env vars
  const existingEnvVars = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return runEnhancedPrecheck(pluginResults, existingPaths, existingEnvVars, installedVersions)
}
