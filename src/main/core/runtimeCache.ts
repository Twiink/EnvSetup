/**
 * 提供主进程内的轻量级运行时缓存。
 */

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

export type RuntimeCache<T> = {
  clear: () => void
  delete: (key: string) => void
  get: (key: string) => T | undefined
  getOrLoad: (key: string, ttlMs: number, loader: () => Promise<T>) => Promise<T>
  set: (key: string, value: T, ttlMs: number) => T
}

export function createRuntimeCache<T>(): RuntimeCache<T> {
  const entries = new Map<string, CacheEntry<T>>()
  const inFlight = new Map<string, Promise<T>>()

  function get(key: string): T | undefined {
    const entry = entries.get(key)
    if (!entry) {
      return undefined
    }

    if (entry.expiresAt <= Date.now()) {
      entries.delete(key)
      return undefined
    }

    return entry.value
  }

  return {
    clear() {
      entries.clear()
      inFlight.clear()
    },
    delete(key) {
      entries.delete(key)
      inFlight.delete(key)
    },
    get,
    async getOrLoad(key, ttlMs, loader) {
      const cached = get(key)
      if (cached !== undefined) {
        return cached
      }

      const pending = inFlight.get(key)
      if (pending) {
        return pending
      }

      const nextPromise = (async () => {
        const value = await loader()
        entries.set(key, { value, expiresAt: Date.now() + ttlMs })
        return value
      })()

      inFlight.set(key, nextPromise)
      try {
        return await nextPromise
      } finally {
        inFlight.delete(key)
      }
    },
    set(key, value, ttlMs) {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    },
  }
}
