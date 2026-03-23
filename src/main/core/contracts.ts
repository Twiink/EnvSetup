import type { AppLocale, LocalizedTextInput } from '../../shared/locale'

export const SUPPORTED_PLATFORMS = ['darwin', 'win32'] as const

export const TASK_STATES = [
  'draft',
  'prechecking',
  'ready',
  'running',
  'failed',
  'partially_succeeded',
  'succeeded',
  'cancelled',
] as const

export const PLUGIN_STATES = [
  'not_started',
  'running',
  'installed_unverified',
  'verified_success',
  'failed',
  'needs_rerun',
] as const

export const ERROR_CODES = [
  'PLATFORM_UNSUPPORTED',
  'PERMISSION_DENIED',
  'PARAM_INVALID',
  'PATH_NOT_WRITABLE',
  'NETWORK_UNAVAILABLE',
  'DOWNLOAD_CHECKSUM_FAILED',
  'EXISTING_ENV_DETECTED',
  'PLUGIN_PACKAGE_INVALID',
  'PLUGIN_DEPENDENCY_MISSING',
  'PLUGIN_EXECUTION_FAILED',
  'VERIFY_FAILED',
  'USER_CANCELLED',
  'VERSION_INCOMPATIBLE',
  'ARCH_UNSUPPORTED',
  'ELEVATION_REQUIRED',
] as const

export type AppPlatform = (typeof SUPPORTED_PLATFORMS)[number]
export type Primitive = string | number | boolean | null
export type TaskStatus = (typeof TASK_STATES)[number]
export type PluginExecutionStatus = (typeof PLUGIN_STATES)[number]
export type ErrorCode = (typeof ERROR_CODES)[number]
export type PrecheckLevel = 'pass' | 'warn' | 'block'
export type ParameterType = 'string' | 'boolean' | 'enum' | 'path' | 'version' | 'number'
export type EnvChangeKind = 'env' | 'path' | 'profile'
export type TaskResultLevel = 'success' | 'partial' | 'failure'
export type DownloadArtifactKind = 'archive' | 'mirror'
export type EnvironmentTool = 'node' | 'java' | 'python'
export type DetectedEnvironmentKind =
  | 'managed_root'
  | 'manager_root'
  | 'runtime_executable'
  | 'runtime_home'
  | 'global_prefix'
  | 'virtual_env'

export type TemplatePluginReference = {
  pluginId: string
  version: string
}

export type TemplateDependsOn = {
  field: string
  in?: Primitive[]
  equals?: Primitive
}

export type TemplateOverrideConstraint = {
  type?: ParameterType
  editable: boolean
  required?: boolean
  enum?: string[]
  range?: {
    min?: number
    max?: number
  }
  pattern?: string
  affects?: string[]
  dependsOn?: TemplateDependsOn
}

export type TemplateManifest = {
  id: string
  name: LocalizedTextInput
  version: string
  platforms: AppPlatform[]
  description: LocalizedTextInput
  plugins: TemplatePluginReference[]
  defaults: Record<string, Primitive>
  overrides: Record<string, TemplateOverrideConstraint>
  checks: string[]
  maintainer?: LocalizedTextInput
  recommended?: boolean
}

export type ResolvedTemplateField = TemplateOverrideConstraint & {
  key: string
  value: Primitive
}

export type ResolvedTemplate = TemplateManifest & {
  fields: Record<string, ResolvedTemplateField>
}

export type PluginParameterDefinition = {
  type: ParameterType
  description?: LocalizedTextInput
  values?: string[]
  required?: boolean
}

export type PluginDependency = {
  pluginId: string
  versionRange?: string
}

export type PluginManifest = {
  id: string
  name: LocalizedTextInput
  version: string
  mainAppVersion: string
  platforms: AppPlatform[]
  permissions: string[]
  parameters: Record<string, PluginParameterDefinition>
  dependencies: PluginDependency[]
  entry: string
}

export type ImportedPlugin = {
  manifest: PluginManifest
  sourcePath: string
  entryPath: string
  importedAt: string
  storagePath?: string
}

export type PrecheckInput = {
  platformSupported: boolean
  archSupported: boolean
  writable: boolean
  dependencySatisfied: boolean
  versionCompatible: boolean
  existingEnvConflict: boolean
  detections?: DetectedEnvironment[]
  networkAvailable?: boolean
  elevationRequired?: boolean
}

export type PrecheckItem = {
  code: ErrorCode
  level: PrecheckLevel
  message: string
}

export type DetectedEnvironment = {
  id: string
  tool: EnvironmentTool
  kind: DetectedEnvironmentKind
  path: string
  source: string
  cleanupSupported: boolean
  cleanupPath?: string
  cleanupEnvKey?: string
}

export type PrecheckResult = {
  level: PrecheckLevel
  items: PrecheckItem[]
  detections: DetectedEnvironment[]
  createdAt: string
}

export type CleanupEnvironmentResult = {
  message: string
  removedPath?: string
  clearedEnvKey?: string
}

export type EnvChange = {
  kind: EnvChangeKind
  key: string
  value: string
  scope: 'user' | 'session'
  target?: string
  description: string
}

export type DownloadArtifact = {
  kind: DownloadArtifactKind
  tool: 'node' | 'nvm' | 'nvm-windows'
  url: string
  official: boolean
  checksumUrl?: string
  checksumAlgorithm?: 'sha256'
  note?: string
}

export type PluginInstallResult = {
  status: Extract<PluginExecutionStatus, 'installed_unverified' | 'failed'>
  executionMode: 'dry_run' | 'real_run'
  version: string
  paths: Record<string, string>
  envChanges: EnvChange[]
  downloads: DownloadArtifact[]
  commands: string[]
  logs: string[]
  summary: string
  context?: Record<string, Primitive>
  error?: string
}

export type PluginVerifyResult = {
  status: Extract<PluginExecutionStatus, 'verified_success' | 'failed'>
  checks: string[]
  error?: string
}

export type PluginExecutionInput = {
  platform: AppPlatform
  dryRun?: boolean
  locale?: AppLocale
  [key: string]: Primitive | undefined
}

export type FrontendPluginParams = PluginExecutionInput & {
  nodeManager: 'node' | 'nvm'
  nodeVersion: string
  installRootDir: string
  npmCacheDir: string
  npmGlobalPrefix: string
}

export type PluginLifecycle = {
  install: (input: PluginExecutionInput) => Promise<PluginInstallResult>
  verify: (
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ) => Promise<PluginVerifyResult>
}

export type TaskPluginSnapshot = {
  pluginId: string
  version: string
  status: PluginExecutionStatus
  params: Record<string, Primitive>
  logs: string[]
  lastResult?: PluginInstallResult
  verifyResult?: PluginVerifyResult
  context: Record<string, Primitive>
  errorCode?: ErrorCode
  error?: string
  startedAt?: string
  finishedAt?: string
}

export type InstallTask = {
  id: string
  templateId: string
  templateVersion: string
  locale: AppLocale
  status: TaskStatus
  params: Record<string, Primitive>
  precheck?: PrecheckResult
  plugins: TaskPluginSnapshot[]
  resultLevel?: TaskResultLevel
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  // 快照回滚集成
  snapshotId?: string
  enhancedPrecheck?: EnhancedPrecheckResult
  rollbackSuggestions?: RollbackSuggestion[]
}

// ============================================================
// 快照回滚系统类型定义
// ============================================================

export type Snapshot = {
  id: string
  taskId: string
  createdAt: string
  type: 'auto' | 'manual'
  label?: string
  // 文件系统快照
  files: {
    [filePath: string]: {
      hash: string   // SHA-256 哈希，对应对象存储中的内容
      mode: number   // 文件权限（如 0o755）
      size: number   // 文件大小（字节）
    }
  }
  // 环境变量快照
  environment: {
    variables: Record<string, string>
    path: string[]
  }
  // Shell 配置文件快照
  shellConfigs: {
    [configPath: string]: {
      hash: string
      lines: number
    }
  }
  // 元数据
  metadata: {
    platform: AppPlatform
    diskUsage: number   // 快照占用磁盘空间（字节）
    fileCount: number   // 快照包含的文件数量
  }
}

export type SnapshotMeta = {
  snapshots: Array<{
    id: string
    taskId: string
    createdAt: string
    type: 'auto' | 'manual'
    label?: string
    canDelete: boolean  // 成功任务的快照可删除
  }>
  maxSnapshots: number  // 最大保留数量（默认 5）
}

export type ObjectRefs = {
  [hash: string]: number  // hash -> 引用计数
}

// ============================================================
// 增强预检类型
// ============================================================

export type FileOperation = {
  type: 'create' | 'modify' | 'delete' | 'symlink'
  path: string
  size?: number  // 字节
}

export type InstallPlan = {
  fileOperations: FileOperation[]
  envChanges: Array<{ key: string; value: string; action: 'set' | 'append' | 'remove' }>
  estimatedDiskUsage: number  // 字节
  estimatedDownloadSize: number  // 字节
  estimatedDurationMs: number
  pluginCount: number
}

export type ConflictItem = {
  type: 'file_exists' | 'env_conflict' | 'version_mismatch'
  path?: string
  key?: string
  detail: string
}

export type ImpactSummary = {
  filesCreated: number
  filesModified: number
  filesDeleted: number
  envVarsChanged: number
  totalDiskUsage: number
  estimatedDurationMs: number
}

export type EnhancedPrecheckResult = {
  plan: InstallPlan
  conflicts: ConflictItem[]
  impact: ImpactSummary
  canProceed: boolean  // false 表示有阻断性冲突
}

// ============================================================
// 失败分析类型
// ============================================================

export type FailureCategory =
  | 'network'       // 网络下载失败
  | 'permission'    // 权限不足
  | 'conflict'      // 文件/环境冲突
  | 'dependency'    // 依赖缺失
  | 'unknown'       // 未知原因

export type FailureAnalysis = {
  category: FailureCategory
  message: string
  detail?: string
  retryable: boolean
  suggestedAction?: string
}

export type RollbackSuggestion = {
  snapshotId: string
  snapshotLabel?: string
  createdAt: string
  reason: string  // 为什么建议这个快照
  confidence: 'high' | 'medium' | 'low'
}

export type RollbackResult = {
  success: boolean
  snapshotId: string
  filesRestored: number
  errors: Array<{ path: string; error: string }>
  message: string
}

export type EnvSetupApi = {
  listTemplates: () => Promise<ResolvedTemplate[]>
  listNodeLtsVersions: () => Promise<string[]>
  runPrecheck: (payload: {
    templateId: string
    values: Record<string, Primitive>
    locale: AppLocale
  }) => Promise<PrecheckResult>
  createTask: (payload: {
    templateId: string
    values: Record<string, Primitive>
    precheck?: PrecheckResult
    locale: AppLocale
  }) => Promise<InstallTask>
  startTask: (taskId: string) => Promise<InstallTask>
  retryPlugin: (taskId: string, pluginId: string) => Promise<InstallTask>
  cleanupEnvironment: (detection: DetectedEnvironment) => Promise<CleanupEnvironmentResult>
  pickDirectory: (defaultPath?: string) => Promise<string | undefined>
  importPluginFromPath: (pluginPath: string) => Promise<ImportedPlugin>
  // 快照管理
  listSnapshots: () => Promise<SnapshotMeta>
  createSnapshot: (payload: { taskId: string; label?: string }) => Promise<Snapshot>
  deleteSnapshot: (snapshotId: string) => Promise<void>
  // 回滚
  suggestRollback: (payload: { taskId: string; failureAnalysis?: FailureAnalysis }) => Promise<RollbackSuggestion[]>
  executeRollback: (payload: { snapshotId: string; trackedPaths?: string[] }) => Promise<RollbackResult>
  // 增强预检
  runEnhancedPrecheck: (pluginResults: PluginInstallResult[]) => Promise<EnhancedPrecheckResult>
}
