// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvSetupApi } from '../../src/main/core/contracts'
import App from '../../src/renderer/App'

const frontendTemplateFixture = {
  id: 'frontend-template',
  name: {
    'zh-CN': '前端开发环境',
    en: 'Frontend Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': '前端开发环境模板',
    en: 'Frontend environment template',
  },
  plugins: [{ pluginId: 'frontend-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: [],
  fields: {
    'frontend.nodeManager': {
      key: 'frontend.nodeManager',
      type: 'enum',
      value: 'nvm',
      editable: true,
      required: true,
      enum: ['node', 'nvm'],
    },
    'frontend.nodeVersion': {
      key: 'frontend.nodeVersion',
      type: 'version',
      value: '20.11.1',
      editable: true,
      required: true,
    },
    'frontend.installRootDir': {
      key: 'frontend.installRootDir',
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
    'zh-CN': 'Java 占位模板',
    en: 'Java placeholder template',
  },
  plugins: [],
  defaults: {},
  overrides: {},
  checks: ['java'],
  fields: {},
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
    'zh-CN': 'Python 占位模板',
    en: 'Python placeholder template',
  },
  plugins: [],
  defaults: {},
  overrides: {},
  checks: ['python'],
  fields: {},
}

const pickDirectory = vi.fn()
const runPrecheck = vi.fn()
const onTaskProgress = vi.fn()
const removeTaskProgressListener = vi.fn()
const startTask = vi.fn()
const previewEnvChanges = vi.fn()
const applyEnvChanges = vi.fn()

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
  previewEnvChanges.mockReset()
  applyEnvChanges.mockReset()
  previewEnvChanges.mockResolvedValue({
    envCount: 0,
    pathCount: 0,
    profileCount: 0,
    targets: [],
  })
  applyEnvChanges.mockResolvedValue({ applied: [], skipped: [] })
  startTask.mockResolvedValue({
    id: 'task-1',
    templateId: 'frontend-template',
    templateVersion: '0.1.0',
    locale: 'zh-CN',
    status: 'succeeded',
    params: {},
    plugins: [
      {
        pluginId: 'frontend-env',
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
          summary: 'Completed frontend environment install commands.',
        },
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const api: EnvSetupApi = {
    listTemplates: vi
      .fn()
      .mockResolvedValue([frontendTemplateFixture, javaTemplateFixture, pythonTemplateFixture]),
    listNodeLtsVersions: vi.fn().mockResolvedValue(['24.13.1', '22.22.1', '20.20.1']),
    runPrecheck,
    createTask: vi.fn().mockResolvedValue({
      id: 'task-1',
      templateId: 'frontend-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      status: 'draft',
      params: {},
      plugins: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    startTask,
    retryPlugin: vi.fn(),
    pickDirectory,
    importPluginFromPath: vi.fn(),
    previewEnvChanges,
    applyEnvChanges,
    onTaskProgress,
    removeTaskProgressListener,
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

describe('App', () => {
  it('renders template list and precheck panel', async () => {
    render(<App />)

    expect(await screen.findByText('模板')).toBeInTheDocument()
    expect(await screen.findByText('预检')).toBeInTheDocument()
    expect(await screen.findByText('前端开发环境')).toBeInTheDocument()
    expect(await screen.findByText('Java 开发环境')).toBeInTheDocument()
    expect(await screen.findByText('Python 开发环境')).toBeInTheDocument()
  })

  it('creates a task after precheck', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '运行预检' }))
    await screen.findByText('通过')
    fireEvent.click(await screen.findByRole('button', { name: '创建任务' }))

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

    fireEvent.click(await screen.findByRole('button', { name: '运行预检' }))

    expect(await screen.findByText('已发现环境')).toBeInTheDocument()
    expect(await screen.findByText('Node 管理器目录')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '一键清理' })).toBeInTheDocument()
  })

  it('switches visible copy to english', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'English' }))

    expect(await screen.findByRole('heading', { name: 'EnvSetup' })).toBeInTheDocument()
    expect(await screen.findByText('Templates')).toBeInTheDocument()
    expect(await screen.findByText('Frontend Environment')).toBeInTheDocument()
  })

  it('shows real_run summary after starting a task', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '运行预检' }))
    await screen.findByText('通过')
    fireEvent.click(await screen.findByRole('button', { name: '创建任务' }))
    await screen.findByText('任务状态')

    fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))

    expect(await screen.findByText('前端环境安装命令已执行完成。')).toBeInTheDocument()
    expect(startTask).toHaveBeenCalledWith('task-1')
    expect(onTaskProgress).toHaveBeenCalled()
    expect(removeTaskProgressListener).toHaveBeenCalled()
  })

  it('renders env/download/command details when task has lastResult', async () => {
    startTask.mockResolvedValueOnce({
      id: 'task-1',
      templateId: 'frontend-template',
      templateVersion: '0.1.0',
      locale: 'zh-CN',
      status: 'succeeded',
      params: {},
      plugins: [
        {
          pluginId: 'frontend-env',
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
            summary: 'Completed frontend environment install commands.',
          },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '运行预检' }))
    await screen.findByText('通过')
    fireEvent.click(await screen.findByRole('button', { name: '创建任务' }))
    await screen.findByText('任务状态')
    fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))

    expect(await screen.findByText('下载项（1）')).toBeInTheDocument()
    expect(await screen.findByText('命令计划（1）')).toBeInTheDocument()
    expect(await screen.findByText('环境变更（1）')).toBeInTheDocument()
  })
})
