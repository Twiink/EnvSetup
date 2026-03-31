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
    expect(screen.getByRole('heading', { name: '最常见的 Git 命令' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Python 虚拟环境怎么建' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Node 基础知识和常见命令' })).toBeInTheDocument()
  })

  it('renders the guide in English', () => {
    render(<BeginnerGuidePanel locale="en" />)

    expect(
      screen.getByRole('heading', { name: 'Common Commands and Concepts for Beginners' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'The Git Commands You Will Use Most' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'How to Create Python Virtual Environments' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Common Beginner Mistakes' })).toBeInTheDocument()
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
      expect(writeText).toHaveBeenCalledWith('pwd')
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
