export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export const DEFAULT_LOCALE = 'zh-CN' as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]
export type LocalizedText = Partial<Record<AppLocale, string>>
export type LocalizedTextInput = string | LocalizedText

export function isAppLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale)
}

export function normalizeLocale(value?: string | null): AppLocale {
  if (!value) {
    return DEFAULT_LOCALE
  }

  if (value === 'zh-CN' || value.toLowerCase().startsWith('zh')) {
    return 'zh-CN'
  }

  if (value === 'en' || value.toLowerCase().startsWith('en')) {
    return 'en'
  }

  return DEFAULT_LOCALE
}

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  return Object.entries(value).every(
    ([key, entry]) => isAppLocale(key) && typeof entry === 'string',
  )
}

export function isLocalizedTextInput(value: unknown): value is LocalizedTextInput {
  return typeof value === 'string' || isLocalizedText(value)
}

export function resolveLocalizedText(
  value: LocalizedTextInput | undefined,
  locale: AppLocale,
  fallback = '',
): string {
  if (!value) {
    return fallback
  }

  if (typeof value === 'string') {
    return value
  }

  return value[locale] ?? value[DEFAULT_LOCALE] ?? Object.values(value)[0] ?? fallback
}
