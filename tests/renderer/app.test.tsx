// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvSetupApi } from '../../src/main/core/contracts'
import App from '../../src/renderer/App'

const templateFixture = {
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
      value: 'nvm',
      editable: true,
      required: true,
      enum: ['node', 'nvm'],
    },
    'frontend.nodeVersion': {
      key: 'frontend.nodeVersion',
      value: '20.11.1',
      editable: true,
      required: true,
    },
  },
}

beforeEach(() => {
  window.localStorage.clear()

  const api: EnvSetupApi = {
    listTemplates: vi.fn().mockResolvedValue([templateFixture]),
    runPrecheck: vi.fn().mockResolvedValue({
      level: 'pass',
      items: [],
      createdAt: new Date().toISOString(),
    }),
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
    startTask: vi.fn(),
    retryPlugin: vi.fn(),
    importPluginFromPath: vi.fn(),
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
  })

  it('creates a task after precheck', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '运行预检' }))
    await screen.findByText('通过')
    fireEvent.click(await screen.findByRole('button', { name: '创建任务' }))

    expect(await screen.findByText('任务状态')).toBeInTheDocument()
    expect(await screen.findByText('草稿')).toBeInTheDocument()
  })

  it('switches visible copy to english', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'English' }))

    expect(await screen.findByRole('heading', { name: 'Environment Setup' })).toBeInTheDocument()
    expect(await screen.findByText('Templates')).toBeInTheDocument()
    expect(await screen.findByText('Frontend Environment')).toBeInTheDocument()
  })
})
