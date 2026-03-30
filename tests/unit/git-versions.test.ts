/**
 * git-versions 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_GIT_MACOS_VERSIONS,
  DEFAULT_GIT_WINDOWS_VERSIONS,
  fetchOfficialGitVersions,
  listGitVersions,
  normalizeGitVersion,
  normalizeGitVersions,
} from '../../src/main/core/gitVersions'

describe('gitVersions', () => {
  it('normalizes Git for Windows release tags', () => {
    expect(normalizeGitVersion('v2.48.2.windows.1')).toBe('2.48.2')
  })

  it('returns undefined for invalid version strings', () => {
    expect(normalizeGitVersion('latest')).toBeUndefined()
  })

  it('normalizes and sorts release payloads', () => {
    const versions = normalizeGitVersions([
      { tag_name: 'v2.48.2.windows.1' },
      { tag_name: 'v2.49.1.windows.1' },
      { tag_name: 'v2.49.1.windows.2' },
      { tag_name: 'v2.50.0-rc0.windows.1', prerelease: true },
      { tag_name: 'invalid' },
    ])

    expect(versions).toEqual(['2.49.1', '2.48.2'])
  })

  it('fetches official Git for Windows versions from GitHub release payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: 'v2.49.1.windows.1' },
        { tag_name: 'v2.48.2.windows.1' },
        { tag_name: 'v2.49.1.windows.2' },
      ],
    })

    await expect(fetchOfficialGitVersions(fetchImpl as typeof fetch)).resolves.toEqual([
      '2.49.1',
      '2.48.2',
    ])
  })

  it('falls back to default Windows versions when fetch fails on win32', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'))

    await expect(listGitVersions('win32', fetchImpl as typeof fetch)).resolves.toEqual([
      ...DEFAULT_GIT_WINDOWS_VERSIONS,
    ])
  })

  it('returns curated macOS installer versions on darwin', async () => {
    await expect(listGitVersions('darwin')).resolves.toEqual([...DEFAULT_GIT_MACOS_VERSIONS])
  })

  it('listGitVersions returns release list from API on win32 success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 'v2.49.1.windows.1' }, { tag_name: 'v2.48.2.windows.1' }],
    })

    await expect(listGitVersions('win32', fetchImpl as typeof fetch)).resolves.toEqual([
      '2.49.1',
      '2.48.2',
    ])
  })

  it('normalizeGitVersion handles non-string input', () => {
    expect(normalizeGitVersion(undefined)).toBeUndefined()
    expect(normalizeGitVersion(123)).toBeUndefined()
  })

  it('fetchOfficialGitVersions throws on non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })

    await expect(fetchOfficialGitVersions(fetchImpl as typeof fetch)).rejects.toThrow(
      'Failed to load Git releases',
    )
  })
})
