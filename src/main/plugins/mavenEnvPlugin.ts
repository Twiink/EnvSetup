/**
 * 实现 Maven 在各平台上的安装与校验策略。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildMavenEnvChanges, resolveMavenInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import { DEFAULT_MAVEN_VERSIONS } from '../core/mavenVersions'
import type {
  AppLocale,
  DownloadArtifact,
  DownloadResolvedArtifact,
  MavenPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const MAVEN_ARCHIVE_BASE_URL = 'https://archive.apache.org/dist/maven/maven-3'
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

function resolveSelectedMavenVersion(input: MavenPluginParams): string {
  return input.mavenVersion ?? DEFAULT_MAVEN_VERSIONS[0]
}

function resolveMavenHomebrewFormula(_input: MavenPluginParams): string {
  return 'maven'
}

function resolveMavenScoopPackage(_input: MavenPluginParams): string {
  return 'maven'
}

function buildResolveHomebrewCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if (-not $scoop) { $scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if ($scoop -and -not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }"
}

function buildResolveScoopMavenCommandFunction(): string {
  return [
    'function Get-ScoopMavenCommand {',
    'param([string]$ScoopPath)',
    '$rawPrefix = & $ScoopPath prefix maven 2>$null | Select-Object -First 1',
    'if ($rawPrefix) {',
    '$prefix = $rawPrefix.ToString().Trim()',
    'if ($prefix -and [System.IO.Path]::IsPathRooted($prefix) -and (Test-Path $prefix)) {',
    "$candidates = @((Join-Path $prefix 'bin\\mvn.cmd'), (Join-Path $prefix 'bin\\mvn'), (Join-Path $prefix 'mvn.cmd'))",
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
    "$candidates = @((Join-Path $shimDir 'mvn.cmd'), (Join-Path $shimDir 'mvn'))",
    '$command = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1',
    'if ($command) { return [System.IO.Path]::GetFullPath($command) }',
    '}',
    'return $null',
    '}',
  ].join('\n')
}

function buildArchiveFileName(input: MavenPluginParams): string {
  const extension = input.platform === 'win32' ? 'zip' : 'tar.gz'
  return `apache-maven-${input.mavenVersion}-bin.${extension}`
}

function buildArchiveUrl(input: MavenPluginParams): string {
  return `${MAVEN_ARCHIVE_BASE_URL}/${input.mavenVersion}/binaries/${buildArchiveFileName(input)}`
}

function buildDownloadPlan(input: MavenPluginParams): DownloadArtifact[] {
  if (input.mavenManager === 'package') {
    return [
      input.platform === 'darwin'
        ? {
            kind: 'installer',
            tool: 'homebrew',
            url: HOMEBREW_INSTALL_URL,
            official: true,
            fileName: 'homebrew-install.sh',
            note: 'Download the official Homebrew install script used to install Maven.',
          }
        : {
            kind: 'installer',
            tool: 'scoop',
            url: SCOOP_INSTALL_URL,
            official: true,
            fileName: 'install.ps1',
            note: 'Download the official Scoop install script used to install Maven.',
          },
    ]
  }

  return [
    {
      kind: 'archive',
      tool: 'maven',
      url: buildArchiveUrl(input),
      official: true,
      fileName: buildArchiveFileName(input),
      note: 'Download the official Apache Maven binary archive.',
    },
  ]
}

export function planMavenDownloads(input: PluginExecutionInput): DownloadArtifact[] {
  const params = toMavenParams(input)
  const downloads = buildDownloadPlan(params)
  validateOfficialDownloads(downloads)
  return downloads
}

function toMavenParams(input: PluginExecutionInput): MavenPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (input.mavenManager !== 'maven' && input.mavenManager !== 'package') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'maven-env 需要 mavenManager=maven|package',
        en: 'maven-env requires mavenManager=maven|package',
      }),
    )
  }

  const mavenVersion =
    typeof input.mavenVersion === 'string' && input.mavenVersion.length > 0
      ? input.mavenVersion
      : undefined

  if (input.mavenManager === 'maven' && !mavenVersion) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'maven-env 在直装模式下需要 mavenVersion',
        en: 'maven-env requires mavenVersion when using the direct manager',
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
        'zh-CN': 'maven-env 缺少工具安装根目录',
        en: 'maven-env requires an install root directory',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'maven-env 仅支持 darwin 和 win32',
        en: 'maven-env supports only darwin and win32',
      }),
    )
  }

  return {
    mavenManager: input.mavenManager,
    mavenVersion,
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
  input: MavenPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolveMavenInstallPaths(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'maven') ??
    `${installPaths.installRootDir}/${buildArchiveFileName(input)}`
  const extractedDir = `${installPaths.installRootDir}/apache-maven-${input.mavenVersion}`

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `rm -rf ${quoteShell(installPaths.standaloneMavenDir)} ${quoteShell(extractedDir)}`,
    `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.installRootDir)}`,
    `mv ${quoteShell(extractedDir)} ${quoteShell(installPaths.standaloneMavenDir)}`,
    `chmod +x ${quoteShell(`${installPaths.standaloneMavenBinDir}/mvn`)}`,
    `export MAVEN_HOME=${quoteShell(installPaths.standaloneMavenDir)} && export M2_HOME=${quoteShell(installPaths.standaloneMavenDir)} && export PATH="${installPaths.standaloneMavenBinDir}:$PATH" && mvn -version`,
  ]
}

function buildDarwinPackageCommands(
  input: MavenPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'homebrew') ??
    `${input.installRootDir}/homebrew-install.sh`

  const resolveBrewCmd = buildResolveHomebrewCommand()
  const formula = resolveMavenHomebrewFormula(input)
  return [
    `${resolveBrewCmd}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash ${quoteShell(installerPath)}; ${resolveBrewCmd}; fi; if [ -z "$BREW_BIN" ]; then echo "Homebrew installation failed." >&2; exit 1; fi; MAVEN_FORMULA=${quoteShell(formula)}; if ! "$BREW_BIN" list --versions "$MAVEN_FORMULA" >/dev/null 2>&1; then HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" install --formula "$MAVEN_FORMULA"; fi`,
  ]
}

function buildWin32DirectCommands(
  input: MavenPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolveMavenInstallPaths(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'maven') ??
    `${installPaths.installRootDir}\\${buildArchiveFileName(input)}`
  const extractedDir = `${installPaths.installRootDir}\\apache-maven-${input.mavenVersion}`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `if (Test-Path ${quotePowerShell(installPaths.standaloneMavenDir)}) { Remove-Item -LiteralPath ${quotePowerShell(installPaths.standaloneMavenDir)} -Recurse -Force -ErrorAction SilentlyContinue }`,
    `if (Test-Path ${quotePowerShell(extractedDir)}) { Remove-Item -LiteralPath ${quotePowerShell(extractedDir)} -Recurse -Force -ErrorAction SilentlyContinue }`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.installRootDir)} -Force`,
    `Move-Item -LiteralPath ${quotePowerShell(extractedDir)} -Destination ${quotePowerShell(installPaths.standaloneMavenDir)} -Force`,
    `$env:MAVEN_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:M2_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneMavenBinDir)} + ';' + $env:Path; & ${quotePowerShell(`${installPaths.standaloneMavenBinDir}\\mvn.cmd`)} -version`,
  ]
}

function buildWin32PackageCommands(
  input: MavenPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'scoop') ??
    `${input.installRootDir}\\install.ps1`

  const resolveScoopCmd = buildResolveScoopCommand()
  const packageToken = resolveMavenScoopPackage(input)
  return [
    `${resolveScoopCmd}; if (-not $scoop) { function Get-ExecutionPolicy { 'ByPass' }; & ${quotePowerShell(installerPath)} -RunAsAdmin:$false; ${resolveScoopCmd}; if (-not $scoop) { throw 'Scoop bootstrap failed.' } }; & $scoop install ${packageToken}`,
  ]
}

function buildInstallCommands(
  input: MavenPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  if (input.mavenManager === 'package') {
    return input.platform === 'win32'
      ? buildWin32PackageCommands(input, resolvedDownloads)
      : buildDarwinPackageCommands(input, resolvedDownloads)
  }

  return input.platform === 'win32'
    ? buildWin32DirectCommands(input, resolvedDownloads)
    : buildDarwinDirectCommands(input, resolvedDownloads)
}

function buildVerifyCommands(input: MavenPluginParams): string[] {
  const installPaths = resolveMavenInstallPaths(input)

  if (input.mavenManager === 'package') {
    if (input.platform === 'win32') {
      return [
        `${buildResolveScoopMavenCommandFunction()}\n${buildResolveScoopCommand()}\nif (-not $scoop) { throw 'Scoop not found.' }\n$mvnCmd = Get-ScoopMavenCommand $scoop\nif (-not $mvnCmd) { throw 'Failed to locate Maven command from Scoop install.' }\n& $mvnCmd -version`,
      ]
    }

    const formula = resolveMavenHomebrewFormula(input)
    return [
      `${buildResolveHomebrewCommand()}; [ -n "$BREW_BIN" ] || exit 1; MVN_BIN="$("$BREW_BIN" --prefix ${formula} 2>/dev/null)/bin/mvn"; if [ -x "$MVN_BIN" ]; then "$MVN_BIN" -version; else mvn -version; fi`,
    ]
  }

  if (input.platform === 'win32') {
    return [
      `$env:MAVEN_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:M2_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneMavenBinDir)} + ';' + $env:Path; & ${quotePowerShell(`${installPaths.standaloneMavenBinDir}\\mvn.cmd`)} -version`,
    ]
  }

  return [
    `export MAVEN_HOME=${quoteShell(installPaths.standaloneMavenDir)} && export M2_HOME=${quoteShell(installPaths.standaloneMavenDir)} && export PATH="${installPaths.standaloneMavenBinDir}:$PATH" && mvn -version`,
  ]
}

function buildRollbackCommands(input: MavenPluginParams): string[] {
  if (input.mavenManager !== 'package') {
    return []
  }

  if (input.platform === 'darwin') {
    const formula = resolveMavenHomebrewFormula(input)
    return [
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions ${formula} >/dev/null 2>&1 && HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" uninstall --formula ${formula} || true; fi`,
    ]
  }

  return [
    `${buildResolveScoopCommand()}; if ($scoop) { & $scoop uninstall maven *> $null; $shimDir = Split-Path $scoop -Parent; $shimPath = Join-Path $shimDir 'mvn.cmd'; if (Test-Path $shimPath) { Remove-Item -LiteralPath $shimPath -Force } }`,
  ]
}

async function runCommands(
  commands: string[],
  platform: MavenPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'maven-env',
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

const mavenEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toMavenParams(input)
    const installPaths = resolveMavenInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const envChanges = buildMavenEnvChanges(params)
    const rollbackCommands = buildRollbackCommands(params)
    let commands = buildInstallCommands(params)

    validateOfficialDownloads(downloads)

    const logs = [
      `manager=${params.mavenManager}`,
      `version=${resolveSelectedMavenVersion(params)}`,
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
      version: resolveSelectedMavenVersion(params),
      paths: {
        installRootDir: params.installRootDir,
        mavenDir:
          params.mavenManager === 'maven'
            ? installPaths.standaloneMavenDir
            : params.platform === 'darwin'
              ? installPaths.homebrewDir
              : installPaths.scoopDir,
        mavenBinDir:
          params.mavenManager === 'maven'
            ? installPaths.standaloneMavenBinDir
            : params.platform === 'darwin'
              ? installPaths.homebrewDir
              : installPaths.scoopDir,
      },
      envChanges,
      downloads,
      commands,
      rollbackCommands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the Maven environment.'
        : 'Completed the official-source Maven environment install commands.',
      context: {
        mavenManager: params.mavenManager,
        mavenVersion: resolveSelectedMavenVersion(params),
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toMavenParams(input)
    const locale = input.locale ?? DEFAULT_LOCALE
    const downloads = buildDownloadPlan(params)

    validateOfficialDownloads(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 Maven 管理方式：${params.mavenManager}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned Maven manager: ${params.mavenManager}`,
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

export default mavenEnvPlugin
