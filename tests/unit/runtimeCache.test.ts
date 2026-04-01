/**
 * runtimeCache 模块的单元测试。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeCache } from '../../src/main/core/runtimeCache'

describe('createRuntimeCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('get returns undefined for missing key', () => {
    const cache = createRuntimeCache<string>()
    expect(cache.get('missing')).toBeUndefined()
  })

  it('set and get round-trip', () => {
    const cache = createRuntimeCache<number>()
    cache.set('a', 42, 5000)
    expect(cache.get('a')).toBe(42)
  })

  it('get returns undefined after TTL expires', () => {
    const cache = createRuntimeCache<string>()
    cache.set('key', 'value', 1000)

    vi.advanceTimersByTime(999)
    expect(cache.get('key')).toBe('value')

    vi.advanceTimersByTime(2)
    expect(cache.get('key')).toBeUndefined()
  })

  it('delete removes entry', () => {
    const cache = createRuntimeCache<string>()
    cache.set('key', 'value', 5000)
    cache.delete('key')
    expect(cache.get('key')).toBeUndefined()
  })

  it('clear removes all entries', () => {
    const cache = createRuntimeCache<string>()
    cache.set('a', '1', 5000)
    cache.set('b', '2', 5000)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  describe('getOrLoad', () => {
    it('calls loader on cache miss and caches the result', async () => {
      const cache = createRuntimeCache<string>()
      const loader = vi.fn().mockResolvedValue('loaded')

      const result = await cache.getOrLoad('key', 5000, loader)

      expect(result).toBe('loaded')
      expect(loader).toHaveBeenCalledOnce()
      expect(cache.get('key')).toBe('loaded')
    })

    it('returns cached value without calling loader on cache hit', async () => {
      const cache = createRuntimeCache<string>()
      cache.set('key', 'cached', 5000)
      const loader = vi.fn().mockResolvedValue('fresh')

      const result = await cache.getOrLoad('key', 5000, loader)

      expect(result).toBe('cached')
      expect(loader).not.toHaveBeenCalled()
    })

    it('deduplicates concurrent loads for the same key', async () => {
      const cache = createRuntimeCache<string>()
      let resolveLoader!: (value: string) => void
      const loader = vi.fn().mockReturnValue(
        new Promise<string>((resolve) => {
          resolveLoader = resolve
        }),
      )

      const promise1 = cache.getOrLoad('key', 5000, loader)
      const promise2 = cache.getOrLoad('key', 5000, loader)

      expect(loader).toHaveBeenCalledOnce()

      resolveLoader('deduped')
      const [r1, r2] = await Promise.all([promise1, promise2])

      expect(r1).toBe('deduped')
      expect(r2).toBe('deduped')
    })

    it('retries loader after a failed load', async () => {
      const cache = createRuntimeCache<string>()
      const loader = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('recovered')

      await expect(cache.getOrLoad('key', 5000, loader)).rejects.toThrow('fail')
      expect(cache.get('key')).toBeUndefined()

      const result = await cache.getOrLoad('key', 5000, loader)
      expect(result).toBe('recovered')
      expect(loader).toHaveBeenCalledTimes(2)
    })

    it('re-loads after TTL expires', async () => {
      const cache = createRuntimeCache<string>()
      const loader = vi
        .fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')

      await cache.getOrLoad('key', 1000, loader)
      expect(cache.get('key')).toBe('first')

      vi.advanceTimersByTime(1001)

      const result = await cache.getOrLoad('key', 1000, loader)
      expect(result).toBe('second')
      expect(loader).toHaveBeenCalledTimes(2)
    })

    it('concurrent waiters all receive the rejection when loader fails', async () => {
      const cache = createRuntimeCache<string>()
      let rejectLoader!: (err: Error) => void
      const loader = vi.fn().mockReturnValue(
        new Promise<string>((_resolve, reject) => {
          rejectLoader = reject
        }),
      )

      const promise1 = cache.getOrLoad('key', 5000, loader)
      const promise2 = cache.getOrLoad('key', 5000, loader)

      rejectLoader(new Error('boom'))

      await expect(promise1).rejects.toThrow('boom')
      await expect(promise2).rejects.toThrow('boom')
    })
  })
})
