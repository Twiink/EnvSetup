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

const REDIS_DIRECT_VERSION = '7.4.7'
const REDIS_DIRECT_ARCHIVE_URL = `https://download.redis.io/releases/redis-${REDIS_DIRECT_VERSION}.tar.gz`
const MEMURAI_WINDOWS_VERSION = '4.2.2'
const MEMURAI_REDIS_API_VERSION = '7.4.7'
const MEMURAI_INSTALLER_URL = `https://download.memurai.com/Memurai-Developer/${MEMURAI_WINDOWS_VERSION}/Memurai-for-Redis-v${MEMURAI_WINDOWS_VERSION}.msi`
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

function buildDirectArchiveFileName(input: RedisPluginParams): string {
  return input.platform === 'win32'
    ? `Memurai-for-Redis-v${MEMURAI_WINDOWS_VERSION}.msi`
    : `redis-${REDIS_DIRECT_VERSION}.tar.gz`
}

function buildDirectExtractedDirName(): string {
  return `redis-${REDIS_DIRECT_VERSION}`
}

function buildMemuraiCleanupCommand(installDir?: string): string {
  const removeInstallDir = installDir
    ? `if (Test-Path ${quotePowerShell(installDir)}) { Remove-Item -LiteralPath ${quotePowerShell(installDir)} -Recurse -Force -ErrorAction SilentlyContinue }`
    : undefined

  return [
    '$entries = @()',
    "foreach ($registryPath in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) { $entries += Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Memurai*' } }",
    '$entries = $entries | Sort-Object DisplayName -Unique',
    'foreach ($entry in $entries) {',
    '$command = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }',
    'if (-not $command) { continue }',
    "if ($command -match '\\{[A-Za-z0-9\\-]+\\}') { $productCode = $matches[0]; $process = Start-Process msiexec.exe -ArgumentList @('/x', $productCode, '/quiet', '/norestart') -Wait -PassThru; if ($process.ExitCode -ne 0) { throw \"Memurai uninstall failed with exit code $($process.ExitCode).\" } }",
    '}',
    removeInstallDir,
  ]
    .filter(Boolean)
    .join('; ')
}

function buildDownloadPlan(input: RedisPluginParams): DownloadArtifact[] {
  if (input.redisManager === 'redis') {
    return [
      {
        kind: input.platform === 'win32' ? 'installer' : 'archive',
        tool: 'redis',
        url: input.platform === 'win32' ? MEMURAI_INSTALLER_URL : REDIS_DIRECT_ARCHIVE_URL,
        official: true,
        fileName: buildDirectArchiveFileName(input),
        note:
          input.platform === 'win32'
            ? 'Download the Memurai Developer installer for Redis-compatible Windows direct install.'
            : 'Download the official Redis source archive for direct install.',
      },
    ]
  }

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

  if (input.redisManager !== 'redis' && input.redisManager !== 'package') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'redis-env 需要 redisManager=redis|package',
        en: 'redis-env requires redisManager=redis|package',
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
    redisManager: input.redisManager,
    installRootDir,
    platform: input.platform,
    dryRun: input.dryRun,
    locale,
    onProgress: input.onProgress,
    downloadCacheDir:
      typeof input.downloadCacheDir === 'string' ? input.downloadCacheDir : undefined,
  }
}

function buildDarwinDirectCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolveRedisInstallPaths(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'redis') ??
    `${installPaths.installRootDir}/${buildDirectArchiveFileName(input)}`
  const extractedDir = `${installPaths.installRootDir}/${buildDirectExtractedDirName()}`

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `rm -rf ${quoteShell(installPaths.standaloneRedisDir)} ${quoteShell(extractedDir)}`,
    `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.installRootDir)}`,
    `mv ${quoteShell(extractedDir)} ${quoteShell(installPaths.standaloneRedisDir)}`,
    `cd ${quoteShell(installPaths.standaloneRedisDir)} && make BUILD_TLS=no MALLOC=libc`,
    `export REDIS_HOME=${quoteShell(installPaths.standaloneRedisDir)} && export PATH="${installPaths.standaloneRedisBinDir}:$PATH" && redis-server --version`,
  ]
}

function buildDarwinPackageCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'homebrew') ??
    `${input.installRootDir}/homebrew-install.sh`

  const resolveBrewCmd = buildResolveHomebrewCommand()
  return [
    `${resolveBrewCmd}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash ${quoteShell(installerPath)}; ${resolveBrewCmd}; fi; if [ -z "$BREW_BIN" ]; then echo "Homebrew installation failed." >&2; exit 1; fi; HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" install redis`,
  ]
}

function buildWin32DirectCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolveRedisInstallPaths(input)
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'redis') ??
    `${installPaths.installRootDir}\\${buildDirectArchiveFileName(input)}`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `Remove-Item -LiteralPath ${quotePowerShell(installPaths.standaloneRedisDir)} -Recurse -Force -ErrorAction SilentlyContinue`,
    `$installDir = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.standaloneRedisDir)}); $process = Start-Process msiexec.exe -ArgumentList @('/i', ${quotePowerShell(installerPath)}, '/quiet', '/norestart', 'INSTALLFOLDER=' + $installDir, 'ADD_INSTALLFOLDER_TO_PATH=0', 'INSTALL_SERVICE=0', 'ADD_FIREWALL_RULE=0') -Wait -PassThru; if ($process.ExitCode -ne 0) { throw "Memurai install failed with exit code $($process.ExitCode)." }`,
    `$env:REDIS_HOME = ${quotePowerShell(installPaths.standaloneRedisDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneRedisDir)} + ';' + $env:Path; $redisCandidates = @((Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'memurai.exe'), (Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'memurai-cli.exe'), (Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'redis-server.exe'), (Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'redis-cli.exe')); $redisExe = $redisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $redisExe) { throw 'Failed to locate Memurai binaries after installation.' }; Write-Output 'Memurai for Redis installed'; Write-Output $redisExe`,
  ]
}

function buildWin32PackageCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'scoop') ??
    `${input.installRootDir}\\install.ps1`

  const resolveScoopCmd = buildResolveScoopCommand()
  return [
    `${resolveScoopCmd}; if (-not $scoop) { function Get-ExecutionPolicy { 'ByPass' }; & ${quotePowerShell(installerPath)} -RunAsAdmin:$false; ${resolveScoopCmd}; if (-not $scoop) { throw 'Scoop bootstrap failed.' } }; & $scoop install redis`,
  ]
}

function buildInstallCommands(
  input: RedisPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  if (input.redisManager === 'redis') {
    return input.platform === 'win32'
      ? buildWin32DirectCommands(input, resolvedDownloads)
      : buildDarwinDirectCommands(input, resolvedDownloads)
  }

  return input.platform === 'win32'
    ? buildWin32PackageCommands(input, resolvedDownloads)
    : buildDarwinPackageCommands(input, resolvedDownloads)
}

function buildDarwinVerifyCommands(input: RedisPluginParams): string[] {
  const installPaths = resolveRedisInstallPaths(input)

  if (input.redisManager === 'redis') {
    return [
      `export REDIS_HOME=${quoteShell(installPaths.standaloneRedisDir)} && export PATH="${installPaths.standaloneRedisBinDir}:$PATH" && redis-server --version`,
    ]
  }

  return [
    `${buildResolveHomebrewCommand()}; if [ -z "$BREW_BIN" ]; then echo "Homebrew not found." >&2; exit 1; fi; REDIS_BIN="$("$BREW_BIN" --prefix redis 2>/dev/null)/bin/redis-server"; if [ -x "$REDIS_BIN" ]; then "$REDIS_BIN" --version; else redis-server --version; fi`,
  ]
}

function buildWin32VerifyCommands(input: RedisPluginParams): string[] {
  const installPaths = resolveRedisInstallPaths(input)

  if (input.redisManager === 'redis') {
    return [
      `$env:REDIS_HOME = ${quotePowerShell(installPaths.standaloneRedisDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneRedisDir)} + ';' + $env:Path; $redisCandidates = @((Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'memurai.exe'), (Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'memurai-cli.exe'), (Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'redis-server.exe'), (Join-Path ${quotePowerShell(installPaths.standaloneRedisDir)} 'redis-cli.exe')); $redisExe = $redisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $redisExe) { throw 'Failed to locate Memurai binaries.' }; Write-Output 'Memurai for Redis installed'; Write-Output $redisExe`,
    ]
  }

  return [
    buildResolveScoopCommand(),
    "if (-not $scoop) { throw 'Scoop not found.' }",
    "$shimDir = Split-Path $scoop -Parent; $redisCandidates = @((Join-Path $shimDir 'redis-server.exe'), (Join-Path $shimDir 'redis-server.cmd'), (Join-Path $shimDir 'redis-cli.exe'), (Join-Path $shimDir 'redis-cli.cmd')); $redisBin = $redisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $redisBin) { throw 'Failed to locate Redis shim.' }; & $redisBin --version",
  ]
}

function buildVerifyCommands(input: RedisPluginParams): string[] {
  return input.platform === 'win32'
    ? buildWin32VerifyCommands(input)
    : buildDarwinVerifyCommands(input)
}

function buildRollbackCommands(input: RedisPluginParams): string[] {
  if (input.redisManager === 'redis') {
    return input.platform === 'win32'
      ? [buildMemuraiCleanupCommand(resolveRedisInstallPaths(input).standaloneRedisDir)]
      : []
  }

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
      const commandOutput = [
        error.stdout?.trim(),
        error.stderr?.trim(),
        error.message ?? String(err),
      ]
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
      `version=${params.redisManager === 'redis' ? (params.platform === 'win32' ? `memurai-${MEMURAI_WINDOWS_VERSION}` : REDIS_DIRECT_VERSION) : 'latest'}`,
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
      version:
        params.redisManager === 'redis'
          ? params.platform === 'win32'
            ? `memurai-${MEMURAI_WINDOWS_VERSION}`
            : REDIS_DIRECT_VERSION
          : 'latest',
      paths: {
        installRootDir: params.installRootDir,
        redisDir: installPaths.standaloneRedisDir,
        redisBinDir: installPaths.standaloneRedisBinDir,
      },
      envChanges,
      downloads,
      commands,
      rollbackCommands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the Redis environment.'
        : 'Completed the official-source Redis environment install commands.',
      context: {
        redisManager: params.redisManager,
        redisVersion:
          params.redisManager === 'redis'
            ? params.platform === 'win32'
              ? `memurai-${MEMURAI_WINDOWS_VERSION}`
              : REDIS_DIRECT_VERSION
            : 'latest',
        ...(params.platform === 'win32' && params.redisManager === 'redis'
          ? { redisApiVersion: MEMURAI_REDIS_API_VERSION }
          : {}),
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
                `计划安装的 Redis 管理方式：${params.redisManager}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned Redis manager: ${params.redisManager}`,
                `Planned tool install root: ${params.installRootDir}`,
                `Planned official download sources: ${downloads.map((download) => download.url).join(' | ')}`,
              ],
      }
    }

    return {
      status: 'verified_success',
      checks: await runCommands(buildVerifyCommands(params), params.platform, input.onProgress),
    }
  },
}

export default redisEnvPlugin
