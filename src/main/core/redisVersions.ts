/**
 * 返回当前平台可用的 Redis 版本列表。
 */

type RedisPlatform = 'darwin' | 'win32'

function currentPlatform(): RedisPlatform {
  return process.platform === 'win32' ? 'win32' : 'darwin'
}

export const DEFAULT_REDIS_MACOS_VERSIONS = ['7.4.7', '7.4.6'] as const
export const DEFAULT_REDIS_WINDOWS_VERSIONS = ['7.4.7'] as const

export async function listRedisVersions(
  platform: RedisPlatform = currentPlatform(),
): Promise<string[]> {
  return platform === 'win32'
    ? [...DEFAULT_REDIS_WINDOWS_VERSIONS]
    : [...DEFAULT_REDIS_MACOS_VERSIONS]
}
