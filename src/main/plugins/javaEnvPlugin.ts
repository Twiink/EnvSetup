import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildJavaEnvChanges, resolveJavaInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import type {
  AppLocale,
  DownloadArtifact,
  JavaPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const ADOPTIUM_BINARY_BASE_URL = 'https://api.adoptium.net/v3/binary/latest'
const SDKMAN_INSTALL_URL = 'https://get.sdkman.io?ci=true&rcupdate=false'
const GIT_FOR_WINDOWS_VERSION = '2.47.1'
const GIT_FOR_WINDOWS_EXE_URL = `https://github.com/git-for-windows/git/releases/download/v${GIT_FOR_WINDOWS_VERSION}.windows.1/Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`

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

  const downloads: DownloadArtifact[] = [
    {
      kind: 'installer',
      tool: 'sdkman',
      url: SDKMAN_INSTALL_URL,
      official: true,
      fileName: 'sdkman-install.sh',
      note: 'Download the official SDKMAN install script with rc updates disabled.',
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
  }
}

function buildDarwinStandaloneCommands(input: JavaPluginParams): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const archiveUrl = buildTemurinBinaryUrl(input)
  const archivePath = `${installPaths.installRootDir}/temurin-jdk-${input.javaVersion}.tar.gz`

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `curl -fsSL ${quoteShell(archiveUrl)} -o ${quoteShell(archivePath)}`,
    `mkdir -p ${quoteShell(installPaths.standaloneJdkDir)}`,
    `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.standaloneJdkDir)} --strip-components=1`,
    `rm -f ${quoteShell(archivePath)}`,
    `export JAVA_HOME=${quoteShell(installPaths.standaloneJdkDir)} && export PATH="${installPaths.standaloneJdkBinDir}:$PATH" && java -version`,
  ]
}

function buildDarwinSdkmanCommands(input: JavaPluginParams): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const featureVersion = extractFeatureVersion(input.javaVersion)

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `rm -rf ${quoteShell(installPaths.sdkmanDir)}`,
    `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir)} && curl -fsSL ${quoteShell(SDKMAN_INSTALL_URL)} | bash && . ${quoteShell(`${installPaths.sdkmanDir}/bin/sdkman-init.sh`)} && sdk install java ${featureVersion}.0-tem && java -version`,
  ]
}

function buildWindowsStandaloneCommands(input: JavaPluginParams): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const archiveUrl = buildTemurinBinaryUrl(input)
  const archivePath = `${installPaths.installRootDir}\\temurin-jdk-${input.javaVersion}.zip`

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `Invoke-WebRequest -Uri ${quotePowerShell(archiveUrl)} -OutFile ${quotePowerShell(archivePath)}`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.standaloneJdkDir)} | Out-Null`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.installRootDir)} -Force`,
    // Temurin extracts to a directory like jdk-21.0.6+7; move its contents
    `$extracted = Get-ChildItem -Path ${quotePowerShell(installPaths.installRootDir)} -Directory | Where-Object { $_.Name -like 'jdk-*' } | Select-Object -First 1; if ($extracted) { Move-Item -Path "$($extracted.FullName)\\*" -Destination ${quotePowerShell(installPaths.standaloneJdkDir)} -Force; Remove-Item -LiteralPath $extracted.FullName -Recurse -Force }`,
    `Remove-Item -LiteralPath ${quotePowerShell(archivePath)} -Force`,
    `$env:JAVA_HOME = ${quotePowerShell(installPaths.standaloneJdkDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneJdkBinDir)} + ';' + $env:Path; & ${quotePowerShell(installPaths.standaloneJdkBinDir + '\\java.exe')} -version`,
  ]
}

function buildWindowsSdkmanCommands(input: JavaPluginParams): string[] {
  const installPaths = resolveJavaInstallPaths(input)
  const featureVersion = extractFeatureVersion(input.javaVersion)
  const gitBashDir = `${installPaths.installRootDir}\\git-bash`
  const fallbackBashPath = `${gitBashDir}\\bin\\bash.exe`
  const bashScript = [
    `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir.replace(/\\/g, '/'))}`,
    'rm -rf "$SDKMAN_DIR"',
    `curl -fsSL ${quoteShell(SDKMAN_INSTALL_URL)} | bash`,
    '. "$SDKMAN_DIR/bin/sdkman-init.sh"',
    `sdk install java ${featureVersion}.0-tem`,
    'java -version',
  ].join(' && ')

  // SDKMAN on Windows requires Git Bash
  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `$gitBash = Get-Command 'bash.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1; if (-not $gitBash) { $gitInstaller = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.installRootDir + '\\Git-installer.exe')}); Invoke-WebRequest -Uri ${quotePowerShell(GIT_FOR_WINDOWS_EXE_URL)} -OutFile $gitInstaller; Start-Process -FilePath $gitInstaller -ArgumentList '/VERYSILENT','/NORESTART','/DIR=${gitBashDir}' -Wait -NoNewWindow; Remove-Item -LiteralPath $gitInstaller -Force; $fallbackBash = [System.IO.Path]::GetFullPath(${quotePowerShell(fallbackBashPath)}); if (Test-Path $fallbackBash) { $gitBash = $fallbackBash } }; if (-not $gitBash) { throw 'Failed to locate Git Bash for SDKMAN.' }`,
    `& $gitBash -lc ${quotePowerShellSingle(bashScript)}`,
  ]
}

export function buildInstallCommands(input: JavaPluginParams): string[] {
  if (input.platform === 'darwin') {
    return input.javaManager === 'sdkman'
      ? buildDarwinSdkmanCommands(input)
      : buildDarwinStandaloneCommands(input)
  }

  return input.javaManager === 'sdkman'
    ? buildWindowsSdkmanCommands(input)
    : buildWindowsStandaloneCommands(input)
}

function buildVerifyCommands(input: JavaPluginParams): string[] {
  const installPaths = resolveJavaInstallPaths(input)

  if (input.platform === 'darwin' && input.javaManager === 'sdkman') {
    return [
      `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir)} && . ${quoteShell(`${installPaths.sdkmanDir}/bin/sdkman-init.sh`)} && java -version`,
      `export SDKMAN_DIR=${quoteShell(installPaths.sdkmanDir)} && . ${quoteShell(`${installPaths.sdkmanDir}/bin/sdkman-init.sh`)} && which java`,
    ]
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
    const commands = buildInstallCommands(params)
    const envChanges = buildJavaEnvChanges(params)

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

      const resolvedDownloads = await downloadArtifacts({
        downloads,
        cacheDir: params.downloadCacheDir,
      })
      logs.push(
        ...resolvedDownloads.map(
          (item) => `download_cache_hit=${item.cacheHit} ${item.artifact.url}`,
        ),
      )

      const cmdOutput = await runCommands(commands, params.platform, input.onProgress)
      logs.push(...cmdOutput)
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
