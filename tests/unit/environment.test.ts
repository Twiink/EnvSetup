import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cleanupDetectedEnvironment,
  detectTemplateEnvironments,
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

    expect(result.removedPath).toBe(cleanupPath)
    expect(process.env.PYENV_ROOT).toBeUndefined()
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
})
