/**
 * python-versions 模块的单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PYTHON_VERSIONS,
  listPythonVersions,
  normalizePythonVersions,
} from '../../src/main/core/pythonVersions'

describe('pythonVersions', () => {
  describe('normalizePythonVersions', () => {
    it('extracts active release versions sorted descending', () => {
      const input = [
        { cycle: '3.13', latest: '3.13.4', eol: '2029-10-01' },
        { cycle: '3.12', latest: '3.12.10', eol: '2028-10-01' },
        { cycle: '3.11', latest: '3.11.12', eol: '2027-10-01' },
        { cycle: '2.7', latest: '2.7.18', eol: '2020-01-01' },
      ]
      const result = normalizePythonVersions(input)
      expect(result).toEqual(['3.13.4', '3.12.10', '3.11.12'])
    })

    it('handles boolean eol field', () => {
      const input = [
        { cycle: '3.12', latest: '3.12.10', eol: false },
        { cycle: '2.7', latest: '2.7.18', eol: true },
      ]
      const result = normalizePythonVersions(input)
      expect(result).toEqual(['3.12.10'])
    })

    it('returns empty array for non-array input', () => {
      expect(normalizePythonVersions(null)).toEqual([])
      expect(normalizePythonVersions('string')).toEqual([])
    })

    it('filters out non-semver latest values', () => {
      const input = [
        { cycle: '3.13', latest: '3.13.4', eol: false },
        { cycle: '3.x', latest: 'not-a-version', eol: false },
      ]
      const result = normalizePythonVersions(input)
      expect(result).toEqual(['3.13.4'])
    })
  })

  describe('listPythonVersions', () => {
    it('returns default versions when fetch fails', async () => {
      const fakeFetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch
      const result = await listPythonVersions(fakeFetch)
      expect(result).toEqual([...DEFAULT_PYTHON_VERSIONS])
    })

    it('returns default versions when API returns non-OK', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch
      const result = await listPythonVersions(fakeFetch)
      expect(result).toEqual([...DEFAULT_PYTHON_VERSIONS])
    })

    it('returns versions from API when successful', async () => {
      const mockData = [
        { cycle: '3.13', latest: '3.13.4', eol: '2029-10-01' },
        { cycle: '3.12', latest: '3.12.10', eol: '2028-10-01' },
      ]
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData,
      }) as unknown as typeof fetch
      const result = await listPythonVersions(fakeFetch)
      expect(result).toEqual(['3.13.4', '3.12.10'])
    })
  })
})
