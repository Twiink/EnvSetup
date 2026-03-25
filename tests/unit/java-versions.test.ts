import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_JAVA_LTS_VERSIONS,
  listJavaLtsVersions,
  normalizeJavaLtsVersions,
} from '../../src/main/core/javaVersions'

describe('javaVersions', () => {
  describe('normalizeJavaLtsVersions', () => {
    it('sorts by major version descending', () => {
      const result = normalizeJavaLtsVersions(['17.0.14+7', '21.0.6+7', '11.0.25+9'])
      expect(result[0]).toMatch(/^21/)
      expect(result[1]).toMatch(/^17/)
      expect(result[2]).toMatch(/^11/)
    })

    it('filters empty strings', () => {
      const result = normalizeJavaLtsVersions(['21.0.6+7', '', '17.0.14+7'])
      expect(result).toHaveLength(2)
    })
  })

  describe('listJavaLtsVersions', () => {
    it('returns default versions when fetch fails', async () => {
      const fakeFetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch
      const result = await listJavaLtsVersions(fakeFetch)
      expect(result).toEqual([...DEFAULT_JAVA_LTS_VERSIONS])
    })

    it('returns default versions when API returns non-OK', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch
      const result = await listJavaLtsVersions(fakeFetch)
      expect(result).toEqual([...DEFAULT_JAVA_LTS_VERSIONS])
    })
  })
})
