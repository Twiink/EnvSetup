/**
 * app 视图及交互行为的渲染测试。
 */

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      value: '2.51.1',
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

const mysqlTemplateFixture = {
  id: 'mysql-template',
  name: {
    'zh-CN': 'MySQL 数据库环境',
    en: 'MySQL Database Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'MySQL 数据库环境模板',
    en: 'MySQL database template',
  },
  plugins: [{ pluginId: 'mysql-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: ['mysql'],
  fields: {
    'mysql.mysqlManager': {
      key: 'mysql.mysqlManager',
      type: 'enum',
      value: 'package',
      editable: true,
      required: true,
      enum: ['mysql', 'package'],
    },
    'mysql.mysqlVersion': {
      key: 'mysql.mysqlVersion',
      type: 'version',
      value: '8.4.8',
      editable: true,
      required: true,
    },
    'mysql.installRootDir': {
      key: 'mysql.installRootDir',
      type: 'path',
      value: '/tmp/mysql-toolchain',
      editable: true,
      required: true,
    },
  },
}

const redisTemplateFixture = {
  id: 'redis-template',
  name: {
    'zh-CN': 'Redis 缓存环境',
    en: 'Redis Cache Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'Redis 缓存环境模板',
    en: 'Redis cache template',
  },
  plugins: [{ pluginId: 'redis-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: ['redis'],
  fields: {
    'redis.redisManager': {
      key: 'redis.redisManager',
      type: 'enum',
      value: 'package',
      editable: true,
      required: true,
      enum: ['redis', 'package'],
    },
    'redis.redisVersion': {
      key: 'redis.redisVersion',
      type: 'version',
      value: '7.4.7',
      editable: true,
      required: true,
    },
    'redis.installRootDir': {
      key: 'redis.installRootDir',
      type: 'path',
      value: '/tmp/redis-toolchain',
      editable: true,
      required: true,
    },
  },
}

const mavenTemplateFixture = {
  id: 'maven-template',
  name: {
    'zh-CN': 'Maven 构建环境',
    en: 'Maven Build Environment',
  },
  version: '0.1.0',
  platforms: ['darwin'],
  description: {
    'zh-CN': 'Maven 构建环境模板',
    en: 'Maven build template',
  },
  plugins: [{ pluginId: 'maven-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: ['maven'],
  fields: {
    'maven.mavenManager': {
      key: 'maven.mavenManager',
      type: 'enum',
      value: 'maven',
      editable: true,
      required: true,
      enum: ['maven', 'package'],
    },
    'maven.mavenVersion': {
      key: 'maven.mavenVersion',
      type: 'version',
      value: '3.9.11',
      editable: true,
      required: true,
    },
    'maven.installRootDir': {
      key: 'maven.installRootDir',
      type: 'path',
      value: '/tmp/maven-toolchain',
      editable: true,
      required: true,
    },
  },
}

const pickDirectory = vi.fn()
const pickPluginImportPath = vi.fn()
const importPluginFromPath = vi.fn()
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
const listSnapshots = vi.fn()
const createSnapshot = vi.fn()
const deleteSnapshot = vi.fn()
const executeRollback = vi.fn()
let taskProgressHandler: ((event: Parameters<EnvSetupApi['onTaskProgress']>[0] extends (event: infer E) => void ? E : never) => void) | undefined

beforeEach(() => {
  window.localStorage.clear()
  pickDirectory.mockReset()
  pickDirectory.mockResolvedValue('/tmp/selected-toolchain')
  pickPluginImportPath.mockReset()
  pickPluginImportPath.mockResolvedValue('/tmp/acme-plugin.zip')
  importPluginFromPath.mockReset()
  importPluginFromPath.mockResolvedValue({
    manifest: {
      id: 'acme-env',
      name: { 'zh-CN': 'Acme 环境', en: 'Acme Environment' },
      version: '1.0.0',
      mainAppVersion: '^0.2.4',
      platforms: ['darwin'],
      permissions: ['download'],
      parameters: {},
      dependencies: [],
      entry: 'index.mjs',
    },
    sourcePath: '/tmp/acme-plugin',
    entryPath: '/tmp/acme-plugin/index.mjs',
    importedAt: new Date().toISOString(),
    templateId: 'imported-acme-env-1.0.0',
  })
  runPrecheck.mockReset()
  runPrecheck.mockResolvedValue({
    level: 'pass',
    items: [],
    detections: [],
    createdAt: new Date().toISOString(),
  })
  onTaskProgress.mockReset()
  onTaskProgress.mockImplementation((callback) => {
    taskProgressHandler = callback
  })
  removeTaskProgressListener.mockReset()
  taskProgressHandler = undefined
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
  listSnapshots.mockReset()
  listSnapshots.mockResolvedValue({
    snapshots: [
      {
        id: 'snapshot-1',
        taskId: 'task-1',
        createdAt: '2026-03-25T00:00:00.000Z',
        type: 'auto',
        label: 'before-install',
        canDelete: false,
      },
    ],
    maxSnapshots: 5,
  })
  createSnapshot.mockReset()
  createSnapshot.mockResolvedValue({
    id: 'snapshot-manual-1',
    taskId: 'task-1',
    createdAt: '2026-03-25T00:00:00.000Z',
    type: 'manual',
    label: 'task-1-manual',
    trackedPaths: [],
    files: {},
    environment: { variables: {}, path: [] },
    shellConfigs: {},
    metadata: { platform: 'darwin', diskUsage: 0, fileCount: 0 },
  })
  deleteSnapshot.mockReset()
  deleteSnapshot.mockResolvedValue(undefined)
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
    snapshotId: 'snapshot-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const api: EnvSetupApi = {
    loadBootstrap: vi.fn().mockResolvedValue({
      templates: [
        nodeTemplateFixture,
        javaTemplateFixture,
        pythonTemplateFixture,
        gitTemplateFixture,
        mysqlTemplateFixture,
        redisTemplateFixture,
        mavenTemplateFixture,
      ],
      nodeLtsVersions: ['24.13.1', '22.22.1', '20.20.1'],
      javaLtsVersions: ['21.0.6', '17.0.14', '11.0.26'],
      pythonVersions: ['3.12.10', '3.11.10', '3.10.15'],
      gitVersions: ['2.49.1', '2.48.2'],
      mysqlVersions: ['8.4.8', '8.4.7'],
      redisVersions: ['7.4.7', '7.4.6'],
      mavenVersions: ['3.9.11', '3.9.10'],
      loadedAt: new Date().toISOString(),
    }),
    listTemplates: vi
      .fn()
      .mockResolvedValue([
        nodeTemplateFixture,
        javaTemplateFixture,
        pythonTemplateFixture,
        gitTemplateFixture,
        mysqlTemplateFixture,
        redisTemplateFixture,
        mavenTemplateFixture,
      ]),
    listNodeLtsVersions: vi.fn().mockResolvedValue(['24.13.1', '22.22.1', '20.20.1']),
    listJavaLtsVersions: vi.fn().mockResolvedValue(['21.0.6', '17.0.14', '11.0.26']),
    listPythonVersions: vi.fn().mockResolvedValue(['3.12.10', '3.11.10', '3.10.15']),
    listGitVersions: vi.fn().mockResolvedValue(['2.49.1', '2.48.2']),
    listMysqlVersions: vi.fn().mockResolvedValue(['8.4.8', '8.4.7']),
    listRedisVersions: vi.fn().mockResolvedValue(['7.4.7', '7.4.6']),
    listMavenVersions: vi.fn().mockResolvedValue(['3.9.11', '3.9.10']),
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
    pickPluginImportPath,
    importPluginFromPath,
    previewEnvChanges,
    applyEnvChanges,
    onTaskProgress,
    removeTaskProgressListener,
    listSnapshots,
    createSnapshot,
    deleteSnapshot,
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

async function emitTaskProgress(
  event: Parameters<Exclude<typeof taskProgressHandler, undefined>>[0],
) {
  if (!taskProgressHandler) {
    throw new Error('task progress listener was not registered')
  }

  await act(async () => {
    taskProgressHandler?.(event)
  })
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
    expect(await screen.findByText('MySQL 数据库环境')).toBeInTheDocument()
    expect(await screen.findByText('Redis 缓存环境')).toBeInTheDocument()
    expect(await screen.findByText('Maven 构建环境')).toBeInTheDocument()
  })

  it('creates a task after precheck', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')

    expect(await screen.findByText('任务状态')).toBeInTheDocument()
    expect(await screen.findByText('草稿')).toBeInTheDocument()
  }, 15000)

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

  it('renders git version and keeps it visible after switching to homebrew', async () => {
    render(<App />)

    fireEvent.click(await screen.findByText('Git 开发环境'))
    fireEvent.change(screen.getByDisplayValue('直接安装 Git'), {
      target: { value: 'homebrew' },
    })

    expect(await screen.findByDisplayValue('2.49.1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('使用 Homebrew 安装 Git')).toBeInTheDocument()
  })

  it('renders mysql version in package mode and keeps it visible after switching manager', async () => {
    render(<App />)

    fireEvent.click(await screen.findByText('MySQL 数据库环境'))
    expect(await screen.findByDisplayValue('8.4.8')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('使用平台包管理器安装'), {
      target: { value: 'mysql' },
    })

    expect(screen.getByDisplayValue('8.4.8')).toBeInTheDocument()
  })

  it('renders redis version in package mode and keeps it visible after switching manager', async () => {
    render(<App />)

    fireEvent.click(await screen.findByText('Redis 缓存环境'))
    expect(await screen.findByDisplayValue('7.4.7')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('使用平台包管理器安装'), {
      target: { value: 'redis' },
    })

    expect(screen.getByDisplayValue('7.4.7')).toBeInTheDocument()
  })

  it('renders maven version and keeps it visible after switching to package manager', async () => {
    render(<App />)

    fireEvent.click(await screen.findByText('Maven 构建环境'))
    fireEvent.change(screen.getByDisplayValue('直接安装 Maven'), {
      target: { value: 'package' },
    })

    expect(await screen.findByDisplayValue('3.9.11')).toBeInTheDocument()
    expect(screen.getByDisplayValue('使用平台包管理器安装')).toBeInTheDocument()
  })

  it('switches visible copy to english', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'English' }))

    expect(await screen.findByRole('heading', { name: 'EnvSetup' })).toBeInTheDocument()
    expect(await screen.findByText('Templates')).toBeInTheDocument()
    expect(await screen.findByText('Node.js Environment')).toBeInTheDocument()
  })

  it('switches to the beginner guide and back without losing workspace state', async () => {
    render(<App />)

    await runPassingPrecheck()

    fireEvent.click(await screen.findByRole('button', { name: '新手知识' }))

    expect(
      await screen.findByRole('heading', { name: '给小白用户的常用命令与基础概念' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入插件' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '环境配置' }))

    expect(await screen.findByText('当前预检项均已通过。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入插件' })).toBeInTheDocument()
    expect(runPrecheck).toHaveBeenCalledTimes(1)
  })

  it('shows real_run summary after starting a task', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('任务状态')

    fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))
    await waitFor(() => {
      expect(startTask).toHaveBeenCalledWith('task-1')
    })
    await screen.findByRole('button', { name: '取消任务' })
    await emitTaskProgress({
      taskId: 'task-1',
      pluginId: 'task',
      type: 'task_done',
      message: 'Task succeeded',
      timestamp: new Date().toISOString(),
      taskSnapshot: {
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
      },
    })

    expect(await screen.findByText('Node.js 环境安装命令已执行完成。')).toBeInTheDocument()
    expect(onTaskProgress).toHaveBeenCalled()
  }, 15000)

  it('renders env/download/command details when task has lastResult', async () => {
    startTask.mockResolvedValueOnce({
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

    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('任务状态')
    fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))
    await waitFor(() => {
      expect(startTask).toHaveBeenCalledWith('task-1')
    })
    await screen.findByRole('button', { name: '取消任务' })
    await emitTaskProgress({
      taskId: 'task-1',
      pluginId: 'task',
      type: 'task_done',
      message: 'Task succeeded',
      timestamp: new Date().toISOString(),
      taskSnapshot: {
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
      },
    })

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

  it('imports plugin from selected zip and refreshes templates', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '导入插件' }))

    await waitFor(() => {
      expect(pickPluginImportPath).toHaveBeenCalledTimes(1)
      expect(importPluginFromPath).toHaveBeenCalledWith('/tmp/acme-plugin.zip')
    })
    expect(await screen.findByText('插件导入成功')).toBeInTheDocument()
  })

  it('creates manual snapshot and opens rollback dialog from snapshot list', async () => {
    render(<App />)

    await runPassingPrecheck()
    await clickEnabledButton('创建任务')
    await screen.findByText('草稿')

    await clickEnabledButton('创建快照')
    await waitFor(() => {
      expect(createSnapshot).toHaveBeenCalledWith({
        taskId: 'task-1',
        label: 'node-template-manual',
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: '回滚到此快照' }))

    expect(await screen.findByRole('heading', { name: '执行回滚' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '执行回滚' }))

    await waitFor(() => {
      expect(executeRollback).toHaveBeenCalledWith({
        snapshotId: 'snapshot-1',
        installPaths: ['/tmp/toolchain'],
      })
    })
  })
})
