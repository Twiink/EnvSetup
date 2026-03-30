/**
 * 实现 Git 在各平台上的安装、清理与回滚策略。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildGitEnvChanges, resolveGitInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import { DEFAULT_GIT_MACOS_VERSIONS, DEFAULT_GIT_WINDOWS_VERSIONS } from '../core/gitVersions'
import type {
  AppLocale,
  DownloadArtifact,
  DownloadResolvedArtifact,
  GitPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const GIT_MACOS_INSTALLER_BASE_URL = 'https://sourceforge.net/projects/git-osx-installer/files'
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

function resolveDefaultGitVersion(platform: GitPluginParams['platform']): string {
  return platform === 'win32' ? DEFAULT_GIT_WINDOWS_VERSIONS[0] : DEFAULT_GIT_MACOS_VERSIONS[0]
}

function resolveSelectedGitVersion(input: GitPluginParams): string {
  return input.gitVersion ?? resolveDefaultGitVersion(input.platform)
}

function resolveGitHomebrewFormula(input: GitPluginParams): string {
  return `git@${resolveSelectedGitVersion(input)}`
}

function resolveGitScoopPackage(_input: GitPluginParams): string {
  return 'git'
}

function buildGitMacosDmgFileName(version: string): string {
  return `git-${version}-intel-universal-mavericks.dmg`
}

function buildGitMacosDmgUrl(version: string): string {
  return `${GIT_MACOS_INSTALLER_BASE_URL}/${buildGitMacosDmgFileName(version)}/download`
}

function buildGitForWindowsArchiveFileName(version: string): string {
  return `Git-${version}-64-bit.tar.bz2`
}

function buildGitForWindowsArchiveUrl(version: string): string {
  return `https://github.com/git-for-windows/git/releases/download/v${version}.windows.1/${buildGitForWindowsArchiveFileName(version)}`
}

function buildResolveHomebrewCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if (-not $scoop) { $scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if ($scoop -and -not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }"
}

function buildResolveScoopGitPrefixFunction(): string {
  return [
    'function Get-ScoopGitPrefix {',
    'param([string]$ScoopPath)',
    '$rawPrefix = & $ScoopPath prefix git 2>$null | Select-Object -First 1',
    'if ($rawPrefix) {',
    '$prefix = $rawPrefix.ToString().Trim()',
    'if ($prefix -and [System.IO.Path]::IsPathRooted($prefix) -and (Test-Path $prefix)) {',
    'return [System.IO.Path]::GetFullPath($prefix)',
    '}',
    '}',
    '$roots = @()',
    '$shimDir = Split-Path $ScoopPath -Parent',
    '$roots += Split-Path $shimDir -Parent',
    'if ($env:SCOOP) { $roots += $env:SCOOP }',
    "$roots += Join-Path $env:USERPROFILE 'scoop'",
    '$roots = $roots | Select-Object -Unique',
    'foreach ($r in $roots) {',
    '$gc = Join-Path $r "apps\\git\\current"',
    'if (Test-Path $gc) { return [System.IO.Path]::GetFullPath($gc) }',
    '$gd = Join-Path $r "apps\\git"',
    'if (Test-Path $gd) {',
    "$vd = Get-ChildItem -Path $gd -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'current' } | Select-Object -First 1 -ExpandProperty FullName",
    'if ($vd) { return $vd }',
    '}',
    '}',
    'return $null',
    '}',
  ].join('\n')
}

function buildScoopGitRootCleanupCommand(): string {
  return [
    '$scoopRoots = @()',
    '$shimDir = Split-Path $scoop -Parent',
    '$scoopRoots += Split-Path $shimDir -Parent',
    'if ($env:SCOOP) { $scoopRoots += $env:SCOOP }',
    "$scoopRoots += Join-Path $env:USERPROFILE 'scoop'",
    '$scoopRoots = $scoopRoots | Select-Object -Unique',
  ].join('; ')
}

function buildForceRemoveScoopRootsCommand(): string {
  return [
    'foreach ($r in $scoopRoots) {',
    'if (-not $r -or -not (Test-Path $r)) { continue }',
    'Remove-Item -LiteralPath $r -Recurse -Force -ErrorAction SilentlyContinue',
    'if (Test-Path $r) {',
    "& cmd.exe /d /c ('rd /s /q \"' + $r + '\"') *> $null",
    '}',
    '}',
  ].join('; ')
}

function buildScoopGitUninstallCommand(options: { removeScoopRoots?: boolean } = {}): string {
  const setScoopEnvFallback =
    "if (-not $env:SCOOP) { $env:SCOOP = Join-Path $env:USERPROFILE 'scoop' }"
  const scoopRootCleanup = buildScoopGitRootCleanupCommand()
  const scoopRootForceRemoval = buildForceRemoveScoopRootsCommand()

  return [
    buildResolveScoopGitPrefixFunction(),
    buildResolveScoopCommand(),
    setScoopEnvFallback,
    'if ($scoop) {',
    '$prefix = Get-ScoopGitPrefix $scoop',
    'if ($prefix) { & $scoop uninstall git *> $null; $uninstallExitCode = $LASTEXITCODE; if ($uninstallExitCode -ne 0) { throw "Scoop git uninstall failed with exit code $uninstallExitCode." } }',
    'Start-Sleep -Milliseconds 250',
    scoopRootCleanup,
    options.removeScoopRoots
      ? scoopRootForceRemoval
      : "foreach ($r in $scoopRoots) { $gd = Join-Path $r 'apps\\git'; if (Test-Path $gd) { Remove-Item -LiteralPath $gd -Recurse -Force } }",
    options.removeScoopRoots
      ? 'foreach ($r in $scoopRoots) { if ($r -and (Test-Path $r)) { throw "Scoop rollback did not remove the bootstrap root: $r" } }'
      : `if ($shimDir -and (Test-Path $shimDir)) { foreach ($shimName in @('git.cmd', 'git.exe', 'git.ps1')) { $shimPath = Join-Path $shimDir $shimName; if (Test-Path $shimPath) { Remove-Item -LiteralPath $shimPath -Force } } }; $remainingPrefix = Get-ScoopGitPrefix $scoop; if ($remainingPrefix) { throw "Scoop git uninstall did not remove the installed prefix: $remainingPrefix" }`,
    '}',
  ].join('; ')
}

function buildVerifyScoopGitCommand(): string {
  return [
    buildResolveScoopGitPrefixFunction(),
    buildResolveScoopCommand(),
    "if (-not $scoop) { throw 'Scoop not found.' }",
    '$prefix = Get-ScoopGitPrefix $scoop',
    "if (-not $prefix) { $shimDir = Split-Path $scoop -Parent; $scoopRoot = Split-Path $shimDir -Parent; $diag = \"scoop=$scoop scoopRoot=$scoopRoot SCOOP=$env:SCOOP USERPROFILE=$env:USERPROFILE\"; $appsGit = Join-Path $scoopRoot 'apps\\git'; if (Test-Path $appsGit) { $diag += ' appsGitContents=' + ((Get-ChildItem $appsGit -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ',') } else { $diag += ' appsGitDir=NOTFOUND' }; throw \"Failed to resolve Scoop git prefix. $diag\" }",
    'Write-Output $prefix',
    "$gitExe = Get-ChildItem -Path $prefix -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('git.exe', 'git.cmd') } | Select-Object -ExpandProperty FullName -First 1",
    'if (-not $gitExe) { throw "Failed to locate Git executable under Scoop prefix $prefix." }',
    '& $gitExe --version',
  ].join('; ')
}

function buildDownloadPlan(input: GitPluginParams): DownloadArtifact[] {
  if (input.gitManager === 'git') {
    const selectedVersion = resolveSelectedGitVersion(input)

    if (input.platform === 'darwin') {
      return [
        {
          kind: 'installer',
          tool: 'git',
          url: buildGitMacosDmgUrl(selectedVersion),
          official: true,
          fileName: buildGitMacosDmgFileName(selectedVersion),
          note: 'Download the official Git macOS installer DMG for the selected version.',
        },
      ]
    }

    return [
      {
        kind: 'archive',
        tool: 'git-for-windows',
        url: buildGitForWindowsArchiveUrl(selectedVersion),
        official: true,
        fileName: buildGitForWindowsArchiveFileName(selectedVersion),
        note: 'Download the official Git for Windows tarball for the selected version.',
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
    extractedCacheDir:
      typeof input.extractedCacheDir === 'string' ? input.extractedCacheDir : undefined,
    platform: input.platform,
    dryRun: input.dryRun,
  }
}

function buildDarwinDirectCommands(
  input: GitPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const paths = resolveGitInstallPaths(input)
  const selectedVersion = resolveSelectedGitVersion(input)
  const dmgPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'git') ??
    `${paths.installRootDir}/${buildGitMacosDmgFileName(selectedVersion)}`
  const mountPoint = `${paths.installRootDir}/git-installer-mount`
  const expandDir = `${paths.installRootDir}/git-pkg-expanded`

  const commands = [`mkdir -p ${quoteShell(paths.installRootDir)}`]

  if (!resolvedDownloads) {
    commands.push(
      `curl -fL ${quoteShell(buildGitMacosDmgUrl(selectedVersion))} -o ${quoteShell(dmgPath)}`,
    )
  }

  commands.push(
    `hdiutil attach ${quoteShell(dmgPath)} -mountpoint ${quoteShell(mountPoint)}`,
    `rm -rf ${quoteShell(paths.gitDir)}`,
    `PKG_PATH=$(find ${quoteShell(mountPoint)} -path '*/.Trashes' -prune -o -name '*.pkg' -print | head -n 1); if [ -z "$PKG_PATH" ]; then echo 'Failed to locate Git installer pkg inside mounted dmg.' >&2; exit 1; fi; rm -rf ${quoteShell(expandDir)}; pkgutil --expand-full "$PKG_PATH" ${quoteShell(expandDir)}`,
    `hdiutil detach ${quoteShell(mountPoint)} || true`,
    `GIT_PAYLOAD_DIR=$(find ${quoteShell(expandDir)} \\( -path '*/Payload/usr/local/git' -o -path '*/usr/local/git' \\) -type d | head -n 1); if [ -z "$GIT_PAYLOAD_DIR" ]; then echo 'Failed to locate usr/local/git in expanded pkg payload.' >&2; exit 1; fi; mkdir -p ${quoteShell(paths.gitDir)}; cp -R "$GIT_PAYLOAD_DIR"/. ${quoteShell(paths.gitDir)}/`,
    ...(resolvedDownloads ? [] : [`rm -f ${quoteShell(dmgPath)}`]),
    `rm -rf ${quoteShell(mountPoint)} ${quoteShell(expandDir)}`,
  )

  return commands
}

function buildDarwinHomebrewCommands(
  input: GitPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const resolveBrewCommand = buildResolveHomebrewCommand()
  const installerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'homebrew') ?? '/tmp/homebrew-install.sh'
  const formula = resolveGitHomebrewFormula(input)
  return [
    resolvedDownloads
      ? `${resolveBrewCommand}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash ${quoteShell(installerPath)}; ${resolveBrewCommand}; fi; [ -n "$BREW_BIN" ] || { echo "brew not found after installation" >&2; exit 1; }; GIT_FORMULA=${quoteShell(formula)}; if ! "$BREW_BIN" list --versions "$GIT_FORMULA" >/dev/null 2>&1; then HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" version-install "$GIT_FORMULA"; fi`
      : `${resolveBrewCommand}; if [ -z "$BREW_BIN" ]; then NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL ${HOMEBREW_INSTALL_URL})"; ${resolveBrewCommand}; fi; [ -n "$BREW_BIN" ] || { echo "brew not found after installation" >&2; exit 1; }; GIT_FORMULA=${quoteShell(formula)}; if ! "$BREW_BIN" list --versions "$GIT_FORMULA" >/dev/null 2>&1; then HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" version-install "$GIT_FORMULA"; fi`,
  ]
}

function buildWindowsDirectCommands(
  input: GitPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const paths = resolveGitInstallPaths(input)
  const selectedVersion = resolveSelectedGitVersion(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'git-for-windows') ??
    `${paths.installRootDir}\\${buildGitForWindowsArchiveFileName(selectedVersion)}`

  const commands = [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(paths.installRootDir)} | Out-Null`,
  ]

  if (!resolvedDownloads) {
    commands.push(
      `Invoke-WebRequest -Uri ${quotePowerShell(buildGitForWindowsArchiveUrl(selectedVersion))} -OutFile ${quotePowerShell(archivePath)}`,
    )
  }

  commands.push(
    `$archive = [System.IO.Path]::GetFullPath(${quotePowerShell(archivePath)}); $extractRoot = [System.IO.Path]::GetFullPath(${quotePowerShell(`${paths.installRootDir}\\git-extract`)}); if (Test-Path $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }; if (Test-Path ${quotePowerShell(paths.gitDir)}) { Remove-Item -LiteralPath ${quotePowerShell(paths.gitDir)} -Recurse -Force }; New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null; New-Item -ItemType Directory -Force -Path ${quotePowerShell(paths.gitDir)} | Out-Null; tar -xjf $archive -C $extractRoot; if ($LASTEXITCODE -ne 0) { throw "Git for Windows archive extraction failed with exit code $LASTEXITCODE." }; $entries = @(Get-ChildItem -LiteralPath $extractRoot -Force); $sourceRoot = if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { $entries[0].FullName } else { $extractRoot }; Get-ChildItem -LiteralPath $sourceRoot -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination ${quotePowerShell(paths.gitDir)} -Force }; Remove-Item -LiteralPath $extractRoot -Recurse -Force`,
  )

  if (!resolvedDownloads) {
    commands.push(
      `if (Test-Path ${quotePowerShell(archivePath)}) { Remove-Item -LiteralPath ${quotePowerShell(archivePath)} -Force -ErrorAction SilentlyContinue }`,
    )
  }

  return commands
}

function buildScoopBootstrapCommands(resolvedDownloads?: DownloadResolvedArtifact[]): string[] {
  const installerPath = resolveDownloadedArtifactPath(resolvedDownloads, 'scoop')

  if (installerPath) {
    return [`$installer = [System.IO.Path]::GetFullPath(${quotePowerShell(installerPath)})`]
  }

  return [
    `$installer = Join-Path ([System.IO.Path]::GetTempPath()) 'envsetup-scoop-install.ps1'`,
    'Invoke-WebRequest -UseBasicParsing -Uri "https://get.scoop.sh" -OutFile $installer',
  ]
}

function buildWindowsScoopCommands(
  input: GitPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  options: { allowBootstrapReset?: boolean } = {},
): string[] {
  const resolveScoopCommand = buildResolveScoopCommand()
  const setScoopEnvFallback =
    "if (-not $env:SCOOP) { $env:SCOOP = Join-Path $env:USERPROFILE 'scoop' }"
  const allowBootstrapReset = options.allowBootstrapReset === true
  const bootstrapInstallerCommands = buildScoopBootstrapCommands(resolvedDownloads)
  const cleanupInstallerCommands = resolvedDownloads
    ? []
    : ['Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue']
  const packageToken = resolveGitScoopPackage(input)

  return [
    [
      resolveScoopCommand,
      setScoopEnvFallback,
      `$maxAttempts = ${allowBootstrapReset ? 2 : 1}`,
      '$attempt = 1',
      '$attemptDiagnostics = @()',
      '$retrySevenZipExplicitly = $false',
      'while ($true) {',
      '  if (-not $scoop) {',
      ...bootstrapInstallerCommands.map((command) => `    ${command}`),
      "    function Get-ExecutionPolicy { 'ByPass' }",
      '    & $installer',
      '    $installerExitCode = $LASTEXITCODE',
      '    Remove-Item Function:\\Get-ExecutionPolicy -ErrorAction SilentlyContinue',
      ...cleanupInstallerCommands.map((command) => `    ${command}`),
      '    if ($installerExitCode -ne 0) { throw "Scoop installer failed with exit code $installerExitCode." }',
      `    ${resolveScoopCommand}`,
      '  }',
      "  if (-not $scoop) { throw 'Failed to locate Scoop.' }",
      '  if ($retrySevenZipExplicitly) {',
      '    Write-Output "Retrying Scoop git install with an explicit 7zip dependency bootstrap."',
      `    & $scoop install 7zip ${packageToken}`,
      '  } else {',
      `    & $scoop install ${packageToken}`,
      '  }',
      '  $installExitCode = $LASTEXITCODE',
      `  ${buildScoopGitRootCleanupCommand()}`,
      '  $foundAppsGit = $false',
      "  foreach ($r in $scoopRoots) { if (Test-Path (Join-Path $r 'apps\\git')) { $foundAppsGit = $true; break } }",
      "  $listOutput = if ($scoop) { & $scoop list *>&1 | Out-String } else { 'SCOOP_UNAVAILABLE' }",
      "  $needsSevenZipRetry = [regex]::IsMatch($listOutput, '(?mi)^7zip\\s+.*Install failed')",
      "  $diag = 'attempt=' + $attempt + ' scoopRoots=' + ($scoopRoots -join ',') + ' SCOOP=' + $env:SCOOP + ' USERPROFILE=' + $env:USERPROFILE + ' scoopList=' + $listOutput",
      "  if ($needsSevenZipRetry) { $diag += ' sevenZipDependency=failed' }",
      '  $attemptDiagnostics += $diag',
      '  if ($installExitCode -eq 0 -and $foundAppsGit) {',
      '    break',
      '  }',
      ...(allowBootstrapReset
        ? [
            '  if ($attempt -lt $maxAttempts) {',
            '    if ($needsSevenZipRetry) {',
            '      Write-Output "Detected failed Scoop 7zip dependency install; retrying with explicit 7zip bootstrap."',
            '      $retrySevenZipExplicitly = $true',
            '      Start-Sleep -Seconds 5',
            '    } else {',
            '      $retrySevenZipExplicitly = $false',
            '    }',
            '    Write-Output "Retrying fresh Scoop bootstrap after incomplete git install."',
            '    foreach ($r in $scoopRoots) { if ($r -and (Test-Path $r)) { Remove-Item -LiteralPath $r -Recurse -Force -ErrorAction SilentlyContinue } }',
            '    $scoop = $null',
            '    $attempt += 1',
            '    continue',
            '  }',
          ]
        : []),
      '  if ($installExitCode -ne 0) {',
      '    throw ("Scoop git install failed with exit code " + $installExitCode + ". " + ($attemptDiagnostics -join " || "))',
      '  }',
      '  throw ("Scoop git install did not create apps\\git. " + ($attemptDiagnostics -join " || "))',
      '}',
    ].join('\n'),
  ]
}

function buildInstallCommands(
  input: GitPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  options: { allowScoopBootstrapReset?: boolean } = {},
): string[] {
  if (input.gitManager === 'git') {
    return input.platform === 'darwin'
      ? buildDarwinDirectCommands(input, resolvedDownloads)
      : buildWindowsDirectCommands(input, resolvedDownloads)
  }

  if (input.gitManager === 'homebrew') {
    return buildDarwinHomebrewCommands(input, resolvedDownloads)
  }

  return buildWindowsScoopCommands(input, resolvedDownloads, {
    allowBootstrapReset: options.allowScoopBootstrapReset,
  })
}

function buildRollbackCommands(input: GitPluginParams): string[] {
  if (input.gitManager === 'homebrew') {
    const formula = resolveGitHomebrewFormula(input)
    return [
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions ${formula} >/dev/null 2>&1 && "$BREW_BIN" uninstall --formula ${formula} || true; fi`,
    ]
  }

  if (input.gitManager === 'scoop') {
    return [buildScoopGitUninstallCommand()]
  }

  return []
}

async function detectExistingScoopRoot(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `${buildResolveScoopCommand()}; if ($scoop) { Write-Output (Split-Path (Split-Path $scoop -Parent) -Parent) }`,
    ])
    const root = stdout.trim()
    return root.length > 0 ? root : undefined
  } catch {
    return undefined
  }
}

function buildVerifyCommands(input: GitPluginParams): string[] {
  const paths = resolveGitInstallPaths(input)

  if (input.gitManager === 'git') {
    if (input.platform === 'darwin') {
      return [`${quoteShell(`${paths.gitBinDir}/git`)} --version`]
    }

    return [`$env:Path = ${quotePowerShell(`${paths.gitBinDir};$env:Path`)}; git --version`]
  }

  if (input.gitManager === 'homebrew') {
    const resolveBrewCommand = buildResolveHomebrewCommand()
    const formula = resolveGitHomebrewFormula(input)
    return [
      `${resolveBrewCommand}; [ -n "$BREW_BIN" ] || exit 1; BREW_PREFIX="$("$BREW_BIN" --prefix ${formula})"; printf '%s\n' "$BREW_PREFIX"; "$BREW_PREFIX/bin/git" --version`,
    ]
  }

  return [buildVerifyScoopGitCommand()]
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
    let rollbackCommands = buildRollbackCommands(params)
    const envChanges = buildGitEnvChanges(params)
    let commands = buildInstallCommands(params)
    let preExistingScoopRoot: string | undefined
    let allowFreshScoopBootstrapReset = false

    validateOfficialDownloads(downloads)

    const logs = [
      `manager=${params.gitManager}`,
      `version=${resolveSelectedGitVersion(params)}`,
      `installRoot=${params.installRootDir}`,
      `mode=${params.dryRun ? 'dry-run' : 'real-run'}`,
    ]

    if (!params.dryRun) {
      if (params.gitManager === 'scoop' && params.platform === 'win32') {
        preExistingScoopRoot = await detectExistingScoopRoot()
        logs.push(
          preExistingScoopRoot
            ? `preexisting_scoop_root=${preExistingScoopRoot}`
            : 'preexisting_scoop_root=absent',
        )
        allowFreshScoopBootstrapReset = !preExistingScoopRoot
        logs.push(
          `fresh_scoop_bootstrap_retry=${allowFreshScoopBootstrapReset ? 'enabled' : 'disabled'}`,
        )
        rollbackCommands = [
          buildScoopGitUninstallCommand({ removeScoopRoots: !preExistingScoopRoot }),
        ]
      }

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

      commands = buildInstallCommands(params, resolvedDownloads, {
        allowScoopBootstrapReset: allowFreshScoopBootstrapReset,
      })
      const commandStartedAt = Date.now()
      logs.push(...(await runCommands(commands, params.platform, input.onProgress)))
      appendPhaseLog(logs, 'install_commands', commandStartedAt, `commands=${commands.length}`)
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: resolveSelectedGitVersion(params),
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
        gitVersion: resolveSelectedGitVersion(params),
        ...(preExistingScoopRoot ? { preExistingScoopRoot } : {}),
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
