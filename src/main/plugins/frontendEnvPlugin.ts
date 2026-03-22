import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildFrontendEnvChanges } from '../core/platform'
import type {
  AppLocale,
  FrontendPluginParams,
  PluginExecutionInput,
  PluginInstallResult,
  PluginVerifyResult,
} from '../core/contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

function translate(locale: AppLocale, text: { 'zh-CN': string; en: string }): string {
  return text[locale]
}

const execFileAsync = promisify(execFile)

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
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
    npmCacheDir: input.npmCacheDir,
    npmGlobalPrefix: input.npmGlobalPrefix,
    platform: input.platform,
    dryRun: input.dryRun,
  }
}

export function buildInstallCommands(input: FrontendPluginParams): string[] {
  if (input.platform === 'darwin') {
    if (input.nodeManager === 'nvm') {
      return [
        'mkdir -p "$HOME/.nvm"',
        'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
        `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install ${input.nodeVersion}`,
        `npm config set cache ${quoteShell(input.npmCacheDir)}`,
        `npm config set prefix ${quoteShell(input.npmGlobalPrefix)}`,
      ]
    }

    return [
      `mkdir -p ${quoteShell(input.npmCacheDir)} ${quoteShell(input.npmGlobalPrefix)}`,
      `npm config set cache ${quoteShell(input.npmCacheDir)}`,
      `npm config set prefix ${quoteShell(input.npmGlobalPrefix)}`,
      `echo "Install standalone Node.js ${input.nodeVersion} for macOS."`,
    ]
  }

  if (input.nodeManager === 'nvm') {
    return [
      `New-Item -ItemType Directory -Force -Path "${input.npmCacheDir}" | Out-Null`,
      `New-Item -ItemType Directory -Force -Path "${input.npmGlobalPrefix}" | Out-Null`,
      `nvm install ${input.nodeVersion}`,
      `npm config set cache "${input.npmCacheDir}"`,
      `npm config set prefix "${input.npmGlobalPrefix}"`,
    ]
  }

  return [
    `New-Item -ItemType Directory -Force -Path "${input.npmCacheDir}" | Out-Null`,
    `New-Item -ItemType Directory -Force -Path "${input.npmGlobalPrefix}" | Out-Null`,
    `npm config set cache "${input.npmCacheDir}"`,
    `npm config set prefix "${input.npmGlobalPrefix}"`,
    `Write-Output "Install standalone Node.js ${input.nodeVersion} for Windows."`,
  ]
}

async function runCommands(
  commands: string[],
  platform: FrontendPluginParams['platform'],
): Promise<void> {
  for (const command of commands) {
    if (platform === 'win32') {
      await execFileAsync('powershell', ['-NoProfile', '-Command', command])
      continue
    }

    await execFileAsync('sh', ['-lc', command])
  }
}

const frontendEnvPlugin = {
  async install(input: PluginExecutionInput): Promise<PluginInstallResult> {
    const params = toFrontendParams(input)
    const commands = buildInstallCommands(params)
    const envChanges = buildFrontendEnvChanges(params)
    const logs = [
      `manager=${params.nodeManager}`,
      `version=${params.nodeVersion}`,
      `cache=${params.npmCacheDir}`,
      `prefix=${params.npmGlobalPrefix}`,
      params.dryRun ? 'mode=dry-run' : 'mode=real-run',
    ]

    if (!params.dryRun) {
      await runCommands(commands, params.platform)
    }

    return {
      status: 'installed_unverified',
      executionMode: params.dryRun ? 'dry_run' : 'real_run',
      version: params.nodeVersion,
      paths: {
        npmCacheDir: params.npmCacheDir,
        npmGlobalPrefix: params.npmGlobalPrefix,
      },
      envChanges,
      commands,
      logs,
      summary: params.dryRun
        ? 'Prepared a dry-run plan for the frontend environment.'
        : 'Completed frontend environment install commands.',
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
    const locale = input.locale ?? DEFAULT_LOCALE

    if (params.dryRun) {
      return {
        status: 'verified_success',
        checks:
          locale === 'zh-CN'
            ? [
                `计划安装的 Node 版本：${params.nodeVersion}`,
                `计划设置的 npm 缓存目录：${params.npmCacheDir}`,
                `计划设置的 npm 全局安装目录：${params.npmGlobalPrefix}`,
              ]
            : [
                `Planned Node version: ${params.nodeVersion}`,
                `Planned npm cache directory: ${params.npmCacheDir}`,
                `Planned npm global install directory: ${params.npmGlobalPrefix}`,
              ],
      }
    }

    await runCommands(
      params.platform === 'win32'
        ? ['node --version', 'npm config get cache', 'npm config get prefix']
        : ['node --version', 'npm config get cache', 'npm config get prefix'],
      params.platform,
    )

    return {
      status: 'verified_success',
      checks:
        locale === 'zh-CN'
          ? [
              `已校验 Node 版本：${params.nodeVersion}`,
              `已校验 npm 缓存目录：${params.npmCacheDir}`,
              `已校验 npm 全局安装目录：${params.npmGlobalPrefix}`,
            ]
          : [
              `Verified Node version: ${params.nodeVersion}`,
              `Verified npm cache directory: ${params.npmCacheDir}`,
              `Verified npm global install directory: ${params.npmGlobalPrefix}`,
            ],
    }
  },
}

export default frontendEnvPlugin
