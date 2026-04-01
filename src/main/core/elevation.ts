/**
 * 处理跨平台提权命令的生成与执行回退。
 */

import { dirname } from 'node:path'

import type { AppPlatform } from './contracts'
import { execFileAsync } from './exec'

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteAppleScript(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function formatMode(mode?: number): string | undefined {
  if (typeof mode !== 'number') {
    return undefined
  }

  return (mode & 0o777).toString(8).padStart(3, '0')
}

export function isPermissionError(error: unknown): boolean {
  if (!error) {
    return false
  }

  const maybeErr = error as NodeJS.ErrnoException
  if (maybeErr.code === 'EACCES' || maybeErr.code === 'EPERM') {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  return (
    normalized.includes('permission denied') ||
    normalized.includes('operation not permitted') ||
    normalized.includes('access is denied') ||
    normalized.includes('requested operation requires elevation') ||
    normalized.includes('administrator privileges') ||
    normalized.includes('run as administrator')
  )
}

export async function executePlatformCommand(
  command: string,
  platform: AppPlatform,
  options: { elevated?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  const execOptions = {
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  }

  if (platform === 'win32') {
    if (options.elevated) {
      const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
      const launcher = [
        `$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @(`,
        `'-NoProfile',`,
        `'-ExecutionPolicy',`,
        `'Bypass',`,
        `'-EncodedCommand',`,
        `${quotePowerShell(encodedCommand)}`,
        `)`,
        'exit $process.ExitCode',
      ].join(' ')

      return execFileAsync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcher],
        execOptions,
      )
    }

    return execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      execOptions,
    )
  }

  if (options.elevated) {
    return execFileAsync(
      'osascript',
      ['-e', `do shell script ${quoteAppleScript(command)} with administrator privileges`],
      execOptions,
    )
  }

  return execFileAsync('sh', ['-c', command], execOptions)
}

export async function executePlatformCommandWithElevationFallback(
  command: string,
  platform: AppPlatform,
): Promise<{ stdout: string; stderr: string; elevated: boolean }> {
  try {
    const result = await executePlatformCommand(command, platform)
    return { ...result, elevated: false }
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error
    }

    const result = await executePlatformCommand(command, platform, { elevated: true })
    return { ...result, elevated: true }
  }
}

export function buildRemovePathCommand(targetPath: string, platform: AppPlatform): string {
  if (platform === 'win32') {
    return `if (Test-Path -LiteralPath ${quotePowerShell(targetPath)}) { Remove-Item -LiteralPath ${quotePowerShell(targetPath)} -Recurse -Force }`
  }

  return `rm -rf -- ${quotePosix(targetPath)}`
}

export function buildEnsureDirectoryCommand(
  targetPath: string,
  platform: AppPlatform,
  mode?: number,
): string {
  if (platform === 'win32') {
    return `if (-not (Test-Path -LiteralPath ${quotePowerShell(targetPath)})) { New-Item -ItemType Directory -Force -Path ${quotePowerShell(targetPath)} | Out-Null }`
  }

  const chmodCommand = formatMode(mode)
    ? ` && chmod ${formatMode(mode)} -- ${quotePosix(targetPath)}`
    : ''
  return `mkdir -p -- ${quotePosix(targetPath)}${chmodCommand}`
}

export function buildCopyFileCommand(
  sourcePath: string,
  targetPath: string,
  platform: AppPlatform,
  mode?: number,
): string {
  if (platform === 'win32') {
    return [
      `$target = ${quotePowerShell(targetPath)}`,
      '$parent = Split-Path -Parent $target',
      'if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }',
      `Copy-Item -LiteralPath ${quotePowerShell(sourcePath)} -Destination $target -Force`,
    ].join('; ')
  }

  const chmodCommand = formatMode(mode)
    ? ` && chmod ${formatMode(mode)} -- ${quotePosix(targetPath)}`
    : ''
  return `mkdir -p -- ${quotePosix(dirname(targetPath))} && cp -f -- ${quotePosix(sourcePath)} ${quotePosix(targetPath)}${chmodCommand}`
}

export function buildReadFileBase64Command(targetPath: string, platform: AppPlatform): string {
  if (platform === 'win32') {
    return `[Convert]::ToBase64String([IO.File]::ReadAllBytes(${quotePowerShell(targetPath)}))`
  }

  return `base64 < ${quotePosix(targetPath)} | tr -d '\\n'`
}
