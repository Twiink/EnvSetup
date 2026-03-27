import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildGitEnvChanges, resolveGitInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import type {
  AppLocale,
  DownloadArtifact,
  GitPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const GIT_MACOS_DMG_URL = 'https://sourceforge.net/projects/git-osx-installer/files/latest/download'
const GIT_FOR_WINDOWS_VERSION = '2.47.1'
const GIT_FOR_WINDOWS_EXE_URL = `https://github.com/git-for-windows/git/releases/download/v${GIT_FOR_WINDOWS_VERSION}.windows.1/Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`
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

function buildResolveHomebrewCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1; if (-not $scoop) { $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate } }"
}

function buildDownloadPlan(input: GitPluginParams): DownloadArtifact[] {
  if (input.gitManager === 'git') {
    if (input.platform === 'darwin') {
      return [
        {
          kind: 'installer',
          tool: 'git',
          url: GIT_MACOS_DMG_URL,
          official: true,
          fileName: 'git-macos-installer.dmg',
          note: 'Download the official Git macOS installer DMG.',
        },
      ]
    }

    return [
      {
        kind: 'installer',
        tool: 'git-for-windows',
        url: GIT_FOR_WINDOWS_EXE_URL,
        official: true,
        fileName: `Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`,
        note: 'Download the official Git for Windows installer.',
      },
    ]
  }

  if (input.gitManager === 'homebrew') {
    return [
      {
        kind: 'installer',
        tool: 'homebrew',
        url: HOMEBREW_INSTALL_URL,
        official: true,
        fileName: 'homebrew-install.sh',
        note: 'Download the official Homebrew install script.',
      },
    ]
  }

  return [
    {
      kind: 'installer',
      tool: 'scoop',
      url: SCOOP_INSTALL_URL,
      official: true,
      fileName: 'install.ps1',
      note: 'Download the official Scoop install script.',
    },
  ]
}

export function planGitDownloads(input: PluginExecutionInput): DownloadArtifact[] {
  const params = toGitParams(input)
  const downloads = buildDownloadPlan(params)
  validateOfficialDownloads(downloads)
  return downloads
}

function toGitParams(input: PluginExecutionInput): GitPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (
    input.gitManager !== 'git' &&
    input.gitManager !== 'homebrew' &&
    input.gitManager !== 'scoop'
  ) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'git-env 需要 gitManager=git|homebrew|scoop',
        en: 'git-env requires gitManager=git|homebrew|scoop',
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
        'zh-CN': 'git-env 缺少工具安装根目录',
        en: 'git-env requires an install root directory',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'git-env 仅支持 darwin 和 win32',
        en: 'git-env supports only darwin and win32',
      }),
    )
  }

  if (input.gitManager === 'homebrew' && input.platform !== 'darwin') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'homebrew 仅支持 darwin',
        en: 'homebrew is supported only on darwin',
      }),
    )
  }

  if (input.gitManager === 'scoop' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'scoop 仅支持 win32',
        en: 'scoop is supported only on win32',
      }),
    )
  }

  return {
    gitManager: input.gitManager,
    gitVersion:
      typeof input.gitVersion === 'string' && input.gitVersion.length > 0
        ? input.gitVersion
        : undefined,
    installRootDir,
    downloadCacheDir:
      typeof input.downloadCacheDir === 'string' ? input.downloadCacheDir : undefined,
    platform: input.platform,
    dryRun: input.dryRun,
  }
}

function buildDarwinDirectCommands(input: GitPluginParams): string[] {
  const paths = resolveGitInstallPaths(input)
  const dmgPath = `${paths.installRootDir}/git-installer.dmg`
  const mountPoint = `${paths.installRootDir}/git-installer-mount`

  return [
    `mkdir -p ${quoteShell(paths.installRootDir)}`,
    `curl -fL ${quoteShell(GIT_MACOS_DMG_URL)} -o ${quoteShell(dmgPath)}`,
    `hdiutil attach ${quoteShell(dmgPath)} -mountpoint ${quoteShell(mountPoint)}`,
    `rm -rf ${quoteShell(paths.gitDir)}`,
    `PKG_PATH=$(find ${quoteShell(mountPoint)} -path '*/.Trashes' -prune -o -name '*.pkg' -print | head -n 1); [ -n "$PKG_PATH" ] && pkgutil --expand-full "$PKG_PATH" ${quoteShell(paths.gitDir)}`,
    `hdiutil detach ${quoteShell(mountPoint)} || true`,
  ]
}

function buildDarwinHomebrewCommands(): string[] {
  const resolveBrewCommand = buildResolveHomebrewCommand()
  return [
    `${resolveBrewCommand}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL ${HOMEBREW_INSTALL_URL})"; ${resolveBrewCommand}; fi; [ -n "$BREW_BIN" ] || { echo "brew not found after installation" >&2; exit 1; }; "$BREW_BIN" install git || "$BREW_BIN" upgrade git`,
  ]
}

function buildWindowsDirectCommands(input: GitPluginParams): string[] {
  const paths = resolveGitInstallPaths(input)
  const installerPath = `${paths.installRootDir}\\Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(paths.installRootDir)} | Out-Null`,
    `Invoke-WebRequest -Uri ${quotePowerShell(GIT_FOR_WINDOWS_EXE_URL)} -OutFile ${quotePowerShell(installerPath)}`,
    `Start-Process -FilePath ${quotePowerShell(installerPath)} -ArgumentList '/VERYSILENT','/NORESTART','/DIR=${paths.gitDir}' -Wait -NoNewWindow`,
    `Remove-Item -LiteralPath ${quotePowerShell(installerPath)} -Force -ErrorAction SilentlyContinue`,
  ]
}

function buildWindowsScoopCommands(): string[] {
  const resolveScoopCommand = buildResolveScoopCommand()
  return [
    `${resolveScoopCommand}; if (-not $scoop) { Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; Invoke-RestMethod -Uri ${quotePowerShell(SCOOP_INSTALL_URL)} | Invoke-Expression; ${resolveScoopCommand} }; if (-not $scoop) { throw 'Failed to locate Scoop.' }; & $scoop install git`,
  ]
}

function buildInstallCommands(input: GitPluginParams): string[] {
  if (input.gitManager === 'git') {
    return input.platform === 'darwin'
      ? buildDarwinDirectCommands(input)
      : buildWindowsDirectCommands(input)
  }

  if (input.gitManager === 'homebrew') {
    return buildDarwinHomebrewCommands()
  }

  return buildWindowsScoopCommands()
}

function buildRollbackCommands(input: GitPluginParams): string[] {
  if (input.gitManager === 'homebrew') {
    return [
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions git >/dev/null 2>&1 && "$BREW_BIN" uninstall --formula git || true; fi`,
    ]
  }

  if (input.gitManager === 'scoop') {
    return [
      `${buildResolveScoopCommand()}; if ($scoop) { & $scoop prefix git *> $null; if ($LASTEXITCODE -eq 0) { & $scoop uninstall git *> $null } }`,
    ]
  }

  return []
}

function buildVerifyCommands(input: GitPluginParams): string[] {
  const paths = resolveGitInstallPaths(input)

  if (input.gitManager === 'git') {
    if (input.platform === 'darwin') {
      return [`export PATH=${quotePowerShell(`${paths.gitBinDir}:$PATH`)} && git --version`]
    }

    return [`$env:Path = ${quotePowerShell(`${paths.gitBinDir};$env:Path`)}; git --version`]
  }

  if (input.gitManager === 'homebrew') {
    const resolveBrewCommand = buildResolveHomebrewCommand()
    return [
      `${resolveBrewCommand}; [ -n "$BREW_BIN" ] || exit 1; BREW_PREFIX="$("$BREW_BIN" --prefix git)"; printf '%s\n' "$BREW_PREFIX"; "$BREW_PREFIX/bin/git" --version`,
    ]
  }

  return [
    `${buildResolveScoopCommand()}; if (-not $scoop) { throw 'Scoop not found.' }; $prefix = (& $scoop prefix git).Trim(); Write-Output $prefix; $shimDir = Split-Path $scoop -Parent; $gitExe = Join-Path $shimDir 'git.exe'; if (-not (Test-Path $gitExe)) { $gitExe = Join-Path $shimDir 'git.cmd' }; & $gitExe --version`,
  ]
}

async function runCommands(
  commands: string[],
  platform: GitPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'git-env',
): Promise<string[]> {
  const output: string[] = []

  for (const [index, command] of commands.entries()) {
    output.push(`$ ${command}`)
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
      const e = err as { stdout?: string; stderr?: string; message?: string }
      if (e.stdout?.trim()) output.push(e.stdout.trim())
      if (e.stderr?.trim()) output.push(`stderr: ${e.stderr.trim()}`)
      output.push(`error: ${e.message ?? String(err)}`)
      throw Object.assign(new Error(e.message ?? String(err)), { commandOutput: output })
    }
  }

  return output
}

const gitEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toGitParams(input)
    const paths = resolveGitInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const commands = buildInstallCommands(params)
    const rollbackCommands = buildRollbackCommands(params)
    const envChanges = buildGitEnvChanges(params)

    validateOfficialDownloads(downloads)

    const logs = [
      `manager=${params.gitManager}`,
      `version=${params.gitVersion ?? 'latest'}`,
      `installRoot=${params.installRootDir}`,
      `mode=${params.dryRun ? 'dry-run' : 'real-run'}`,
    ]

    if (!params.dryRun) {
      if (!params.downloadCacheDir) {
        throw Object.assign(new Error('Download cache directory is required for real-run'), {
          code: 'DOWNLOAD_FAILED',
        })
      }

      const resolvedDownloads = await downloadArtifacts({
        downloads,
        cacheDir: params.downloadCacheDir,
      })
      logs.push(
        ...resolvedDownloads.map(
          (item) => `download_cache_hit=${item.cacheHit} ${item.artifact.url}`,
        ),
      )
      logs.push(...(await runCommands(commands, params.platform, input.onProgress)))
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: params.gitVersion ?? GIT_FOR_WINDOWS_VERSION,
      paths: {
        installRootDir: params.installRootDir,
        gitDir: paths.gitDir,
        gitBinDir: paths.gitBinDir,
      },
      envChanges,
      downloads,
      commands,
      rollbackCommands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the Git environment.'
        : 'Completed the official-source Git environment install commands.',
      context: {
        gitManager: params.gitManager,
        gitVersion: params.gitVersion ?? GIT_FOR_WINDOWS_VERSION,
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toGitParams(input)
    const locale = input.locale ?? DEFAULT_LOCALE
    const downloads = buildDownloadPlan(params)

    validateOfficialDownloads(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 Git 管理方式：${params.gitManager}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned Git manager: ${params.gitManager}`,
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

export default gitEnvPlugin
