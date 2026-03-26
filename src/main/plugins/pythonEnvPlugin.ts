import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildPythonEnvChanges, resolvePythonInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import type {
  AppLocale,
  DownloadArtifact,
  PythonPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
  TaskProgressEvent,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

const execFileAsync = promisify(execFile)

const PYTHON_FTP_BASE_URL = 'https://www.python.org/ftp/python'
const MINICONDA_BASE_URL = 'https://repo.anaconda.com/miniconda'

function translate(locale: AppLocale, text: { 'zh-CN': string; en: string }): string {
  return text[locale]
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quotePowerShell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function resolvePythonArch(): string {
  return process.arch === 'x64' ? 'x86_64' : 'arm64'
}

/** @deprecated Retained for potential future source-compilation option. Not called in production. */
function buildPythonSourceUrl(input: PythonPluginParams): string {
  return `${PYTHON_FTP_BASE_URL}/${input.pythonVersion}/Python-${input.pythonVersion}.tar.xz`
}

function buildPythonWindowsEmbedUrl(input: PythonPluginParams): string {
  return `${PYTHON_FTP_BASE_URL}/${input.pythonVersion}/python-${input.pythonVersion}-embed-amd64.zip`
}

function buildMinicondaUrl(input: PythonPluginParams): string {
  if (input.platform === 'darwin') {
    const arch = resolvePythonArch()
    return `${MINICONDA_BASE_URL}/Miniconda3-latest-MacOSX-${arch}.sh`
  }
  return `${MINICONDA_BASE_URL}/Miniconda3-latest-Windows-x86_64.exe`
}

function buildDownloadPlan(input: PythonPluginParams): DownloadArtifact[] {
  if (input.pythonManager === 'python') {
    if (input.platform === 'darwin') {
      // Use precompiled .pkg installer instead of source compilation
      return [
        {
          kind: 'installer',
          tool: 'python',
          url: buildPythonPkgUrl(input),
          official: true,
          note: 'Download the official Python .pkg installer from python.org.',
          fileName: `python-${input.pythonVersion}-macos11.pkg`,
        },
      ]
    }
    return [
      {
        kind: 'archive',
        tool: 'python',
        url: buildPythonWindowsEmbedUrl(input),
        official: true,
        note: 'Download the Python embeddable zip from python.org.',
        fileName: `python-${input.pythonVersion}-embed-amd64.zip`,
      },
    ]
  }

  if (input.pythonManager === 'pkg') {
    return [
      {
        kind: 'installer',
        tool: 'python',
        url: buildPythonPkgUrl(input),
        official: true,
        note: 'Download the official Python .pkg installer from python.org.',
        fileName: `python-${input.pythonVersion}-macos11.pkg`,
      },
    ]
  }

  // conda mode
  return [
    {
      kind: 'installer',
      tool: 'miniconda',
      url: buildMinicondaUrl(input),
      official: true,
      note: 'Download the Miniconda installer from repo.anaconda.com.',
      fileName:
        input.platform === 'darwin'
          ? `Miniconda3-latest-MacOSX-${resolvePythonArch()}.sh`
          : 'Miniconda3-latest-Windows-x86_64.exe',
    },
  ]
}

export function planPythonDownloads(input: PluginExecutionInput): DownloadArtifact[] {
  const params = toPythonParams(input)
  const downloads = buildDownloadPlan(params)
  assertOfficialDownloadPlan(downloads)
  return downloads
}

function assertOfficialDownloadPlan(downloads: DownloadArtifact[]): void {
  validateOfficialDownloads(downloads)
}

function toPythonParams(input: PluginExecutionInput): PythonPluginParams {
  const locale = input.locale ?? DEFAULT_LOCALE

  if (
    input.pythonManager !== 'python' &&
    input.pythonManager !== 'conda' &&
    input.pythonManager !== 'pkg'
  ) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'python-env 需要 pythonManager=python|conda|pkg',
        en: 'python-env requires pythonManager=python|conda|pkg',
      }),
    )
  }

  if (typeof input.pythonVersion !== 'string' || input.pythonVersion.length === 0) {
    throw new Error(
      translate(locale, {
        'zh-CN': 'python-env 缺少 pythonVersion',
        en: 'python-env requires pythonVersion',
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
        'zh-CN': 'python-env 缺少工具安装根目录',
        en: 'python-env requires an install root directory',
      }),
    )
  }

  if (input.platform !== 'darwin' && input.platform !== 'win32') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'python-env 仅支持 darwin 和 win32',
        en: 'python-env supports only darwin and win32',
      }),
    )
  }

  if (input.pythonManager === 'pkg' && input.platform !== 'darwin') {
    throw new Error(
      translate(locale, {
        'zh-CN': 'python-env 的 pkg 管理器仅支持 macOS',
        en: 'python-env pkg manager is only supported on macOS',
      }),
    )
  }

  return {
    pythonManager: input.pythonManager,
    pythonVersion: input.pythonVersion,
    installRootDir,
    condaEnvName: typeof input.condaEnvName === 'string' ? input.condaEnvName : undefined,
    platform: input.platform,
    dryRun: input.dryRun,
    downloadCacheDir:
      typeof input.downloadCacheDir === 'string' ? input.downloadCacheDir : undefined,
  }
}

function buildPythonPkgUrl(input: PythonPluginParams): string {
  return `${PYTHON_FTP_BASE_URL}/${input.pythonVersion}/python-${input.pythonVersion}-macos11.pkg`
}

/** Extract major.minor from a version string like '3.12.10' */
function extractPythonMajorMinor(version: string): string {
  const parts = version.split('.')
  return `${parts[0]}.${parts[1]}`
}

function buildDarwinPkgCommands(input: PythonPluginParams): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const pkgUrl = buildPythonPkgUrl(input)
  const installerPath = `${installPaths.installRootDir}/python-${input.pythonVersion}.pkg`
  const expandDir = `${installPaths.installRootDir}/python-pkg-expanded`
  const majorMinor = extractPythonMajorMinor(input.pythonVersion)

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `curl -fsSL ${quoteShell(pkgUrl)} -o ${quoteShell(installerPath)}`,
    `pkgutil --expand-full ${quoteShell(installerPath)} ${quoteShell(expandDir)}`,
    `FRAMEWORK_DIR=$(find ${quoteShell(expandDir)} -path ${quoteShell(`*/Python.framework/Versions/${majorMinor}`)} -type d | head -n 1); [ -n "$FRAMEWORK_DIR" ] && mkdir -p ${quoteShell(installPaths.standalonePythonDir)} && cp -R "$FRAMEWORK_DIR"/. ${quoteShell(installPaths.standalonePythonDir)}/`,
    `rm -rf ${quoteShell(expandDir)} ${quoteShell(installerPath)}`,
    `${quoteShell(`${installPaths.standalonePythonBinDir}/python3`)} --version && ${quoteShell(`${installPaths.standalonePythonBinDir}/python3`)} -m ensurepip --upgrade`,
  ]
}

/** @deprecated Retained for potential future source-compilation option. Not called in production. */
function _buildDarwinStandaloneCommands(input: PythonPluginParams): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const archiveUrl = buildPythonSourceUrl(input)
  const archivePath = `${installPaths.installRootDir}/Python-${input.pythonVersion}.tar.xz`
  const extractedDir = `${installPaths.installRootDir}/Python-${input.pythonVersion}`

  return [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `curl -fsSL ${quoteShell(archiveUrl)} -o ${quoteShell(archivePath)}`,
    `tar -xJf ${quoteShell(archivePath)} -C ${quoteShell(installPaths.installRootDir)}`,
    `cd ${quoteShell(extractedDir)} && ./configure --prefix=${quoteShell(installPaths.standalonePythonDir)} --enable-optimizations 2>&1 | tail -1`,
    `cd ${quoteShell(extractedDir)} && make -j$(sysctl -n hw.ncpu) 2>&1 | tail -1 && make install 2>&1 | tail -1`,
    `rm -rf ${quoteShell(extractedDir)} ${quoteShell(archivePath)}`,
    `export PATH=${quoteShell(installPaths.standalonePythonBinDir)}":$PATH" && python3 --version && python3 -m ensurepip --upgrade`,
  ]
}

function buildDarwinCondaCommands(input: PythonPluginParams): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const installerUrl = buildMinicondaUrl(input)
  const installerPath = `${installPaths.installRootDir}/miniconda-installer.sh`
  const condaEnvName = input.condaEnvName ?? 'base'

  const commands = [
    `mkdir -p ${quoteShell(installPaths.installRootDir)}`,
    `curl -fsSL ${quoteShell(installerUrl)} -o ${quoteShell(installerPath)}`,
    `bash ${quoteShell(installerPath)} -b -p ${quoteShell(installPaths.condaDir)}`,
    `rm -f ${quoteShell(installerPath)}`,
  ]

  if (condaEnvName !== 'base') {
    commands.push(
      `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && conda create -y -n ${quoteShell(condaEnvName)} python=${input.pythonVersion}`,
    )
  } else {
    commands.push(
      `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && conda install -y python=${input.pythonVersion}`,
    )
  }

  commands.push(
    `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && python --version`,
  )

  return commands
}

function buildWindowsStandaloneCommands(input: PythonPluginParams): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const archiveUrl = buildPythonWindowsEmbedUrl(input)
  const archivePath = `${installPaths.installRootDir}\\python-${input.pythonVersion}-embed-amd64.zip`
  const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py'

  return [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `Invoke-WebRequest -Uri ${quotePowerShell(archiveUrl)} -OutFile ${quotePowerShell(archivePath)}`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.standalonePythonDir)} | Out-Null`,
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.standalonePythonDir)} -Force`,
    `Remove-Item -LiteralPath ${quotePowerShell(archivePath)} -Force`,
    // Enable pip in embedded Python by uncommenting import site
    `$pthFile = Get-ChildItem -Path ${quotePowerShell(installPaths.standalonePythonDir)} -Filter 'python*._pth' | Select-Object -First 1; if ($pthFile) { (Get-Content $pthFile.FullName) -replace '^#import site','import site' | Set-Content $pthFile.FullName }`,
    `Invoke-WebRequest -Uri ${quotePowerShell(getPipUrl)} -OutFile ${quotePowerShell(installPaths.standalonePythonDir + '\\get-pip.py')}`,
    `& ${quotePowerShell(installPaths.standalonePythonBinDir + '\\python.exe')} ${quotePowerShell(installPaths.standalonePythonDir + '\\get-pip.py')}`,
    `Remove-Item -LiteralPath ${quotePowerShell(installPaths.standalonePythonDir + '\\get-pip.py')} -Force`,
    `$env:Path = ${quotePowerShell(installPaths.standalonePythonBinDir)} + ';' + $env:Path; & ${quotePowerShell(installPaths.standalonePythonBinDir + '\\python.exe')} --version`,
  ]
}

function buildWindowsCondaCommands(input: PythonPluginParams): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const installerUrl = buildMinicondaUrl(input)
  const installerPath = `${installPaths.installRootDir}\\Miniconda3-installer.exe`
  const condaEnvName = input.condaEnvName ?? 'base'
  const condaExe = `${installPaths.condaDir}\\Scripts\\conda.exe`

  const commands = [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `Invoke-WebRequest -Uri ${quotePowerShell(installerUrl)} -OutFile ${quotePowerShell(installerPath)}`,
    `Start-Process -FilePath ([System.IO.Path]::GetFullPath(${quotePowerShell(installerPath)})) -ArgumentList '/S','/D=${installPaths.condaDir}' -Wait -NoNewWindow`,
    `Remove-Item -LiteralPath ${quotePowerShell(installerPath)} -Force`,
    `$condaExe = [System.IO.Path]::GetFullPath(${quotePowerShell(condaExe)})`,
  ]

  if (condaEnvName !== 'base') {
    commands.push(
      `& $condaExe create -y -n ${quotePowerShell(condaEnvName)} python=${input.pythonVersion}`,
    )
  } else {
    commands.push(`& $condaExe install -y python=${input.pythonVersion}`)
  }

  commands.push(`& $condaExe run python --version`)

  return commands
}

export function buildInstallCommands(input: PythonPluginParams): string[] {
  if (input.platform === 'darwin') {
    if (input.pythonManager === 'conda') return buildDarwinCondaCommands(input)
    // 'python' and 'pkg' managers both use .pkg extraction on macOS (fast, precompiled)
    return buildDarwinPkgCommands(input)
  }

  return input.pythonManager === 'conda'
    ? buildWindowsCondaCommands(input)
    : buildWindowsStandaloneCommands(input)
}

function buildVerifyCommands(input: PythonPluginParams): string[] {
  const installPaths = resolvePythonInstallPaths(input)

  if (input.platform === 'darwin' && input.pythonManager === 'conda') {
    return [
      `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && python --version`,
      `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && which python`,
    ]
  }

  if (input.platform === 'darwin') {
    return [
      `${quoteShell(`${installPaths.standalonePythonBinDir}/python3`)} --version`,
      `${quoteShell(`${installPaths.standalonePythonBinDir}/pip3`)} --version`,
    ]
  }

  if (input.pythonManager === 'conda') {
    const condaExe = `${installPaths.condaDir}\\Scripts\\conda.exe`
    return [
      `$condaExe = [System.IO.Path]::GetFullPath(${quotePowerShell(condaExe)}); & $condaExe run python --version`,
    ]
  }

  return [`& ${quotePowerShell(installPaths.standalonePythonBinDir + '\\python.exe')} --version`]
}

async function runCommands(
  commands: string[],
  platform: PythonPluginParams['platform'],
  onProgress?: (event: TaskProgressEvent) => void,
  pluginId = 'python-env',
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

const pythonEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toPythonParams(input)
    const installPaths = resolvePythonInstallPaths(params)
    const downloads = buildDownloadPlan(params)
    const commands = buildInstallCommands(params)
    const envChanges = buildPythonEnvChanges(params)

    assertOfficialDownloadPlan(downloads)

    const logs = [
      `manager=${params.pythonManager}`,
      `version=${params.pythonVersion}`,
      `installRoot=${params.installRootDir}`,
      `condaEnvName=${params.condaEnvName ?? 'base'}`,
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
      version: params.pythonVersion,
      paths: {
        installRootDir: params.installRootDir,
        pythonDir: installPaths.standalonePythonDir,
        condaDir: installPaths.condaDir,
        condaEnvDir: installPaths.condaEnvDir,
      },
      envChanges,
      downloads,
      commands,
      logs,
      summary: params.dryRun
        ? 'Prepared an official-source dry-run plan for the Python environment.'
        : 'Completed the official-source Python environment install commands.',
      context: {
        pythonManager: params.pythonManager,
        pythonVersion: params.pythonVersion,
        condaEnvName: params.condaEnvName ?? 'base',
      },
    }
  },

  async verify(
    input: PluginExecutionInput & { installResult: PluginInstallResult },
  ): Promise<PluginVerifyResult> {
    const params = toPythonParams(input)
    const downloads = buildDownloadPlan(params)
    const locale = input.locale ?? DEFAULT_LOCALE

    assertOfficialDownloadPlan(downloads)

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 Python 版本：${params.pythonVersion}`,
                `计划设置的工具安装根目录：${params.installRootDir}`,
                `计划使用的官方下载源：${downloads.map((download) => download.url).join(' | ')}`,
              ]
            : [
                `Planned Python version: ${params.pythonVersion}`,
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
              `已校验 Python 版本：${params.pythonVersion}`,
              `已校验工具安装根目录：${params.installRootDir}`,
            ]
          : [
              `Verified Python version: ${params.pythonVersion}`,
              `Verified tool install root: ${params.installRootDir}`,
            ]),
        ...verifyOutput,
      ],
    }
  },
}

export default pythonEnvPlugin
