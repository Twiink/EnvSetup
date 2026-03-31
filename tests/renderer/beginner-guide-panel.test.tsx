/**
 * 新手知识页的渲染与交互测试。
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BeginnerGuidePanel } from '../../src/renderer/components/BeginnerGuidePanel'

const originalClipboard = navigator.clipboard

describe('BeginnerGuidePanel', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
  })

  it('renders the guide in Chinese', () => {
    render(<BeginnerGuidePanel locale="zh-CN" />)

    expect(
      screen.getByRole('heading', { name: '给小白用户的常用命令与基础概念' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '工具切换' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '当前工具目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '总览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Node.js' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Java' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Python' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Git' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MySQL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redis' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maven' })).toBeInTheDocument()
    expect(screen.getByText('当前优先平台')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '基础概念' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '占位符、引号和点号是什么意思' }),
    ).toBeInTheDocument()
  })

  it('renders the guide in English', () => {
    render(<BeginnerGuidePanel locale="en" />)

    expect(
      screen.getByRole('heading', { name: 'Common Commands and Concepts for Beginners' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Node.js' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maven' })).toBeInTheDocument()
    expect(screen.getByText('Primary platform')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Foundations' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'What Placeholders, Quotes, and `.` Mean' }),
    ).toBeInTheDocument()
  })

  it('switches tools and updates the visible sections', () => {
    render(<BeginnerGuidePanel locale="zh-CN" />)

    fireEvent.click(screen.getByRole('button', { name: 'Git' }))

    expect(screen.getByRole('heading', { name: '常用命令' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '最常用的 Git 命令组合' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: '环境变量与路径',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '占位符、引号和点号是什么意思' }),
    ).not.toBeInTheDocument()
  })

  it('copies a command when clipboard is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<BeginnerGuidePanel locale="zh-CN" />)

    const copyButtons = screen.getAllByRole('button', { name: '复制命令' })
    fireEvent.click(copyButtons[0])

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('git commit -m "新增新手知识页"')
    })
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
  })

  it('disables copy buttons when clipboard is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })

    render(<BeginnerGuidePanel locale="zh-CN" />)

    const unavailableButtons = screen.getAllByRole('button', { name: '当前环境不支持复制' })
    expect(unavailableButtons[0]).toBeDisabled()
  })
})
