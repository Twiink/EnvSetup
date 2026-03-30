/**
 * redis-versions 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REDIS_MACOS_VERSIONS,
  DEFAULT_REDIS_WINDOWS_VERSIONS,
  listRedisVersions,
} from '../../src/main/core/redisVersions'

describe('redisVersions', () => {
  it('returns curated Redis versions for darwin', async () => {
    await expect(listRedisVersions('darwin')).resolves.toEqual([...DEFAULT_REDIS_MACOS_VERSIONS])
  })

  it('returns curated Redis versions for win32', async () => {
    await expect(listRedisVersions('win32')).resolves.toEqual([...DEFAULT_REDIS_WINDOWS_VERSIONS])
  })
})
