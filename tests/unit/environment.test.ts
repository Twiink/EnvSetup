import { access, chmod, mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/core/envPersistence', () => ({
  clearPersistedEnvKey: vi.fn(async () => undefined),
}))

import {
  cleanupDetectedEnvironments,
  cleanupDetectedEnvironment,
  collectCleanupTrackedPaths,
  detectTemplateEnvironments,
  isCleanupAllowedPath,
} from '../../src/main/core/environment'
import { resolveTemplate } from '../../src/main/core/template'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('environment detection', () => {
  it('detects node-managed roots from template values and current env vars', async () => {
    const installRootDir = await mkdtemp(join(tmpdir(), 'envsetup-node-'))
    process.env.NVM_DIR = await mkdtemp(join(tmpdir(), 'envsetup-nvm-'))

    const template = resolveTemplate({
      id: 'node-template',
      name: { 'zh-CN': 'Node.js 开发环境', en: 'Node.js Environment' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': '前端', en: 'Node.js' },
      plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
      defaults: { 'node.installRootDir': installRootDir },
      overrides: {
        'node.installRootDir': { editable: true, type: 'path' },
      },
      checks: ['node'],
    })

    const detections = await detectTemplateEnvironments(template, {
      'node.installRootDir': installRootDir,
    })

    expect(detections.some((detection) => detection.kind === 'managed_root')).toBe(true)
    expect(detections.some((detection) => detection.source === 'NVM_DIR')).toBe(true)
  })

  it('detects java and python placeholder environments', async () => {
    process.env.JAVA_HOME = await mkdtemp(join(tmpdir(), 'envsetup-java-'))
    process.env.VIRTUAL_ENV = await mkdtemp(join(tmpdir(), 'envsetup-venv-'))

    const javaTemplate = resolveTemplate({
      id: 'java-template',
      name: { 'zh-CN': 'Java', en: 'Java' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': 'Java', en: 'Java' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['java'],
    })

    const pythonTemplate = resolveTemplate({
      id: 'python-template',
      name: { 'zh-CN': 'Python', en: 'Python' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': 'Python', en: 'Python' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['python'],
    })

    await expect(detectTemplateEnvironments(javaTemplate, {})).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: 'java', source: 'JAVA_HOME' })]),
    )
    await expect(detectTemplateEnvironments(pythonTemplate, {})).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: 'python', source: 'VIRTUAL_ENV' })]),
    )
  })

  it('cleans user-owned detection roots and clears session env vars', async () => {
    const cleanupPath = await mkdtemp(join(tmpdir(), 'envsetup-clean-'))
    const cleanupRealPath = await realpath(cleanupPath)
    await mkdir(join(cleanupPath, 'bin'), { recursive: true })
    await writeFile(join(cleanupPath, 'bin', 'python'), '', 'utf8')
    process.env.PYENV_ROOT = cleanupPath

    const result = await cleanupDetectedEnvironment({
      id: 'python:manager_root:PYENV_ROOT:test',
      tool: 'python',
      kind: 'manager_root',
      path: cleanupPath,
      source: 'PYENV_ROOT',
      cleanupSupported: true,
      cleanupPath,
      cleanupEnvKey: 'PYENV_ROOT',
    })

    expect(result.removedPath).toBe(cleanupRealPath)
    expect(process.env.PYENV_ROOT).toBeUndefined()
  })

  it('allows cleanup for system-style paths except filesystem root', () => {
    expect(isCleanupAllowedPath('/usr/bin/git')).toBe(true)
    expect(isCleanupAllowedPath('/Library/Java/JavaVirtualMachines/temurin')).toBe(true)
    expect(isCleanupAllowedPath('/')).toBe(false)
  })

  it('clears env key even when the detected path is protected', async () => {
    const protectedPath =
      process.platform === 'win32'
        ? 'C:\\Program Files\\Java\\jdk-21'
        : '/Library/Java/JavaVirtualMachines/jdk-21'
    process.env.JAVA_HOME = protectedPath

    const result = await cleanupDetectedEnvironment({
      id: `java:runtime_home:JAVA_HOME:${protectedPath}`,
      tool: 'java',
      kind: 'runtime_home',
      path: protectedPath,
      source: 'JAVA_HOME',
      cleanupSupported: true,
      cleanupPath: protectedPath,
      cleanupEnvKey: 'JAVA_HOME',
    })

    expect(result.removedPath).toBeUndefined()
    expect(result.clearedEnvKey).toBe('JAVA_HOME')
    expect(process.env.JAVA_HOME).toBeUndefined()
  })

  it('detects NVM_HOME (nvm-windows) when env var is set', async () => {
    const nvmHome = await mkdtemp(join(tmpdir(), 'envsetup-nvmhome-'))
    process.env.NVM_HOME = nvmHome

    const template = resolveTemplate({
      id: 'node-template',
      name: { 'zh-CN': '前端', en: 'Node.js' },
      version: '0.1.0',
      platforms: ['darwin', 'win32'],
      description: { 'zh-CN': '前端', en: 'Node.js' },
      plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
      defaults: {},
      overrides: {},
      checks: ['node'],
    })

    const detections = await detectTemplateEnvironments(template, {})
    expect(detections.some((d) => d.source === 'NVM_HOME')).toBe(true)
  })

  it('detects npm_config_prefix when env var is set', async () => {
    const globalPrefix = await mkdtemp(join(tmpdir(), 'envsetup-npmprefix-'))
    process.env.npm_config_prefix = globalPrefix

    const template = resolveTemplate({
      id: 'node-template',
      name: { 'zh-CN': '前端', en: 'Node.js' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': '前端', en: 'Node.js' },
      plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
      defaults: {},
      overrides: {},
      checks: ['node'],
    })

    const detections = await detectTemplateEnvironments(template, {})
    expect(detections.some((d) => d.source === 'npm_config_prefix')).toBe(true)
  })

  it('detects git executable and managed root for git template', async () => {
    const installRootDir = await mkdtemp(join(tmpdir(), 'envsetup-git-'))

    const template = resolveTemplate({
      id: 'git-template',
      name: { 'zh-CN': 'Git', en: 'Git' },
      version: '0.1.0',
      platforms: ['darwin', 'win32'],
      description: { 'zh-CN': 'Git', en: 'Git' },
      plugins: [{ pluginId: 'git-env', version: '0.1.0' }],
      defaults: { 'git.installRootDir': installRootDir },
      overrides: {},
      checks: ['git'],
    })

    const detections = await detectTemplateEnvironments(template, {
      'git.installRootDir': installRootDir,
    })

    expect(detections.some((d) => d.tool === 'git' && d.source === 'git.installRootDir')).toBe(true)
    expect(detections.some((d) => d.tool === 'git' && d.source === 'PATH')).toBe(true)
  })

  it('narrows SCOOP detection to the git app directory when present', async () => {
    const scoopRoot = await mkdtemp(join(tmpdir(), 'envsetup-scoop-'))
    const gitAppDir = join(scoopRoot, 'apps', 'git')
    await mkdir(gitAppDir, { recursive: true })
    process.env.SCOOP = scoopRoot

    const template = resolveTemplate({
      id: 'git-template',
      name: { 'zh-CN': 'Git', en: 'Git' },
      version: '0.1.0',
      platforms: ['win32'],
      description: { 'zh-CN': 'Git', en: 'Git' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['git'],
    })

    const detections = await detectTemplateEnvironments(template, {})
    const scoopDetection = detections.find((detection) => detection.source === 'SCOOP')

    expect(scoopDetection?.path).toBe(gitAppDir)
    expect(scoopDetection?.cleanupEnvKey).toBeUndefined()
  })

  it('marks env-backed detections as cleanup-supported even when the path is protected', async () => {
    process.env.JAVA_HOME =
      process.platform === 'win32'
        ? 'C:\\Program Files\\Java\\jdk-21'
        : '/Library/Java/JavaVirtualMachines/jdk-21'

    const template = resolveTemplate({
      id: 'java-template',
      name: { 'zh-CN': 'Java', en: 'Java' },
      version: '0.1.0',
      platforms: ['darwin', 'win32'],
      description: { 'zh-CN': 'Java', en: 'Java' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['java'],
    })

    const detections = await detectTemplateEnvironments(template, {})
    const javaHomeDetection = detections.find((d) => d.source === 'JAVA_HOME')

    expect(javaHomeDetection?.cleanupSupported).toBe(true)
  })

  it('marks runtime executables as cleanup-supported for java and git', async () => {
    const fakeBinDir = await mkdtemp(join(tmpdir(), 'envsetup-bin-'))
    const fakeJava = join(fakeBinDir, 'java')
    const fakeGit = join(fakeBinDir, 'git')
    await writeFile(fakeJava, '#!/bin/sh\nexit 0\n', 'utf8')
    await writeFile(fakeGit, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(fakeJava, 0o755)
    await chmod(fakeGit, 0o755)

    process.env.PATH = `${fakeBinDir}${delimiter}${originalEnv.PATH ?? ''}`

    const javaTemplate = resolveTemplate({
      id: 'java-template',
      name: { 'zh-CN': 'Java', en: 'Java' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': 'Java', en: 'Java' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['java'],
    })

    const gitTemplate = resolveTemplate({
      id: 'git-template',
      name: { 'zh-CN': 'Git', en: 'Git' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': 'Git', en: 'Git' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['git'],
    })

    const javaDetections = await detectTemplateEnvironments(javaTemplate, {})
    const gitDetections = await detectTemplateEnvironments(gitTemplate, {})

    expect(
      javaDetections.find(
        (detection) => detection.kind === 'runtime_executable' && detection.path === fakeJava,
      ),
    ).toEqual(
      expect.objectContaining({
        cleanupSupported: true,
        cleanupPath: fakeJava,
      }),
    )
    expect(
      gitDetections.find(
        (detection) => detection.kind === 'runtime_executable' && detection.path === fakeGit,
      ),
    ).toEqual(
      expect.objectContaining({
        cleanupSupported: true,
        cleanupPath: fakeGit,
      }),
    )
  })

  it('treats jenv shim java as cleanup-supported runtime executable', async () => {
    const jenvRoot = await mkdtemp(join(tmpdir(), 'envsetup-jenv-'))
    const shimDir = join(jenvRoot, '.jenv', 'shims')
    const fakeJava = join(shimDir, 'java')
    await mkdir(shimDir, { recursive: true })
    await writeFile(fakeJava, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(fakeJava, 0o755)

    process.env.PATH = `${shimDir}${delimiter}${originalEnv.PATH ?? ''}`

    const javaTemplate = resolveTemplate({
      id: 'java-template',
      name: { 'zh-CN': 'Java', en: 'Java' },
      version: '0.1.0',
      platforms: ['darwin'],
      description: { 'zh-CN': 'Java', en: 'Java' },
      plugins: [],
      defaults: {},
      overrides: {},
      checks: ['java'],
    })

    const detections = await detectTemplateEnvironments(javaTemplate, {})
    expect(
      detections.find(
        (detection) => detection.kind === 'runtime_executable' && detection.path === fakeJava,
      ),
    ).toEqual(
      expect.objectContaining({
        cleanupSupported: true,
        cleanupPath: fakeJava,
      }),
    )
  })

  it('removes runtime executable files when no manager-specific uninstall is available', async () => {
    const fakeBinDir = await mkdtemp(join(tmpdir(), 'envsetup-exec-clean-'))
    const fakeGit = join(fakeBinDir, 'git')
    await writeFile(fakeGit, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(fakeGit, 0o755)
    const fakeGitRealPath = await realpath(fakeGit)

    const result = await cleanupDetectedEnvironment({
      id: `git:runtime_executable:PATH:${fakeGit}`,
      tool: 'git',
      kind: 'runtime_executable',
      path: fakeGit,
      source: 'PATH',
      cleanupSupported: true,
      cleanupPath: fakeGit,
    })

    expect(result.removedPath).toBe(fakeGitRealPath)
    await expect(access(fakeGit)).rejects.toThrow()
  })

  it('collects cleanup tracked paths from manager-specific plans', async () => {
    const sdkmanDir = await mkdtemp(join(tmpdir(), 'envsetup-sdkman-'))
    const candidatesDir = join(sdkmanDir, 'candidates', 'java')
    await mkdir(candidatesDir, { recursive: true })

    const trackedPaths = await collectCleanupTrackedPaths([
      {
        id: `java:manager_root:SDKMAN_DIR:${candidatesDir}`,
        tool: 'java',
        kind: 'manager_root',
        path: candidatesDir,
        source: 'SDKMAN_DIR',
        cleanupSupported: true,
        cleanupPath: candidatesDir,
        cleanupEnvKey: 'SDKMAN_DIR',
      },
    ])

    expect(trackedPaths).toEqual([await realpath(candidatesDir)])
  })

  it('aggregates batch cleanup results and errors', async () => {
    const cleanupPath = await mkdtemp(join(tmpdir(), 'envsetup-clean-batch-'))
    process.env.PYENV_ROOT = cleanupPath

    const result = await cleanupDetectedEnvironments([
      {
        id: 'python:manager_root:PYENV_ROOT:test',
        tool: 'python',
        kind: 'manager_root',
        path: cleanupPath,
        source: 'PYENV_ROOT',
        cleanupSupported: true,
        cleanupPath,
        cleanupEnvKey: 'PYENV_ROOT',
      },
      {
        id: 'java:runtime_executable:PATH:/usr/bin/java',
        tool: 'java',
        kind: 'runtime_executable',
        path: process.platform === 'win32' ? 'C:\\Windows\\System32\\java.exe' : '/usr/bin/java',
        source: 'PATH',
        cleanupSupported: false,
      },
    ])

    expect(result.results).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.results[0].detectionId).toBe('python:manager_root:PYENV_ROOT:test')
  })
})
