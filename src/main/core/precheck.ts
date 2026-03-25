import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type {
  AppLocale,
  DetectedEnvironment,
  PrecheckInput,
  PrecheckItem,
  PrecheckResult,
  Primitive,
  ResolvedTemplate,
} from './contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'
import { detectTemplateEnvironments } from './environment'
import { getPrecheckMessage } from './i18n'
import { mapTemplateValuesToPluginParams } from './template'

function isSupportedArchForPlatform(platform: 'darwin' | 'win32', arch: string): boolean {
  if (platform === 'darwin') {
    return arch === 'x64' || arch === 'arm64'
  }

  return arch === 'x64'
}

export async function isWritablePath(targetPath: string): Promise<boolean> {
  const normalizedPath = targetPath.startsWith('~/')
    ? resolve(process.env.HOME ?? process.cwd(), targetPath.slice(2))
    : resolve(targetPath)

  let candidate = normalizedPath

  while (true) {
    try {
      await access(candidate, constants.F_OK)
    } catch {
      const parent = dirname(candidate)
      if (parent === candidate) {
        return false
      }
      candidate = parent
      continue
    }

    try {
      await access(candidate, constants.W_OK)
      return true
    } catch {
      return false
    }
  }
}

export async function buildRuntimePrecheckInput(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
): Promise<PrecheckInput> {
  const detections = await detectTemplateEnvironments(template, values)

  // Collect all writable paths from plugin params
  const writablePaths: string[] = []

  for (const plugin of template.plugins) {
    const pluginParams = mapTemplateValuesToPluginParams(plugin.pluginId, values)

    if (typeof pluginParams.installRootDir === 'string') {
      writablePaths.push(pluginParams.installRootDir)
    }
    if (typeof pluginParams.npmCacheDir === 'string') {
      writablePaths.push(pluginParams.npmCacheDir)
    }
    if (typeof pluginParams.npmGlobalPrefix === 'string') {
      writablePaths.push(pluginParams.npmGlobalPrefix)
    }
  }

  // If no plugin-specific paths found, fall back to cwd
  if (writablePaths.length === 0) {
    writablePaths.push(process.cwd())
  }

  const currentPlatform = process.platform === 'win32' ? 'win32' : 'darwin'

  // Template-level checks: identify which declared tool checks have environment conflicts
  const failedTemplateChecks = template.checks.filter((toolId) =>
    detections.some((d) => d.tool === toolId),
  )

  return {
    platformSupported: template.platforms.includes(currentPlatform),
    archSupported: isSupportedArchForPlatform(currentPlatform, process.arch),
    writable: (
      await Promise.all(writablePaths.map((p) => isWritablePath(p).catch(() => false)))
    ).every(Boolean),
    dependencySatisfied: true,
    versionCompatible: true,
    existingEnvConflict: detections.length > 0,
    detections,
    networkAvailable: true,
    elevationRequired: false,
    failedTemplateChecks: failedTemplateChecks.length > 0 ? failedTemplateChecks : undefined,
  }
}

export async function runPrecheck(
  input: PrecheckInput,
  locale: AppLocale = DEFAULT_LOCALE,
): Promise<PrecheckResult> {
  const items: PrecheckItem[] = []
  const detections: DetectedEnvironment[] = input.detections ?? []

  if (!input.platformSupported) {
    items.push({
      code: 'PLATFORM_UNSUPPORTED',
      level: 'block',
      message: getPrecheckMessage('PLATFORM_UNSUPPORTED', locale),
    })
  }

  if (!input.archSupported) {
    items.push({
      code: 'ARCH_UNSUPPORTED',
      level: 'block',
      message: getPrecheckMessage('ARCH_UNSUPPORTED', locale),
    })
  }

  if (!input.writable) {
    items.push({
      code: 'PATH_NOT_WRITABLE',
      level: 'block',
      message: getPrecheckMessage('PATH_NOT_WRITABLE', locale),
    })
  }

  if (!input.dependencySatisfied) {
    items.push({
      code: 'PLUGIN_DEPENDENCY_MISSING',
      level: 'block',
      message: getPrecheckMessage('PLUGIN_DEPENDENCY_MISSING', locale),
    })
  }

  if (!input.versionCompatible) {
    items.push({
      code: 'VERSION_INCOMPATIBLE',
      level: 'block',
      message: getPrecheckMessage('VERSION_INCOMPATIBLE', locale),
    })
  }

  if (input.networkAvailable === false) {
    items.push({
      code: 'NETWORK_UNAVAILABLE',
      level: 'block',
      message: getPrecheckMessage('NETWORK_UNAVAILABLE', locale),
    })
  }

  if (input.existingEnvConflict) {
    items.push({
      code: 'EXISTING_ENV_DETECTED',
      level: 'warn',
      message: getPrecheckMessage('EXISTING_ENV_DETECTED', locale),
    })
  }

  if (input.failedTemplateChecks && input.failedTemplateChecks.length > 0) {
    const toolList = input.failedTemplateChecks.join(', ')
    const templateCheckMsg =
      locale === 'zh-CN'
        ? `模板声明的工具检查发现已有环境冲突：${toolList}`
        : `Template-declared check found existing environment conflict for: ${toolList}`
    items.push({
      code: 'EXISTING_ENV_DETECTED',
      level: 'warn',
      message: templateCheckMsg,
    })
  }

  if (input.elevationRequired) {
    items.push({
      code: 'ELEVATION_REQUIRED',
      level: 'warn',
      message: getPrecheckMessage('ELEVATION_REQUIRED', locale),
    })
  }

  const level = items.some((item) => item.level === 'block')
    ? 'block'
    : items.some((item) => item.level === 'warn')
      ? 'warn'
      : 'pass'

  return {
    level,
    items,
    detections,
    createdAt: new Date().toISOString(),
  }
}
