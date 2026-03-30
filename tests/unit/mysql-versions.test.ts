/**
 * mysql-versions 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_MYSQL_LTS_VERSIONS, listMysqlVersions } from '../../src/main/core/mysqlVersions'

describe('mysqlVersions', () => {
  it('returns curated MySQL LTS versions', async () => {
    await expect(listMysqlVersions()).resolves.toEqual([...DEFAULT_MYSQL_LTS_VERSIONS])
  })
})
