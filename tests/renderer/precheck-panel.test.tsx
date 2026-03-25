// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  DetectedEnvironment,
  EnhancedPrecheckResult,
  PrecheckResult,
} from '../../src/main/core/contracts'
import { PrecheckPanel } from '../../src/renderer/components/PrecheckPanel'

const makePrecheckResult = (
  overrides: Partial<PrecheckResult> = {},
): PrecheckResult => ({
  level: 'pass',
  items: [],
  detections: [],
  createdAt: new Date().toISOString(),
  ...overrides,
})

const makeDetection = (
  overrides: Partial<DetectedEnvironment> = {},
): DetectedEnvironment => ({
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
    render(
      <PrecheckPanel locale="zh-CN" onRun={vi.fn()} onCleanup={vi.fn()} />,
    )

    expect(screen.getByText('尚未执行预检。')).toBeInTheDocument()
  })

  it('calls onRun when precheck button clicked', () => {
    const onRun = vi.fn()

    render(
      <PrecheckPanel locale="zh-CN" onRun={onRun} onCleanup={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '运行预检' }))

    expect(onRun).toHaveBeenCalledOnce()
  })

  it('renders pass level badge when precheck passes', () => {
    const precheck = makePrecheckResult({ level: 'pass' })

    render(
      <PrecheckPanel
        locale="zh-CN"
        precheck={precheck}
        onRun={vi.fn()}
        onCleanup={vi.fn()}
      />,
    )

    expect(screen.getByText('通过')).toBeInTheDocument()
    expect(screen.getByText('当前预检项均已通过。')).toBeInTheDocument()
  })

  it('renders detected environments with cleanup buttons', () => {
    const detection = makeDetection()
    const precheck = makePrecheckResult({
      level: 'warn',
      detections: [detection],
    })

    render(
      <PrecheckPanel
        locale="zh-CN"
        precheck={precheck}
        onRun={vi.fn()}
        onCleanup={vi.fn()}
      />,
    )

    expect(screen.getByText('已发现环境')).toBeInTheDocument()
    expect(screen.getByText('Node 管理器目录')).toBeInTheDocument()
    expect(screen.getByText('/tmp/.nvm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一键清理' })).toBeInTheDocument()
  })

  it('calls onCleanup when cleanup button clicked', () => {
    const onCleanup = vi.fn()
    const detection = makeDetection()
    const precheck = makePrecheckResult({
      level: 'warn',
      detections: [detection],
    })

    render(
      <PrecheckPanel
        locale="zh-CN"
        precheck={precheck}
        onRun={vi.fn()}
        onCleanup={onCleanup}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '一键清理' }))

    expect(onCleanup).toHaveBeenCalledWith(detection)
  })

  it('disables precheck button when disabled prop is true', () => {
    render(
      <PrecheckPanel
        locale="zh-CN"
        disabled={true}
        onRun={vi.fn()}
        onCleanup={vi.fn()}
      />,
    )

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
        { type: 'file_exists', path: '/usr/local/bin/node', detail: 'File already exists at target path' },
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
