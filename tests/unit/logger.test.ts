import { describe, expect, it } from 'vitest'

import { sanitizeLog } from '../../src/main/core/logger'

describe('logger', () => {
  it('redacts token-like values', () => {
    const result = sanitizeLog('token=secret-123 password=abc apiKey=xyz')
    expect(result).not.toContain('secret-123')
    expect(result).not.toContain('password=abc')
    expect(result).not.toContain('apiKey=xyz')
  })
})
