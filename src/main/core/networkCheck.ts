/**
 * 在真实安装前探测官方下载地址的网络可达性。
 */

import type {
  AppPlatform,
  DownloadArtifact,
  NetworkCheckResult,
  NetworkCheckTarget,
  PluginExecutionInput,
  Primitive,
  ResolvedTemplate,
} from './contracts'
import { mapTemplateValuesToPluginParams } from './template'
import { planGitDownloads } from '../plugins/gitEnvPlugin'
import { planJavaDownloads } from '../plugins/javaEnvPlugin'
import { planNodeDownloads } from '../plugins/nodeEnvPlugin'
import { planPythonDownloads } from '../plugins/pythonEnvPlugin'
import { planMysqlDownloads } from '../plugins/mysqlEnvPlugin'
import { planRedisDownloads } from '../plugins/redisEnvPlugin'
import { planMavenDownloads } from '../plugins/mavenEnvPlugin'
import { createRuntimeCache } from './runtimeCache'

const DEFAULT_NETWORK_CHECK_TIMEOUT_MS = 5000
const NETWORK_RESULT_CACHE_TTL_MS = 60_000
const networkResultCache = createRuntimeCache<NetworkCheckResult>()

type TemplateNetworkCheckOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  platform?: AppPlatform
  gitBashMissing?: boolean
}

function resolveCurrentPlatform(): AppPlatform {
  return process.platform === 'win32' ? 'win32' : 'darwin'
}

function toPlannerInput(
  pluginId: string,
  values: Record<string, Primitive>,
  platform: AppPlatform,
): PluginExecutionInput {
  return {
    ...mapTemplateValuesToPluginParams(pluginId, values),
    platform,
    dryRun: true,
    locale: 'en',
  }
}

function planPluginDownloads(
  pluginId: string,
  values: Record<string, Primitive>,
  options: { platform: AppPlatform; gitBashMissing?: boolean },
): DownloadArtifact[] {
  const input = toPlannerInput(pluginId, values, options.platform)

  switch (pluginId) {
    case 'node-env':
      return planNodeDownloads(input)
    case 'java-env': {
      const downloads = planJavaDownloads(input)
      if (
        options.platform === 'win32' &&
        input.javaManager === 'sdkman' &&
        options.gitBashMissing === false
      ) {
        return downloads.filter((download) => download.tool !== 'git-for-windows')
      }
      return downloads
    }
    case 'python-env':
      return planPythonDownloads(input)
    case 'git-env':
      return planGitDownloads(input)
    case 'mysql-env':
      return planMysqlDownloads(input)
    case 'redis-env':
      return planRedisDownloads(input)
    case 'maven-env':
      return planMavenDownloads(input)
    default:
      return []
  }
}

export function collectTemplateDownloadArtifacts(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
  options: { platform?: AppPlatform; gitBashMissing?: boolean } = {},
): DownloadArtifact[] {
  const platform = options.platform ?? resolveCurrentPlatform()

  return template.plugins.flatMap((plugin) =>
    planPluginDownloads(plugin.pluginId, values, {
      platform,
      gitBashMissing: options.gitBashMissing,
    }),
  )
}

export function collectTemplateNetworkTargets(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
  options: { platform?: AppPlatform; gitBashMissing?: boolean } = {},
): NetworkCheckTarget[] {
  const downloads = collectTemplateDownloadArtifacts(template, values, options)
  const targetMap = new Map<string, NetworkCheckTarget>()

  for (const download of downloads) {
    const host = new URL(download.url).host
    const key = `${download.tool}:${download.url}`

    if (targetMap.has(key)) {
      continue
    }

    targetMap.set(key, {
      id: key,
      tool: download.tool,
      kind: download.kind,
      url: download.url,
      host,
      note: download.note,
    })
  }

  return [...targetMap.values()]
}

function formatProbeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `Timed out after ${timeoutMs}ms`
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // 只要响应头已经拿到，body 取消失败不影响连通性判断。
  }
}

async function probeTarget(
  target: NetworkCheckTarget,
  options: { fetchImpl: typeof fetch; timeoutMs: number },
): Promise<NetworkCheckResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    let response = await options.fetchImpl(target.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })

    if (!response.ok) {
      await cancelResponseBody(response)
      response = await options.fetchImpl(target.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      })
    }

    await cancelResponseBody(response)

    return {
      ...target,
      reachable: response.ok,
      durationMs: Date.now() - startedAt,
      statusCode: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ...target,
      reachable: false,
      durationMs: Date.now() - startedAt,
      error: formatProbeError(error, options.timeoutMs),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runNetworkChecks(
  targets: NetworkCheckTarget[],
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<NetworkCheckResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_NETWORK_CHECK_TIMEOUT_MS

  return Promise.all(
    targets.map((target) =>
      networkResultCache.getOrLoad(`${target.id}:${timeoutMs}`, NETWORK_RESULT_CACHE_TTL_MS, () =>
        probeTarget(target, { fetchImpl, timeoutMs }),
      ),
    ),
  )
}

export async function runTemplateNetworkChecks(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
  options: TemplateNetworkCheckOptions = {},
): Promise<NetworkCheckResult[]> {
  const targets = collectTemplateNetworkTargets(template, values, options)
  return runNetworkChecks(targets, options)
}
