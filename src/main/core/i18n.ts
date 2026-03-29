/**
 * Loads localized strings and shared copy used by main-process workflows.
 */

import type { ErrorCode } from './contracts'
import type { AppLocale, LocalizedTextInput } from '../../shared/locale'
import { resolveLocalizedText } from '../../shared/locale'

const precheckMessages: Partial<Record<ErrorCode, LocalizedTextInput>> = {
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
    'zh-CN': '检测到已有相关运行时环境，请谨慎继续。',
    en: 'An existing runtime environment was detected. Continue with care.',
  },
  ELEVATION_REQUIRED: {
    'zh-CN': '部分操作可能需要管理员授权。',
    en: 'Some requested operations may require administrator approval.',
  },
}

export function getPrecheckMessage(code: ErrorCode, locale: AppLocale): string {
  return resolveLocalizedText(precheckMessages[code], locale, code)
}
