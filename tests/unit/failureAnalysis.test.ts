import { describe, expect, it } from 'vitest'

import {
  analyzeFailure,
  categorizeError,
  isRetryable,
  suggestAction,
} from '../../src/main/core/failureAnalysis'
import type { PluginInstallResult } from '../../src/main/core/contracts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<PluginInstallResult> = {}): PluginInstallResult {
  return {
    status: 'failed',
    executionMode: 'dry_run',
    version: '1.0.0',
    paths: {},
    envChanges: [],
    downloads: [],
    commands: [],
    logs: [],
    summary: '',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// categorizeError
// ---------------------------------------------------------------------------

describe('categorizeError', () => {
  it.each([
    ['ECONNREFUSED connect ECONNREFUSED 127.0.0.1:80', 'network'],
    ['ETIMEDOUT request timed out', 'network'],
    ['fetch failed: unable to reach host', 'network'],
    ['download failed after 3 retries', 'network'],
    ['network unreachable', 'network'],
    ['curl exit code 7', 'network'],
    ['wget: unable to resolve host', 'network'],
  ] as const)('recognises network error: %s', (msg, expected) => {
    expect(categorizeError(msg)).toBe(expected)
  })

  it.each([
    ['EACCES: permission denied, open /usr/local/bin/node', 'permission'],
    ['EPERM: operation not permitted', 'permission'],
    ['permission denied while writing to /etc', 'permission'],
    ['please run with sudo to install', 'permission'],
  ] as const)('recognises permission error: %s', (msg, expected) => {
    expect(categorizeError(msg)).toBe(expected)
  })

  it.each([
    ['EEXIST: file already exists at /usr/local/bin/node', 'conflict'],
    ['already exists: /home/user/.nvm', 'conflict'],
    ['conflict detected in PATH', 'conflict'],
  ] as const)('recognises conflict error: %s', (msg, expected) => {
    expect(categorizeError(msg)).toBe(expected)
  })

  it.each([
    ['bash: git: command not found', 'dependency'],
    ['not found: python3', 'dependency'],
    ['ENOENT: no such file or directory', 'dependency'],
    ['missing required dependency: curl', 'dependency'],
  ] as const)('recognises dependency error: %s', (msg, expected) => {
    expect(categorizeError(msg)).toBe(expected)
  })

  it('returns unknown for unrecognised errors', () => {
    expect(categorizeError('something went horribly wrong')).toBe('unknown')
    expect(categorizeError('')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// isRetryable
// ---------------------------------------------------------------------------

describe('isRetryable', () => {
  it('network errors are retryable', () => {
    expect(isRetryable('network')).toBe(true)
  })

  it('unknown errors are retryable', () => {
    expect(isRetryable('unknown')).toBe(true)
  })

  it.each(['permission', 'conflict', 'dependency'] as const)(
    '%s errors are not retryable',
    (category) => {
      expect(isRetryable(category)).toBe(false)
    },
  )
})

// ---------------------------------------------------------------------------
// suggestAction
// ---------------------------------------------------------------------------

describe('suggestAction', () => {
  it('suggests retry for network', () => {
    expect(suggestAction('network')).toBe('Check network connection and retry')
  })

  it('suggests privilege fix for permission', () => {
    expect(suggestAction('permission')).toContain('elevated privileges')
  })

  it('suggests remove conflicting files for conflict', () => {
    expect(suggestAction('conflict')).toContain('conflicting files')
  })

  it('suggests install deps for dependency', () => {
    expect(suggestAction('dependency')).toContain('missing dependencies')
  })

  it('suggests checking logs for unknown', () => {
    expect(suggestAction('unknown')).toContain('logs')
  })
})

// ---------------------------------------------------------------------------
// analyzeFailure
// ---------------------------------------------------------------------------

describe('analyzeFailure', () => {
  it('returns non-failure analysis when status is not failed', () => {
    const result = makeResult({ status: 'installed_unverified' })
    const analysis = analyzeFailure(result)
    expect(analysis.retryable).toBe(false)
    expect(analysis.message).toMatch(/did not fail/)
  })

  it('returns unknown analysis when no error and no logs', () => {
    const result = makeResult({ status: 'failed', error: undefined, logs: [] })
    const analysis = analyzeFailure(result)
    expect(analysis.category).toBe('unknown')
    expect(analysis.retryable).toBe(true)
  })

  it('uses result.error for categorisation', () => {
    const result = makeResult({ error: 'ECONNREFUSED 127.0.0.1:3000' })
    const analysis = analyzeFailure(result)
    expect(analysis.category).toBe('network')
    expect(analysis.retryable).toBe(true)
    expect(analysis.suggestedAction).toBe('Check network connection and retry')
    expect(analysis.message).toBe('ECONNREFUSED 127.0.0.1:3000')
  })

  it('prioritises structured error code over message matching', () => {
    const result = makeResult({
      errorCode: 'DOWNLOAD_CHECKSUM_FAILED',
      error: 'network timeout text should not override code',
    })
    const analysis = analyzeFailure(result)
    expect(analysis.category).toBe('conflict')
    expect(analysis.retryable).toBe(false)
  })

  it('falls back to last log lines when no result.error', () => {
    const result = makeResult({
      error: undefined,
      logs: ['step 1', 'step 2', 'EACCES: permission denied'],
    })
    const analysis = analyzeFailure(result)
    expect(analysis.category).toBe('permission')
    expect(analysis.retryable).toBe(false)
  })

  it('handles conflict failures', () => {
    const result = makeResult({ error: 'EEXIST: file already exists at /usr/local' })
    const analysis = analyzeFailure(result)
    expect(analysis.category).toBe('conflict')
    expect(analysis.retryable).toBe(false)
  })

  it('handles dependency failures', () => {
    const result = makeResult({ error: 'bash: git: command not found' })
    const analysis = analyzeFailure(result)
    expect(analysis.category).toBe('dependency')
    expect(analysis.retryable).toBe(false)
    expect(analysis.suggestedAction).toContain('missing dependencies')
  })
})
