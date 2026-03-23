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
}
