/**
 * template-panel 视图及交互行为的渲染测试。
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedTemplate } from '../../src/main/core/contracts'
import { TemplatePanel } from '../../src/renderer/components/TemplatePanel'

const makeTemplate = (overrides: Partial<ResolvedTemplate> = {}): ResolvedTemplate => ({
  id: 'tpl-node',
  name: { 'zh-CN': 'Node.js 开发环境', en: 'Node.js Environment' },
  version: '1.0.0',
  platforms: ['darwin'],
  description: { 'zh-CN': '前端团队标准环境', en: 'Frontend team standard env' },
  plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
  defaults: {},
  overrides: {},
  checks: [],
  fields: {},
  ...overrides,
})

const templateA = makeTemplate()
const templateB = makeTemplate({
  id: 'tpl-java',
  name: { 'zh-CN': 'Java 开发环境', en: 'Java Environment' },
  version: '2.0.0',
  description: { 'zh-CN': 'Java 后端环境', en: 'Java backend env' },
})

afterEach(() => {
  cleanup()
})

describe('TemplatePanel', () => {
  it('renders template names and versions using locale', () => {
    render(
      <TemplatePanel
        locale="zh-CN"
        templates={[templateA, templateB]}
        selectedTemplateId=""
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('Node.js 开发环境')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('Java 开发环境')).toBeInTheDocument()
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
  })

  it('highlights selected template with aria-pressed', () => {
    render(
      <TemplatePanel
        locale="zh-CN"
        templates={[templateA, templateB]}
        selectedTemplateId="tpl-node"
        onSelect={vi.fn()}
      />,
    )

    const buttons = screen.getAllByRole('button')
    // Template cards are rendered as buttons. Find the one for tpl-node.
    const nodeButton = buttons.find((b) => b.textContent?.includes('Node.js 开发环境'))
    const javaButton = buttons.find((b) => b.textContent?.includes('Java 开发环境'))

    expect(nodeButton).toHaveAttribute('aria-pressed', 'true')
    expect(javaButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onSelect when a template card is clicked', () => {
    const onSelect = vi.fn()

    render(
      <TemplatePanel
        locale="en"
        templates={[templateA, templateB]}
        selectedTemplateId=""
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByText('Java Environment'))

    expect(onSelect).toHaveBeenCalledWith('tpl-java')
  })

  it('renders empty grid when templates array is empty', () => {
    render(<TemplatePanel locale="zh-CN" templates={[]} selectedTemplateId="" onSelect={vi.fn()} />)

    // Section header text should still render
    expect(screen.getByText('团队标准模板')).toBeInTheDocument()
    // No template card buttons should exist (only header text, no aria-pressed buttons)
    const pressedButtons = screen
      .queryAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'))
    expect(pressedButtons).toHaveLength(0)
  })
})
