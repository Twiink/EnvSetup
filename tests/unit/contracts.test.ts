import { describe, expect, it } from 'vitest'

import { ERROR_CODES, PLUGIN_STATES, TASK_STATES } from '../../src/main/core/contracts'

describe('contracts', () => {
  it('defines task states from spec', () => {
    expect(TASK_STATES).toEqual([
      'draft',
      'prechecking',
      'ready',
      'running',
      'failed',
      'partially_succeeded',
      'succeeded',
      'cancelled',
    ])
  })

  it('defines plugin states from spec', () => {
    expect(PLUGIN_STATES).toContain('installed_unverified')
    expect(PLUGIN_STATES).toContain('needs_rerun')
  })

  it('defines error codes used by mvp', () => {
    expect(ERROR_CODES).toContain('PLUGIN_PACKAGE_INVALID')
    expect(ERROR_CODES).toContain('USER_CANCELLED')
  })
})
