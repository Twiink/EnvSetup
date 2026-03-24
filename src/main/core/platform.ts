import { posix, win32 } from 'node:path'

import type { AppPlatform, EnvChange, FrontendPluginParams } from './contracts'

export type PlatformStrategy = {
  platform: AppPlatform
  shellTargets: string[]
  profileTargets: string[]
  pathSeparator: ':' | ';'
}

export type FrontendInstallPaths = {
  installRootDir: string
  standaloneNodeDir: string
  standaloneNodeBinDir: string
  nvmDir: string
  nvmNodeMirror: string
  nvmWindowsSymlinkDir: string
}

export function buildPlatformStrategy(platform: AppPlatform): PlatformStrategy {
  if (platform === 'darwin') {
    return {
      platform,
      shellTargets: ['zsh', 'bash'],
      profileTargets: ['~/.zshrc', '~/.bash_profile'],
      pathSeparator: ':',
    }
  }

  return {
    platform,
    shellTargets: ['powershell'],
    profileTargets: ['PowerShell:$PROFILE'],
    pathSeparator: ';',
  }
}

function getPathApi(platform: AppPlatform) {
  return platform === 'win32' ? win32 : posix
}

export function resolveFrontendInstallPaths(input: FrontendPluginParams): FrontendInstallPaths {
  const pathApi = getPathApi(input.platform)
  const standaloneNodeDir = pathApi.join(input.installRootDir, `node-v${input.nodeVersion}`)

  return {
    installRootDir: input.installRootDir,
    standaloneNodeDir,
    standaloneNodeBinDir:
      input.platform === 'win32' ? standaloneNodeDir : pathApi.join(standaloneNodeDir, 'bin'),
    nvmDir: pathApi.join(input.installRootDir, 'nvm'),
    nvmNodeMirror: 'https://nodejs.org/dist',
    nvmWindowsSymlinkDir: pathApi.join(input.installRootDir, 'node-current'),
  }
}

export function buildFrontendEnvChanges(input: FrontendPluginParams): EnvChange[] {
  const strategy = buildPlatformStrategy(input.platform)
  const installPaths = resolveFrontendInstallPaths(input)
  const envChanges: EnvChange[] = [
    {
      kind: 'env',
      key: 'npm_config_cache',
      value: input.npmCacheDir,
      scope: 'user',
      description: 'Set npm cache directory.',
    },
    {
      kind: 'env',
      key: 'npm_config_prefix',
      value: input.npmGlobalPrefix,
      scope: 'user',
      description: 'Set npm global prefix directory.',
    },
  ]

  if (input.nodeManager === 'node') {
    envChanges.push({
      kind: 'path',
      key: 'PATH',
      value: installPaths.standaloneNodeBinDir,
      scope: 'user',
      description: 'Expose the standalone Node.js install directory in PATH.',
    })
  }

  if (input.platform === 'darwin' && input.nodeManager === 'nvm') {
    envChanges.push(
      {
        kind: 'env',
        key: 'NVM_DIR',
        value: installPaths.nvmDir,
        scope: 'user',
        description: 'Store nvm under the user-managed install root directory.',
      },
      {
        kind: 'env',
        key: 'NVM_NODEJS_ORG_MIRROR',
        value: installPaths.nvmNodeMirror,
        scope: 'user',
        description: 'Force nvm to download Node.js from nodejs.org.',
      },
      ...strategy.profileTargets.map(
        (target): EnvChange => ({
          kind: 'profile',
          key: 'frontend-env:init',
          value: buildNvmInitSnippet(installPaths.nvmDir, installPaths.nvmNodeMirror),
          scope: 'user',
          target,
          description: 'Load nvm automatically in new terminal sessions.',
        }),
      ),
    )
  }

  if (input.platform === 'win32' && input.nodeManager === 'nvm') {
    envChanges.push(
      {
        kind: 'env',
        key: 'NVM_HOME',
        value: installPaths.nvmDir,
        scope: 'user',
        description: 'Store nvm-windows under the user-managed install root directory.',
      },
      {
        kind: 'env',
        key: 'NVM_SYMLINK',
        value: installPaths.nvmWindowsSymlinkDir,
        scope: 'user',
        description: 'Expose the active Node.js version through a stable symlink path.',
      },
      {
        kind: 'path',
        key: 'PATH',
        value: `%NVM_HOME%${strategy.pathSeparator}%NVM_SYMLINK%`,
        scope: 'user',
        description: 'Expose nvm-windows and the active Node symlink in PATH.',
      },
    )
  }

  return envChanges
}

export function buildNvmInitSnippet(
  nvmDir: string,
  nodeMirror = 'https://nodejs.org/dist',
): string {
  return [
    '# envsetup: frontend-env:start',
    `export NVM_DIR="${nvmDir}"`,
    `export NVM_NODEJS_ORG_MIRROR="${nodeMirror}"`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    '# envsetup: frontend-env:end',
  ].join('\n')
}
