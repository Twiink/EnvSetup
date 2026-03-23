import type {
  DetectedEnvironment,
  ErrorCode,
  PluginExecutionStatus,
  PrecheckLevel,
  TaskStatus,
} from '../main/core/contracts'
import type { AppLocale, LocalizedTextInput } from '../shared/locale'
import { resolveLocalizedText } from '../shared/locale'

const uiText = {
  documentTitle: {
    'zh-CN': '开发环境配置',
    en: 'Environment Setup',
  },
  appBadge: {
    'zh-CN': '环境配置平台',
    en: 'Environment Platform',
  },
  appTitle: {
    'zh-CN': '开发环境配置',
    en: 'Environment Setup',
  },
  appDescription: {
    'zh-CN': '用模板驱动的方式交付团队开发环境，先跑预检，再冻结参数，最后按插件顺序执行。',
    en: 'Deliver team development environments through templates: precheck first, freeze inputs second, then execute plugins in order.',
  },
  languageLabel: {
    'zh-CN': '语言',
    en: 'Language',
  },
  templatesEyebrow: {
    'zh-CN': '模板',
    en: 'Templates',
  },
  templatesTitle: {
    'zh-CN': '团队标准模板',
    en: 'Team Standard Templates',
  },
  templatesDescription: {
    'zh-CN': '先选团队模板，再做受控范围内的本地调整。',
    en: 'Start from the team template, then apply only controlled local overrides.',
  },
  overridesTitle: {
    'zh-CN': '参数覆盖',
    en: 'Overrides',
  },
  overridesDescription: {
    'zh-CN': '仅展示模板允许修改的字段，其他内容保持团队标准。',
    en: 'Only editable fields from the template are shown here. Everything else stays aligned with the team standard.',
  },
  overridesNoEditableFields: {
    'zh-CN': '当前模板没有需要调整的参数，可以直接运行预检查看现有环境。',
    en: 'This template has no editable parameters. Run precheck directly to inspect the current environment.',
  },
  overridesEmpty: {
    'zh-CN': '请选择一个模板以查看可编辑参数。',
    en: 'Select a template to review editable fields.',
  },
  requiredField: {
    'zh-CN': '必填字段',
    en: 'Required field',
  },
  optionalField: {
    'zh-CN': '可选字段',
    en: 'Optional field',
  },
  browseFolder: {
    'zh-CN': '选择文件夹',
    en: 'Choose Folder',
  },
  precheckTitle: {
    'zh-CN': '预检',
    en: 'Precheck',
  },
  precheckDescription: {
    'zh-CN': '在执行任务前确认平台、目录、已有环境冲突和权限风险。',
    en: 'Validate platform, directories, existing environment conflicts, and permission risks before execution.',
  },
  runPrecheck: {
    'zh-CN': '运行预检',
    en: 'Run Precheck',
  },
  precheckEmpty: {
    'zh-CN': '尚未执行预检。',
    en: 'Precheck has not been run yet.',
  },
  precheckAllPassed: {
    'zh-CN': '当前预检项均已通过。',
    en: 'All current precheck items passed.',
  },
  detectedEnvironmentTitle: {
    'zh-CN': '已发现环境',
    en: 'Detected Environments',
  },
  cleanupEnvironment: {
    'zh-CN': '一键清理',
    en: 'Clean Up',
  },
  cleanupUnavailable: {
    'zh-CN': '仅展示路径',
    en: 'Display Only',
  },
  taskTitle: {
    'zh-CN': '任务',
    en: 'Task',
  },
  taskDescription: {
    'zh-CN': '任务创建后会冻结模板参数快照，启动时按插件顺序执行。',
    en: 'Task creation freezes the template parameter snapshot and executes plugins in order when started.',
  },
  createTask: {
    'zh-CN': '创建任务',
    en: 'Create Task',
  },
  startTask: {
    'zh-CN': '开始执行',
    en: 'Start Task',
  },
  taskStatus: {
    'zh-CN': '任务状态',
    en: 'Task Status',
  },
  retryPlugin: {
    'zh-CN': '重试插件',
    en: 'Retry Plugin',
  },
  noTask: {
    'zh-CN': '还没有任务。先运行预检，再创建任务。',
    en: 'No task yet. Run precheck first, then create a task.',
  },
  cacheLabel: {
    'zh-CN': '缓存目录',
    en: 'Cache Directory',
  },
} as const satisfies Record<string, LocalizedTextInput>

const localeButtonLabelMap: Record<AppLocale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
}

const taskStatusLabelMap: Record<TaskStatus, LocalizedTextInput> = {
  draft: { 'zh-CN': '草稿', en: 'Draft' },
  prechecking: { 'zh-CN': '预检中', en: 'Prechecking' },
  ready: { 'zh-CN': '就绪', en: 'Ready' },
  running: { 'zh-CN': '执行中', en: 'Running' },
  failed: { 'zh-CN': '失败', en: 'Failed' },
  partially_succeeded: { 'zh-CN': '部分成功', en: 'Partially Succeeded' },
  succeeded: { 'zh-CN': '成功', en: 'Succeeded' },
  cancelled: { 'zh-CN': '已取消', en: 'Cancelled' },
}

const pluginStatusLabelMap: Record<PluginExecutionStatus, LocalizedTextInput> = {
  not_started: { 'zh-CN': '未开始', en: 'Not Started' },
  running: { 'zh-CN': '执行中', en: 'Running' },
  installed_unverified: { 'zh-CN': '已安装待校验', en: 'Installed, Awaiting Verification' },
  verified_success: { 'zh-CN': '校验成功', en: 'Verified' },
  failed: { 'zh-CN': '失败', en: 'Failed' },
  needs_rerun: { 'zh-CN': '待重跑', en: 'Needs Rerun' },
}

const precheckLevelLabelMap: Record<PrecheckLevel, LocalizedTextInput> = {
  pass: { 'zh-CN': '通过', en: 'Pass' },
  warn: { 'zh-CN': '警告', en: 'Warn' },
  block: { 'zh-CN': '阻塞', en: 'Block' },
}

const precheckItemTextMap: Partial<Record<ErrorCode, LocalizedTextInput>> = {
  PLATFORM_UNSUPPORTED: {
    'zh-CN': '所选模板不支持当前操作系统。',
    en: 'The selected template does not support the current operating system.',
  },
  ARCH_UNSUPPORTED: {
    'zh-CN': '当前 CPU 架构不在 MVP 支持范围内。',
    en: 'The current CPU architecture is outside the MVP support matrix.',
  },
  PATH_NOT_WRITABLE: {
    'zh-CN': '一个或多个目标目录当前不可写。',
    en: 'One or more target directories are not writable.',
  },
  PLUGIN_DEPENDENCY_MISSING: {
    'zh-CN': '存在缺失或未解析的插件依赖。',
    en: 'A plugin dependency is missing or unresolved.',
  },
  VERSION_INCOMPATIBLE: {
    'zh-CN': '模板或插件版本与当前应用版本不兼容。',
    en: 'Template or plugin versions are not compatible with this app build.',
  },
  NETWORK_UNAVAILABLE: {
    'zh-CN': '当前网络不可用，无法执行需要下载的步骤。',
    en: 'Network access is unavailable for download-based steps.',
  },
  EXISTING_ENV_DETECTED: {
    'zh-CN': '检测到已有 Node 或 npm 环境，请谨慎继续。',
    en: 'An existing Node or npm environment was detected. Continue with care.',
  },
  ELEVATION_REQUIRED: {
    'zh-CN': '部分操作可能需要管理员授权。',
    en: 'Some requested operations may require administrator approval.',
  },
}

const templateFieldLabelMap: Record<string, LocalizedTextInput> = {
  'frontend.nodeManager': {
    'zh-CN': 'Node 管理方式',
    en: 'Node Management',
  },
  'frontend.nodeVersion': {
    'zh-CN': 'Node 版本',
    en: 'Node Version',
  },
  'frontend.installRootDir': {
    'zh-CN': '工具安装根目录',
    en: 'Tool Install Root',
  },
  'frontend.npmCacheDir': {
    'zh-CN': 'npm 缓存目录',
    en: 'npm Cache Directory',
  },
  'frontend.npmGlobalPrefix': {
    'zh-CN': 'npm 全局安装目录',
    en: 'npm Global Install Directory',
  },
}

const templateOptionLabelMap: Record<string, LocalizedTextInput> = {
  node: {
    'zh-CN': '直接安装 Node.js',
    en: 'Install Node.js Directly',
  },
  nvm: {
    'zh-CN': '使用 nvm 管理 Node.js',
    en: 'Use nvm to Manage Node.js',
  },
}

const pluginSummaryMap: Record<string, LocalizedTextInput> = {
  'frontend-env.dry_run': {
    'zh-CN': '已生成前端环境安装的演练计划。',
    en: 'Prepared a dry-run plan for the frontend environment.',
  },
  'frontend-env.real_run': {
    'zh-CN': '前端环境安装命令已执行完成。',
    en: 'Completed frontend environment install commands.',
  },
}

const detectedEnvironmentKindMap: Record<
  DetectedEnvironment['kind'],
  Partial<Record<DetectedEnvironment['tool'], LocalizedTextInput>>
> = {
  managed_root: {
    node: {
      'zh-CN': '模板管理目录',
      en: 'Template-Managed Directory',
    },
  },
  manager_root: {
    node: {
      'zh-CN': 'Node 管理器目录',
      en: 'Node Manager Directory',
    },
    python: {
      'zh-CN': 'Python 管理器目录',
      en: 'Python Manager Directory',
    },
  },
  runtime_executable: {
    node: {
      'zh-CN': 'Node 可执行文件',
      en: 'Node Executable',
    },
    java: {
      'zh-CN': 'Java 可执行文件',
      en: 'Java Executable',
    },
    python: {
      'zh-CN': 'Python 可执行文件',
      en: 'Python Executable',
    },
  },
  runtime_home: {
    java: {
      'zh-CN': 'JAVA_HOME',
      en: 'JAVA_HOME',
    },
  },
  global_prefix: {
    node: {
      'zh-CN': 'npm 全局目录',
      en: 'npm Global Prefix',
    },
  },
  virtual_env: {
    python: {
      'zh-CN': 'Python 虚拟环境',
      en: 'Python Virtual Environment',
    },
  },
}

export type UiTextKey = keyof typeof uiText

export function getUiText(locale: AppLocale, key: UiTextKey): string {
  return resolveLocalizedText(uiText[key], locale, key)
}

export function getLocaleButtonLabel(locale: AppLocale): string {
  return localeButtonLabelMap[locale]
}

export function getTaskStatusLabel(locale: AppLocale, status: TaskStatus): string {
  return resolveLocalizedText(taskStatusLabelMap[status], locale, status)
}

export function getPluginStatusLabel(locale: AppLocale, status: PluginExecutionStatus): string {
  return resolveLocalizedText(pluginStatusLabelMap[status], locale, status)
}

export function getPrecheckLevelLabel(locale: AppLocale, level: PrecheckLevel): string {
  return resolveLocalizedText(precheckLevelLabelMap[level], locale, level)
}

export function getPrecheckItemMessage(
  locale: AppLocale,
  code: ErrorCode,
  fallback: string,
): string {
  return resolveLocalizedText(precheckItemTextMap[code], locale, fallback)
}

export function getTemplateFieldLabel(locale: AppLocale, key: string): string {
  return resolveLocalizedText(templateFieldLabelMap[key], locale, key)
}

export function getTemplateOptionLabel(locale: AppLocale, key: string): string {
  return resolveLocalizedText(templateOptionLabelMap[key], locale, key)
}

export function getPluginSummary(
  locale: AppLocale,
  pluginId: string,
  executionMode: 'dry_run' | 'real_run',
  fallback: string,
): string {
  return resolveLocalizedText(pluginSummaryMap[`${pluginId}.${executionMode}`], locale, fallback)
}

export function getDetectedEnvironmentKindLabel(
  locale: AppLocale,
  detection: DetectedEnvironment,
): string {
  return resolveLocalizedText(
    detectedEnvironmentKindMap[detection.kind]?.[detection.tool],
    locale,
    detection.kind,
  )
}

export function getDetectedEnvironmentSourceLabel(
  locale: AppLocale,
  detection: DetectedEnvironment,
): string {
  return locale === 'zh-CN' ? `来源：${detection.source}` : `Source: ${detection.source}`
}
