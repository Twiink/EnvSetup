/**
 * Unit tests for the node versions module.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_NODE_LTS_VERSIONS,
  fetchOfficialNodeLtsVersions,
  listNodeLtsVersions,
  normalizeNodeLtsVersions,
} from '../../src/main/core/nodeVersions'

describe('node versions', () => {
  it('keeps only the latest patch for each lts major line', () => {
    const versions = normalizeNodeLtsVersions([
      { version: 'v22.21.0', lts: 'Jod' },
      { version: 'v22.22.1', lts: 'Jod' },
      { version: 'v24.12.0', lts: 'Krypton' },
      { version: 'v24.13.1', lts: 'Krypton' },
      { version: 'v25.1.0', lts: false },
      { version: 'v20.20.1', lts: 'Iron' },
    ])

    expect(versions).toEqual(['24.13.1', '22.22.1', '20.20.1'])
  })

  it('loads lts versions from the official node index', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { version: 'v22.22.1', lts: 'Jod' },
        { version: 'v24.13.1', lts: 'Krypton' },
        { version: 'v20.20.1', lts: 'Iron' },
      ],
    } satisfies Partial<Response>)

    await expect(fetchOfficialNodeLtsVersions(fetchImpl as typeof fetch)).resolves.toEqual([
      '24.13.1',
      '22.22.1',
      '20.20.1',
    ])
  })

  it('falls back to bundled lts versions when the official source is unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(listNodeLtsVersions(fetchImpl as typeof fetch)).resolves.toEqual([
      ...DEFAULT_NODE_LTS_VERSIONS,
    ])
  })

  it('returns empty array for non-array input', () => {
    expect(normalizeNodeLtsVersions(null)).toEqual([])
    expect(normalizeNodeLtsVersions(undefined)).toEqual([])
    expect(normalizeNodeLtsVersions('string')).toEqual([])
    expect(normalizeNodeLtsVersions(42)).toEqual([])
  })

  it('returns empty array for empty input array', () => {
    expect(normalizeNodeLtsVersions([])).toEqual([])
  })

  it('ignores entries where lts is false', () => {
    const versions = normalizeNodeLtsVersions([
      { version: 'v18.0.0', lts: false },
      { version: 'v21.0.0', lts: false },
    ])
    expect(versions).toEqual([])
  })

  it('ignores entries with invalid version strings', () => {
    const versions = normalizeNodeLtsVersions([
      { version: 'not-a-version', lts: 'Iron' },
      { version: '', lts: 'Iron' },
      { version: 'v20.1.0', lts: 'Iron' },
    ])
    expect(versions).toEqual(['20.1.0'])
  })

  it('strips leading v from version strings', () => {
    const versions = normalizeNodeLtsVersions([{ version: 'v20.1.0', lts: 'Iron' }])
    expect(versions[0]).toBe('20.1.0')
  })

  it('handles version without leading v', () => {
    const versions = normalizeNodeLtsVersions([{ version: '20.1.0', lts: 'Iron' }])
    expect(versions[0]).toBe('20.1.0')
  })

  it('keeps only the highest patch for each major when multiple entries exist', () => {
    const versions = normalizeNodeLtsVersions([
      { version: 'v20.1.0', lts: 'Iron' },
      { version: 'v20.5.3', lts: 'Iron' },
      { version: 'v20.3.0', lts: 'Iron' },
    ])
    expect(versions).toEqual(['20.5.3'])
  })

  it('sorts output descending by major version', () => {
    const versions = normalizeNodeLtsVersions([
      { version: 'v18.20.0', lts: 'Hydrogen' },
      { version: 'v22.1.0', lts: 'Jod' },
      { version: 'v20.5.0', lts: 'Iron' },
    ])
    expect(versions[0].startsWith('22')).toBe(true)
    expect(versions[1].startsWith('20')).toBe(true)
    expect(versions[2].startsWith('18')).toBe(true)
  })

  it('throws when the HTTP response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => [],
    } satisfies Partial<Response>)

    await expect(fetchOfficialNodeLtsVersions(fetchImpl as typeof fetch)).rejects.toThrow(
      'Failed to load Node.js releases',
    )
  })

  it('throws when the payload contains no LTS versions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ version: 'v21.0.0', lts: false }],
    } satisfies Partial<Response>)

    await expect(fetchOfficialNodeLtsVersions(fetchImpl as typeof fetch)).rejects.toThrow(
      'No official Node.js LTS versions',
    )
  })

  it('listNodeLtsVersions falls back to defaults on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => [],
    } satisfies Partial<Response>)

    await expect(listNodeLtsVersions(fetchImpl as typeof fetch)).resolves.toEqual([
      ...DEFAULT_NODE_LTS_VERSIONS,
    ])
  })
})
