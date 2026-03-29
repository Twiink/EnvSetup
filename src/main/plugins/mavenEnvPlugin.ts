/**
 * 实现 Maven 在各平台上的安装与校验策略。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildMavenEnvChanges, resolveMavenInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
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

function buildArchiveFileName(input: MavenPluginParams): string {
  const extension = input.platform === 'win32' ? 'zip' : 'tar.gz'
  return `apache-maven-${input.mavenVersion}-bin.${extension}`
}

function buildArchiveUrl(input: MavenPluginParams): string {
  return `${MAVEN_ARCHIVE_BASE_URL}/${input.mavenVersion}/binaries/${buildArchiveFileName(input)}`
}

function buildDownloadPlan(input: MavenPluginParams): DownloadArtifact[] {
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

  if (input.mavenManager !== 'maven') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'maven-env 需要 mavenManager=maven',
        en: 'maven-env requires mavenManager=maven',
      }),
    )
  }

  if (typeof input.mavenVersion !== 'string' || input.mavenVersion.length === 0) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'maven-env 缺少 mavenVersion',
        en: 'maven-env requires mavenVersion',
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
    mavenManager: 'maven',
    mavenVersion: input.mavenVersion,
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

function buildWin32InstallCommands(
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
    `Remove-Item -LiteralPath ${quotePowerShell(installPaths.standaloneMavenDir)} -Recurse -Force -ErrorAction SilentlyContinue`,
    `Remove-Item -LiteralPath ${quotePowerShell(extractedDir)} -Recurse -Force -ErrorAction SilentlyContinue`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.installRootDir)} -Force`,
    `Move-Item -LiteralPath ${quotePowerShell(extractedDir)} -Destination ${quotePowerShell(installPaths.standaloneMavenDir)} -Force`,
    `$env:MAVEN_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:M2_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneMavenBinDir)} + ';' + $env:Path; & ${quotePowerShell(`${installPaths.standaloneMavenBinDir}\\mvn.cmd`)} -version`,
  ]
}

function buildInstallCommands(
  input: MavenPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  return input.platform === 'win32'
    ? buildWin32InstallCommands(input, resolvedDownloads)
    : buildDarwinInstallCommands(input, resolvedDownloads)
}

function buildVerifyCommands(input: MavenPluginParams): string[] {
  const installPaths = resolveMavenInstallPaths(input)

  if (input.platform === 'win32') {
    return [
      `$env:MAVEN_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:M2_HOME = ${quotePowerShell(installPaths.standaloneMavenDir)}; $env:Path = ${quotePowerShell(installPaths.standaloneMavenBinDir)} + ';' + $env:Path; & ${quotePowerShell(`${installPaths.standaloneMavenBinDir}\\mvn.cmd`)} -version`,
    ]
  }

  return [
    `export MAVEN_HOME=${quoteShell(installPaths.standaloneMavenDir)} && export M2_HOME=${quoteShell(installPaths.standaloneMavenDir)} && export PATH="${installPaths.standaloneMavenBinDir}:$PATH" && mvn -version`,
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

const mavenEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toMavenParams(input)
    const installPaths = resolveMavenInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const envChanges = buildMavenEnvChanges(params)
    let commands = buildInstallCommands(params)

    validateOfficialDownloads(downloads)

    const logs = [
      `manager=${params.mavenManager}`,
      `version=${params.mavenVersion}`,
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
      version: params.mavenVersion,
      paths: {
        installRootDir: params.installRootDir,
        mavenDir: installPaths.standaloneMavenDir,
        mavenBinDir: installPaths.standaloneMavenBinDir,
      },
      envChanges,
      downloads,
      commands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the Maven environment.'
        : 'Completed the official-source Maven environment install commands.',
      context: {
        mavenManager: params.mavenManager,
        mavenVersion: params.mavenVersion,
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
                `计划安装的 Maven 版本：${params.mavenVersion}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned Maven version: ${params.mavenVersion}`,
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
              `已校验 Maven 版本：${params.mavenVersion}`,
              `已校验工具安装根目录：${params.installRootDir}`,
            ]
          : [
              `Verified Maven version: ${params.mavenVersion}`,
              `Verified tool install root: ${params.installRootDir}`,
            ]),
        ...verifyOutput,
      ],
    }
  },
}

export default mavenEnvPlugin
