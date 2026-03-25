import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_GIT_VERSIONS,
  fetchOfficialGitVersion,
  listGitVersions,
  normalizeGitVersion,
} from '../../src/main/core/gitVersions'

describe('gitVersions', () => {
  it('normalizes v-prefixed version strings', () => {
    expect(normalizeGitVersion('v2.47.1')).toBe('2.47.1')
  })

  it('returns undefined for invalid version strings', () => {
    expect(normalizeGitVersion('latest')).toBeUndefined()
  })

  it('fetches official git version from GitHub release payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v2.48.0' }),
    })

    await expect(fetchOfficialGitVersion(fetchImpl as typeof fetch)).resolves.toBe('2.48.0')
  })

  it('falls back to default versions when fetch fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'))

    await expect(listGitVersions(fetchImpl as typeof fetch)).resolves.toEqual([...DEFAULT_GIT_VERSIONS])
  })
})
