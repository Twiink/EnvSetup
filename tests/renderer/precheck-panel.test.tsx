/**
 * Renderer tests for the precheck panel view and its user interactions.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  DetectedEnvironment,
  EnhancedPrecheckResult,
  PrecheckResult,
} from '../../src/main/core/contracts'
import { PrecheckPanel } from '../../src/renderer/components/PrecheckPanel'

const makePrecheckResult = (overrides: Partial<PrecheckResult> = {}): PrecheckResult => ({
  level: 'pass',
  items: [],
  detections: [],
  createdAt: new Date().toISOString(),
  ...overrides,
})

const makeDetection = (overrides: Partial<DetectedEnvironment> = {}): DetectedEnvironment => ({
  id: 'node:manager_root:NVM_DIR:/tmp/.nvm',
  tool: 'node',
  kind: 'manager_root',
  path: '/tmp/.nvm',
  source: 'NVM_DIR',
  cleanupSupported: true,
  cleanupPath: '/tmp/.nvm',
  cleanupEnvKey: 'NVM_DIR',
  ...overrides,
})

const makeEnhancedPrecheck = (
  overrides: Partial<EnhancedPrecheckResult> = {},
): EnhancedPrecheckResult => ({
  plan: {
    fileOperations: [],
    envChanges: [],
    estimatedDiskUsage: 52428800,
    estimatedDownloadSize: 26214400,
    estimatedDurationMs: 12000,
    pluginCount: 1,
  },
  conflicts: [],
  impact: {
    filesCreated: 3,
    filesModified: 1,
    filesDeleted: 0,
    envVarsChanged: 2,
    totalDiskUsage: 52428800,
    estimatedDurationMs: 12000,
  },
  canProceed: true,
  ...overrides,
})

afterEach(() => {
  cleanup()
})

describe('PrecheckPanel', () => {
  it('renders empty state when no precheck result', () => {
    render(<PrecheckPanel locale="zh-CN" onRun={vi.fn()} onCleanup={vi.fn()} />)

    expect(screen.getByText('尚未执行预检。')).toBeInTheDocument()
  })

  it('calls onRun when precheck button clicked', () => {
    const onRun = vi.fn()

    render(<PrecheckPanel locale="zh-CN" onRun={onRun} onCleanup={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '运行预检' }))

    expect(onRun).toHaveBeenCalledOnce()
  })

  it('renders pass level badge when precheck passes', () => {
    const precheck = makePrecheckResult({ level: 'pass' })

    render(<PrecheckPanel locale="zh-CN" precheck={precheck} onRun={vi.fn()} onCleanup={vi.fn()} />)

    expect(screen.getByText('通过')).toBeInTheDocument()
    expect(screen.getByText('当前预检项均已通过。')).toBeInTheDocument()
  })

  it('renders detected environments with a single cleanup button', () => {
    const detection = makeDetection()
    const precheck = makePrecheckResult({
      level: 'warn',
      detections: [
        detection,
        makeDetection({
          id: 'python:virtual_env:CONDA_PREFIX:/tmp/miniconda',
          tool: 'python',
          kind: 'virtual_env',
          path: '/tmp/miniconda',
          source: 'CONDA_PREFIX',
          cleanupPath: '/tmp/miniconda',
          cleanupEnvKey: 'CONDA_PREFIX',
        }),
      ],
    })

    render(<PrecheckPanel locale="zh-CN" precheck={precheck} onRun={vi.fn()} onCleanup={vi.fn()} />)

    expect(screen.getByText('已发现环境')).toBeInTheDocument()
    expect(screen.getByText('Node 管理器目录')).toBeInTheDocument()
    expect(screen.getByText('Python 虚拟环境')).toBeInTheDocument()
    expect(screen.getByText('/tmp/.nvm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一键清理' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '一键清理' })).toHaveLength(1)
  })

  it('renders network check results for the current template download sources', () => {
    const precheck = makePrecheckResult({
      level: 'block',
      items: [
        {
          code: 'NETWORK_UNAVAILABLE',
          level: 'block',
          message: '当前网络不可用，无法执行需要下载的步骤。',
        },
      ],
      networkChecks: [
        {
          id: 'nvm:https://github.com/nvm-sh/nvm/archive/refs/tags/v0.40.4.tar.gz',
          tool: 'nvm',
          kind: 'archive',
          host: 'github.com',
          url: 'https://github.com/nvm-sh/nvm/archive/refs/tags/v0.40.4.tar.gz',
          reachable: true,
          durationMs: 78,
          statusCode: 200,
        },
        {
          id: 'node:https://nodejs.org/dist',
          tool: 'node',
          kind: 'mirror',
          host: 'nodejs.org',
          url: 'https://nodejs.org/dist',
          reachable: false,
          durationMs: 1500,
          error: 'Timed out after 1500ms',
        },
      ],
    })

    render(<PrecheckPanel locale="zh-CN" precheck={precheck} onRun={vi.fn()} onCleanup={vi.fn()} />)

    expect(screen.getByText('网络检测')).toBeInTheDocument()
    expect(screen.getByText('github.com')).toBeInTheDocument()
    expect(screen.getByText('nodejs.org')).toBeInTheDocument()
    expect(screen.getByText('nvm 官方源')).toBeInTheDocument()
    expect(screen.getByText('Node.js 官方源')).toBeInTheDocument()
    expect(screen.getByText('可访问')).toBeInTheDocument()
    expect(screen.getByText('不可访问')).toBeInTheDocument()
    expect(screen.getByText(/Timed out after 1500ms/)).toBeInTheDocument()
  })

  it('calls onCleanup with all cleanup-supported detections when cleanup button clicked', () => {
    const onCleanup = vi.fn()
    const detection = makeDetection()
    const precheck = makePrecheckResult({
      level: 'warn',
      detections: [
        detection,
        makeDetection({
          id: 'java:runtime_executable:PATH:/usr/bin/java',
          tool: 'java',
          kind: 'runtime_executable',
          path: '/usr/bin/java',
          source: 'PATH',
          cleanupSupported: false,
          cleanupPath: undefined,
        }),
      ],
    })

    render(
      <PrecheckPanel locale="zh-CN" precheck={precheck} onRun={vi.fn()} onCleanup={onCleanup} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '一键清理' }))

    expect(onCleanup).toHaveBeenCalledWith([detection])
  })

  it('disables precheck button when disabled prop is true', () => {
    render(<PrecheckPanel locale="zh-CN" disabled={true} onRun={vi.fn()} onCleanup={vi.fn()} />)

    expect(screen.getByRole('button', { name: '运行预检' })).toBeDisabled()
  })

  it('renders enhanced precheck impact summary', () => {
    const precheck = makePrecheckResult()
    const enhanced = makeEnhancedPrecheck()

    render(
      <PrecheckPanel
        locale="zh-CN"
        precheck={precheck}
        enhancedPrecheck={enhanced}
        onRun={vi.fn()}
        onCleanup={vi.fn()}
      />,
    )

    // Impact summary stats are rendered with labels
    expect(screen.getByText('Files created')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Files modified')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Env vars changed')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Disk usage')).toBeInTheDocument()
    expect(screen.getByText('50.0 MB')).toBeInTheDocument()
  })

  it('renders conflicts from enhanced precheck', () => {
    const precheck = makePrecheckResult()
    const enhanced = makeEnhancedPrecheck({
      conflicts: [
        {
          type: 'file_exists',
          path: '/usr/local/bin/node',
          detail: 'File already exists at target path',
        },
        { type: 'env_conflict', key: 'PATH', detail: 'PATH already contains /usr/local/bin' },
      ],
    })

    render(
      <PrecheckPanel
        locale="zh-CN"
        precheck={precheck}
        enhancedPrecheck={enhanced}
        onRun={vi.fn()}
        onCleanup={vi.fn()}
      />,
    )

    expect(screen.getByText('2 conflicts detected')).toBeInTheDocument()
    expect(screen.getByText(/File already exists at target path/)).toBeInTheDocument()
    expect(screen.getByText(/PATH already contains \/usr\/local\/bin/)).toBeInTheDocument()
  })
})
