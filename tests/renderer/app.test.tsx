// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvSetupApi } from '../../src/main/core/contracts'
import App from '../../src/renderer/App'

const nodeTemplateFixture = {
  id: 'node-template',
  name: {
    'zh-CN': 'Node.js 开发环境',
    en: 'Node.js Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'Node.js 开发环境模板',
    en: 'Node.js environment template',
  },
  plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: [],
  fields: {
    'node.nodeManager': {
      key: 'node.nodeManager',
      type: 'enum',
      value: 'nvm',
      editable: true,
      required: true,
      enum: ['node', 'nvm'],
    },
    'node.nodeVersion': {
      key: 'node.nodeVersion',
      type: 'version',
      value: '20.11.1',
      editable: true,
      required: true,
    },
    'node.installRootDir': {
      key: 'node.installRootDir',
      type: 'path',
      value: '/tmp/toolchain',
      editable: true,
      required: true,
    },
  },
}

const javaTemplateFixture = {
  id: 'java-template',
  name: {
    'zh-CN': 'Java 开发环境',
    en: 'Java Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'Java 开发环境模板',
    en: 'Java environment template',
  },
  plugins: [{ pluginId: 'java-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: ['java'],
  fields: {
    'java.javaManager': {
      key: 'java.javaManager',
      type: 'enum',
      value: 'jdk',
      editable: true,
      required: true,
      enum: ['jdk', 'sdkman'],
    },
    'java.javaVersion': {
      key: 'java.javaVersion',
      type: 'version',
      value: '21.0.6',
      editable: true,
      required: true,
    },
    'java.installRootDir': {
      key: 'java.installRootDir',
      type: 'path',
      value: '/tmp/java-toolchain',
      editable: true,
      required: true,
    },
  },
}

const pythonTemplateFixture = {
  id: 'python-template',
  name: {
    'zh-CN': 'Python 开发环境',
    en: 'Python Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'Python 开发环境模板',
    en: 'Python environment template',
  },
  plugins: [{ pluginId: 'python-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: ['python'],
  fields: {
    'python.pythonManager': {
      key: 'python.pythonManager',
      type: 'enum',
      value: 'python',
      editable: true,
      required: true,
      enum: ['python', 'conda'],
    },
    'python.pythonVersion': {
      key: 'python.pythonVersion',
      type: 'version',
      value: '3.12.10',
      editable: true,
      required: true,
    },
    'python.installRootDir': {
      key: 'python.installRootDir',
      type: 'path',
      value: '/tmp/python-toolchain',
      editable: true,
      required: true,
    },
  },
}

const gitTemplateFixture = {
  id: 'git-template',
  name: {
    'zh-CN': 'Git 开发环境',
    en: 'Git Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'Git 开发环境模板',
    en: 'Git environment template',
  },
  plugins: [{ pluginId: 'git-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: ['git'],
  fields: {
    'git.gitManager': {
      key: 'git.gitManager',
      type: 'enum',
      value: 'git',
      editable: true,
      required: true,
      enum: ['git', 'homebrew'],
    },
    'git.gitVersion': {
      key: 'git.gitVersion',
      type: 'version',
      value: '2.47.1',
      editable: true,
      required: true,
    },
    'git.installRootDir': {
      key: 'git.installRootDir',
      type: 'path',
      value: '/tmp/git-toolchain',
      editable: true,
      required: true,
    },
  },
}

const pickDirectory = vi.fn()
const runPrecheck = vi.fn()
const onTaskProgress = vi.fn()
const removeTaskProgressListener = vi.fn()
const startTask = vi.fn()
const cancelTask = vi.fn()
const retryPlugin = vi.fn()
const cleanupEnvironment = vi.fn()
const cleanupEnvironments = vi.fn()
const previewEnvChanges = vi.fn()
const applyEnvChanges = vi.fn()
const executeRollback = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  pickDirectory.mockReset()
  pickDirectory.mockResolvedValue('/tmp/selected-toolchain')
  runPrecheck.mockReset()
  runPrecheck.mockResolvedValue({
    level: 'pass',
    items: [],
    detections: [],
    createdAt: new Date().toISOString(),
  })
  onTaskProgress.mockReset()
  removeTaskProgressListener.mockReset()
  startTask.mockReset()
  cancelTask.mockReset()
  retryPlugin.mockReset()
  cleanupEnvironment.mockReset()
  cleanupEnvironments.mockReset()
  previewEnvChanges.mockReset()
  applyEnvChanges.mockReset()
  executeRollback.mockReset()
  previewEnvChanges.mockResolvedValue({
    envCount: 0,
    pathCount: 0,
    profileCount: 0,
    targets: [],
  })
  cleanupEnvironment.mockResolvedValue({ ok: true })
  cleanupEnvironments.mockResolvedValue({
    snapshotId: 'snapshot-cleanup-1',
    results: [],
    errors: [],
    message: 'Successfully cleaned 2 environment(s)',
  })
  applyEnvChanges.mockResolvedValue({ applied: [], skipped: [] })
  executeRollback.mockResolvedValue({
    success: true,
    executionMode: 'real_run',
    snapshotId: 'snapshot-cleanup-1',
    filesRestored: 2,
    envVariablesRestored: 1,
    shellConfigsRestored: 1,
    directoriesRemoved: 0,
    errors: [],
    message:
      'Successfully restored 2 file(s), 1 shell config(s), ran 0 rollback command(s), removed 0 dir(s)',
  })
  cancelTask.mockResolvedValue({
    id: 'task-1',
    templateId: 'node-template',
    templateVersion: '0.1.0',
    locale: 'zh-CN',
    status: 'cancelled',
    params: {},
    plugins: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  retryPlugin.mockResolvedValue({
    id: 'task-1',
    templateId: 'node-template',
    templateVersion: '0.1.0',
    locale: 'zh-CN',
    status: 'running',
    params: {},
    plugins: [
      {
        pluginId: 'node-env',
        version: '0.1.0',
        status: 'running',
        params: {},
        logs: [],
        context: {},
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  startTask.mockResolvedValue({
    id: 'task-1',
    templateId: 'node-template',
    templateVersion: '0.1.0',
    locale: 'zh-CN',
    status: 'succeeded',
    params: {},
    plugins: [
      {
        pluginId: 'node-env',
        version: '0.1.0',
        status: 'verified_success',
        params: {},
        logs: [],
        context: {},
        lastResult: {
          status: 'installed_unverified',
          executionMode: 'real_run',
          version: '20.11.1',
          paths: {
            installRootDir: '/tmp/toolchain',
            npmCacheDir: '/tmp/npm-cache',
            npmGlobalPrefix: '/tmp/npm-global',
          },
          envChanges: [],
          downloads: [],
          commands: [],
          logs: [],
          summary: 'Completed Node.js environment install commands.',
        },
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const api: EnvSetupApi = {
    loadBootstrap: vi.fn().mockResolvedValue({
      templates: [nodeTemplateFixture, javaTemplateFixture, pythonTemplateFixture, gitTemplateFixture],
      nodeLtsVersions: ['24.13.1', '22.22.1', '20.20.1'],
      javaLtsVersions: ['21.0.6', '17.0.14', '11.0.26'],
      pythonVersions: ['3.12.10', '3.11.10', '3.10.15'],
      gitVersions: ['2.47.1'],
      loadedAt: new Date().toISOString(),
    }),
    listTemplates: vi
      .fn()
      .mockResolvedValue([
        nodeTemplateFixture,
        javaTemplateFixture,
        pythonTemplateFixture,
        gitTemplateFixture,
      ]),
    listNodeLtsVersions: vi.fn().mockResolvedValue(['24.13.1', '22.22.1', '20.20.1']),
    listJavaLtsVersions: vi.fn().mockResolvedValue(['21.0.6', '17.0.14', '11.0.26']),
    listPythonVersions: vi.fn().mockResolvedValue(['3.12.10', '3.11.10', '3.10.15']),
    listGitVersions: vi.fn().mockResolvedValue(['2.47.1']),
    runPrecheck,
    createTask: vi.fn().mockResolvedValue({
      id: 'task-1',
      templateId: 'node-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      status: 'draft',
      params: {},
      plugins: [
        {
          pluginId: 'node-env',
          version: '0.1.0',
          status: 'failed',
          params: {},
          logs: [],
          context: {},
          lastResult: {
            status: 'installed_unverified',
            executionMode: 'real_run',
            version: '20.11.1',
            paths: {
              installRootDir: '/tmp/toolchain',
              npmCacheDir: '/tmp/npm-cache',
              npmGlobalPrefix: '/tmp/npm-global',
            },
            envChanges: [
              {
                kind: 'env',
                key: 'npm_config_cache',
                value: '/tmp/npm-cache',
                scope: 'user',
                description: 'Set npm cache directory.',
              },
            ],
            downloads: [],
            commands: [],
            logs: [],
            summary: 'Completed Node.js environment install commands.',
          },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    startTask,
    cancelTask,
    retryPlugin,
    cleanupEnvironment,
    cleanupEnvironments,
    pickDirectory,
    importPluginFromPath: vi.fn(),
    previewEnvChanges,
    applyEnvChanges,
    onTaskProgress,
    removeTaskProgressListener,
    listSnapshots: vi.fn(),
    createSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    suggestRollback: vi.fn(),
    executeRollback,
    runEnhancedPrecheck: vi.fn(),
  }

  Object.defineProperty(window, 'envSetup', {
    configurable: true,
    writable: true,
    value: api,
  })
})

afterEach(() => {
  cleanup()
})

async function clickEnabledButton(name: string) {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => {
    expect(button).toBeEnabled()
  })
  fireEvent.click(button)
}

async function runPassingPrecheck() {
  await clickEnabledButton('运行预检')
  await screen.findByText('当前预检项均已通过。')
}

describe('App', () => {
  it('renders template list and precheck panel', async () => {
    render(<App />)

    expect(await screen.findByText('模板')).toBeInTheDocument()
    expect(await screen.findByText('预检')).toBeInTheDocument()
    expect(await screen.findByText('Node.js 开发环境')).toBeInTheDocument()
    expect(await screen.findByText('Java 开发环境')).toBeInTheDocument()
    expect(await screen.findByText('Python 开发环境')).toBeInTheDocument()
    expect(await screen.findByText('Git 开发环境')).toBeInTheDocument()
  })

  it('creates a task after precheck', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')

    expect(await screen.findByText('任务状态')).toBeInTheDocument()
    expect(await screen.findByText('草稿')).toBeInTheDocument()
  })

  it('renders node version as official lts select and allows directory picking', async () => {
    render(<App />)

    expect(await screen.findByDisplayValue('24.13.1')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '工具安装根目录 选择文件夹' }))

    expect(pickDirectory).toHaveBeenCalledWith('/tmp/toolchain')
    expect(await screen.findByDisplayValue('/tmp/selected-toolchain')).toBeInTheDocument()
  })

  it('shows detected environments and cleanup action after precheck', async () => {
    runPrecheck.mockResolvedValueOnce({
      level: 'warn',
      items: [],
      detections: [
        {
          id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
          tool: 'node',
          kind: 'manager_root',
          path: '/tmp/.nvm',
          source: 'NVM_DIR',
          cleanupSupported: true,
          cleanupPath: '/tmp/.nvm',
          cleanupEnvKey: 'NVM_DIR',
        },
      ],
      createdAt: new Date().toISOString(),
    })

    render(<App />)

    await clickEnabledButton('运行预检')

    expect(await screen.findByText('已发现环境')).toBeInTheDocument()
    expect(await screen.findByText('Node 管理器目录')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '一键清理' })).toBeInTheDocument()
  })

  it('renders git version as selectable option after switching template', async () => {
    render(<App />)

    fireEvent.click(await screen.findByText('Git 开发环境'))

    expect(await screen.findByDisplayValue('2.47.1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('直接安装 Git')).toBeInTheDocument()
  })

  it('switches visible copy to english', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'English' }))

    expect(await screen.findByRole('heading', { name: 'EnvSetup' })).toBeInTheDocument()
    expect(await screen.findByText('Templates')).toBeInTheDocument()
    expect(await screen.findByText('Node.js Environment')).toBeInTheDocument()
  })

  it('shows real_run summary after starting a task', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('任务状态')

    fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))

    expect(await screen.findByText('Node.js 环境安装命令已执行完成。')).toBeInTheDocument()
    expect(startTask).toHaveBeenCalledWith('task-1')
    expect(onTaskProgress).toHaveBeenCalled()
    expect(removeTaskProgressListener).toHaveBeenCalled()
  })

  it('renders env/download/command details when task has lastResult', async () => {
    startTask.mockResolvedValueOnce({
      id: 'task-1',
      templateId: 'node-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      status: 'succeeded',
      params: {},
      plugins: [
        {
          pluginId: 'node-env',
          version: '0.1.0',
          status: 'verified_success',
          params: {},
          logs: [],
          context: {},
          lastResult: {
            status: 'installed_unverified',
            executionMode: 'real_run',
            version: '20.11.1',
            paths: {
              installRootDir: '/tmp/toolchain',
              npmCacheDir: '/tmp/npm-cache',
              npmGlobalPrefix: '/tmp/npm-global',
            },
            envChanges: [
              {
                kind: 'env',
                key: 'npm_config_cache',
                value: '/tmp/npm-cache',
                scope: 'user',
                description: 'Set npm cache directory.',
              },
            ],
            downloads: [
              {
                kind: 'archive',
                tool: 'node',
                url: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz',
                official: true,
              },
            ],
            commands: ['echo install'],
            logs: [],
            summary: 'Completed Node.js environment install commands.',
          },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('任务状态')
    fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))

    expect(await screen.findByText('下载项（1）')).toBeInTheDocument()
    expect(await screen.findByText('命令计划（1）')).toBeInTheDocument()
    expect(await screen.findByText('环境变更（1）')).toBeInTheDocument()
  })

  it('reruns precheck after cleanup', async () => {
    runPrecheck
      .mockResolvedValueOnce({
        level: 'warn',
        items: [],
        detections: [
          {
            id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
            tool: 'node',
            kind: 'manager_root',
            path: '/tmp/.nvm',
            source: 'NVM_DIR',
            cleanupSupported: true,
            cleanupPath: '/tmp/.nvm',
            cleanupEnvKey: 'NVM_DIR',
          },
          {
            id: 'python:virtual_env:CONDA_PREFIX:/tmp/miniconda',
            tool: 'python',
            kind: 'virtual_env',
            path: '/tmp/miniconda',
            source: 'CONDA_PREFIX',
            cleanupSupported: true,
            cleanupPath: '/tmp/miniconda',
            cleanupEnvKey: 'CONDA_PREFIX',
          },
          {
            id: 'java:runtime_executable:PATH:/usr/bin/java',
            tool: 'java',
            kind: 'runtime_executable',
            path: '/usr/bin/java',
            source: 'PATH',
            cleanupSupported: false,
          },
        ],
        createdAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        level: 'pass',
        items: [],
        detections: [],
        createdAt: new Date().toISOString(),
      })

    render(<App />)

    await clickEnabledButton('运行预检')
    fireEvent.click(await screen.findByRole('button', { name: '一键清理' }))

    await waitFor(() => {
      expect(cleanupEnvironments).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
          cleanupPath: '/tmp/.nvm',
        }),
        expect.objectContaining({
          id: 'python:virtual_env:CONDA_PREFIX:/tmp/miniconda',
          cleanupPath: '/tmp/miniconda',
        }),
      ])
      expect(runPrecheck).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('当前预检项均已通过。')).toBeInTheDocument()
  })

  it('shows cleanup rollback entry and executes rollback from cleanup snapshot', async () => {
    runPrecheck
      .mockResolvedValueOnce({
        level: 'warn',
        items: [],
        detections: [
          {
            id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
            tool: 'node',
            kind: 'manager_root',
            path: '/tmp/.nvm',
            source: 'NVM_DIR',
            cleanupSupported: true,
            cleanupPath: '/tmp/.nvm',
            cleanupEnvKey: 'NVM_DIR',
          },
        ],
        createdAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        level: 'pass',
        items: [],
        detections: [],
        createdAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        level: 'warn',
        items: [],
        detections: [
          {
            id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
            tool: 'node',
            kind: 'manager_root',
            path: '/tmp/.nvm',
            source: 'NVM_DIR',
            cleanupSupported: true,
            cleanupPath: '/tmp/.nvm',
            cleanupEnvKey: 'NVM_DIR',
          },
        ],
        createdAt: new Date().toISOString(),
      })

    render(<App />)

    await clickEnabledButton('运行预检')
    fireEvent.click(await screen.findByRole('button', { name: '一键清理' }))

    expect(await screen.findByRole('button', { name: '一键回滚清理' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '一键回滚清理' }))

    await waitFor(() => {
      expect(executeRollback).toHaveBeenCalledWith({ snapshotId: 'snapshot-cleanup-1' })
      expect(runPrecheck).toHaveBeenCalledTimes(3)
    })
  })

  it('retries failed plugin and rebinds progress listener', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('任务状态')
    fireEvent.click(await screen.findByRole('button', { name: '重试插件' }))

    expect(retryPlugin).toHaveBeenCalledWith('task-1', 'node-env')
    expect(onTaskProgress).toHaveBeenCalled()
    expect(removeTaskProgressListener).toHaveBeenCalled()
  })

  it('cancels running task from task panel', async () => {
    const createTask = vi.fn().mockResolvedValueOnce({
      id: 'task-1',
      templateId: 'node-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      status: 'running',
      params: {},
      plugins: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    Object.defineProperty(window, 'envSetup', {
      configurable: true,
      writable: true,
      value: {
        ...window.envSetup,
        createTask,
      },
    })

    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('执行中')
    fireEvent.click(await screen.findByRole('button', { name: '取消任务' }))

    expect(cancelTask).toHaveBeenCalledWith('task-1')
    expect(await screen.findByText('已取消')).toBeInTheDocument()
  })

  it('previews and applies env changes from task result', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('任务状态')
    fireEvent.click(await screen.findByRole('button', { name: '应用环境变更' }))

    await waitFor(() => {
      expect(previewEnvChanges).toHaveBeenCalledWith([
        expect.objectContaining({ key: 'npm_config_cache', value: '/tmp/npm-cache' }),
      ])
      expect(applyEnvChanges).toHaveBeenCalledWith({
        changes: [expect.objectContaining({ key: 'npm_config_cache', value: '/tmp/npm-cache' })],
      })
    })
    expect(await screen.findByText('环境变更已应用。 (0/1)')).toBeInTheDocument()
  })
})
