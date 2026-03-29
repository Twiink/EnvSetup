/**
 * 实现 Redis 在各平台上的一键安装与校验策略。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildRedisEnvChanges, resolveRedisInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import type {
  AppLocale,
  DownloadArtifact,
  DownloadResolvedArtifact,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  RedisPluginParams,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const HOMEBREW_INSTALL_URL = 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'
const SCOOP_INSTALL_URL = 'https://get.scoop.sh'

function translate(locale: AppLocale, text: { 'zh-CN': string; en: string }): string {
  return text[locale]
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quotePowerShell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function resolveDownloadedArtifactPath(
  resolvedDownloads: DownloadResolvedArtifact[] | undefined,
  tool: DownloadArtifact['tool'],
): string | undefined {
  return resolvedDownloads?.find((item) => item.artifact.tool === tool)?.localPath
}

function appendPhaseLog(logs: string[], phase: string, startedAt: number, detail?: string): void {
  const suffix = detail ? ` ${detail}` : ''
  logs.push(`phase=${phase} durationMs=${Date.now() - startedAt}${suffix}`)
}

function buildResolveHomebrewCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if (-not $scoop) { $scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }"
}

function buildDownloadPlan(input: RedisPluginParams): DownloadArtifact[] {
  return [
    input.platform === 'darwin'
      ? {
          kind: 'installer',
          tool: 'homebrew',
          url: HOMEBREW_INSTALL_URL,
          official: true,
          fileName: 'homebrew-install.sh',
          note: 'Download the official Homebrew install script used to install Redis.',
        }
      : {
          kind: 'installer',
          tool: 'scoop',
          url: SCOOP_INSTALL_URL,
          official: true,
          fileName: 'install.ps1',
          note: 'Download the official Scoop install script used to install Redis.',
        },
  ]
}

export function planRedisDownloads(input: PluginExecutionInput): DownloadArtifact[] {
  const params = toRedisParams(input)
  const downloads = buildDownloadPlan(params)
  validateOfficialDownloads(downloads)
  return downloads
}

function toRedisParams(input: PluginExecutionInput): RedisPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (input.redisManager !== 'package') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'redis-env 需要 redisManager=package',
        en: 'redis-env requires redisManager=package',
      }),
    )
  }

  const installRootDir =
    typeof input.installRootDir === 'string' && input.installRootDir.length > 0
      ? input.installRootDir
      : (process.env.ENVSETUP_INSTALL_ROOT ?? '')

  if (installRootDir.length === 0) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'redis-env 缺少工具安装根目录',
        en: 'redis-env requires an install root directory',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'redis-env 仅支持 darwin 和 win32',
        en: 'redis-env supports only darwin and win32',
      }),
    )
  }

  return {
    redisManager: 'package',
    installRootDir,
    platform: input.platform,
    dryRun: input.dryRun,
    locale,
    onProgress: input.onProgress,
    downloadCacheDir:
      typeof input.downloadCacheDir === 'string' ? input.downloadCacheDir : undefined,
  }
}

function buildDarwinInstallCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'homebrew') ??
    `${input.installRootDir}/homebrew-install.sh`

  return [
    buildResolveHomebrewCommand(),
    `if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash ${quoteShell(installerPath)}; fi`,
    buildResolveHomebrewCommand(),
    'if [ -z "$BREW_BIN" ]; then echo "Homebrew installation failed." >&2; exit 1; fi',
    'HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" install redis',
  ]
}

function buildWin32InstallCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'scoop') ?? `${input.installRootDir}\\install.ps1`

  return [
    buildResolveScoopCommand(),
    `if (-not $scoop) { function Get-ExecutionPolicy { 'ByPass' }; & ${quotePowerShell(installerPath)} -RunAsAdmin:$false; ${buildResolveScoopCommand()}; if (-not $scoop) { throw 'Scoop bootstrap failed.' } }`,
    '& $scoop install redis',
  ]
}

function buildInstallCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  return input.platform === 'win32'
    ? buildWin32InstallCommands(input, resolvedDownloads)
    : buildDarwinInstallCommands(input, resolvedDownloads)
}

function buildDarwinVerifyCommands(): string[] {
  return [
    buildResolveHomebrewCommand(),
    'if [ -z "$BREW_BIN" ]; then echo "Homebrew not found." >&2; exit 1; fi',
    'REDIS_BIN="$("$BREW_BIN" --prefix redis 2>/dev/null)/bin/redis-server"; if [ -x "$REDIS_BIN" ]; then "$REDIS_BIN" --version; else redis-server --version; fi',
  ]
}

function buildWin32VerifyCommands(): string[] {
  return [
    buildResolveScoopCommand(),
    "if (-not $scoop) { throw 'Scoop not found.' }",
    "$shimDir = Split-Path $scoop -Parent; $redisCandidates = @((Join-Path $shimDir 'redis-server.exe'), (Join-Path $shimDir 'redis-server.cmd'), (Join-Path $shimDir 'redis-cli.exe'), (Join-Path $shimDir 'redis-cli.cmd')); $redisBin = $redisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $redisBin) { throw 'Failed to locate Redis shim.' }; & $redisBin --version",
  ]
}

function buildVerifyCommands(input: RedisPluginParams): string[] {
  return input.platform === 'win32' ? buildWin32VerifyCommands() : buildDarwinVerifyCommands()
}

function buildRollbackCommands(input: RedisPluginParams): string[] {
  if (input.platform === 'darwin') {
    return [
      'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions redis >/dev/null 2>&1 && HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" uninstall --formula redis || true; fi',
    ]
  }

  return [
    `${buildResolveScoopCommand()}; if ($scoop) { & $scoop uninstall redis *> $null; $shimDir = Split-Path $scoop -Parent; foreach ($shimName in @('redis-server.exe', 'redis-server.cmd', 'redis-cli.exe', 'redis-cli.cmd')) { $shimPath = Join-Path $shimDir $shimName; if (Test-Path $shimPath) { Remove-Item -LiteralPath $shimPath -Force } } }`,
  ]
}

async function runCommands(
  commands: string[],
  platform: RedisPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'redis-env',
): Promise<string[]> {
  const output: string[] = []

  for (const [index, command] of commands.entries()) {
    onProgress?.({
      taskId: '',
      pluginId,
      type: 'command_start',
      message: command,
      commandIndex: index + 1,
      commandTotal: commands.length,
      timestamp: new Date().toISOString(),
    })

    try {
      const result =
        platform === 'win32'
          ? await execFileAsync('powershell', [
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              command,
            ])
          : await execFileAsync('/bin/sh', ['-c', command])
      if (result.stdout.trim()) output.push(result.stdout.trim())
      if (result.stderr.trim()) output.push(`stderr: ${result.stderr.trim()}`)
      onProgress?.({
        taskId: '',
        pluginId,
        type: 'command_done',
        message: command,
        commandIndex: index + 1,
        commandTotal: commands.length,
        output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n'),
        timestamp: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      const commandOutput = [error.stdout?.trim(), error.stderr?.trim(), error.message ?? String(err)]
        .filter(Boolean)
        .join('\n')
      onProgress?.({
        taskId: '',
        pluginId,
        type: 'command_error',
        message: command,
        commandIndex: index + 1,
        commandTotal: commands.length,
        output: commandOutput,
        timestamp: new Date().toISOString(),
      })
      throw Object.assign(new Error(error.message ?? String(err)), { commandOutput })
    }
  }

  return output
}

const redisEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toRedisParams(input)
    const installPaths = resolveRedisInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const envChanges = buildRedisEnvChanges(params)
    const rollbackCommands = buildRollbackCommands(params)
    let commands = buildInstallCommands(params)

    validateOfficialDownloads(downloads)

    const logs = [
      `manager=${params.redisManager}`,
      `platform_manager=${params.platform === 'darwin' ? 'homebrew' : 'scoop'}`,
      `installRoot=${params.installRootDir}`,
      `mode=${params.dryRun ? 'dry-run' : 'real-run'}`,
    ]

    if (!params.dryRun) {
      if (!params.downloadCacheDir) {
        throw Object.assign(new Error('Download cache directory is required for real-run'), {
          code: 'DOWNLOAD_FAILED',
        })
      }

      const downloadStartedAt = Date.now()
      const resolvedDownloads = await downloadArtifacts({
        downloads,
        cacheDir: params.downloadCacheDir,
      })
      logs.push(
        ...resolvedDownloads.map(
          (item) =>
            `download_cache_hit=${item.cacheHit} ${item.artifact.url} localPath=${item.localPath}`,
        ),
      )
      appendPhaseLog(logs, 'download', downloadStartedAt, `artifacts=${resolvedDownloads.length}`)

      commands = buildInstallCommands(params, resolvedDownloads)
      const commandStartedAt = Date.now()
      logs.push(...(await runCommands(commands, params.platform, input.onProgress)))
      appendPhaseLog(logs, 'install_commands', commandStartedAt, `commands=${commands.length}`)
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: 'latest',
      paths: {
        installRootDir: params.installRootDir,
        homebrewDir: installPaths.homebrewDir,
        scoopDir: installPaths.scoopDir,
      },
      envChanges,
      downloads,
      commands,
      rollbackCommands,
      logs,
      summary: params.dryRun
        ? 'Prepared a dry-run plan for the Redis environment through the platform package manager.'
        : 'Completed the Redis environment install commands through the platform package manager.',
      context: {
        redisManager: params.redisManager,
        platformManager: params.platform === 'darwin' ? 'homebrew' : 'scoop',
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toRedisParams(input)
    const locale = input.locale ?? DEFAULT_LOCALE
    const downloads = buildDownloadPlan(params)

    validateOfficialDownloads(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划使用的平台包管理器：${params.platform === 'darwin' ? 'Homebrew' : 'Scoop'}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned platform package manager: ${params.platform === 'darwin' ? 'Homebrew' : 'Scoop'}`,
                `Planned tool install root: ${params.installRootDir}`,
                `Planned official download sources: ${downloads.map((download) => download.url).join(' | ')}`,
              ],
      }
    }

    const verifyOutput = await runCommands(
      buildVerifyCommands(params),
      params.platform,
      input.onProgress,
    )

    return {
      status: 'verified_success',
      checks: [
        ...(locale === 'zh-CN'
          ? [`已校验 Redis 安装命令可用`, `已校验工具安装根目录：${params.installRootDir}`]
          : [`Verified Redis installation command availability`, `Verified tool install root: ${params.installRootDir}`]),
        ...verifyOutput,
      ],
    }
  },
}

export default redisEnvPlugin
