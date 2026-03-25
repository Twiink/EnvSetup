import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isAppLocale,
  isLocalizedText,
  isLocalizedTextInput,
  normalizeLocale,
  resolveLocalizedText,
} from '../../src/shared/locale'

// ---------------------------------------------------------------------------
// isAppLocale
// ---------------------------------------------------------------------------

describe('isAppLocale', () => {
  it('returns true for each supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isAppLocale(locale)).toBe(true)
    }
  })

  it('returns false for unsupported locale strings', () => {
    expect(isAppLocale('fr')).toBe(false)
    expect(isAppLocale('zh')).toBe(false)
    expect(isAppLocale('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// normalizeLocale
// ---------------------------------------------------------------------------

describe('normalizeLocale', () => {
  it('returns default locale for null/undefined/empty', () => {
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE)
  })

  it('normalizes zh variants to zh-CN', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('zh-TW')).toBe('zh-CN')
    expect(normalizeLocale('zh')).toBe('zh-CN')
    expect(normalizeLocale('ZH')).toBe('zh-CN')
  })

  it('normalizes en variants to en', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('EN')).toBe('en')
  })

  it('falls back to default for unknown locales', () => {
    expect(normalizeLocale('fr')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('ja')).toBe(DEFAULT_LOCALE)
  })
})

// ---------------------------------------------------------------------------
// isLocalizedText
// ---------------------------------------------------------------------------

describe('isLocalizedText', () => {
  it('returns true for valid localized text objects', () => {
    expect(isLocalizedText({ 'zh-CN': '你好', en: 'Hello' })).toBe(true)
    expect(isLocalizedText({ 'zh-CN': '你好' })).toBe(true)
    expect(isLocalizedText({ en: 'Hello' })).toBe(true)
  })

  it('returns false for non-objects', () => {
    expect(isLocalizedText('hello')).toBe(false)
    expect(isLocalizedText(123)).toBe(false)
    expect(isLocalizedText(null)).toBe(false)
    expect(isLocalizedText(undefined)).toBe(false)
    expect(isLocalizedText([])).toBe(false)
  })

  it('returns false when keys are not valid locales', () => {
    expect(isLocalizedText({ fr: 'Bonjour' })).toBe(false)
  })

  it('returns false when values are not strings', () => {
    expect(isLocalizedText({ 'zh-CN': 123 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isLocalizedTextInput
// ---------------------------------------------------------------------------

describe('isLocalizedTextInput', () => {
  it('returns true for plain strings', () => {
    expect(isLocalizedTextInput('hello')).toBe(true)
    expect(isLocalizedTextInput('')).toBe(true)
  })

  it('returns true for localized text objects', () => {
    expect(isLocalizedTextInput({ 'zh-CN': '你好', en: 'Hello' })).toBe(true)
  })

  it('returns false for non-string non-object values', () => {
    expect(isLocalizedTextInput(123)).toBe(false)
    expect(isLocalizedTextInput(null)).toBe(false)
    expect(isLocalizedTextInput(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveLocalizedText
// ---------------------------------------------------------------------------

describe('resolveLocalizedText', () => {
  it('returns the string directly for plain string input', () => {
    expect(resolveLocalizedText('hello', 'en')).toBe('hello')
    expect(resolveLocalizedText('你好', 'zh-CN')).toBe('你好')
  })

  it('returns the matching locale value from an object', () => {
    const text = { 'zh-CN': '你好', en: 'Hello' }
    expect(resolveLocalizedText(text, 'zh-CN')).toBe('你好')
    expect(resolveLocalizedText(text, 'en')).toBe('Hello')
  })

  it('falls back to default locale when requested locale is missing', () => {
    const text = { 'zh-CN': '你好' }
    expect(resolveLocalizedText(text, 'en')).toBe('你好')
  })

  it('falls back to first available value when default locale is also missing', () => {
    const text = { en: 'Hello' }
    expect(resolveLocalizedText(text, 'zh-CN')).toBe('Hello')
  })

  it('returns fallback for undefined input', () => {
    expect(resolveLocalizedText(undefined, 'en', 'fallback')).toBe('fallback')
    expect(resolveLocalizedText(undefined, 'en')).toBe('')
  })

  it('returns empty string as default fallback', () => {
    expect(resolveLocalizedText(undefined, 'zh-CN')).toBe('')
  })
})
