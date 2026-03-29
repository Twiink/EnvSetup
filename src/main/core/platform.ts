/**
 * Wraps platform detection and platform-specific path or command helpers.
 */

import { posix, win32 } from 'node:path'

import type {
  AppPlatform,
  EnvChange,
  GitPluginParams,
  NodePluginParams,
  JavaPluginParams,
  PythonPluginParams,
} from './contracts'

export type PlatformStrategy = {
  platform: AppPlatform
  shellTargets: string[]
  profileTargets: string[]
  pathSeparator: ':' | ';'
}

export type NodeInstallPaths = {
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

export function resolveNodeInstallPaths(input: NodePluginParams): NodeInstallPaths {
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

export function buildNodeEnvChanges(input: NodePluginParams): EnvChange[] {
  const strategy = buildPlatformStrategy(input.platform)
  const installPaths = resolveNodeInstallPaths(input)
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
          key: 'node-env:init',
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
    '# envsetup: node-env:start',
    `export NVM_DIR="${nvmDir}"`,
    `export NVM_NODEJS_ORG_MIRROR="${nodeMirror}"`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    '# envsetup: node-env:end',
  ].join('\n')
}

// ============================================================
// Git 环境路径与环境变量
// ============================================================

export type GitInstallPaths = {
  installRootDir: string
  gitDir: string
  gitBinDir: string
  homebrewDir: string
  scoopDir: string
}

export function resolveGitInstallPaths(input: GitPluginParams): GitInstallPaths {
  const pathApi = getPathApi(input.platform)
  const gitDir = pathApi.join(input.installRootDir, 'git')

  return {
    installRootDir: input.installRootDir,
    gitDir,
    gitBinDir:
      input.platform === 'win32' ? pathApi.join(gitDir, 'cmd') : pathApi.join(gitDir, 'bin'),
    homebrewDir: process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin',
    scoopDir: pathApi.join(input.installRootDir, 'scoop', 'shims'),
  }
}

export function buildGitEnvChanges(input: GitPluginParams): EnvChange[] {
  const installPaths = resolveGitInstallPaths(input)

  if (input.gitManager === 'git') {
    return [
      {
        kind: 'path',
        key: 'PATH',
        value: installPaths.gitBinDir,
        scope: 'user',
        description: 'Expose the standalone Git install directory in PATH.',
      },
    ]
  }

  if (input.gitManager === 'homebrew') {
    return [
      {
        kind: 'path',
        key: 'PATH',
        value: installPaths.homebrewDir,
        scope: 'user',
        description: 'Expose the Homebrew bin directory for Git in PATH.',
      },
    ]
  }

  return [
    {
      kind: 'path',
      key: 'PATH',
      value: installPaths.scoopDir,
      scope: 'user',
      description: 'Expose the Scoop shims directory for Git in PATH.',
    },
  ]
}

// ============================================================
// Java 环境路径与环境变量
// ============================================================

export type JavaInstallPaths = {
  installRootDir: string
  standaloneJdkDir: string
  standaloneJdkBinDir: string
  sdkmanDir: string
}

export function resolveJavaInstallPaths(input: JavaPluginParams): JavaInstallPaths {
  const pathApi = getPathApi(input.platform)
  const standaloneJdkDir = pathApi.join(input.installRootDir, `java-${input.javaVersion}`)

  return {
    installRootDir: input.installRootDir,
    standaloneJdkDir,
    standaloneJdkBinDir: pathApi.join(standaloneJdkDir, 'bin'),
    sdkmanDir: pathApi.join(input.installRootDir, 'sdkman'),
  }
}

export function buildJavaEnvChanges(input: JavaPluginParams): EnvChange[] {
  const strategy = buildPlatformStrategy(input.platform)
  const installPaths = resolveJavaInstallPaths(input)
  const envChanges: EnvChange[] = []

  if (input.javaManager === 'jdk') {
    envChanges.push(
      {
        kind: 'env',
        key: 'JAVA_HOME',
        value: installPaths.standaloneJdkDir,
        scope: 'user',
        description: 'Set JAVA_HOME to the standalone JDK directory.',
      },
      {
        kind: 'path',
        key: 'PATH',
        value: installPaths.standaloneJdkBinDir,
        scope: 'user',
        description: 'Expose the standalone JDK bin directory in PATH.',
      },
    )
  }

  if (input.javaManager === 'sdkman') {
    if (input.platform === 'darwin') {
      envChanges.push(
        {
          kind: 'env',
          key: 'SDKMAN_DIR',
          value: installPaths.sdkmanDir,
          scope: 'user',
          description: 'Store SDKMAN under the user-managed install root directory.',
        },
        ...strategy.profileTargets.map(
          (target): EnvChange => ({
            kind: 'profile',
            key: 'java-env:init',
            value: buildSdkmanInitSnippet(installPaths.sdkmanDir),
            scope: 'user',
            target,
            description: 'Load SDKMAN automatically in new terminal sessions.',
          }),
        ),
      )
    } else {
      // Windows: SDKMAN runs through Git Bash
      envChanges.push({
        kind: 'env',
        key: 'SDKMAN_DIR',
        value: installPaths.sdkmanDir,
        scope: 'user',
        description: 'Store SDKMAN under the user-managed install root directory.',
      })
    }
  }

  return envChanges
}

export function buildSdkmanInitSnippet(sdkmanDir: string): string {
  return [
    '# envsetup: java-env:start',
    `export SDKMAN_DIR="${sdkmanDir}"`,
    `[[ -s "${sdkmanDir}/bin/sdkman-init.sh" ]] && source "${sdkmanDir}/bin/sdkman-init.sh"`,
    '# envsetup: java-env:end',
  ].join('\n')
}

// ============================================================
// Python 环境路径与环境变量
// ============================================================

export type PythonInstallPaths = {
  installRootDir: string
  standalonePythonDir: string
  standalonePythonBinDir: string
  condaDir: string
  condaEnvDir: string
}

export function resolvePythonInstallPaths(input: PythonPluginParams): PythonInstallPaths {
  const pathApi = getPathApi(input.platform)
  const standalonePythonDir = pathApi.join(input.installRootDir, `python-${input.pythonVersion}`)
  const condaDir = pathApi.join(input.installRootDir, 'miniconda3')
  const condaEnvName = input.condaEnvName ?? 'base'

  return {
    installRootDir: input.installRootDir,
    standalonePythonDir,
    standalonePythonBinDir:
      input.platform === 'win32' ? standalonePythonDir : pathApi.join(standalonePythonDir, 'bin'),
    condaDir,
    condaEnvDir: condaEnvName === 'base' ? condaDir : pathApi.join(condaDir, 'envs', condaEnvName),
  }
}

export function buildPythonEnvChanges(input: PythonPluginParams): EnvChange[] {
  const strategy = buildPlatformStrategy(input.platform)
  const installPaths = resolvePythonInstallPaths(input)
  const envChanges: EnvChange[] = []

  if (input.pythonManager === 'python' || input.pythonManager === 'pkg') {
    envChanges.push({
      kind: 'path',
      key: 'PATH',
      value: installPaths.standalonePythonBinDir,
      scope: 'user',
      description: 'Expose the standalone Python install directory in PATH.',
    })
  }

  if (input.pythonManager === 'conda') {
    if (input.platform === 'darwin') {
      envChanges.push(
        ...strategy.profileTargets.map(
          (target): EnvChange => ({
            kind: 'profile',
            key: 'python-env:init',
            value: buildCondaInitSnippet(installPaths.condaDir),
            scope: 'user',
            target,
            description: 'Load conda automatically in new terminal sessions.',
          }),
        ),
      )
    } else {
      envChanges.push({
        kind: 'path',
        key: 'PATH',
        value: `${installPaths.condaDir}${strategy.pathSeparator}${installPaths.condaDir}\\Scripts`,
        scope: 'user',
        description: 'Expose Miniconda and Scripts directory in PATH.',
      })
    }
  }

  return envChanges
}

export function buildCondaInitSnippet(condaDir: string): string {
  return [
    '# envsetup: python-env:start',
    `eval "$(${condaDir}/bin/conda shell.bash hook 2> /dev/null)"`,
    '# envsetup: python-env:end',
  ].join('\n')
}
