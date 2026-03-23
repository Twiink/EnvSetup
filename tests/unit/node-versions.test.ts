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
})
