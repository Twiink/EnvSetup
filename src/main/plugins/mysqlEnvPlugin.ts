/**
 * 实现 MySQL 在各平台上的一键安装与校验策略。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildMysqlEnvChanges, resolveMysqlInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import { DEFAULT_MYSQL_LTS_VERSIONS } from '../core/mysqlVersions'
import type {
  AppLocale,
  DownloadArtifact,
  DownloadResolvedArtifact,
  MysqlPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const MYSQL_MACOS_ARCHIVE_BASE_URL = 'https://cdn.mysql.com/Downloads'
const MYSQL_WINDOWS_ARCHIVE_BASE_URL = 'https://dev.mysql.com/get/Downloads'
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

function resolveSelectedMysqlVersion(input: MysqlPluginParams): string {
  return input.mysqlVersion ?? DEFAULT_MYSQL_LTS_VERSIONS[0]
}

function resolveMysqlSeries(version: string): string {
  return version.split('.').slice(0, 2).join('.')
}

function resolveMysqlHomebrewFormula(input: MysqlPluginParams): string {
  return `mysql@${resolveSelectedMysqlVersion(input)}`
}

function resolveMysqlScoopPackage(input: MysqlPluginParams): string {
  return `mysql@${resolveSelectedMysqlVersion(input)}`
}

function buildResolveHomebrewCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if (-not $scoop) { $scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if ($scoop -and -not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }"
}

function buildDirectArchiveFileName(input: MysqlPluginParams): string {
  const selectedVersion = resolveSelectedMysqlVersion(input)

  if (input.platform === 'win32') {
    return `mysql-${selectedVersion}-winx64.zip`
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  return `mysql-${selectedVersion}-macos15-${arch}.tar.gz`
}

function buildDirectArchiveUrl(input: MysqlPluginParams): string {
  const mysqlSeries = resolveMysqlSeries(resolveSelectedMysqlVersion(input))
  const baseUrl =
    input.platform === 'darwin'
      ? `${MYSQL_MACOS_ARCHIVE_BASE_URL}/MySQL-${mysqlSeries}`
      : `${MYSQL_WINDOWS_ARCHIVE_BASE_URL}/MySQL-${mysqlSeries}`

  return `${baseUrl}/${buildDirectArchiveFileName(input)}`
}

function buildDirectExtractedDirName(input: MysqlPluginParams): string {
  return buildDirectArchiveFileName(input).replace(/\.tar\.gz$|\.zip$/u, '')
}

function buildDownloadPlan(input: MysqlPluginParams): DownloadArtifact[] {
  if (input.mysqlManager === 'mysql') {
    return [
      {
        kind: 'archive',
        tool: 'mysql',
        url: buildDirectArchiveUrl(input),
        official: true,
        fileName: buildDirectArchiveFileName(input),
        note:
          input.platform === 'darwin'
            ? 'Download the official MySQL Community Server macOS archive.'
            : 'Download the official MySQL Community Server Windows noinstall archive.',
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
          note: 'Download the official Homebrew install script used to install MySQL.',
        }
      : {
          kind: 'installer',
          tool: 'scoop',
          url: SCOOP_INSTALL_URL,
          official: true,
          fileName: 'install.ps1',
          note: 'Download the official Scoop install script used to install MySQL.',
        },
  ]
}

export function planMysqlDownloads(input: PluginExecutionInput): DownloadArtifact[] {
  const params = toMysqlParams(input)
  const downloads = buildDownloadPlan(params)
  validateOfficialDownloads(downloads)
  return downloads
}

function toMysqlParams(input: PluginExecutionInput): MysqlPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (input.mysqlManager !== 'mysql' && input.mysqlManager !== 'package') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'mysql-env 需要 mysqlManager=mysql|package',
        en: 'mysql-env requires mysqlManager=mysql|package',
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
        'zh-CN': 'mysql-env 缺少工具安装根目录',
        en: 'mysql-env requires an install root directory',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'mysql-env 仅支持 darwin 和 win32',
        en: 'mysql-env supports only darwin and win32',
      }),
    )
  }

  return {
    mysqlManager: input.mysqlManager,
    mysqlVersion:
      typeof input.mysqlVersion === 'string' && input.mysqlVersion.length > 0
        ? input.mysqlVersion
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
  input: MysqlPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolveMysqlInstallPaths(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'mysql') ??
    `${installPaths.installRootDir}/${buildDirectArchiveFileName(input)}`
  const extractedDir = `${installPaths.installRootDir}/${buildDirectExtractedDirName(input)}`

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `rm -rf ${quoteShell(installPaths.standaloneMysqlDir)} ${quoteShell(extractedDir)}`,
    `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.installRootDir)}`,
    `mv ${quoteShell(extractedDir)} ${quoteShell(installPaths.standaloneMysqlDir)}`,
    `chmod +x ${quoteShell(`${installPaths.standaloneMysqlBinDir}/mysql`)} ${quoteShell(`${installPaths.standaloneMysqlBinDir}/mysqld`)}`,
    `export MYSQL_HOME=${quoteShell(installPaths.standaloneMysqlDir)} && export PATH="${installPaths.standaloneMysqlBinDir}:$PATH" && ${quoteShell(`${installPaths.standaloneMysqlBinDir}/mysql`)} --version`,
  ]
}

function buildDarwinPackageCommands(
  input: MysqlPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'homebrew') ??
    `${input.installRootDir}/homebrew-install.sh`

  const resolveBrewCmd = buildResolveHomebrewCommand()
  const formula = resolveMysqlHomebrewFormula(input)
  return [
    `${resolveBrewCmd}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash ${quoteShell(installerPath)}; ${resolveBrewCmd}; fi; if [ -z "$BREW_BIN" ]; then echo "Homebrew installation failed." >&2; exit 1; fi; MYSQL_FORMULA=${quoteShell(formula)}; if ! "$BREW_BIN" list --versions "$MYSQL_FORMULA" >/dev/null 2>&1; then HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" version-install "$MYSQL_FORMULA"; fi`,
  ]
}

function buildWin32DirectCommands(
  input: MysqlPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolveMysqlInstallPaths(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'mysql') ??
    `${installPaths.installRootDir}\\${buildDirectArchiveFileName(input)}`
  const extractedDir = `${installPaths.installRootDir}\\${buildDirectExtractedDirName(input)}`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `if (Test-Path ${quotePowerShell(installPaths.standaloneMysqlDir)}) { Remove-Item -LiteralPath ${quotePowerShell(installPaths.standaloneMysqlDir)} -Recurse -Force -ErrorAction SilentlyContinue }`,
    `if (Test-Path ${quotePowerShell(extractedDir)}) { Remove-Item -LiteralPath ${quotePowerShell(extractedDir)} -Recurse -Force -ErrorAction SilentlyContinue }`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.installRootDir)} -Force`,
    `Move-Item -LiteralPath ${quotePowerShell(extractedDir)} -Destination ${quotePowerShell(installPaths.standaloneMysqlDir)} -Force`,
    `$env:MYSQL_HOME = ${quotePowerShell(installPaths.standaloneMysqlDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneMysqlBinDir)} + ';' + $env:Path; & ${quotePowerShell(`${installPaths.standaloneMysqlBinDir}\\mysql.exe`)} --version`,
  ]
}

function buildWin32PackageCommands(
  input: MysqlPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'scoop') ??
    `${input.installRootDir}\\install.ps1`

  const resolveScoopCmd = buildResolveScoopCommand()
  const packageToken = resolveMysqlScoopPackage(input)
  return [
    `${resolveScoopCmd}; if (-not $scoop) { function Get-ExecutionPolicy { 'ByPass' }; & ${quotePowerShell(installerPath)} -RunAsAdmin:$false; ${resolveScoopCmd}; if (-not $scoop) { throw 'Scoop bootstrap failed.' } }; & $scoop install ${packageToken}`,
  ]
}

function buildInstallCommands(
  input: MysqlPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  if (input.mysqlManager === 'mysql') {
    return input.platform === 'win32'
      ? buildWin32DirectCommands(input, resolvedDownloads)
      : buildDarwinDirectCommands(input, resolvedDownloads)
  }

  return input.platform === 'win32'
    ? buildWin32PackageCommands(input, resolvedDownloads)
    : buildDarwinPackageCommands(input, resolvedDownloads)
}

function buildDarwinVerifyCommands(input: MysqlPluginParams): string[] {
  const installPaths = resolveMysqlInstallPaths(input)

  if (input.mysqlManager === 'mysql') {
    return [
      `export MYSQL_HOME=${quoteShell(installPaths.standaloneMysqlDir)} && export PATH="${installPaths.standaloneMysqlBinDir}:$PATH" && ${quoteShell(`${installPaths.standaloneMysqlBinDir}/mysql`)} --version`,
    ]
  }

  const formula = resolveMysqlHomebrewFormula(input)
  return [
    `${buildResolveHomebrewCommand()}; if [ -z "$BREW_BIN" ]; then echo "Homebrew not found." >&2; exit 1; fi; MYSQL_BIN="$("$BREW_BIN" --prefix ${formula} 2>/dev/null)/bin/mysql"; if [ -x "$MYSQL_BIN" ]; then "$MYSQL_BIN" --version; else mysql --version; fi`,
  ]
}

function buildWin32VerifyCommands(input: MysqlPluginParams): string[] {
  const installPaths = resolveMysqlInstallPaths(input)

  if (input.mysqlManager === 'mysql') {
    return [
      `$env:MYSQL_HOME = ${quotePowerShell(installPaths.standaloneMysqlDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneMysqlBinDir)} + ';' + $env:Path; & ${quotePowerShell(`${installPaths.standaloneMysqlBinDir}\\mysql.exe`)} --version`,
    ]
  }

  return [
    `${buildResolveScoopCommand()}; if (-not $scoop) { throw 'Scoop not found.' }; $shimDir = Split-Path $scoop -Parent; $mysqlCandidates = @((Join-Path $shimDir 'mysql.exe'), (Join-Path $shimDir 'mysql.cmd'), (Join-Path $shimDir 'mysqld.exe'), (Join-Path $shimDir 'mysqld.cmd')); $mysqlBin = $mysqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $mysqlBin) { throw 'Failed to locate MySQL shim.' }; & $mysqlBin --version`,
  ]
}

function buildVerifyCommands(input: MysqlPluginParams): string[] {
  return input.platform === 'win32'
    ? buildWin32VerifyCommands(input)
    : buildDarwinVerifyCommands(input)
}

function buildRollbackCommands(input: MysqlPluginParams): string[] {
  if (input.mysqlManager === 'mysql') {
    return []
  }

  if (input.platform === 'darwin') {
    const formula = resolveMysqlHomebrewFormula(input)
    return [
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions ${formula} >/dev/null 2>&1 && HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" uninstall --formula ${formula} || true; fi`,
    ]
  }

  return [
    `${buildResolveScoopCommand()}; if ($scoop) { & $scoop uninstall mysql *> $null; $shimDir = Split-Path $scoop -Parent; foreach ($shimName in @('mysql.exe', 'mysql.cmd', 'mysqld.exe', 'mysqld.cmd')) { $shimPath = Join-Path $shimDir $shimName; if (Test-Path $shimPath) { Remove-Item -LiteralPath $shimPath -Force } } }`,
  ]
}

async function runCommands(
  commands: string[],
  platform: MysqlPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'mysql-env',
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

const mysqlEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toMysqlParams(input)
    const installPaths = resolveMysqlInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const envChanges = buildMysqlEnvChanges(params)
    const rollbackCommands = buildRollbackCommands(params)
    let commands = buildInstallCommands(params)

    validateOfficialDownloads(downloads)

    const logs = [
      `manager=${params.mysqlManager}`,
      `version=${resolveSelectedMysqlVersion(params)}`,
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
      version: resolveSelectedMysqlVersion(params),
      paths: {
        installRootDir: params.installRootDir,
        mysqlDir: installPaths.standaloneMysqlDir,
        mysqlBinDir: installPaths.standaloneMysqlBinDir,
      },
      envChanges,
      downloads,
      commands,
      rollbackCommands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the MySQL environment.'
        : 'Completed the official-source MySQL environment install commands.',
      context: {
        mysqlManager: params.mysqlManager,
        mysqlVersion: resolveSelectedMysqlVersion(params),
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toMysqlParams(input)
    const locale = input.locale ?? DEFAULT_LOCALE
    const downloads = buildDownloadPlan(params)

    validateOfficialDownloads(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 MySQL 管理方式：${params.mysqlManager}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned MySQL manager: ${params.mysqlManager}`,
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

export default mysqlEnvPlugin
