/**
 * 实现 Python 在各平台上的安装、清理与回滚策略。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildPythonEnvChanges, resolvePythonInstallPaths } from '../core/platform'
import { downloadArtifacts, validateOfficialDownloads } from '../core/download'
import type {
  AppLocale,
  DownloadArtifact,
  DownloadResolvedArtifact,
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

function resolveDownloadedArtifactPath(
  resolvedDownloads: DownloadResolvedArtifact[] | undefined,
  tool: DownloadArtifact['tool'],
  fileName?: string,
): string | undefined {
  const matchingDownloads = resolvedDownloads?.filter((item) => item.artifact.tool === tool) ?? []
  if (!fileName) {
    return matchingDownloads[0]?.localPath
  }

  return matchingDownloads.find((item) => item.artifact.fileName === fileName)?.localPath
}

function appendPhaseLog(logs: string[], phase: string, startedAt: number, detail?: string): void {
  const suffix = detail ? ` ${detail}` : ''
  logs.push(`phase=${phase} durationMs=${Date.now() - startedAt}${suffix}`)
}

function resolvePythonArch(): string {
  return process.arch === 'x64' ? 'x86_64' : 'arm64'
}

/** @deprecated 为未来可能恢复的源码编译方案保留，生产流程不会调用。 */
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
      // macOS 直接安装优先走官方 .pkg，避免源码编译过慢。
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
      {
        kind: 'installer',
        tool: 'python',
        url: 'https://bootstrap.pypa.io/get-pip.py',
        official: true,
        note: 'Download the official pip bootstrap script for embedded Python.',
        fileName: 'get-pip.py',
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

  // conda 模式只需要下载 Miniconda 安装器。
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
    extractedCacheDir:
      typeof input.extractedCacheDir === 'string' ? input.extractedCacheDir : undefined,
  }
}

function buildPythonPkgUrl(input: PythonPluginParams): string {
  return `${PYTHON_FTP_BASE_URL}/${input.pythonVersion}/python-${input.pythonVersion}-macos11.pkg`
}

/** 从版本号中提取 major.minor，例如把 `3.12.10` 提取为 `3.12`。 */
function extractPythonMajorMinor(version: string): string {
  const parts = version.split('.')
  return `${parts[0]}.${parts[1]}`
}

function buildDarwinPythonWrappersCommand(
  standalonePythonDir: string,
  standalonePythonBinDir: string,
  majorMinor: string,
): string {
  return [
    `PYTHON_ROOT=${quoteShell(standalonePythonDir)}`,
    `PYTHON_BIN_DIR=${quoteShell(standalonePythonBinDir)}`,
    `PYTHON_MAJOR_MINOR=${quoteShell(majorMinor)}`,
    `python3 - <<'PY'
import os
from pathlib import Path

python_root = Path(os.environ['PYTHON_ROOT'])
python_bin_dir = Path(os.environ['PYTHON_BIN_DIR'])
major_minor = os.environ['PYTHON_MAJOR_MINOR']

python_launcher = """#!/bin/sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
PYTHON_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
FRAMEWORKS_DIR="$PYTHON_ROOT/Library/Frameworks"
export DYLD_ROOT_PATH="$PYTHON_ROOT"
if [ -n "$DYLD_FRAMEWORK_PATH" ]; then
  export DYLD_FRAMEWORK_PATH="$FRAMEWORKS_DIR:$DYLD_FRAMEWORK_PATH"
else
  export DYLD_FRAMEWORK_PATH="$FRAMEWORKS_DIR"
fi
if [ -n "$DYLD_FALLBACK_FRAMEWORK_PATH" ]; then
  export DYLD_FALLBACK_FRAMEWORK_PATH="$FRAMEWORKS_DIR:$DYLD_FALLBACK_FRAMEWORK_PATH"
else
  export DYLD_FALLBACK_FRAMEWORK_PATH="$FRAMEWORKS_DIR"
fi
export PYTHONHOME="$PYTHON_ROOT/Library/Frameworks/Python.framework/Versions/__MAJOR_MINOR__"
exec "$PYTHON_ROOT/Library/Frameworks/Python.framework/Versions/__MAJOR_MINOR__/bin/python__MAJOR_MINOR__" "$@"
""".replace('__MAJOR_MINOR__', major_minor)

pip_launcher = """#!/bin/sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
PYTHON_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
exec "$PYTHON_ROOT/bin/python3" -m pip "$@"
"""


def write_executable(target: Path, content: str) -> None:
    target.write_text(content)
    target.chmod(0o755)


python_bin_dir.mkdir(parents=True, exist_ok=True)
for name in ('python', 'python3', f'python{major_minor}'):
    write_executable(python_bin_dir / name, python_launcher)

for name in ('pip', 'pip3', f'pip{major_minor}'):
    write_executable(python_bin_dir / name, pip_launcher)
PY`,
  ].join('; ')
}

function buildDarwinPkgCommands(
  input: PythonPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const pkgUrl = buildPythonPkgUrl(input)
  const installerPath =
    resolveDownloadedArtifactPath(
      resolvedDownloads,
      'python',
      `python-${input.pythonVersion}-macos11.pkg`,
    ) ?? `${installPaths.installRootDir}/python-${input.pythonVersion}.pkg`
  const expandDir = `${installPaths.installRootDir}/python-pkg-expanded`
  const standaloneFrameworksDir = `${installPaths.standalonePythonDir}/Library/Frameworks`
  const majorMinor = extractPythonMajorMinor(input.pythonVersion)

  const commands = [`mkdir -p ${quoteShell(installPaths.installRootDir)}`]

  if (!resolvedDownloads) {
    commands.push(`curl -fsSL ${quoteShell(pkgUrl)} -o ${quoteShell(installerPath)}`)
  }

  commands.push(
    `pkgutil --expand-full ${quoteShell(installerPath)} ${quoteShell(expandDir)}`,
    `rm -rf ${quoteShell(installPaths.standalonePythonDir)}; mkdir -p ${quoteShell(`${standaloneFrameworksDir}/Python.framework`)}; PYTHON_FRAMEWORK_SOURCE=$(find ${quoteShell(expandDir)} \\( -path '*/Python_Framework.pkg/Payload' -o -path '*/Python.framework' \\) -type d | head -n 1); if [ -z "$PYTHON_FRAMEWORK_SOURCE" ]; then echo 'Failed to locate Python.framework in expanded pkg payload.' >&2; exit 1; fi; cp -R "$PYTHON_FRAMEWORK_SOURCE"/. ${quoteShell(`${standaloneFrameworksDir}/Python.framework`)}/; PYTHONT_FRAMEWORK_SOURCE=$(find ${quoteShell(expandDir)} \\( -path '*/PythonT_Framework.pkg/Payload' -o -path '*/PythonT.framework' \\) -type d | head -n 1); if [ -n "$PYTHONT_FRAMEWORK_SOURCE" ]; then mkdir -p ${quoteShell(`${standaloneFrameworksDir}/PythonT.framework`)}; cp -R "$PYTHONT_FRAMEWORK_SOURCE"/. ${quoteShell(`${standaloneFrameworksDir}/PythonT.framework`)}/; fi; if [ ! -x ${quoteShell(`${standaloneFrameworksDir}/Python.framework/Versions/${majorMinor}/bin/python${majorMinor}`)} ]; then echo 'Failed to locate the Python executable inside the copied framework bundle.' >&2; exit 1; fi`,
    buildDarwinPythonWrappersCommand(
      installPaths.standalonePythonDir,
      installPaths.standalonePythonBinDir,
      majorMinor,
    ),
    `rm -rf ${quoteShell(expandDir)}${resolvedDownloads ? '' : ` ${quoteShell(installerPath)}`}`,
    `${quoteShell(`${installPaths.standalonePythonBinDir}/python3`)} --version && ${quoteShell(`${installPaths.standalonePythonBinDir}/python3`)} -m ensurepip --upgrade`,
  )

  return commands
}

/** @deprecated 为未来可能恢复的源码编译方案保留，生产流程不会调用。 */
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

function buildDarwinCondaCommands(
  input: PythonPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const installerUrl = buildMinicondaUrl(input)
  const installerPath =
    resolveDownloadedArtifactPath(
      resolvedDownloads,
      'miniconda',
      `Miniconda3-latest-MacOSX-${resolvePythonArch()}.sh`,
    ) ?? `${installPaths.installRootDir}/miniconda-installer.sh`
  const condaEnvName = input.condaEnvName ?? 'base'

  const commands = [`mkdir -p ${quoteShell(installPaths.installRootDir)}`]

  if (!resolvedDownloads) {
    commands.push(`curl -fsSL ${quoteShell(installerUrl)} -o ${quoteShell(installerPath)}`)
  }

  commands.push(
    `bash ${quoteShell(installerPath)} -b -p ${quoteShell(installPaths.condaDir)}`,
    ...(resolvedDownloads ? [] : [`rm -f ${quoteShell(installerPath)}`]),
  )

  if (condaEnvName !== 'base') {
    commands.push(
      `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && conda create -y -c conda-forge -n ${quoteShell(condaEnvName)} python=${input.pythonVersion}`,
    )
  } else {
    commands.push(
      `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && conda install -y -c conda-forge python=${input.pythonVersion}`,
    )
  }

  commands.push(
    `eval "$(${installPaths.condaDir}/bin/conda shell.bash hook 2> /dev/null)" && python --version`,
  )

  return commands
}

function buildWindowsStandaloneCommands(
  input: PythonPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const archiveUrl = buildPythonWindowsEmbedUrl(input)
  const archivePath =
    resolveDownloadedArtifactPath(
      resolvedDownloads,
      'python',
      `python-${input.pythonVersion}-embed-amd64.zip`,
    ) ?? `${installPaths.installRootDir}\\python-${input.pythonVersion}-embed-amd64.zip`
  const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py'
  const getPipPath =
    resolveDownloadedArtifactPath(resolvedDownloads, 'python', 'get-pip.py') ??
    `${installPaths.standalonePythonDir}\\get-pip.py`

  const commands = [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.standalonePythonDir)} | Out-Null`,
  ]

  if (!resolvedDownloads) {
    commands.push(
      `Invoke-WebRequest -Uri ${quotePowerShell(archiveUrl)} -OutFile ${quotePowerShell(archivePath)}`,
    )
  }

  commands.push(
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(installPaths.standalonePythonDir)} -Force`,
    ...(resolvedDownloads
      ? []
      : [`Remove-Item -LiteralPath ${quotePowerShell(archivePath)} -Force`]),
    // Windows embed 版默认禁用了 site，这里打开后才能顺利引导 pip。
    `$pthFile = Get-ChildItem -Path ${quotePowerShell(installPaths.standalonePythonDir)} -Filter 'python*._pth' | Select-Object -First 1; if ($pthFile) { (Get-Content $pthFile.FullName) -replace '^#import site','import site' | Set-Content $pthFile.FullName }`,
  )

  if (!resolvedDownloads) {
    commands.push(
      `Invoke-WebRequest -Uri ${quotePowerShell(getPipUrl)} -OutFile ${quotePowerShell(getPipPath)}`,
    )
  }

  commands.push(
    `& ${quotePowerShell(installPaths.standalonePythonBinDir + '\\python.exe')} ${quotePowerShell(getPipPath)}`,
    ...(resolvedDownloads
      ? []
      : [`Remove-Item -LiteralPath ${quotePowerShell(getPipPath)} -Force`]),
    `$env:Path = ${quotePowerShell(installPaths.standalonePythonBinDir)} + ';' + $env:Path; & ${quotePowerShell(installPaths.standalonePythonBinDir + '\\python.exe')} --version`,
  )

  return commands
}

function buildWindowsCondaCommands(
  input: PythonPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  const installPaths = resolvePythonInstallPaths(input)
  const installerUrl = buildMinicondaUrl(input)
  const installerPath =
    resolveDownloadedArtifactPath(
      resolvedDownloads,
      'miniconda',
      'Miniconda3-latest-Windows-x86_64.exe',
    ) ?? `${installPaths.installRootDir}\\Miniconda3-installer.exe`
  const condaEnvName = input.condaEnvName ?? 'base'
  const condaCommandResolver = [
    `$condaCandidates = @([System.IO.Path]::GetFullPath(${quotePowerShell(`${installPaths.condaDir}\\Scripts\\conda.exe`)}), [System.IO.Path]::GetFullPath(${quotePowerShell(`${installPaths.condaDir}\\_conda.exe`)}), [System.IO.Path]::GetFullPath(${quotePowerShell(`${installPaths.condaDir}\\condabin\\conda.bat`)}))`,
    '$condaCommand = $condaCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1',
    `if (-not $condaCommand) { throw 'Failed to locate conda command after Miniconda install.' }`,
  ].join('; ')

  const commands = [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(installPaths.installRootDir)} | Out-Null`,
  ]

  if (!resolvedDownloads) {
    commands.push(
      `Invoke-WebRequest -Uri ${quotePowerShell(installerUrl)} -OutFile ${quotePowerShell(installerPath)}`,
    )
  }

  commands.push(
    `$condaTarget = [System.IO.Path]::GetFullPath(${quotePowerShell(installPaths.condaDir)}); $proc = Start-Process -FilePath ([System.IO.Path]::GetFullPath(${quotePowerShell(installerPath)})) -ArgumentList '/InstallationType=JustMe','/RegisterPython=0','/AddToPath=0','/S',"/D=$condaTarget" -Wait -PassThru; if ($proc.ExitCode -ne 0) { throw "Miniconda installer failed with exit code $($proc.ExitCode)." }`,
    ...(resolvedDownloads
      ? []
      : [`Remove-Item -LiteralPath ${quotePowerShell(installerPath)} -Force`]),
  )

  if (condaEnvName !== 'base') {
    commands.push(
      `${condaCommandResolver}; & $condaCommand create -y -c conda-forge -n ${quotePowerShell(condaEnvName)} python=${input.pythonVersion}`,
    )
  } else {
    commands.push(
      `${condaCommandResolver}; & $condaCommand install -y -c conda-forge python=${input.pythonVersion}`,
    )
  }

  commands.push(`${condaCommandResolver}; & $condaCommand run python --version`)

  return commands
}

export function buildInstallCommands(
  input: PythonPluginParams,
  resolvedDownloads?: DownloadResolvedArtifact[],
): string[] {
  if (input.platform === 'darwin') {
    if (input.pythonManager === 'conda') return buildDarwinCondaCommands(input, resolvedDownloads)
    // macOS 下的 `python` 和 `pkg` 两种模式最终都走 .pkg 解包路径。
    return buildDarwinPkgCommands(input, resolvedDownloads)
  }

  return input.pythonManager === 'conda'
    ? buildWindowsCondaCommands(input, resolvedDownloads)
    : buildWindowsStandaloneCommands(input, resolvedDownloads)
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
      `${quoteShell(`${installPaths.standalonePythonBinDir}/python3`)} -m pip --version`,
    ]
  }

  if (input.pythonManager === 'conda') {
    const condaCommandResolver = [
      `$condaCandidates = @([System.IO.Path]::GetFullPath(${quotePowerShell(`${installPaths.condaDir}\\Scripts\\conda.exe`)}), [System.IO.Path]::GetFullPath(${quotePowerShell(`${installPaths.condaDir}\\_conda.exe`)}), [System.IO.Path]::GetFullPath(${quotePowerShell(`${installPaths.condaDir}\\condabin\\conda.bat`)}))`,
      '$condaCommand = $condaCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1',
      `if (-not $condaCommand) { throw 'Failed to locate conda command after Miniconda install.' }`,
    ].join('; ')
    return [`${condaCommandResolver}; & $condaCommand run python --version`]
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
    const envChanges = buildPythonEnvChanges(params)
    let commands = buildInstallCommands(params)

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
      const cmdOutput = await runCommands(commands, params.platform, input.onProgress)
      logs.push(...cmdOutput)
      appendPhaseLog(logs, 'install_commands', commandStartedAt, `commands=${commands.length}`)
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
