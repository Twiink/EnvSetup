/**
 * Unit tests for the contracts module.
 */

import { describe, expect, it } from 'vitest'

import {
  ERROR_CODES,
  PLUGIN_STATES,
  SUPPORTED_PLATFORMS,
  TASK_STATES,
} from '../../src/main/core/contracts'

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

  it('defines supported platforms', () => {
    expect(SUPPORTED_PLATFORMS).toEqual(['darwin', 'win32'])
  })

  it('defines all plugin states', () => {
    expect(PLUGIN_STATES).toEqual([
      'not_started',
      'running',
      'installed_unverified',
      'verified_success',
      'failed',
      'needs_rerun',
    ])
  })

  it('defines all error codes', () => {
    expect(ERROR_CODES).toEqual([
      'PLATFORM_UNSUPPORTED',
      'PERMISSION_DENIED',
      'PARAM_INVALID',
      'PATH_NOT_WRITABLE',
      'NETWORK_UNAVAILABLE',
      'DOWNLOAD_HOST_UNTRUSTED',
      'DOWNLOAD_FAILED',
      'DOWNLOAD_RETRY_EXHAUSTED',
      'DOWNLOAD_CHECKSUM_FAILED',
      'ENV_PERSISTENCE_FAILED',
      'EXISTING_ENV_DETECTED',
      'PLUGIN_PACKAGE_INVALID',
      'PLUGIN_DEPENDENCY_MISSING',
      'PLUGIN_EXECUTION_FAILED',
      'VERIFY_FAILED',
      'USER_CANCELLED',
      'VERSION_INCOMPATIBLE',
      'ARCH_UNSUPPORTED',
      'ELEVATION_REQUIRED',
    ])
  })
})
