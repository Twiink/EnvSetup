/**
 * Implements Java installation, cleanup, and rollback strategies across supported platforms.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { prepareExtractedArchive } from '../core/archiveCache'
import { buildJavaEnvChanges, resolveJavaInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import type {
  AppLocale,
  DownloadArtifact,
  DownloadResolvedArtifact,
  JavaPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const ADOPTIUM_BINARY_BASE_URL = 'https://api.adoptium.net/v3/binary/latest'
const SDKMAN_CLI_VERSION = '5.22.3'
const SDKMAN_API_BASE = 'https://api.sdkman.io/2'
const GIT_FOR_WINDOWS_VERSION = '2.47.1'
const GIT_FOR_WINDOWS_EXE_URL = `https://github.com/git-for-windows/git/releases/download/v${GIT_FOR_WINDOWS_VERSION}.windows.1/Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`
const GIT_FOR_WINDOWS_SILENT_ARGS = [
  '/VERYSILENT',
  '/SUPPRESSMSGBOXES',
  '/NORESTART',
  '/NOCANCEL',
  '/SP-',
]

function translate(locale: AppLocale, text: { 'zh-CN': string; en: string }): string {
  return text[locale]
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quotePowerShell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildPowerShellArrayLiteral(values: string[]): string {
  return `@(${values.map((value) => quotePowerShell(value)).join(', ')})`
}

function buildPowerShellHereString(value: string): string {
  return `@'\n${value.replace(/\r\n/g, '\n')}\n'@`
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

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized.length > 0 ? sanitized : 'default'
}

function toBashPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function buildSdkmanLocalJavaAlias(javaVersion: string): string {
  return `${sanitizePathSegment(extractFeatureVersion(javaVersion))}-local`
}

function resolveSdkmanPlatform(platform: 'darwin' | 'win32'): string {
  if (platform === 'darwin') {
    return process.arch === 'x64' ? 'darwinx64' : 'darwinarm64'
  }
  return 'windowsx64'
}

const SDKMAN_CONFIG_LINES = [
  'sdkman_auto_answer=true',
  'sdkman_colour_enable=false',
  'sdkman_selfupdate_feature=false',
  'sdkman_auto_complete=true',
  'sdkman_auto_env=false',
  'sdkman_beta_channel=false',
  'sdkman_checksum_enable=true',
  'sdkman_curl_connect_timeout=7',
  'sdkman_curl_max_time=10',
  'sdkman_debug_mode=false',
  'sdkman_healthcheck_enable=true',
  'sdkman_insecure_ssl=false',
  'sdkman_native_enable=false',
]
const SDKMAN_CANDIDATE_NAMES = ['java']

type PreparedJavaInstallSources = {
  temurinArchiveDir?: string
  entries: Array<{
    cacheHit: boolean
    label: string
    path: string
  }>
}

async function prepareInstallSources(
  input: JavaPluginParams,
  resolvedDownloads: DownloadResolvedArtifact[],
): Promise<PreparedJavaInstallSources> {
  const preparedSources: PreparedJavaInstallSources = {
    entries: [],
  }

  if (!input.extractedCacheDir) {
    return preparedSources
  }

  const archivePath = resolveDownloadedArtifactPath(resolvedDownloads, 'temurin')
  if (!archivePath) {
    return preparedSources
  }

  const extractedArchive = await prepareExtractedArchive({
    archivePath,
    cacheDir: input.extractedCacheDir,
    format: input.platform === 'win32' ? 'zip' : 'tar.gz',
  })
  const extractedDir = extractedArchive.extractedRootDir ?? extractedArchive.extractionDir
  preparedSources.temurinArchiveDir = extractedDir
  preparedSources.entries.push({
    cacheHit: extractedArchive.cacheHit,
    label: 'temurin',
    path: extractedDir,
  })
  return preparedSources
}

/** Extract the major feature version from a Temurin version string like '21.0.6+7' or '21' */
function extractFeatureVersion(version: string): string {
  return version.split('.')[0]
}

function resolveTemurinArch(): string {
  return process.arch === 'x64' ? 'x64' : 'aarch64'
}

function buildTemurinBinaryUrl(input: JavaPluginParams): string {
  const featureVersion = extractFeatureVersion(input.javaVersion)
  const os = input.platform === 'win32' ? 'windows' : 'mac'
  const arch = input.platform === 'win32' ? 'x64' : resolveTemurinArch()
  return `${ADOPTIUM_BINARY_BASE_URL}/${featureVersion}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`
}

function resolveTemurinArchiveExtension(platform: JavaPluginParams['platform']): string {
  return platform === 'win32' ? '.zip' : '.tar.gz'
}

function buildDownloadPlan(input: JavaPluginParams): DownloadArtifact[] {
  if (input.javaManager === 'jdk') {
    return [
      {
        kind: 'archive',
        tool: 'temurin',
        url: buildTemurinBinaryUrl(input),
        official: true,
        fileName: `temurin-jdk-${input.javaVersion}${resolveTemurinArchiveExtension(input.platform)}`,
        note: 'Download the Eclipse Temurin JDK from Adoptium.',
      },
    ]
  }

  const sdkmanPlatform = resolveSdkmanPlatform(input.platform)
  const downloads: DownloadArtifact[] = [
    {
      kind: 'archive',
      tool: 'temurin',
      url: buildTemurinBinaryUrl(input),
      official: true,
      fileName: `temurin-jdk-${input.javaVersion}${resolveTemurinArchiveExtension(input.platform)}`,
      note: 'Download the official Eclipse Temurin JDK archive used for SDKMAN local installation.',
    },
    {
      kind: 'archive',
      tool: 'sdkman-cli',
      url: `${SDKMAN_API_BASE}/broker/download/sdkman/install/${SDKMAN_CLI_VERSION}/${sdkmanPlatform}`,
      official: true,
      fileName: `sdkman-cli-${SDKMAN_CLI_VERSION}.zip`,
      note: 'Download the SDKMAN CLI distribution zip.',
    },
  ]

  if (input.platform === 'darwin') {
    return downloads
  }

  return [
    ...downloads,
    {
      kind: 'installer',
      tool: 'git-for-windows',
      url: GIT_FOR_WINDOWS_EXE_URL,
      official: true,
      fileName: `Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`,
      note: 'Git for Windows (provides Git Bash required by SDKMAN). Installed only if bash.exe is not found.',
    },
  ]
}

export function planJavaDownloads(input: PluginExecutionInput): DownloadArtifact[] {
  const params = toJavaParams(input)
  const downloads = buildDownloadPlan(params)
  assertOfficialDownloadPlan(downloads)
  return downloads
}

function assertOfficialDownloadPlan(downloads: DownloadArtifact[]): void {
  validateOfficialDownloads(downloads)
}

function toJavaParams(input: PluginExecutionInput): JavaPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (input.javaManager !== 'jdk' && input.javaManager !== 'sdkman') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'java-env 需要 javaManager=jdk|sdkman',
        en: 'java-env requires javaManager=jdk|sdkman',
      }),
    )
  }

  if (typeof input.javaVersion !== 'string' || input.javaVersion.length === 0) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'java-env 缺少 javaVersion',
        en: 'java-env requires javaVersion',
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
        'zh-CN': 'java-env 缺少工具安装根目录',
        en: 'java-env requires an install root directory',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'java-env 仅支持 darwin 和 win32',
        en: 'java-env supports only darwin and win32',
      }),
    )
  }

  return {
    javaManager: input.javaManager,
    javaVersion: input.javaVersion,
    installRootDir,
    platform: input.platform,
    dryRun: input.dryRun,
    downloadCacheDir:
      typeof input.downloadCacheDir === 'string' ? input.downloadCacheDir : undefined,
    extractedCacheDir:
      typeof input.extractedCacheDir === 'string' ? input.extractedCacheDir : undefined,
  }
}

function buildDarwinStandaloneCommands(
  input: JavaPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  cachedArchiveDir?: string,
): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const archiveUrl = buildTemurinBinaryUrl(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'temurin') ??
    `${installPaths.installRootDir}/temurin-jdk-${input.javaVersion}.tar.gz`

  const commands = [`mkdir -p ${quoteShell(installPaths.installRootDir)}`]

  if (!resolvedDownloads) {
    commands.push(`curl -fsSL ${quoteShell(archiveUrl)} -o ${quoteShell(archivePath)}`)
  }

  commands.push(`mkdir -p ${quoteShell(installPaths.standaloneJdkDir)}`)

  if (cachedArchiveDir) {
    commands.push(
      `cp -R ${quoteShell(`${cachedArchiveDir}/.`)} ${quoteShell(installPaths.standaloneJdkDir)}`,
    )
  } else {
    commands.push(
      `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.standaloneJdkDir)} --strip-components=1`,
      ...(resolvedDownloads ? [] : [`rm -f ${quoteShell(archivePath)}`]),
    )
  }

  commands.push(
    // macOS Temurin archives contain Contents/Home/; flatten if present
    `if [ -d ${quoteShell(installPaths.standaloneJdkDir + '/Contents/Home')} ]; then mv ${quoteShell(installPaths.standaloneJdkDir + '/Contents/Home')}/* ${quoteShell(installPaths.standaloneJdkDir)}/ && rm -rf ${quoteShell(installPaths.standaloneJdkDir + '/Contents')}; fi`,
    `export JAVA_HOME=${quoteShell(installPaths.standaloneJdkDir)} && export PATH="${installPaths.standaloneJdkBinDir}:$PATH" && java -version`,
  )

  return commands
}

function buildDarwinSdkmanCommands(
  input: JavaPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  cachedArchiveDir?: string,
): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const archiveUrl = buildTemurinBinaryUrl(input)
  const sdkmanPlatform = resolveSdkmanPlatform(input.platform)
  const sdkmanLocalJavaDir = `${installPaths.sdkmanDir}/local/java-${sanitizePathSegment(input.javaVersion)}`
  const sdkmanLocalJavaAlias = buildSdkmanLocalJavaAlias(input.javaVersion)
  const temurinArchivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'temurin') ??
    `${installPaths.installRootDir}/temurin-jdk-${input.javaVersion}.tar.gz`
  const sdkmanCliZipPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'sdkman-cli') ??
    `${installPaths.installRootDir}/sdkman-cli-${SDKMAN_CLI_VERSION}.zip`
  const bashScript = [
    `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir)}`,
    // Set up SDKMAN directory structure manually (avoids network dependency of install script)
    'mkdir -p "$SDKMAN_DIR/bin" "$SDKMAN_DIR/src" "$SDKMAN_DIR/ext" "$SDKMAN_DIR/etc" "$SDKMAN_DIR/var" "$SDKMAN_DIR/tmp" "$SDKMAN_DIR/candidates"',
    `unzip -qo ${quoteShell(sdkmanCliZipPath)} -d "$SDKMAN_DIR/tmp"`,
    'cp -rf "$SDKMAN_DIR/tmp"/sdkman-*/* "$SDKMAN_DIR"',
    'rm -rf "$SDKMAN_DIR/tmp"/sdkman-*',
    `echo ${quoteShell(sdkmanPlatform)} > "$SDKMAN_DIR/var/platform"`,
    `echo ${quoteShell(SDKMAN_CLI_VERSION)} > "$SDKMAN_DIR/var/version"`,
    `printf '%s\\n' ${SDKMAN_CONFIG_LINES.map((l) => quoteShell(l)).join(' ')} > "$SDKMAN_DIR/etc/config"`,
    `printf '%s' ${quoteShell(SDKMAN_CANDIDATE_NAMES.join(','))} > "$SDKMAN_DIR/var/candidates"`,
    `. ${quoteShell(`${installPaths.sdkmanDir}/bin/sdkman-init.sh`)}`,
    `SDKMAN_LOCAL_JAVA_DIR=${quoteShell(sdkmanLocalJavaDir)}`,
    `SDKMAN_LOCAL_JAVA_ALIAS=${quoteShell(sdkmanLocalJavaAlias)}`,
    'rm -rf "$SDKMAN_LOCAL_JAVA_DIR"',
    'mkdir -p "$SDKMAN_LOCAL_JAVA_DIR"',
    ...(cachedArchiveDir
      ? [`cp -R ${quoteShell(`${cachedArchiveDir}/.`)} "$SDKMAN_LOCAL_JAVA_DIR"`]
      : [
          `tar -xzf ${quoteShell(temurinArchivePath)} -C "$SDKMAN_LOCAL_JAVA_DIR" --strip-components=1`,
        ]),
    'if [ -d "$SDKMAN_LOCAL_JAVA_DIR/Contents/Home" ]; then mv "$SDKMAN_LOCAL_JAVA_DIR/Contents/Home"/* "$SDKMAN_LOCAL_JAVA_DIR"/ && rm -rf "$SDKMAN_LOCAL_JAVA_DIR/Contents"; fi',
    'sdk install java "$SDKMAN_LOCAL_JAVA_ALIAS" "$SDKMAN_LOCAL_JAVA_DIR"',
    'sdk default java "$SDKMAN_LOCAL_JAVA_ALIAS"',
    'java -version',
  ].join(' && ')

  const commands = [`mkdir -p ${quoteShell(installPaths.installRootDir)}`]

  if (!resolvedDownloads) {
    const sdkmanCliUrl = `${SDKMAN_API_BASE}/broker/download/sdkman/install/${SDKMAN_CLI_VERSION}/${sdkmanPlatform}`
    commands.push(
      `curl -fsSL ${quoteShell(sdkmanCliUrl)} -o ${quoteShell(sdkmanCliZipPath)}`,
      `curl -fsSL ${quoteShell(archiveUrl)} -o ${quoteShell(temurinArchivePath)}`,
    )
  }

  commands.push(`rm -rf ${quoteShell(installPaths.sdkmanDir)}`, bashScript)

  if (!resolvedDownloads) {
    commands.push(
      `rm -f ${quoteShell(sdkmanCliZipPath)}`,
      `rm -f ${quoteShell(temurinArchivePath)}`,
    )
  }

  return commands
}

function buildWindowsStandaloneCommands(
  input: JavaPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  cachedArchiveDir?: string,
): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const archiveUrl = buildTemurinBinaryUrl(input)
  const archivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'temurin') ??
    `${installPaths.installRootDir}\\temurin-jdk-${input.javaVersion}.zip`

  const commands = [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
  ]

  if (!resolvedDownloads) {
    commands.push(
      `Invoke-WebRequest -Uri ${quotePowerShell(archiveUrl)} -OutFile ${quotePowerShell(archivePath)}`,
    )
  }

  commands.push(
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.standaloneJdkDir)} | Out-Null`,
  )

  if (cachedArchiveDir) {
    commands.push(
      `Copy-Item -Path (Join-Path ${quotePowerShell(cachedArchiveDir)} '*') -Destination ${quotePowerShell(installPaths.standaloneJdkDir)} -Recurse -Force`,
    )
  } else {
    commands.push(
      `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.installRootDir)} -Force`,
      // Temurin extracts to a directory like jdk-21.0.6+7; move its contents
      `$extracted = Get-ChildItem -Path ${quotePowerShell(installPaths.installRootDir)} -Directory | Where-Object { $_.Name -like 'jdk-*' } | Select-Object -First 1; if ($extracted) { Move-Item -Path "$($extracted.FullName)\\*" -Destination ${quotePowerShell(installPaths.standaloneJdkDir)} -Force; Remove-Item -LiteralPath $extracted.FullName -Recurse -Force }`,
      ...(resolvedDownloads
        ? []
        : [`Remove-Item -LiteralPath ${quotePowerShell(archivePath)} -Force`]),
    )
  }

  commands.push(
    `$env:JAVA_HOME = ${quotePowerShell(installPaths.standaloneJdkDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneJdkBinDir)} + ';' + $env:Path; & ${quotePowerShell(installPaths.standaloneJdkBinDir + '\\java.exe')} -version`,
  )

  return commands
}

function buildWindowsSdkmanCommands(
  input: JavaPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  cachedArchiveDir?: string,
): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const sdkmanPlatform = resolveSdkmanPlatform(input.platform)
  const gitBashDir = `${installPaths.installRootDir}\\git-bash`
  const fallbackBashPath = `${gitBashDir}\\bin\\bash.exe`
  const gitInstallerPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'git-for-windows') ??
    `${installPaths.installRootDir}\\Git-installer.exe`
  const temurinArchiveUrl = buildTemurinBinaryUrl(input)
  const temurinArchivePath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'temurin') ??
    `${installPaths.installRootDir}\\temurin-jdk-${input.javaVersion}.zip`
  const sdkmanCliZipPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'sdkman-cli') ??
    `${installPaths.installRootDir}\\sdkman-cli-${SDKMAN_CLI_VERSION}.zip`
  const sdkmanLocalJavaDir = `${installPaths.sdkmanDir}\\local\\java-${sanitizePathSegment(input.javaVersion)}`
  const sdkmanLocalJavaBashDir = toBashPath(sdkmanLocalJavaDir)
  const sdkmanLocalJavaAlias = buildSdkmanLocalJavaAlias(input.javaVersion)
  const extractRoot = `${installPaths.installRootDir}\\sdkman-java-extract`
  const gitInstallerArgs = buildPowerShellArrayLiteral([
    ...GIT_FOR_WINDOWS_SILENT_ARGS,
    `/DIR=${gitBashDir}`,
  ])
  const setupScriptPath = `${installPaths.installRootDir}\\envsetup-sdkman-setup.sh`
  const registerScriptPath = `${installPaths.installRootDir}\\envsetup-sdkman-register.sh`
  const setupScriptBashPath = toBashPath(setupScriptPath)
  const registerScriptBashPath = toBashPath(registerScriptPath)
  const sdkmanCliZipBashPath = toBashPath(sdkmanCliZipPath)
  const sdkmanSetupBashScript = [
    `export SDKMAN_DIR=${quoteShell(toBashPath(installPaths.sdkmanDir))}`,
    'mkdir -p "$SDKMAN_DIR/bin" "$SDKMAN_DIR/src" "$SDKMAN_DIR/ext" "$SDKMAN_DIR/etc" "$SDKMAN_DIR/var" "$SDKMAN_DIR/tmp" "$SDKMAN_DIR/candidates"',
    `unzip -qo ${quoteShell(sdkmanCliZipBashPath)} -d "$SDKMAN_DIR/tmp"`,
    'cp -rf "$SDKMAN_DIR/tmp"/sdkman-*/* "$SDKMAN_DIR"',
    'rm -rf "$SDKMAN_DIR/tmp"/sdkman-*',
    `echo ${quoteShell(sdkmanPlatform)} > "$SDKMAN_DIR/var/platform"`,
    `echo ${quoteShell(SDKMAN_CLI_VERSION)} > "$SDKMAN_DIR/var/version"`,
    `printf '%s\\n' ${SDKMAN_CONFIG_LINES.map((l) => quoteShell(l)).join(' ')} > "$SDKMAN_DIR/etc/config"`,
    `printf '%s' ${quoteShell(SDKMAN_CANDIDATE_NAMES.join(','))} > "$SDKMAN_DIR/var/candidates"`,
  ].join('\n')
  const sdkmanRegisterBashScript = [
    `export SDKMAN_DIR=${quoteShell(toBashPath(installPaths.sdkmanDir))}`,
    '. "$SDKMAN_DIR/bin/sdkman-init.sh"',
    `SDKMAN_LOCAL_JAVA_DIR=${quoteShell(sdkmanLocalJavaBashDir)}`,
    `SDKMAN_LOCAL_JAVA_ALIAS=${quoteShell(sdkmanLocalJavaAlias)}`,
    'sdk install java "$SDKMAN_LOCAL_JAVA_ALIAS" "$SDKMAN_LOCAL_JAVA_DIR"',
    'sdk default java "$SDKMAN_LOCAL_JAVA_ALIAS"',
    'java -version',
  ].join('\n')
  const gitBashCommand = [
    `$gitBash = Get-Command 'bash.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1`,
    resolvedDownloads
      ? `if (-not $gitBash) { $gitInstallerArgs = ${gitInstallerArgs}; $gitInstaller = [System.IO.Path]::GetFullPath(${quotePowerShell(gitInstallerPath)}); $proc = Start-Process -FilePath $gitInstaller -ArgumentList $gitInstallerArgs -Wait -PassThru; if ($proc.ExitCode -ne 0) { throw "Git for Windows installer failed with exit code $($proc.ExitCode)." }; $fallbackBash = [System.IO.Path]::GetFullPath(${quotePowerShell(fallbackBashPath)}); if (Test-Path $fallbackBash) { $gitBash = $fallbackBash } }`
      : `if (-not $gitBash) { $gitInstallerArgs = ${gitInstallerArgs}; $gitInstaller = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.installRootDir + '\\Git-installer.exe')}); Invoke-WebRequest -Uri ${quotePowerShell(GIT_FOR_WINDOWS_EXE_URL)} -OutFile $gitInstaller; $proc = Start-Process -FilePath $gitInstaller -ArgumentList $gitInstallerArgs -Wait -PassThru; $gitInstallerExitCode = $proc.ExitCode; if (Test-Path $gitInstaller) { Remove-Item -LiteralPath $gitInstaller -Force -ErrorAction SilentlyContinue }; if ($gitInstallerExitCode -ne 0) { throw "Git for Windows installer failed with exit code $gitInstallerExitCode." }; $fallbackBash = [System.IO.Path]::GetFullPath(${quotePowerShell(fallbackBashPath)}); if (Test-Path $fallbackBash) { $gitBash = $fallbackBash } }`,
    `if (-not $gitBash) { throw 'Failed to locate Git Bash for SDKMAN.' }`,
    `$sdkmanDir = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.sdkmanDir)})`,
    `if (Test-Path $sdkmanDir) { Remove-Item -LiteralPath $sdkmanDir -Recurse -Force }`,
    `$sdkmanSetupScriptPath = [System.IO.Path]::GetFullPath(${quotePowerShell(setupScriptPath)})`,
    `$sdkmanSetupScript = ${buildPowerShellHereString(sdkmanSetupBashScript)}`,
    `Set-Content -LiteralPath $sdkmanSetupScriptPath -Value $sdkmanSetupScript -Encoding Ascii -NoNewline`,
    `& $gitBash -lc ${quotePowerShellSingle(`bash ${quoteShell(setupScriptBashPath)}`)}`,
    `$sdkmanSetupExitCode = $LASTEXITCODE`,
    `if (Test-Path $sdkmanSetupScriptPath) { Remove-Item -LiteralPath $sdkmanSetupScriptPath -Force -ErrorAction SilentlyContinue }`,
    `if ($sdkmanSetupExitCode -ne 0) { throw "SDKMAN setup failed with exit code $sdkmanSetupExitCode." }`,
    `$localJavaDir = [System.IO.Path]::GetFullPath(${quotePowerShell(sdkmanLocalJavaDir)})`,
    `if (Test-Path $localJavaDir) { Remove-Item -LiteralPath $localJavaDir -Recurse -Force }`,
    `New-Item -ItemType Directory -Force -Path $localJavaDir | Out-Null`,
    ...(cachedArchiveDir
      ? [
          `Copy-Item -Path (Join-Path ${quotePowerShell(cachedArchiveDir)} '*') -Destination $localJavaDir -Recurse -Force`,
        ]
      : [
          `$extractRoot = [System.IO.Path]::GetFullPath(${quotePowerShell(extractRoot)})`,
          `if (Test-Path $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }`,
          `New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null`,
          `Expand-Archive -LiteralPath ${quotePowerShell(temurinArchivePath)} -DestinationPath $extractRoot -Force`,
          `$entries = @(Get-ChildItem -LiteralPath $extractRoot -Force)`,
          `$sourceRoot = if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { $entries[0].FullName } else { $extractRoot }`,
          `Get-ChildItem -LiteralPath $sourceRoot -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $localJavaDir -Force }`,
          `if (Test-Path $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }`,
        ]),
    `$sdkmanRegisterScriptPath = [System.IO.Path]::GetFullPath(${quotePowerShell(registerScriptPath)})`,
    `$sdkmanRegisterScript = ${buildPowerShellHereString(sdkmanRegisterBashScript)}`,
    `Set-Content -LiteralPath $sdkmanRegisterScriptPath -Value $sdkmanRegisterScript -Encoding Ascii -NoNewline`,
    `& $gitBash -lc ${quotePowerShellSingle(`bash ${quoteShell(registerScriptBashPath)}`)}`,
    `$sdkmanRegisterExitCode = $LASTEXITCODE`,
    `if (Test-Path $sdkmanRegisterScriptPath) { Remove-Item -LiteralPath $sdkmanRegisterScriptPath -Force -ErrorAction SilentlyContinue }`,
    `if ($sdkmanRegisterExitCode -ne 0) { throw "SDKMAN local Java registration failed with exit code $sdkmanRegisterExitCode." }`,
  ].join('; ')

  // SDKMAN on Windows requires Git Bash
  const commands = [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
  ]

  if (!resolvedDownloads) {
    const sdkmanCliUrl = `${SDKMAN_API_BASE}/broker/download/sdkman/install/${SDKMAN_CLI_VERSION}/${sdkmanPlatform}`
    commands.push(
      `Invoke-WebRequest -Uri ${quotePowerShell(sdkmanCliUrl)} -OutFile ${quotePowerShell(sdkmanCliZipPath)}`,
      `Invoke-WebRequest -Uri ${quotePowerShell(temurinArchiveUrl)} -OutFile ${quotePowerShell(temurinArchivePath)}`,
    )
  }

  commands.push(gitBashCommand)

  if (!resolvedDownloads) {
    commands.push(
      `if (Test-Path ${quotePowerShell(sdkmanCliZipPath)}) { Remove-Item -LiteralPath ${quotePowerShell(sdkmanCliZipPath)} -Force -ErrorAction SilentlyContinue }`,
      `if (Test-Path ${quotePowerShell(temurinArchivePath)}) { Remove-Item -LiteralPath ${quotePowerShell(temurinArchivePath)} -Force -ErrorAction SilentlyContinue }`,
    )
  }

  return commands
}

export function buildInstallCommands(
  input: JavaPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
  preparedSources?: PreparedJavaInstallSources,
): string[] {
  if (input.platform === 'darwin') {
    return input.javaManager === 'sdkman'
      ? buildDarwinSdkmanCommands(input, resolvedDownloads, preparedSources?.temurinArchiveDir)
      : buildDarwinStandaloneCommands(input, resolvedDownloads, preparedSources?.temurinArchiveDir)
  }

  return input.javaManager === 'sdkman'
    ? buildWindowsSdkmanCommands(input, resolvedDownloads, preparedSources?.temurinArchiveDir)
    : buildWindowsStandaloneCommands(input, resolvedDownloads, preparedSources?.temurinArchiveDir)
}

function buildVerifyCommands(input: JavaPluginParams): string[] {
  const installPaths = resolveJavaInstallPaths(input)

  if (input.platform === 'darwin' && input.javaManager === 'sdkman') {
    const versionCheckScript = [
      `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir)}`,
      `. ${quoteShell(`${installPaths.sdkmanDir}/bin/sdkman-init.sh`)}`,
      'java -version',
    ].join(' && ')
    const whichCheckScript = [
      `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir)}`,
      `. ${quoteShell(`${installPaths.sdkmanDir}/bin/sdkman-init.sh`)}`,
      'which java',
    ].join(' && ')

    return [versionCheckScript, whichCheckScript]
  }

  if (input.platform === 'darwin') {
    return [`${quoteShell(`${installPaths.standaloneJdkBinDir}/java`)} -version`]
  }

  if (input.javaManager === 'sdkman') {
    const fallbackBashPath = `${installPaths.installRootDir}\\git-bash\\bin\\bash.exe`
    const verifyScript = [
      `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir.replace(/\\/g, '/'))}`,
      '. "$SDKMAN_DIR/bin/sdkman-init.sh"',
      'java -version',
    ].join(' && ')
    return [
      `$gitBash = Get-Command 'bash.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1; if (-not $gitBash) { $fallbackBash = [System.IO.Path]::GetFullPath(${quotePowerShell(fallbackBashPath)}); if (Test-Path $fallbackBash) { $gitBash = $fallbackBash } }; if (-not $gitBash) { throw 'Git Bash not found for SDKMAN verify.' }; & $gitBash -lc ${quotePowerShellSingle(verifyScript)}`,
    ]
  }

  return [`& ${quotePowerShell(installPaths.standaloneJdkBinDir + '\\java.exe')} -version`]
}

async function runCommands(
  commands: string[],
  platform: JavaPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'java-env',
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
          : await execFileAsync('/bin/bash', ['-lc', command])
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
      onProgress?.({
        taskId: '',
        pluginId,
        type: 'command_error',
        message: command,
        commandIndex: index + 1,
        commandTotal: commands.length,
        output: [e.stdout?.trim(), e.stderr?.trim(), e.message ?? String(err)]
          .filter(Boolean)
          .join('\n'),
        timestamp: new Date().toISOString(),
      })
      throw Object.assign(new Error(e.message ?? String(err)), { commandOutput: output })
    }
  }
  return output
}

const javaEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toJavaParams(input)
    const installPaths = resolveJavaInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const envChanges = buildJavaEnvChanges(params)
    let commands = buildInstallCommands(params)

    assertOfficialDownloadPlan(downloads)

    const logs = [
      `manager=${params.javaManager}`,
      `version=${params.javaVersion}`,
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

      let preparedSources: PreparedJavaInstallSources | undefined
      if (params.extractedCacheDir) {
        const extractStartedAt = Date.now()
        preparedSources = await prepareInstallSources(params, resolvedDownloads)
        if (preparedSources.entries.length > 0) {
          logs.push(
            ...preparedSources.entries.map(
              (entry) =>
                `extract_cache_hit=${entry.cacheHit} ${entry.label} sourcePath=${entry.path}`,
            ),
          )
          appendPhaseLog(
            logs,
            'extract_cache',
            extractStartedAt,
            `artifacts=${preparedSources.entries.length}`,
          )
        }
      }

      commands = buildInstallCommands(params, resolvedDownloads, preparedSources)
      const commandStartedAt = Date.now()
      const cmdOutput = await runCommands(commands, params.platform, input.onProgress)
      logs.push(...cmdOutput)
      appendPhaseLog(logs, 'install_commands', commandStartedAt, `commands=${commands.length}`)
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: params.javaVersion,
      paths: {
        installRootDir: params.installRootDir,
        jdkDir: installPaths.standaloneJdkDir,
        sdkmanDir: installPaths.sdkmanDir,
      },
      envChanges,
      downloads,
      commands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the Java environment.'
        : 'Completed the official-source Java environment install commands.',
      context: {
        javaManager: params.javaManager,
        javaVersion: params.javaVersion,
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toJavaParams(input)
    const downloads = buildDownloadPlan(params)
    const locale = input.locale ?? DEFAULT_LOCALE

    assertOfficialDownloadPlan(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 Java 版本：${params.javaVersion}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned Java version: ${params.javaVersion}`,
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
          ? [
              `已校验 Java 版本：${params.javaVersion}`,
              `已校验工具安装根目录：${params.installRootDir}`,
            ]
          : [
              `Verified Java version: ${params.javaVersion}`,
              `Verified tool install root: ${params.installRootDir}`,
            ]),
        ...verifyOutput,
      ],
    }
  },
}

export default javaEnvPlugin
