/**
 * 实现 Redis 在各平台上的一键安装与校验策略。
 */

import { buildRedisEnvChanges, resolveRedisInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import { execFileAsync } from '../core/exec'
import { executePlatformCommand, isPermissionError } from '../core/elevation'
import { DEFAULT_REDIS_MACOS_VERSIONS, DEFAULT_REDIS_WINDOWS_VERSIONS } from '../core/redisVersions'
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

const MEMURAI_LTS_RELEASES = {
  '7.4.7': {
    memuraiVersion: '4.2.2',
    requestAlias: 'windows-redis',
  },
} as const
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

function buildWindowsAdministratorCheck(message: string): string {
  return [
    '$isAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    `if (-not $isAdministrator) { throw '${message.replace(/'/g, "''")}' }`,
  ].join('; ')
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

function resolveSelectedRedisVersion(input: RedisPluginParams): string {
  return (
    input.redisVersion ??
    (input.platform === 'win32'
      ? DEFAULT_REDIS_WINDOWS_VERSIONS[0]
      : DEFAULT_REDIS_MACOS_VERSIONS[0])
  )
}

function resolveMemuraiRelease(redisVersion: string) {
  return MEMURAI_LTS_RELEASES[redisVersion as keyof typeof MEMURAI_LTS_RELEASES]
}

function resolveRedisHomebrewFormula(_input: RedisPluginParams): string {
  return 'redis'
}

function resolveRedisScoopPackage(input: RedisPluginParams): string {
  return `redis@${resolveSelectedRedisVersion(input)}`
}

function buildRedisDirectArchiveUrl(input: RedisPluginParams): string {
  const selectedVersion = resolveSelectedRedisVersion(input)

  if (input.platform === 'win32') {
    const memuraiRelease = resolveMemuraiRelease(selectedVersion)
    if (!memuraiRelease) {
      throw new Error(`Unsupported Redis direct version for win32: ${selectedVersion}`)
    }

    return `https://www.memurai.com/api/request-download-link?version=${memuraiRelease.requestAlias}`
  }

  return `https://download.redis.io/releases/redis-${selectedVersion}.tar.gz`
}

function buildResolveHomebrewCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if (-not $scoop) { $scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if ($scoop -and -not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }"
}

function buildResolveScoopRedisCommandFunction(): string {
  return [
    'function Get-ScoopRedisCommand {',
    'param([string]$ScoopPath)',
    "$shimNames = @('redis-server.exe', 'redis-server.cmd', 'redis-server', 'redis-cli.exe', 'redis-cli.cmd', 'redis-cli')",
    '$rawPrefix = & $ScoopPath prefix redis 2>$null | Select-Object -First 1',
    'if ($rawPrefix) {',
    '$prefix = $rawPrefix.ToString().Trim()',
    'if ($prefix -and [System.IO.Path]::IsPathRooted($prefix) -and (Test-Path $prefix)) {',
    '$candidates = $shimNames | ForEach-Object { Join-Path $prefix $_ }',
    '$command = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1',
    'if ($command) { return [System.IO.Path]::GetFullPath($command) }',
    '}',
    '}',
    '$shimDirs = @()',
    '$shimDirs += Split-Path $ScoopPath -Parent',
    "if ($env:SCOOP) { $shimDirs += Join-Path $env:SCOOP 'shims' }",
    "$shimDirs += Join-Path (Join-Path $env:USERPROFILE 'scoop') 'shims'",
    '$shimDirs = $shimDirs | Where-Object { $_ } | Select-Object -Unique',
    'foreach ($shimDir in $shimDirs) {',
    '$candidates = $shimNames | Where-Object { $_ -like "*.exe" -or $_ -like "*.cmd" } | ForEach-Object { Join-Path $shimDir $_ }',
    '$command = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1',
    'if ($command) { return [System.IO.Path]::GetFullPath($command) }',
    '}',
    'return $null',
    '}',
  ].join('\n')
}

function buildDirectArchiveFileName(input: RedisPluginParams): string {
  const selectedVersion = resolveSelectedRedisVersion(input)

  return input.platform === 'win32'
    ? `Memurai-for-Redis-v${resolveMemuraiRelease(selectedVersion)?.memuraiVersion ?? 'unknown'}.msi`
    : `redis-${selectedVersion}.tar.gz`
}

function buildDirectExtractedDirName(input: RedisPluginParams): string {
  return `redis-${resolveSelectedRedisVersion(input)}`
}

function buildMemuraiCleanupCommand(installDir?: string): string {
  const removeInstallDir = installDir
    ? `if (Test-Path ${quotePowerShell(installDir)}) { Remove-Item -LiteralPath ${quotePowerShell(installDir)} -Recurse -Force -ErrorAction SilentlyContinue }`
    : undefined
  const requireAdmin = buildWindowsAdministratorCheck(
    'Memurai uninstall requires administrator privileges.',
  )

  return [
    requireAdmin,
    '$entries = @()',
    "foreach ($registryPath in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) { $entries += Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Memurai*' } }",
    '$entries = $entries | Sort-Object DisplayName -Unique',
    'foreach ($entry in $entries) {',
    '$command = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }',
    'if (-not $command) { continue }',
    'if ($command -match \'\\{[A-Za-z0-9\\-]+\\}\') { $productCode = $matches[0]; $uninstallCommand = (\'msiexec.exe /quiet /x "{0}" /norestart\' -f $productCode); & cmd.exe /d /s /c $uninstallCommand; $uninstallExitCode = $LASTEXITCODE; if ($uninstallExitCode -ne 0 -and $uninstallExitCode -ne 1641 -and $uninstallExitCode -ne 3010) { throw "Memurai uninstall failed with exit code $($uninstallExitCode)." } }',
    '}',
    removeInstallDir,
  ]
    .filter(Boolean)
    .join('; ')
}

function buildDownloadPlan(input: RedisPluginParams): DownloadArtifact[] {
  if (input.redisManager === 'redis') {
    const selectedVersion = resolveSelectedRedisVersion(input)

    return [
      {
        kind: input.platform === 'win32' ? 'installer' : 'archive',
        tool: 'redis',
        url: buildRedisDirectArchiveUrl(input),
        official: true,
        fileName: buildDirectArchiveFileName(input),
        note:
          input.platform === 'win32'
            ? `Download the Memurai Developer installer compatible with Redis ${selectedVersion}.`
            : `Download the official Redis ${selectedVersion} source archive for direct install.`,
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
    redisVersion:
      typeof input.redisVersion === 'string' && input.redisVersion.length > 0
        ? input.redisVersion
        : undefined,
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
  const extractedDir = `${installPaths.installRootDir}/${buildDirectExtractedDirName(input)}`

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
  const formula = resolveRedisHomebrewFormula(input)
  return [
    `${resolveBrewCmd}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash ${quoteShell(installerPath)}; ${resolveBrewCmd}; fi; if [ -z "$BREW_BIN" ]; then echo "Homebrew installation failed." >&2; exit 1; fi; REDIS_FORMULA=${quoteShell(formula)}; if ! "$BREW_BIN" list --versions "$REDIS_FORMULA" >/dev/null 2>&1; then HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" install --formula "$REDIS_FORMULA"; fi`,
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
    `if (Test-Path ${quotePowerShell(installPaths.standaloneRedisDir)}) { Remove-Item -LiteralPath ${quotePowerShell(installPaths.standaloneRedisDir)} -Recurse -Force -ErrorAction SilentlyContinue }`,
    `${buildWindowsAdministratorCheck('Memurai setup requires administrator privileges.')}; $installDir = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.standaloneRedisDir)}); $installer = [System.IO.Path]::GetFullPath(${quotePowerShell(installerPath)}); $msiLogPath = Join-Path ([System.IO.Path]::GetTempPath()) 'envsetup-memurai-install.log'; if (Test-Path $msiLogPath) { Remove-Item -LiteralPath $msiLogPath -Force -ErrorAction SilentlyContinue }; $installCommand = ('msiexec.exe /quiet /i "{0}" INSTALLFOLDER="{1}" ADD_INSTALLFOLDER_TO_PATH=0 INSTALL_SERVICE=0 ADD_FIREWALL_RULE=0 /norestart /l*v "{2}"' -f $installer, $installDir, $msiLogPath); & cmd.exe /d /s /c $installCommand; $msiExitCode = $LASTEXITCODE; if ($msiExitCode -ne 0 -and $msiExitCode -ne 1641 -and $msiExitCode -ne 3010) { $msiLogTail = if (Test-Path $msiLogPath) { (Get-Content -LiteralPath $msiLogPath -Tail 80 | Out-String).Trim() } else { '' }; if ($msiLogTail) { throw ('Memurai install failed with exit code {0}. MSI log tail:{1}{2}' -f $msiExitCode, [System.Environment]::NewLine, $msiLogTail) }; throw "Memurai install failed with exit code $($msiExitCode)." }`,
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
  const packageToken = resolveRedisScoopPackage(input)
  return [
    `${resolveScoopCmd}; if (-not $scoop) { function Get-ExecutionPolicy { 'ByPass' }; & ${quotePowerShell(installerPath)} -RunAsAdmin:$false; ${resolveScoopCmd}; if (-not $scoop) { throw 'Scoop bootstrap failed.' } }; & $scoop install ${packageToken}`,
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

  const formula = resolveRedisHomebrewFormula(input)
  return [
    `${buildResolveHomebrewCommand()}; if [ -z "$BREW_BIN" ]; then echo "Homebrew not found." >&2; exit 1; fi; REDIS_BIN="$("$BREW_BIN" --prefix ${formula} 2>/dev/null)/bin/redis-server"; if [ -x "$REDIS_BIN" ]; then "$REDIS_BIN" --version; else redis-server --version; fi`,
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
    `${buildResolveScoopRedisCommandFunction()}\n${buildResolveScoopCommand()}\nif (-not $scoop) { throw 'Scoop not found.' }\n$redisBin = Get-ScoopRedisCommand $scoop\nif (-not $redisBin) { throw 'Failed to locate Redis command from Scoop install.' }\n& $redisBin --version`,
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
    const formula = resolveRedisHomebrewFormula(input)
    return [
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions ${formula} >/dev/null 2>&1 && HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" uninstall --formula ${formula} || true; fi`,
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
  signal?: AbortSignal,
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
            ], { signal })
          : await execFileAsync('/bin/sh', ['-c', command], { signal })
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
      if (platform === 'win32' && isPermissionError(err)) {
        const elevatedResult = await executePlatformCommand(command, 'win32', {
          elevated: true,
          signal,
        })
        if (elevatedResult.stdout.trim()) output.push(elevatedResult.stdout.trim())
        if (elevatedResult.stderr.trim()) output.push(`stderr: ${elevatedResult.stderr.trim()}`)
        onProgress?.({
          taskId: '',
          pluginId,
          type: 'command_done',
          message: command,
          commandIndex: index + 1,
          commandTotal: commands.length,
          output: [elevatedResult.stdout.trim(), elevatedResult.stderr.trim()]
            .filter(Boolean)
            .join('\n'),
          timestamp: new Date().toISOString(),
        })
        continue
      }

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
      `version=${resolveSelectedRedisVersion(params)}`,
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
      logs.push(...(await runCommands(commands, params.platform, input.onProgress, input.signal)))
      appendPhaseLog(logs, 'install_commands', commandStartedAt, `commands=${commands.length}`)
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: resolveSelectedRedisVersion(params),
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
        redisVersion: resolveSelectedRedisVersion(params),
        ...(params.platform === 'win32' && params.redisManager === 'redis'
          ? {
              memuraiVersion: resolveMemuraiRelease(resolveSelectedRedisVersion(params))
                ?.memuraiVersion,
              redisApiVersion: resolveSelectedRedisVersion(params),
            }
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
      checks: await runCommands(
        buildVerifyCommands(params),
        params.platform,
        input.onProgress,
        input.signal,
      ),
    }
  },
}

export default redisEnvPlugin
