/**
 * platform 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import {
  buildCondaInitSnippet,
  buildGitEnvChanges,
  buildJavaEnvChanges,
  buildMavenEnvChanges,
  buildMysqlEnvChanges,
  buildNodeEnvChanges,
  buildNvmInitSnippet,
  buildPlatformStrategy,
  buildPythonEnvChanges,
  buildRedisEnvChanges,
  buildSdkmanInitSnippet,
  resolveGitInstallPaths,
  resolveJavaInstallPaths,
  resolveMavenInstallPaths,
  resolveMysqlInstallPaths,
  resolveNodeInstallPaths,
  resolvePythonInstallPaths,
  resolveRedisInstallPaths,
} from '../../src/main/core/platform'

// ---------------------------------------------------------------------------
// buildPlatformStrategy
// ---------------------------------------------------------------------------

describe('buildPlatformStrategy', () => {
  it('returns zsh/bash strategy for darwin', () => {
    const strategy = buildPlatformStrategy('darwin')
    expect(strategy.shellTargets).toEqual(['zsh', 'bash'])
  })

  it('returns powershell strategy for win32', () => {
    const strategy = buildPlatformStrategy('win32')
    expect(strategy.shellTargets).toEqual(['powershell'])
  })

  it('uses colon as path separator on darwin', () => {
    expect(buildPlatformStrategy('darwin').pathSeparator).toBe(':')
  })

  it('uses semicolon as path separator on win32', () => {
    expect(buildPlatformStrategy('win32').pathSeparator).toBe(';')
  })

  it('includes expected profile targets for darwin', () => {
    const { profileTargets } = buildPlatformStrategy('darwin')
    expect(profileTargets).toContain('~/.zshrc')
    expect(profileTargets).toContain('~/.bash_profile')
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInstallPaths
// ---------------------------------------------------------------------------

describe('resolveNodeInstallPaths', () => {
  const darwinBase = {
    platform: 'darwin' as const,
    nodeManager: 'nvm' as const,
    nodeVersion: '20.11.1',
    installRootDir: '/tools',
    npmCacheDir: '/tmp/cache',
    npmGlobalPrefix: '/tmp/global',
  }

  it('resolves standaloneNodeDir under installRootDir on darwin', () => {
    const paths = resolveNodeInstallPaths(darwinBase)
    expect(paths.standaloneNodeDir).toBe('/tools/node-v20.11.1')
  })

  it('places bin/ under standaloneNodeDir on darwin', () => {
    const paths = resolveNodeInstallPaths(darwinBase)
    expect(paths.standaloneNodeBinDir).toBe('/tools/node-v20.11.1/bin')
  })

  it('places nvmDir under installRootDir', () => {
    const paths = resolveNodeInstallPaths(darwinBase)
    expect(paths.nvmDir).toBe('/tools/nvm')
  })

  it('standaloneNodeBinDir equals standaloneNodeDir on win32', () => {
    const paths = resolveNodeInstallPaths({ ...darwinBase, platform: 'win32' })
    expect(paths.standaloneNodeBinDir).toBe(paths.standaloneNodeDir)
  })

  it('nvmNodeMirror points to official nodejs.org dist', () => {
    const paths = resolveNodeInstallPaths(darwinBase)
    expect(paths.nvmNodeMirror).toBe('https://nodejs.org/dist')
  })
})

// ---------------------------------------------------------------------------
// buildNodeEnvChanges
// ---------------------------------------------------------------------------

describe('buildNodeEnvChanges', () => {
  const darwinNvm = {
    platform: 'darwin' as const,
    nodeManager: 'nvm' as const,
    nodeVersion: '20.11.1',
    installRootDir: '/tools',
    npmCacheDir: '/tmp/cache',
    npmGlobalPrefix: '/tmp/global',
  }

  it('includes npm_config_cache env change', () => {
    const changes = buildNodeEnvChanges(darwinNvm)
    const cacheChange = changes.find((c) => c.key === 'npm_config_cache')
    expect(cacheChange).toBeDefined()
    expect(cacheChange?.value).toBe('/tmp/cache')
  })

  it('includes a profile change for nvm init snippet on darwin', () => {
    const changes = buildNodeEnvChanges(darwinNvm)
    const profileChange = changes.find((c) => c.kind === 'profile')
    expect(profileChange).toBeDefined()
    expect(profileChange?.value).toContain('nvm.sh')
  })

  it('does not produce a profile change for node manager on darwin', () => {
    const changes = buildNodeEnvChanges({ ...darwinNvm, nodeManager: 'node' })
    const profileChange = changes.find((c) => c.kind === 'profile')
    expect(profileChange).toBeUndefined()
  })

  it('includes NVM_HOME and NVM_SYMLINK env changes on win32 with nvm', () => {
    const changes = buildNodeEnvChanges({ ...darwinNvm, platform: 'win32' })
    expect(changes.find((c) => c.key === 'NVM_HOME')).toBeDefined()
    expect(changes.find((c) => c.key === 'NVM_SYMLINK')).toBeDefined()
  })

  it('includes PATH change on win32 with nvm', () => {
    const changes = buildNodeEnvChanges({ ...darwinNvm, platform: 'win32' })
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toContain('%NVM_HOME%')
  })

  it('includes PATH change pointing to standaloneNodeBinDir on win32 with standalone node', () => {
    const win32Node = { ...darwinNvm, platform: 'win32' as const, nodeManager: 'node' as const }
    const paths = resolveNodeInstallPaths(win32Node)
    const changes = buildNodeEnvChanges(win32Node)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toBe(paths.standaloneNodeBinDir)
  })

  it('does not include NVM_HOME or NVM_SYMLINK on win32 with standalone node', () => {
    const changes = buildNodeEnvChanges({
      ...darwinNvm,
      platform: 'win32' as const,
      nodeManager: 'node' as const,
    })
    expect(changes.find((c) => c.key === 'NVM_HOME')).toBeUndefined()
    expect(changes.find((c) => c.key === 'NVM_SYMLINK')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildNvmInitSnippet
// ---------------------------------------------------------------------------

describe('buildNvmInitSnippet', () => {
  it('contains the envsetup start/end markers', () => {
    const snippet = buildNvmInitSnippet('/tools/nvm')
    expect(snippet).toContain('# envsetup: node-env:start')
    expect(snippet).toContain('# envsetup: node-env:end')
  })

  it('exports NVM_DIR to the provided path', () => {
    const snippet = buildNvmInitSnippet('/tools/nvm')
    expect(snippet).toContain('export NVM_DIR="/tools/nvm"')
  })

  it('sources nvm.sh', () => {
    const snippet = buildNvmInitSnippet('/tools/nvm')
    expect(snippet).toContain('[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"')
  })

  it('uses the provided nodeMirror for NVM_NODEJS_ORG_MIRROR', () => {
    const snippet = buildNvmInitSnippet('/tools/nvm', 'https://custom.mirror/dist')
    expect(snippet).toContain('export NVM_NODEJS_ORG_MIRROR="https://custom.mirror/dist"')
  })

  it('defaults NVM_NODEJS_ORG_MIRROR to official nodejs.org', () => {
    const snippet = buildNvmInitSnippet('/tools/nvm')
    expect(snippet).toContain('https://nodejs.org/dist')
  })
})

// ---------------------------------------------------------------------------
// resolveGitInstallPaths / buildGitEnvChanges
// ---------------------------------------------------------------------------

describe('resolveGitInstallPaths', () => {
  const darwinGit = {
    platform: 'darwin' as const,
    gitManager: 'git' as const,
    gitVersion: '2.47.1',
    installRootDir: '/tools',
  }

  it('resolves standalone git directories on darwin', () => {
    const paths = resolveGitInstallPaths(darwinGit)
    expect(paths.gitDir).toBe('/tools/git')
    expect(paths.gitBinDir).toBe('/tools/git/bin')
  })

  it('resolves standalone git cmd directory on win32', () => {
    const paths = resolveGitInstallPaths({ ...darwinGit, platform: 'win32' })
    expect(paths.gitBinDir).toBe('\\tools\\git\\cmd')
  })
})

describe('buildGitEnvChanges', () => {
  const darwinGit = {
    platform: 'darwin' as const,
    gitManager: 'git' as const,
    gitVersion: '2.47.1',
    installRootDir: '/tools',
  }

  it('includes PATH change for standalone git', () => {
    const changes = buildGitEnvChanges(darwinGit)
    expect(changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'PATH', value: '/tools/git/bin' })]),
    )
  })

  it('includes Homebrew PATH change on darwin', () => {
    const changes = buildGitEnvChanges({ ...darwinGit, gitManager: 'homebrew' as const })
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'PATH',
          value: process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin',
        }),
      ]),
    )
  })

  it('includes Scoop shims PATH change on win32', () => {
    const changes = buildGitEnvChanges({
      ...darwinGit,
      platform: 'win32' as const,
      gitManager: 'scoop' as const,
    })
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })
})

// ---------------------------------------------------------------------------
// resolveJavaInstallPaths
// ---------------------------------------------------------------------------

describe('resolveJavaInstallPaths', () => {
  const darwinJava = {
    platform: 'darwin' as const,
    javaManager: 'jdk' as const,
    javaVersion: '21.0.2',
    installRootDir: '/tools',
  }

  it('resolves standaloneJdkDir under installRootDir on darwin', () => {
    const paths = resolveJavaInstallPaths(darwinJava)
    expect(paths.standaloneJdkDir).toBe('/tools/java-21.0.2')
  })

  it('places bin/ under standaloneJdkDir on darwin', () => {
    const paths = resolveJavaInstallPaths(darwinJava)
    expect(paths.standaloneJdkBinDir).toBe('/tools/java-21.0.2/bin')
  })

  it('places sdkmanDir under installRootDir', () => {
    const paths = resolveJavaInstallPaths(darwinJava)
    expect(paths.sdkmanDir).toBe('/tools/sdkman')
  })

  it('uses backslash paths on win32', () => {
    const paths = resolveJavaInstallPaths({ ...darwinJava, platform: 'win32' })
    expect(paths.standaloneJdkDir).toBe('\\tools\\java-21.0.2')
    expect(paths.standaloneJdkBinDir).toBe('\\tools\\java-21.0.2\\bin')
    expect(paths.sdkmanDir).toBe('\\tools\\sdkman')
  })
})

// ---------------------------------------------------------------------------
// buildJavaEnvChanges
// ---------------------------------------------------------------------------

describe('buildJavaEnvChanges', () => {
  const darwinJdk = {
    platform: 'darwin' as const,
    javaManager: 'jdk' as const,
    javaVersion: '21.0.2',
    installRootDir: '/tools',
  }

  it('includes JAVA_HOME env change for jdk manager', () => {
    const changes = buildJavaEnvChanges(darwinJdk)
    const javaHome = changes.find((c) => c.key === 'JAVA_HOME')
    expect(javaHome).toBeDefined()
    expect(javaHome?.value).toBe('/tools/java-21.0.2')
  })

  it('includes PATH change for jdk manager', () => {
    const changes = buildJavaEnvChanges(darwinJdk)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toBe('/tools/java-21.0.2/bin')
  })

  it('includes SDKMAN_DIR env change for sdkman on darwin', () => {
    const darwinSdkman = { ...darwinJdk, javaManager: 'sdkman' as const }
    const changes = buildJavaEnvChanges(darwinSdkman)
    const sdkmanDir = changes.find((c) => c.key === 'SDKMAN_DIR')
    expect(sdkmanDir).toBeDefined()
    expect(sdkmanDir?.value).toBe('/tools/sdkman')
  })

  it('includes profile changes for each profile target on darwin with sdkman', () => {
    const darwinSdkman = { ...darwinJdk, javaManager: 'sdkman' as const }
    const changes = buildJavaEnvChanges(darwinSdkman)
    const profileChanges = changes.filter((c) => c.kind === 'profile')
    expect(profileChanges.length).toBeGreaterThanOrEqual(2)
    expect(profileChanges.some((c) => c.target === '~/.zshrc')).toBe(true)
    expect(profileChanges.some((c) => c.target === '~/.bash_profile')).toBe(true)
  })

  it('includes SDKMAN_DIR but no profile changes for sdkman on win32', () => {
    const win32Sdkman = {
      ...darwinJdk,
      platform: 'win32' as const,
      javaManager: 'sdkman' as const,
    }
    const changes = buildJavaEnvChanges(win32Sdkman)
    expect(changes.find((c) => c.key === 'SDKMAN_DIR')).toBeDefined()
    expect(changes.find((c) => c.kind === 'profile')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildSdkmanInitSnippet
// ---------------------------------------------------------------------------

describe('buildSdkmanInitSnippet', () => {
  it('contains the envsetup start/end markers', () => {
    const snippet = buildSdkmanInitSnippet('/tools/sdkman')
    expect(snippet).toContain('# envsetup: java-env:start')
    expect(snippet).toContain('# envsetup: java-env:end')
  })

  it('exports SDKMAN_DIR to the provided path', () => {
    const snippet = buildSdkmanInitSnippet('/tools/sdkman')
    expect(snippet).toContain('export SDKMAN_DIR="/tools/sdkman"')
  })

  it('sources sdkman-init.sh', () => {
    const snippet = buildSdkmanInitSnippet('/tools/sdkman')
    expect(snippet).toContain('sdkman-init.sh')
    expect(snippet).toContain('source "/tools/sdkman/bin/sdkman-init.sh"')
  })
})

// ---------------------------------------------------------------------------
// resolvePythonInstallPaths
// ---------------------------------------------------------------------------

describe('resolvePythonInstallPaths', () => {
  const darwinPython = {
    platform: 'darwin' as const,
    pythonManager: 'python' as const,
    pythonVersion: '3.12.1',
    installRootDir: '/tools',
  }

  it('resolves standalonePythonDir under installRootDir on darwin', () => {
    const paths = resolvePythonInstallPaths(darwinPython)
    expect(paths.standalonePythonDir).toBe('/tools/python-3.12.1')
  })

  it('places bin/ under standalonePythonDir on darwin', () => {
    const paths = resolvePythonInstallPaths(darwinPython)
    expect(paths.standalonePythonBinDir).toBe('/tools/python-3.12.1/bin')
  })

  it('standalonePythonBinDir equals standalonePythonDir on win32', () => {
    const paths = resolvePythonInstallPaths({ ...darwinPython, platform: 'win32' })
    expect(paths.standalonePythonBinDir).toBe(paths.standalonePythonDir)
  })

  it('resolves condaDir to miniconda3 under installRootDir', () => {
    const paths = resolvePythonInstallPaths(darwinPython)
    expect(paths.condaDir).toBe('/tools/miniconda3')
  })

  it('condaEnvDir equals condaDir when condaEnvName is base', () => {
    const paths = resolvePythonInstallPaths({ ...darwinPython, condaEnvName: 'base' })
    expect(paths.condaEnvDir).toBe(paths.condaDir)
  })

  it('condaEnvDir defaults to condaDir when condaEnvName is omitted', () => {
    const paths = resolvePythonInstallPaths(darwinPython)
    expect(paths.condaEnvDir).toBe(paths.condaDir)
  })

  it('condaEnvDir points to envs/{name} for a custom conda env name', () => {
    const paths = resolvePythonInstallPaths({ ...darwinPython, condaEnvName: 'myenv' })
    expect(paths.condaEnvDir).toBe('/tools/miniconda3/envs/myenv')
  })

  it('uses backslash paths on win32', () => {
    const paths = resolvePythonInstallPaths({
      ...darwinPython,
      platform: 'win32',
      condaEnvName: 'myenv',
    })
    expect(paths.standalonePythonDir).toBe('\\tools\\python-3.12.1')
    expect(paths.condaDir).toBe('\\tools\\miniconda3')
    expect(paths.condaEnvDir).toBe('\\tools\\miniconda3\\envs\\myenv')
  })
})

// ---------------------------------------------------------------------------
// buildPythonEnvChanges
// ---------------------------------------------------------------------------

describe('buildPythonEnvChanges', () => {
  const darwinPython = {
    platform: 'darwin' as const,
    pythonManager: 'python' as const,
    pythonVersion: '3.12.1',
    installRootDir: '/tools',
  }

  it('includes PATH change pointing to standalonePythonBinDir for python manager', () => {
    const changes = buildPythonEnvChanges(darwinPython)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toBe('/tools/python-3.12.1/bin')
  })

  it('includes profile changes for conda on darwin', () => {
    const darwinConda = { ...darwinPython, pythonManager: 'conda' as const }
    const changes = buildPythonEnvChanges(darwinConda)
    const profileChanges = changes.filter((c) => c.kind === 'profile')
    expect(profileChanges.length).toBeGreaterThanOrEqual(2)
    expect(profileChanges.some((c) => c.target === '~/.zshrc')).toBe(true)
    expect(profileChanges.some((c) => c.target === '~/.bash_profile')).toBe(true)
  })

  it('does not produce profile changes for conda on win32', () => {
    const win32Conda = {
      ...darwinPython,
      platform: 'win32' as const,
      pythonManager: 'conda' as const,
    }
    const changes = buildPythonEnvChanges(win32Conda)
    expect(changes.find((c) => c.kind === 'profile')).toBeUndefined()
  })

  it('includes PATH with condaDir and Scripts for conda on win32', () => {
    const win32Conda = {
      ...darwinPython,
      platform: 'win32' as const,
      pythonManager: 'conda' as const,
    }
    const changes = buildPythonEnvChanges(win32Conda)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toContain('\\tools\\miniconda3')
    expect(pathChange?.value).toContain('Scripts')
  })

  it('does not include PATH or profile changes for standalone python on darwin', () => {
    const changes = buildPythonEnvChanges(darwinPython)
    const profileChanges = changes.filter((c) => c.kind === 'profile')
    expect(profileChanges).toHaveLength(0)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange?.value).toBe('/tools/python-3.12.1/bin')
  })

  it('includes PATH change pointing to standalonePythonBinDir for pkg manager on darwin', () => {
    const darwinPkg = { ...darwinPython, pythonManager: 'pkg' as const }
    const changes = buildPythonEnvChanges(darwinPkg)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toBe('/tools/python-3.12.1/bin')
    const profileChanges = changes.filter((c) => c.kind === 'profile')
    expect(profileChanges).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resolveMysqlInstallPaths / buildMysqlEnvChanges
// ---------------------------------------------------------------------------

describe('resolveMysqlInstallPaths', () => {
  const darwinMysql = {
    platform: 'darwin' as const,
    mysqlManager: 'package' as const,
    installRootDir: '/tools',
  }

  it('uses Homebrew bin directory on darwin', () => {
    const paths = resolveMysqlInstallPaths(darwinMysql)
    expect(paths.homebrewDir).toBe(process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin')
  })

  it('uses Scoop shims directory on win32', () => {
    const paths = resolveMysqlInstallPaths({ ...darwinMysql, platform: 'win32' })
    expect(paths.scoopDir).toBe('%USERPROFILE%\\scoop\\shims')
  })
})

describe('buildMysqlEnvChanges', () => {
  const darwinMysql = {
    platform: 'darwin' as const,
    mysqlManager: 'package' as const,
    installRootDir: '/tools',
  }

  it('points PATH to Homebrew bin on darwin', () => {
    const changes = buildMysqlEnvChanges(darwinMysql)
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'PATH',
          value: process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin',
        }),
      ]),
    )
  })

  it('points PATH to Scoop shims on win32', () => {
    const changes = buildMysqlEnvChanges({ ...darwinMysql, platform: 'win32' as const })
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })
})

// ---------------------------------------------------------------------------
// resolveRedisInstallPaths / buildRedisEnvChanges
// ---------------------------------------------------------------------------

describe('resolveRedisInstallPaths', () => {
  const darwinRedis = {
    platform: 'darwin' as const,
    redisManager: 'package' as const,
    installRootDir: '/tools',
  }

  it('uses Homebrew bin directory on darwin', () => {
    const paths = resolveRedisInstallPaths(darwinRedis)
    expect(paths.homebrewDir).toBe(process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin')
  })

  it('uses Scoop shims directory on win32', () => {
    const paths = resolveRedisInstallPaths({ ...darwinRedis, platform: 'win32' })
    expect(paths.scoopDir).toBe('%USERPROFILE%\\scoop\\shims')
  })
})

describe('buildRedisEnvChanges', () => {
  const darwinRedis = {
    platform: 'darwin' as const,
    redisManager: 'package' as const,
    installRootDir: '/tools',
  }

  it('points PATH to Homebrew bin on darwin', () => {
    const changes = buildRedisEnvChanges(darwinRedis)
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'PATH',
          value: process.arch === 'x64' ? '/usr/local/bin' : '/opt/homebrew/bin',
        }),
      ]),
    )
  })

  it('points PATH to Scoop shims on win32', () => {
    const changes = buildRedisEnvChanges({ ...darwinRedis, platform: 'win32' as const })
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PATH', value: '%USERPROFILE%\\scoop\\shims' }),
      ]),
    )
  })
})

// ---------------------------------------------------------------------------
// resolveMavenInstallPaths / buildMavenEnvChanges
// ---------------------------------------------------------------------------

describe('resolveMavenInstallPaths', () => {
  const darwinMaven = {
    platform: 'darwin' as const,
    mavenManager: 'maven' as const,
    mavenVersion: '3.9.11',
    installRootDir: '/tools',
  }

  it('resolves standaloneMavenDir under installRootDir on darwin', () => {
    const paths = resolveMavenInstallPaths(darwinMaven)
    expect(paths.standaloneMavenDir).toBe('/tools/maven-3.9.11')
  })

  it('places bin/ under standaloneMavenDir on darwin', () => {
    const paths = resolveMavenInstallPaths(darwinMaven)
    expect(paths.standaloneMavenBinDir).toBe('/tools/maven-3.9.11/bin')
  })

  it('uses backslash paths on win32', () => {
    const paths = resolveMavenInstallPaths({ ...darwinMaven, platform: 'win32' })
    expect(paths.standaloneMavenDir).toBe('\\tools\\maven-3.9.11')
    expect(paths.standaloneMavenBinDir).toBe('\\tools\\maven-3.9.11\\bin')
  })
})

describe('buildMavenEnvChanges', () => {
  const darwinMaven = {
    platform: 'darwin' as const,
    mavenManager: 'maven' as const,
    mavenVersion: '3.9.11',
    installRootDir: '/tools',
  }

  it('includes MAVEN_HOME and M2_HOME env changes', () => {
    const changes = buildMavenEnvChanges(darwinMaven)
    expect(changes.find((change) => change.key === 'MAVEN_HOME')?.value).toBe('/tools/maven-3.9.11')
    expect(changes.find((change) => change.key === 'M2_HOME')?.value).toBe('/tools/maven-3.9.11')
  })

  it('includes PATH change for standalone Maven bin', () => {
    const changes = buildMavenEnvChanges(darwinMaven)
    expect(changes.find((change) => change.key === 'PATH')?.value).toBe('/tools/maven-3.9.11/bin')
  })
})

// ---------------------------------------------------------------------------
// buildCondaInitSnippet
// ---------------------------------------------------------------------------

describe('buildCondaInitSnippet', () => {
  it('contains the envsetup start/end markers', () => {
    const snippet = buildCondaInitSnippet('/tools/miniconda3')
    expect(snippet).toContain('# envsetup: python-env:start')
    expect(snippet).toContain('# envsetup: python-env:end')
  })

  it('contains conda shell.bash hook eval', () => {
    const snippet = buildCondaInitSnippet('/tools/miniconda3')
    expect(snippet).toContain('conda shell.bash hook')
    expect(snippet).toContain('eval')
    expect(snippet).toContain('/tools/miniconda3/bin/conda')
  })
})
