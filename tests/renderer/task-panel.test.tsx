/**
 * Renderer tests for the task panel view and its user interactions.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InstallTask, TaskProgressEvent } from '../../src/main/core/contracts'
import { TaskPanel } from '../../src/renderer/components/TaskPanel'

const makeTask = (overrides: Partial<InstallTask> = {}): InstallTask => ({
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
      status: 'not_started',
      params: {},
      logs: [],
      context: {},
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const makeProgressEvent = (overrides: Partial<TaskProgressEvent> = {}): TaskProgressEvent => ({
  taskId: 'task-1',
  pluginId: 'node-env',
  type: 'command_start',
  message: 'install node',
  commandIndex: 1,
  commandTotal: 2,
  timestamp: new Date().toISOString(),
  ...overrides,
})

afterEach(() => {
  cleanup()
})

describe('TaskPanel', () => {
  const baseProps = {
    locale: 'zh-CN' as const,
    progressEvents: [],
    busy: false,
    canCreate: true,
    onCreateTask: vi.fn(),
    onStartTask: vi.fn(),
    onRetryPlugin: vi.fn(),
    onCancelTask: vi.fn(),
    onApplyEnvChanges: vi.fn(),
  }

  it('renders empty state when no task', () => {
    render(<TaskPanel {...baseProps} />)

    expect(screen.getByText('还没有任务。先运行预检，再创建任务。')).toBeInTheDocument()
  })

  it('renders task status label when task exists', () => {
    render(<TaskPanel {...baseProps} task={makeTask({ status: 'draft' })} />)

    expect(screen.getByText('任务状态')).toBeInTheDocument()
    expect(screen.getByText('草稿')).toBeInTheDocument()
  })

  it('calls onCreateTask when create button clicked', () => {
    const onCreateTask = vi.fn()
    render(<TaskPanel {...baseProps} onCreateTask={onCreateTask} />)

    fireEvent.click(screen.getByRole('button', { name: '创建任务' }))
    expect(onCreateTask).toHaveBeenCalledOnce()
  })

  it('calls onStartTask when start button clicked', () => {
    const onStartTask = vi.fn()
    render(<TaskPanel {...baseProps} task={makeTask()} onStartTask={onStartTask} />)

    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))
    expect(onStartTask).toHaveBeenCalledOnce()
  })

  it('shows retry button for failed plugins', () => {
    const onRetryPlugin = vi.fn()
    const task = makeTask({
      plugins: [
        {
          pluginId: 'node-env',
          version: '0.1.0',
          status: 'failed',
          params: {},
          logs: [],
          context: {},
        },
      ],
    })

    render(<TaskPanel {...baseProps} task={task} onRetryPlugin={onRetryPlugin} />)

    fireEvent.click(screen.getByRole('button', { name: '重试插件' }))
    expect(onRetryPlugin).toHaveBeenCalledWith('node-env')
  })

  it('shows cancel button when task status is running', () => {
    const onCancelTask = vi.fn()
    render(
      <TaskPanel
        {...baseProps}
        task={makeTask({ status: 'running' })}
        onCancelTask={onCancelTask}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))
    expect(onCancelTask).toHaveBeenCalledOnce()
  })

  it('disables create button when canCreate=false', () => {
    render(<TaskPanel {...baseProps} canCreate={false} />)

    expect(screen.getByRole('button', { name: '创建任务' })).toBeDisabled()
  })

  it('renders plugin details with lastResult', () => {
    const onApplyEnvChanges = vi.fn()
    const task = makeTask({
      plugins: [
        {
          pluginId: 'node-env',
          version: '0.1.0',
          status: 'verified_success',
          params: {},
          logs: ['done'],
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
                description: 'cache',
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
    })

    render(<TaskPanel {...baseProps} task={task} onApplyEnvChanges={onApplyEnvChanges} />)

    expect(screen.getByText('下载项（1）')).toBeInTheDocument()
    expect(screen.getByText('命令计划（1）')).toBeInTheDocument()
    expect(screen.getByText('环境变更（1）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '应用环境变更' }))
    expect(onApplyEnvChanges).toHaveBeenCalledWith('node-env')
  })

  it('renders progress information from progress events', () => {
    render(
      <TaskPanel
        {...baseProps}
        task={makeTask({ status: 'running' })}
        progressEvents={[makeProgressEvent()]}
      />,
    )

    expect(screen.getByText(/正在执行命令/)).toBeInTheDocument()
    expect(screen.getByText(/1\/2/)).toBeInTheDocument()
  })
})
