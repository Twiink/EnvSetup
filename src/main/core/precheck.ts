import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type {
  AppLocale,
  PrecheckInput,
  PrecheckItem,
  PrecheckResult,
  Primitive,
  ResolvedTemplate,
} from './contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'
import { getPrecheckMessage } from './i18n'
import { mapTemplateValuesToPluginParams } from './template'

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

export async function detectExistingNodeEnvironment(): Promise<boolean> {
  return (
    Boolean(process.env.NVM_DIR || process.env.NVM_HOME || process.env.npm_config_prefix) ||
    Boolean(process.env.PATH?.toLowerCase().includes('node'))
  )
}

export async function buildRuntimePrecheckInput(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
): Promise<PrecheckInput> {
  const frontendParams = mapTemplateValuesToPluginParams(
    template.plugins[0]?.pluginId ?? 'frontend-env',
    values,
  )
  const npmCacheDir =
    typeof frontendParams.npmCacheDir === 'string' ? frontendParams.npmCacheDir : process.cwd()
  const npmGlobalPrefix =
    typeof frontendParams.npmGlobalPrefix === 'string'
      ? frontendParams.npmGlobalPrefix
      : process.cwd()

  return {
    platformSupported: template.platforms.includes(process.platform as 'darwin' | 'win32'),
    archSupported: process.arch === 'x64' || process.arch === 'arm64',
    writable: (
      await Promise.all([
        isWritablePath(npmCacheDir).catch(() => false),
        isWritablePath(npmGlobalPrefix).catch(() => false),
      ])
    ).every(Boolean),
    dependencySatisfied: true,
    versionCompatible: true,
    existingEnvConflict: await detectExistingNodeEnvironment(),
    networkAvailable: true,
    elevationRequired: false,
  }
}

export async function runPrecheck(
  input: PrecheckInput,
  locale: AppLocale = DEFAULT_LOCALE,
): Promise<PrecheckResult> {
  const items: PrecheckItem[] = []

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
    createdAt: new Date().toISOString(),
  }
}
