import type { AppPlatform, EnvChange, FrontendPluginParams } from './contracts'

export type PlatformStrategy = {
  platform: AppPlatform
  shellTargets: string[]
  profileTargets: string[]
  pathSeparator: ':' | ';'
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

export function buildFrontendEnvChanges(input: FrontendPluginParams): EnvChange[] {
  const strategy = buildPlatformStrategy(input.platform)
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

  if (input.platform === 'darwin' && input.nodeManager === 'nvm') {
    envChanges.push(
      {
        kind: 'env',
        key: 'NVM_DIR',
        value: '$HOME/.nvm',
        scope: 'user',
        description: 'Store nvm under the current user home directory.',
      },
      ...strategy.profileTargets.map(
        (target): EnvChange => ({
          kind: 'profile',
          key: 'frontend-env:init',
          value: buildNvmInitSnippet(),
          scope: 'user',
          target,
          description: 'Load nvm automatically in new terminal sessions.',
        }),
      ),
    )
  }

  if (input.platform === 'win32' && input.nodeManager === 'nvm') {
    envChanges.push({
      kind: 'path',
      key: 'PATH',
      value: `%NVM_HOME%${strategy.pathSeparator}%NVM_SYMLINK%`,
      scope: 'user',
      description: 'Expose nvm-windows and the active Node symlink in PATH.',
    })
  }

  return envChanges
}

export function buildNvmInitSnippet(): string {
  return [
    '# envsetup: frontend-env:start',
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    '# envsetup: frontend-env:end',
  ].join('\n')
}
