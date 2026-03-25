import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildFrontendEnvChanges, resolveFrontendInstallPaths } from '../core/platform'
import type {
  AppLocale,
  DownloadArtifact,
  FrontendPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const NODEJS_DIST_BASE_URL = 'https://nodejs.org/dist'
const NVM_ARCHIVE_BASE_URL = 'https://github.com/nvm-sh/nvm/archive/refs/tags'
const NVM_WINDOWS_RELEASE_BASE_URL = 'https://github.com/coreybutler/nvm-windows/releases/download'
const PINNED_NVM_VERSION = '0.40.4'
const PINNED_NVM_WINDOWS_VERSION = '1.2.2'

const OFFICIAL_DOWNLOAD_HOSTS: Record<DownloadArtifact['tool'], Set<string>> = {
  node: new Set(['nodejs.org']),
  nvm: new Set(['github.com']),
  'nvm-windows': new Set(['github.com']),
}

function translate(locale: AppLocale, text: { 'zh-CN': string; en: string }): string {
  return text[locale]
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quoteShellDouble(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function quotePowerShell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function resolveNodeArchiveBasename(input: FrontendPluginParams): string {
  const architecture = input.platform === 'win32' ? 'x64' : process.arch === 'x64' ? 'x64' : 'arm64'

  return input.platform === 'win32'
    ? `node-v${input.nodeVersion}-win-${architecture}.zip`
    : `node-v${input.nodeVersion}-darwin-${architecture}.tar.gz`
}

function buildNodeArchiveUrl(input: FrontendPluginParams): string {
  const archiveName = resolveNodeArchiveBasename(input)
  return `${NODEJS_DIST_BASE_URL}/v${input.nodeVersion}/${archiveName}`
}

function buildNodeChecksumUrl(input: FrontendPluginParams): string {
  return `${NODEJS_DIST_BASE_URL}/v${input.nodeVersion}/SHASUMS256.txt`
}

function buildDownloadPlan(input: FrontendPluginParams): DownloadArtifact[] {
  if (input.nodeManager === 'node') {
    return [
      {
        kind: 'archive',
        tool: 'node',
        url: buildNodeArchiveUrl(input),
        official: true,
        checksumUrl: buildNodeChecksumUrl(input),
        checksumAlgorithm: 'sha256',
        note: 'Download the standalone Node.js archive from nodejs.org.',
      },
    ]
  }

  if (input.platform === 'darwin') {
    return [
      {
        kind: 'archive',
        tool: 'nvm',
        url: `${NVM_ARCHIVE_BASE_URL}/v${PINNED_NVM_VERSION}.tar.gz`,
        official: true,
        note: 'Download nvm from the official nvm-sh GitHub repository archive.',
      },
      {
        kind: 'mirror',
        tool: 'node',
        url: NODEJS_DIST_BASE_URL,
        official: true,
        note: 'Force nvm to download Node.js from nodejs.org.',
      },
    ]
  }

  return [
    {
      kind: 'archive',
      tool: 'nvm-windows',
      url: `${NVM_WINDOWS_RELEASE_BASE_URL}/${PINNED_NVM_WINDOWS_VERSION}/nvm-noinstall.zip`,
      official: true,
      note: 'Download nvm-windows from the official coreybutler GitHub release.',
    },
    {
      kind: 'mirror',
      tool: 'node',
      url: NODEJS_DIST_BASE_URL,
      official: true,
      note: 'Force nvm-windows to download Node.js from nodejs.org.',
    },
  ]
}

function assertOfficialDownloadPlan(downloads: DownloadArtifact[]): void {
  for (const download of downloads) {
    const allowedHosts = OFFICIAL_DOWNLOAD_HOSTS[download.tool]
    const host = new URL(download.url).host

    if (!allowedHosts.has(host)) {
      throw new Error(`Unofficial download host detected for ${download.tool}: ${download.url}`)
    }

    if (download.checksumUrl) {
      const checksumHost = new URL(download.checksumUrl).host
      if (!allowedHosts.has(checksumHost)) {
        throw new Error(
          `Unofficial checksum host detected for ${download.tool}: ${download.checksumUrl}`,
        )
      }
    }
  }
}

function toFrontendParams(input: PluginExecutionInput): FrontendPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (input.nodeManager !== 'node' && input.nodeManager !== 'nvm') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'frontend-env 需要 nodeManager=node|nvm',
        en: 'frontend-env requires nodeManager=node|nvm',
      }),
    )
  }

  if (typeof input.nodeVersion !== 'string' || input.nodeVersion.length === 0) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'frontend-env 缺少 nodeVersion',
        en: 'frontend-env requires nodeVersion',
      }),
    )
  }

  const installRootDir =
    typeof input.installRootDir === 'string' && input.installRootDir.length > 0
      ? input.installRootDir
      : process.env.ENVSETUP_INSTALL_ROOT ?? ''

  if (installRootDir.length === 0) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'frontend-env 缺少工具安装根目录',
        en: 'frontend-env requires an install root directory',
      }),
    )
  }

  if (typeof input.npmCacheDir !== 'string' || typeof input.npmGlobalPrefix !== 'string') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'frontend-env 缺少 npm 缓存目录或全局安装目录',
        en: 'frontend-env requires npm cache and global prefix paths',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'frontend-env 仅支持 darwin 和 win32',
        en: 'frontend-env supports only darwin and win32',
      }),
    )
  }

  return {
    nodeManager: input.nodeManager,
    nodeVersion: input.nodeVersion,
    installRootDir,
    npmCacheDir: input.npmCacheDir,
    npmGlobalPrefix: input.npmGlobalPrefix,
    platform: input.platform,
    dryRun: input.dryRun,
  }
}

function buildDarwinStandaloneCommands(input: FrontendPluginParams): string[] {
  const installPaths = resolveFrontendInstallPaths(input)
  const archiveUrl = buildNodeArchiveUrl(input)
  const checksumUrl = buildNodeChecksumUrl(input)
  const archiveName = resolveNodeArchiveBasename(input)
  const archivePath = `${installPaths.installRootDir}/${archiveName}`
  const checksumPath = `${installPaths.installRootDir}/SHASUMS256.txt`
  const extractedNodeDir = archiveName.replace(/\.tar\.gz$/, '')

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)} ${quoteShell(input.npmCacheDir)} ${quoteShell(input.npmGlobalPrefix)}`,
    `curl -fsSL ${quoteShell(archiveUrl)} -o ${quoteShell(archivePath)}`,
    `curl -fsSL ${quoteShell(checksumUrl)} -o ${quoteShell(checksumPath)}`,
    `(cd ${quoteShell(installPaths.installRootDir)} && grep ${quoteShell(` ${archiveName}$`)} SHASUMS256.txt | shasum -a 256 -c -)`,
    `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.installRootDir)}`,
    `rm -rf ${quoteShell(installPaths.standaloneNodeDir)} && mv ${quoteShell(`${installPaths.installRootDir}/${extractedNodeDir}`)} ${quoteShell(installPaths.standaloneNodeDir)}`,
    `export PATH=${quoteShellDouble(`${installPaths.standaloneNodeBinDir}:$PATH`)} && npm config set cache ${quoteShell(input.npmCacheDir)} && npm config set prefix ${quoteShell(input.npmGlobalPrefix)}`,
  ]
}

function buildDarwinNvmCommands(input: FrontendPluginParams): string[] {
  const installPaths = resolveFrontendInstallPaths(input)
  const archiveUrl = `${NVM_ARCHIVE_BASE_URL}/v${PINNED_NVM_VERSION}.tar.gz`
  const archivePath = `${installPaths.installRootDir}/nvm-v${PINNED_NVM_VERSION}.tar.gz`
  const extractedDir = `${installPaths.installRootDir}/nvm-${PINNED_NVM_VERSION}`

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)} ${quoteShell(installPaths.nvmDir)} ${quoteShell(input.npmCacheDir)} ${quoteShell(input.npmGlobalPrefix)}`,
    `curl -fsSL ${quoteShell(archiveUrl)} -o ${quoteShell(archivePath)}`,
    `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.installRootDir)}`,
    `cp -R ${quoteShell(`${extractedDir}/.`)} ${quoteShell(installPaths.nvmDir)}`,
    `rm -rf ${quoteShell(extractedDir)} ${quoteShell(archivePath)}`,
    `unset npm_config_prefix npm_config_globalconfig; if command -v npm >/dev/null 2>&1; then npm config delete prefix 2>/dev/null || true; npm config delete globalconfig 2>/dev/null || true; fi; export NVM_DIR=${quoteShell(installPaths.nvmDir)} NVM_NODEJS_ORG_MIRROR=${quoteShell(installPaths.nvmNodeMirror)} && . ${quoteShell(`${installPaths.nvmDir}/nvm.sh`)} && nvm install ${input.nodeVersion} && nvm alias default ${input.nodeVersion} && npm config set cache ${quoteShell(input.npmCacheDir)} && npm config set prefix ${quoteShell(input.npmGlobalPrefix)}`,
  ]
}

function buildWindowsStandaloneCommands(input: FrontendPluginParams): string[] {
  const installPaths = resolveFrontendInstallPaths(input)
  const archiveUrl = buildNodeArchiveUrl(input)
  const checksumUrl = buildNodeChecksumUrl(input)
  const archiveName = resolveNodeArchiveBasename(input)
  const archivePath = `${installPaths.installRootDir}\\${archiveName}`
  const checksumPath = `${installPaths.installRootDir}\\SHASUMS256.txt`
  const extractedNodeDir = `${installPaths.installRootDir}\\${archiveName.replace(/\.zip$/, '')}`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(input.npmCacheDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(input.npmGlobalPrefix)} | Out-Null`,
    `Invoke-WebRequest -Uri ${quotePowerShell(archiveUrl)} -OutFile ${quotePowerShell(archivePath)}`,
    `Invoke-WebRequest -Uri ${quotePowerShell(checksumUrl)} -OutFile ${quotePowerShell(checksumPath)}`,
    `$expectedHash = ((Select-String -Path ${quotePowerShell(checksumPath)} -Pattern ${quotePowerShell(` ${archiveName}$`)}).Line -split '\\s+')[0]`,
    `if ((Get-FileHash -Algorithm SHA256 -Path ${quotePowerShell(archivePath)}).Hash.ToLower() -ne $expectedHash.ToLower()) { throw 'Node.js checksum verification failed.' }`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.installRootDir)} -Force`,
    `if (Test-Path ${quotePowerShell(installPaths.standaloneNodeDir)}) { Remove-Item -LiteralPath ${quotePowerShell(installPaths.standaloneNodeDir)} -Recurse -Force }`,
    `Move-Item -LiteralPath ${quotePowerShell(extractedNodeDir)} -Destination ${quotePowerShell(installPaths.standaloneNodeDir)} -Force`,
    `$env:Path = ${quotePowerShell(`${installPaths.standaloneNodeBinDir};$env:Path`)}`,
    `& ${quotePowerShell(`${installPaths.standaloneNodeBinDir}\\npm.cmd`)} config set cache ${quotePowerShell(input.npmCacheDir)}`,
    `& ${quotePowerShell(`${installPaths.standaloneNodeBinDir}\\npm.cmd`)} config set prefix ${quotePowerShell(input.npmGlobalPrefix)}`,
  ]
}

function buildWindowsNvmCommands(input: FrontendPluginParams): string[] {
  const installPaths = resolveFrontendInstallPaths(input)
  const archiveUrl = `${NVM_WINDOWS_RELEASE_BASE_URL}/${PINNED_NVM_WINDOWS_VERSION}/nvm-noinstall.zip`
  const archivePath = `${installPaths.installRootDir}\\nvm-noinstall.zip`
  const settingsPath = `${installPaths.nvmDir}\\settings.txt`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.nvmDir)} | Out-Null`,
    // Do NOT pre-create nvmWindowsSymlinkDir — nvm-windows creates it as a directory junction via `nvm use`.
    // Pre-creating it as a real directory prevents the junction from being established.
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(input.npmCacheDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(input.npmGlobalPrefix)} | Out-Null`,
    `Invoke-WebRequest -Uri ${quotePowerShell(archiveUrl)} -OutFile ${quotePowerShell(archivePath)}`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.nvmDir)} -Force`,
    `@('root: ${installPaths.nvmDir}','path: ${installPaths.nvmWindowsSymlinkDir}','arch: 64','proxy: none','node_mirror: ${NODEJS_DIST_BASE_URL}/') | Set-Content -LiteralPath ${quotePowerShell(settingsPath)} -Encoding ASCII`,
    `$ErrorActionPreference = 'Stop'; $_nvm = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.nvmDir)}); $_sym = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.nvmWindowsSymlinkDir)}); $_ver = "$_nvm\\v${input.nodeVersion}"; $env:NVM_HOME = $_nvm; $env:NVM_SYMLINK = $_sym; $env:Path = $_nvm + ';' + $_sym + ';' + $env:Path; & "$_nvm\\nvm.exe" install ${input.nodeVersion}; if ($LASTEXITCODE -ne 0) { throw "nvm install failed (exit code $LASTEXITCODE)" }; & "$_nvm\\nvm.exe" use ${input.nodeVersion}; if (!(Test-Path "$_sym\\node.exe")) { if (Test-Path $_sym) { Remove-Item -LiteralPath $_sym -Recurse -Force }; cmd /c mklink /J "$_sym" "$_ver"; if (!(Test-Path "$_sym\\node.exe")) { throw "junction creation failed" } }; & "$_sym\\npm.cmd" config set cache ${quotePowerShell(input.npmCacheDir)}; & "$_sym\\npm.cmd" config set prefix ${quotePowerShell(input.npmGlobalPrefix)}`,
  ]
}

export function buildInstallCommands(input: FrontendPluginParams): string[] {
  if (input.platform === 'darwin') {
    return input.nodeManager === 'nvm'
      ? buildDarwinNvmCommands(input)
      : buildDarwinStandaloneCommands(input)
  }

  return input.nodeManager === 'nvm'
    ? buildWindowsNvmCommands(input)
    : buildWindowsStandaloneCommands(input)
}

function buildVerifyCommands(input: FrontendPluginParams): string[] {
  const installPaths = resolveFrontendInstallPaths(input)

  if (input.platform === 'darwin' && input.nodeManager === 'nvm') {
    return [
      `unset npm_config_prefix npm_config_globalconfig; if command -v npm >/dev/null 2>&1; then npm config delete prefix 2>/dev/null || true; npm config delete globalconfig 2>/dev/null || true; fi; export NVM_DIR=${quoteShell(installPaths.nvmDir)} NVM_NODEJS_ORG_MIRROR=${quoteShell(installPaths.nvmNodeMirror)} && . ${quoteShell(`${installPaths.nvmDir}/nvm.sh`)} && nvm which ${input.nodeVersion}`,
      `unset npm_config_prefix npm_config_globalconfig; if command -v npm >/dev/null 2>&1; then npm config delete prefix 2>/dev/null || true; npm config delete globalconfig 2>/dev/null || true; fi; export NVM_DIR=${quoteShell(installPaths.nvmDir)} NVM_NODEJS_ORG_MIRROR=${quoteShell(installPaths.nvmNodeMirror)} && . ${quoteShell(`${installPaths.nvmDir}/nvm.sh`)} && npm config get cache && npm config get prefix`,
    ]
  }

  if (input.platform === 'darwin') {
    return [
      `${quoteShell(`${installPaths.standaloneNodeBinDir}/node`)} --version`,
      `${quoteShell(`${installPaths.standaloneNodeBinDir}/npm`)} config get cache`,
      `${quoteShell(`${installPaths.standaloneNodeBinDir}/npm`)} config get prefix`,
    ]
  }

  if (input.nodeManager === 'nvm') {
    return [
      `$_nvm = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.nvmDir)}); $_sym = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.nvmWindowsSymlinkDir)}); $env:NVM_HOME = $_nvm; $env:NVM_SYMLINK = $_sym; $env:Path = $_nvm + ';' + $_sym + ';' + $env:Path; & "$_sym\\node.exe" --version; & "$_sym\\npm.cmd" config get cache; & "$_sym\\npm.cmd" config get prefix`,
    ]
  }

  return [
    `$_bin = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.standaloneNodeBinDir)}); & "$_bin\\node.exe" --version; & "$_bin\\npm.cmd" config get cache; & "$_bin\\npm.cmd" config get prefix`,
  ]
}

async function runCommands(
  commands: string[],
  platform: FrontendPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'frontend-env',
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
          : await execFileAsync('sh', ['-c', command])
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
        output: [e.stdout?.trim(), e.stderr?.trim(), e.message ?? String(err)].filter(Boolean).join('\n'),
        timestamp: new Date().toISOString(),
      })
      throw Object.assign(new Error(e.message ?? String(err)), { commandOutput: output })
    }
  }
  return output
}

const frontendEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toFrontendParams(input)
    const installPaths = resolveFrontendInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const commands = buildInstallCommands(params)
    const envChanges = buildFrontendEnvChanges(params)

    assertOfficialDownloadPlan(downloads)

    const logs = [
      `manager=${params.nodeManager}`,
      `version=${params.nodeVersion}`,
      `installRoot=${params.installRootDir}`,
      `cache=${params.npmCacheDir}`,
      `prefix=${params.npmGlobalPrefix}`,
      `nodeSource=${downloads.find((download) => download.tool === 'node')?.url ?? NODEJS_DIST_BASE_URL}`,
      `mode=${params.dryRun ? 'dry-run' : 'real-run'}`,
    ]

    if (!params.dryRun) {
      const cmdOutput = await runCommands(commands, params.platform, input.onProgress)
      logs.push(...cmdOutput)
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: params.nodeVersion,
      paths: {
        installRootDir: params.installRootDir,
        nodeInstallDir: installPaths.standaloneNodeDir,
        nvmDir: installPaths.nvmDir,
        npmCacheDir: params.npmCacheDir,
        npmGlobalPrefix: params.npmGlobalPrefix,
      },
      envChanges,
      downloads,
      commands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the frontend environment.'
        : 'Completed the official-source frontend environment install commands.',
      context: {
        nodeManager: params.nodeManager,
        nodeVersion: params.nodeVersion,
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toFrontendParams(input)
    const downloads = buildDownloadPlan(params)
    const locale = input.locale ?? DEFAULT_LOCALE

    assertOfficialDownloadPlan(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 Node 版本：${params.nodeVersion}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
                `计划设置的 npm 缓存目录：${params.npmCacheDir}`,
                `计划设置的 npm 全局安装目录：${params.npmGlobalPrefix}`,
              ]
            : [
                `Planned Node version: ${params.nodeVersion}`,
                `Planned tool install root: ${params.installRootDir}`,
                `Planned official download sources: ${downloads.map((download) => download.url).join(' | ')}`,
                `Planned npm cache directory: ${params.npmCacheDir}`,
                `Planned npm global install directory: ${params.npmGlobalPrefix}`,
              ],
      }
    }

    const verifyOutput = await runCommands(buildVerifyCommands(params), params.platform, input.onProgress)

    return {
      status: 'verified_success',
      checks: [
        ...(locale === 'zh-CN'
          ? [
              `已校验 Node 版本：${params.nodeVersion}`,
              `已校验工具安装根目录：${params.installRootDir}`,
              `已校验 npm 缓存目录：${params.npmCacheDir}`,
              `已校验 npm 全局安装目录：${params.npmGlobalPrefix}`,
            ]
          : [
              `Verified Node version: ${params.nodeVersion}`,
              `Verified tool install root: ${params.installRootDir}`,
              `Verified npm cache directory: ${params.npmCacheDir}`,
              `Verified npm global install directory: ${params.npmGlobalPrefix}`,
            ]),
        ...verifyOutput,
      ],
    }
  },
}

export default frontendEnvPlugin
