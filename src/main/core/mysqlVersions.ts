/**
 * 返回当前支持的 MySQL LTS 版本列表。
 */

export const DEFAULT_MYSQL_LTS_VERSIONS = ['8.4.8', '8.4.7'] as const

export async function listMysqlVersions(): Promise<string[]> {
  return [...DEFAULT_MYSQL_LTS_VERSIONS]
}
