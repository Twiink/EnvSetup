/**
 * networkCheck 模块的单元测试。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { NetworkCheckTarget, ResolvedTemplate } from '../../src/main/core/contracts'
import { downloadArtifacts } from '../../src/main/core/download'
import {
  collectTemplateDownloadArtifacts,
  collectTemplateNetworkTargets,
  runNetworkChecks,
  runTemplateNetworkChecks,
} from '../../src/main/core/networkCheck'

function makeTemplate(pluginId: string): ResolvedTemplate {
  return {
    id: `${pluginId}-template`,
    name: { 'zh-CN': '模板', en: 'Template' },
    version: '0.1.0',
    platforms: ['darwin', 'win32'],
    description: { 'zh-CN': '描述', en: 'Description' },
    plugins: [{ pluginId, version: '0.1.0' }],
    defaults: {},
    overrides: {},
    checks: [],
    fields: {},
  }
}

describe('networkCheck', () => {
  it('collects the real node nvm download targets from the plugin plan', () => {
    const targets = collectTemplateNetworkTargets(
      makeTemplate('node-env'),
      {
        'node.nodeManager': 'nvm',
        'node.nodeVersion': '20.11.1',
        'node.installRootDir': '/tmp/toolchain',
        'node.npmCacheDir': '/tmp/npm-cache',
        'node.npmGlobalPrefix': '/tmp/npm-global',
      },
      { platform: 'darwin' },
    )

    expect(targets.map((target) => target.tool)).toEqual(['nvm', 'node'])
    expect(targets.map((target) => target.host)).toEqual(['github.com', 'nodejs.org'])
  })

  it('collects the MySQL direct-install probe target on macOS', () => {
    const targets = collectTemplateNetworkTargets(
      makeTemplate('mysql-env'),
      {
        'mysql.mysqlManager': 'mysql',
        'mysql.installRootDir': '/tmp/mysql-toolchain',
      },
      { platform: 'darwin' },
    )

    expect(targets).toEqual([
      expect.objectContaining({
        tool: 'mysql',
        host: 'cdn.mysql.com',
      }),
    ])
  })

  it('collects the Redis direct-install probe target on Windows', () => {
    const targets = collectTemplateNetworkTargets(
      makeTemplate('redis-env'),
      {
        'redis.redisManager': 'redis',
        'redis.installRootDir': 'C:\\envsetup\\redis',
      },
      { platform: 'win32' },
    )

    expect(targets).toEqual([
      expect.objectContaining({
        tool: 'redis',
        host: 'www.memurai.com',
      }),
    ])
  })

  it('collects the Maven package-manager probe target from the official Homebrew host', () => {
    const targets = collectTemplateNetworkTargets(
      makeTemplate('maven-env'),
      {
        'maven.mavenManager': 'package',
        'maven.installRootDir': '/tmp/maven-toolchain',
      },
      { platform: 'darwin' },
    )

    expect(targets).toEqual([
      expect.objectContaining({
        tool: 'homebrew',
        host: 'raw.githubusercontent.com',
      }),
    ])
  })

  it('skips the optional Git for Windows probe when SDKMAN already has Git Bash', () => {
    const targets = collectTemplateNetworkTargets(
      makeTemplate('java-env'),
      {
        'java.javaManager': 'sdkman',
        'java.javaVersion': '21',
        'java.installRootDir': '/tmp/java-toolchain',
      },
      {
        platform: 'win32',
        gitBashMissing: false,
      },
    )

    expect(targets.some((target) => target.tool === 'git-for-windows')).toBe(false)
    expect(targets.some((target) => target.tool === 'sdkman-cli')).toBe(true)
    expect(targets.some((target) => target.tool === 'sdkman-native')).toBe(false)
  })

  it('falls back to GET when HEAD is rejected and reports success', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const [result] = await runNetworkChecks(
      [
        {
          id: 'node:https://nodejs.org/dist/index.json',
          tool: 'node',
          kind: 'archive',
          host: 'nodejs.org',
          url: 'https://nodejs.org/dist/index.json',
        },
      ],
      { fetchImpl },
    )

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://nodejs.org/dist/index.json',
      expect.objectContaining({ method: 'HEAD' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://nodejs.org/dist/index.json',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result.reachable).toBe(true)
    expect(result.statusCode).toBe(200)
  })

  it('reports an unreachable target when the probe throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ENOTFOUND'))
    const target: NetworkCheckTarget = {
      id: 'python:https://www.python.org/ftp/python',
      tool: 'python',
      kind: 'archive',
      host: 'www.python.org',
      url: 'https://www.python.org/ftp/python',
    }

    const [result] = await runNetworkChecks([target], { fetchImpl, timeoutMs: 50 })

    expect(result.reachable).toBe(false)
    expect(result.error).toContain('ENOTFOUND')
  })

  it('treats cached Redis direct downloads as reachable without probing the network', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'envsetup-network-cache-'))
    const template = makeTemplate('redis-env')
    const values = {
      'redis.redisManager': 'redis',
      'redis.installRootDir': 'C:\\envsetup\\redis',
    }
    const downloads = collectTemplateDownloadArtifacts(template, values, { platform: 'win32' })

    const downloadFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: 'https://download.memurai.com/Memurai-Developer/4.2.2/Memurai-for-Redis-v4.2.2.msi?Expires=123',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('signed-installer-content'), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      )

    await downloadArtifacts({ downloads, cacheDir, fetchImpl: downloadFetch })

    const probeFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('probe should not run'))
    const [result] = await runTemplateNetworkChecks(template, values, {
      platform: 'win32',
      downloadCacheDir: cacheDir,
      fetchImpl: probeFetch,
    })

    expect(result).toEqual(
      expect.objectContaining({
        tool: 'redis',
        host: 'www.memurai.com',
        reachable: true,
        statusCode: 200,
      }),
    )
    expect(result.durationMs).toBe(0)
    expect(probeFetch).not.toHaveBeenCalled()
  })
})
