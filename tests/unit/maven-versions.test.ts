/**
 * maven-versions 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MAVEN_VERSIONS,
  fetchOfficialMavenVersions,
  listMavenVersions,
  normalizeMavenVersion,
  normalizeMavenVersions,
} from '../../src/main/core/mavenVersions'

describe('mavenVersions', () => {
  it('normalizes maven-prefixed version strings', () => {
    expect(normalizeMavenVersion('maven-3.9.11')).toBe('3.9.11')
  })

  it('returns undefined for invalid version strings', () => {
    expect(normalizeMavenVersion('latest')).toBeUndefined()
    expect(normalizeMavenVersion(undefined)).toBeUndefined()
  })

  it('filters draft/prerelease releases and sorts versions descending', () => {
    const versions = normalizeMavenVersions([
      { tag_name: 'maven-3.9.10' },
      { tag_name: 'maven-3.9.11' },
      { tag_name: 'maven-3.9.9', draft: true },
      { tag_name: 'maven-4.0.0', prerelease: true },
    ])

    expect(versions).toEqual(['3.9.11', '3.9.10'])
  })

  it('fetches official Maven versions from GitHub releases', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 'maven-3.9.11' }, { tag_name: 'maven-3.9.10' }],
    })

    await expect(fetchOfficialMavenVersions(fetchImpl as typeof fetch)).resolves.toEqual([
      '3.9.11',
      '3.9.10',
    ])
  })

  it('falls back to bundled versions when fetch fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(listMavenVersions(fetchImpl as typeof fetch)).resolves.toEqual([
      ...DEFAULT_MAVEN_VERSIONS,
    ])
  })

  it('throws when the HTTP response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => [],
    })

    await expect(fetchOfficialMavenVersions(fetchImpl as typeof fetch)).rejects.toThrow(
      'Failed to load Maven releases',
    )
  })

  it('throws when no official Maven versions are returned', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 'latest', prerelease: true }],
    })

    await expect(fetchOfficialMavenVersions(fetchImpl as typeof fetch)).rejects.toThrow(
      'No official Maven versions were returned.',
    )
  })
})
