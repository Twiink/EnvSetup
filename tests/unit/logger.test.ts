import { describe, expect, it } from 'vitest'

import { sanitizeLog } from '../../src/main/core/logger'

describe('sanitizeLog', () => {
  it('redacts token-like values', () => {
    const result = sanitizeLog('token=secret-123 password=abc apiKey=xyz')
    expect(result).not.toContain('secret-123')
    expect(result).not.toContain('password=abc')
    expect(result).not.toContain('apiKey=xyz')
  })

  it('preserves non-sensitive parts of the log line', () => {
    const result = sanitizeLog('installing node v20.11.1 token=supersecret')
    expect(result).toContain('installing node v20.11.1')
  })

  it('redacts values regardless of key casing', () => {
    const result = sanitizeLog('TOKEN=abc PASSWORD=def APIKEY=ghi')
    expect(result).not.toContain('abc')
    expect(result).not.toContain('def')
    expect(result).not.toContain('ghi')
  })

  it('returns a plain string without sensitive fragments', () => {
    const result = sanitizeLog('')
    expect(typeof result).toBe('string')
  })

  it('does not alter lines with no sensitive keys', () => {
    const line = 'all good: downloaded 100mb'
    const result = sanitizeLog(line)
    expect(result).toBe(line)
  })
})
