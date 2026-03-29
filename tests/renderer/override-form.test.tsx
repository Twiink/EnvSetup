/**
 * override-form 视图及交互行为的渲染测试。
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedTemplate } from '../../src/main/core/contracts'
import { OverrideForm } from '../../src/renderer/components/OverrideForm'

const makeTemplate = (overrides: Partial<ResolvedTemplate> = {}): ResolvedTemplate => ({
  id: 'tpl-node',
  name: { 'zh-CN': 'Node.js 开发环境', en: 'Node.js Environment' },
  version: '1.0.0',
  platforms: ['darwin'],
  description: { 'zh-CN': '前端环境', en: 'Frontend env' },
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
  ...overrides,
})

afterEach(() => {
  cleanup()
})

describe('OverrideForm', () => {
  it('renders empty state when no template provided', () => {
    render(
      <OverrideForm
        locale="zh-CN"
        values={{}}
        errors={{}}
        onChange={vi.fn()}
        onPickDirectory={vi.fn()}
      />,
    )

    expect(screen.getByText('参数覆盖')).toBeInTheDocument()
    expect(screen.getByText('请选择一个模板以查看可编辑参数。')).toBeInTheDocument()
  })

  it('renders editable fields from template', () => {
    const template = makeTemplate()

    render(
      <OverrideForm
        locale="zh-CN"
        template={template}
        values={{
          'node.nodeManager': 'nvm',
          'node.nodeVersion': '20.11.1',
          'node.installRootDir': '/tmp/toolchain',
        }}
        errors={{}}
        onChange={vi.fn()}
        onPickDirectory={vi.fn()}
      />,
    )

    // Enum field renders as a select
    expect(screen.getByDisplayValue('使用 nvm 管理 Node.js')).toBeInTheDocument()
    // Version field renders as a text input
    expect(screen.getByDisplayValue('20.11.1')).toBeInTheDocument()
    // Path field renders with an input
    expect(screen.getByDisplayValue('/tmp/toolchain')).toBeInTheDocument()
  })

  it('calls onChange when select field changes', () => {
    const template = makeTemplate()
    const onChange = vi.fn()

    render(
      <OverrideForm
        locale="zh-CN"
        template={template}
        values={{
          'node.nodeManager': 'nvm',
          'node.nodeVersion': '20.11.1',
          'node.installRootDir': '/tmp/toolchain',
        }}
        errors={{}}
        onChange={onChange}
        onPickDirectory={vi.fn()}
      />,
    )

    const select = screen.getByDisplayValue('使用 nvm 管理 Node.js')
    fireEvent.change(select, { target: { value: 'node' } })

    expect(onChange).toHaveBeenCalledWith('node.nodeManager', 'node')
  })

  it('calls onPickDirectory when browse button clicked', () => {
    const template = makeTemplate()
    const onPickDirectory = vi.fn()

    render(
      <OverrideForm
        locale="zh-CN"
        template={template}
        values={{
          'node.nodeManager': 'nvm',
          'node.nodeVersion': '20.11.1',
          'node.installRootDir': '/tmp/toolchain',
        }}
        errors={{}}
        onChange={vi.fn()}
        onPickDirectory={onPickDirectory}
      />,
    )

    // The browse button has aria-label composed of "<label> 选择文件夹"
    const browseButton = screen.getByRole('button', { name: '工具安装根目录 选择文件夹' })
    fireEvent.click(browseButton)

    expect(onPickDirectory).toHaveBeenCalledWith('node.installRootDir')
  })

  it('shows error messages for fields with errors', () => {
    const template = makeTemplate()

    render(
      <OverrideForm
        locale="zh-CN"
        template={template}
        values={{
          'node.nodeManager': 'nvm',
          'node.nodeVersion': '',
          'node.installRootDir': '/tmp/toolchain',
        }}
        errors={{ 'node.nodeVersion': '该字段为必填项。' }}
        onChange={vi.fn()}
        onPickDirectory={vi.fn()}
      />,
    )

    expect(screen.getByText('该字段为必填项。')).toBeInTheDocument()
  })

  it('disables browse button when busy=true', () => {
    const template = makeTemplate()

    render(
      <OverrideForm
        locale="zh-CN"
        template={template}
        values={{
          'node.nodeManager': 'nvm',
          'node.nodeVersion': '20.11.1',
          'node.installRootDir': '/tmp/toolchain',
        }}
        errors={{}}
        busy={true}
        onChange={vi.fn()}
        onPickDirectory={vi.fn()}
      />,
    )

    const browseButton = screen.getByRole('button', { name: '工具安装根目录 选择文件夹' })
    expect(browseButton).toBeDisabled()
  })
})
