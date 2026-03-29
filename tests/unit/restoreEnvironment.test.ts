/**
 * Unit tests for the restore environment module.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import type { Snapshot } from '../../src/main/core/contracts'
import { restoreEnvironment } from '../../src/main/core/snapshot'

const originalEnv = { ...process.env }

function makeEnv(
  variables: Record<string, string>,
  path: string[] = ['/usr/bin', '/usr/local/bin'],
): Snapshot['environment'] {
  return { variables, path }
}

beforeEach(() => {
  process.env = {
    KEEP_ME: 'yes',
    STALE_ONLY: 'stale',
    PATH: '/stale/path',
  }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('restoreEnvironment (darwin)', () => {
  it('restores process.env to the snapshot state exactly', async () => {
    const count = await restoreEnvironment(
      makeEnv({ KEEP_ME: 'updated', NODE_HOME: '/opt/node' }, ['/usr/bin', '/opt/node/bin']),
      'darwin',
    )

    expect(count).toBeGreaterThan(0)
    expect(process.env.KEEP_ME).toBe('updated')
    expect(process.env.NODE_HOME).toBe('/opt/node')
    expect(process.env.PATH).toBe('/usr/bin:/opt/node/bin')
    expect(process.env.STALE_ONLY).toBeUndefined()
  })

  it('uses the path array instead of PATH from variables', async () => {
    await restoreEnvironment(
      makeEnv({ PATH: '/should/not/win', JAVA_HOME: '/opt/java' }, ['/actual/path']),
      'darwin',
    )

    expect(process.env.PATH).toBe('/actual/path')
    expect(process.env.JAVA_HOME).toBe('/opt/java')
  })

  it('returns the number of changed process variables', async () => {
    const count = await restoreEnvironment(makeEnv({ KEEP_ME: 'yes' }, ['/usr/bin']), 'darwin')

    expect(count).toBe(2)
    expect(process.env.PATH).toBe('/usr/bin')
    expect(process.env.STALE_ONLY).toBeUndefined()
  })
})
