import { describe, expect, it } from 'vitest'

import {
  buildFrontendEnvChanges,
  buildNvmInitSnippet,
  buildPlatformStrategy,
  resolveFrontendInstallPaths,
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
// resolveFrontendInstallPaths
// ---------------------------------------------------------------------------

describe('resolveFrontendInstallPaths', () => {
  const darwinBase = {
    platform: 'darwin' as const,
    nodeManager: 'nvm' as const,
    nodeVersion: '20.11.1',
    installRootDir: '/tools',
    npmCacheDir: '/tmp/cache',
    npmGlobalPrefix: '/tmp/global',
  }

  it('resolves standaloneNodeDir under installRootDir on darwin', () => {
    const paths = resolveFrontendInstallPaths(darwinBase)
    expect(paths.standaloneNodeDir).toBe('/tools/node-v20.11.1')
  })

  it('places bin/ under standaloneNodeDir on darwin', () => {
    const paths = resolveFrontendInstallPaths(darwinBase)
    expect(paths.standaloneNodeBinDir).toBe('/tools/node-v20.11.1/bin')
  })

  it('places nvmDir under installRootDir', () => {
    const paths = resolveFrontendInstallPaths(darwinBase)
    expect(paths.nvmDir).toBe('/tools/nvm')
  })

  it('standaloneNodeBinDir equals standaloneNodeDir on win32', () => {
    const paths = resolveFrontendInstallPaths({ ...darwinBase, platform: 'win32' })
    expect(paths.standaloneNodeBinDir).toBe(paths.standaloneNodeDir)
  })

  it('nvmNodeMirror points to official nodejs.org dist', () => {
    const paths = resolveFrontendInstallPaths(darwinBase)
    expect(paths.nvmNodeMirror).toBe('https://nodejs.org/dist')
  })
})

// ---------------------------------------------------------------------------
// buildFrontendEnvChanges
// ---------------------------------------------------------------------------

describe('buildFrontendEnvChanges', () => {
  const darwinNvm = {
    platform: 'darwin' as const,
    nodeManager: 'nvm' as const,
    nodeVersion: '20.11.1',
    installRootDir: '/tools',
    npmCacheDir: '/tmp/cache',
    npmGlobalPrefix: '/tmp/global',
  }

  it('includes npm_config_cache env change', () => {
    const changes = buildFrontendEnvChanges(darwinNvm)
    const cacheChange = changes.find((c) => c.key === 'npm_config_cache')
    expect(cacheChange).toBeDefined()
    expect(cacheChange?.value).toBe('/tmp/cache')
  })

  it('includes a profile change for nvm init snippet on darwin', () => {
    const changes = buildFrontendEnvChanges(darwinNvm)
    const profileChange = changes.find((c) => c.kind === 'profile')
    expect(profileChange).toBeDefined()
    expect(profileChange?.value).toContain('nvm.sh')
  })

  it('does not produce a profile change for node manager on darwin', () => {
    const changes = buildFrontendEnvChanges({ ...darwinNvm, nodeManager: 'node' })
    const profileChange = changes.find((c) => c.kind === 'profile')
    expect(profileChange).toBeUndefined()
  })

  it('includes NVM_HOME and NVM_SYMLINK env changes on win32 with nvm', () => {
    const changes = buildFrontendEnvChanges({ ...darwinNvm, platform: 'win32' })
    expect(changes.find((c) => c.key === 'NVM_HOME')).toBeDefined()
    expect(changes.find((c) => c.key === 'NVM_SYMLINK')).toBeDefined()
  })

  it('includes PATH change on win32 with nvm', () => {
    const changes = buildFrontendEnvChanges({ ...darwinNvm, platform: 'win32' })
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toContain('%NVM_HOME%')
  })

  it('includes PATH change pointing to standaloneNodeBinDir on win32 with standalone node', () => {
    const win32Node = { ...darwinNvm, platform: 'win32' as const, nodeManager: 'node' as const }
    const paths = resolveFrontendInstallPaths(win32Node)
    const changes = buildFrontendEnvChanges(win32Node)
    const pathChange = changes.find((c) => c.key === 'PATH')
    expect(pathChange).toBeDefined()
    expect(pathChange?.value).toBe(paths.standaloneNodeBinDir)
  })

  it('does not include NVM_HOME or NVM_SYMLINK on win32 with standalone node', () => {
    const changes = buildFrontendEnvChanges({
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
    expect(snippet).toContain('# envsetup: frontend-env:start')
    expect(snippet).toContain('# envsetup: frontend-env:end')
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
