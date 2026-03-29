/**
 * copy 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import {
  getDetectedEnvironmentKindLabel,
  getDetectedEnvironmentSourceLabel,
  getLocaleButtonLabel,
  getPluginStatusLabel,
  getPluginSummary,
  getPrecheckItemMessage,
  getPrecheckLevelLabel,
  getTaskStatusLabel,
  getTemplateFieldLabel,
  getTemplateOptionLabel,
  getUiText,
} from '../../src/renderer/copy'
import type { DetectedEnvironment } from '../../src/main/core/contracts'

// ---------------------------------------------------------------------------
// getUiText
// ---------------------------------------------------------------------------

describe('getUiText', () => {
  it('returns zh-CN text for known keys', () => {
    expect(getUiText('zh-CN', 'appTitle')).toBe('开工吧')
    expect(getUiText('zh-CN', 'runPrecheck')).toBe('运行预检')
  })

  it('returns en text for known keys', () => {
    expect(getUiText('en', 'appTitle')).toBe('EnvSetup')
    expect(getUiText('en', 'runPrecheck')).toBe('Run Precheck')
  })
})

// ---------------------------------------------------------------------------
// getLocaleButtonLabel
// ---------------------------------------------------------------------------

describe('getLocaleButtonLabel', () => {
  it('returns 简体中文 for zh-CN', () => {
    expect(getLocaleButtonLabel('zh-CN')).toBe('简体中文')
  })

  it('returns English for en', () => {
    expect(getLocaleButtonLabel('en')).toBe('English')
  })
})

// ---------------------------------------------------------------------------
// getTaskStatusLabel
// ---------------------------------------------------------------------------

describe('getTaskStatusLabel', () => {
  const statuses = [
    'draft',
    'prechecking',
    'ready',
    'running',
    'failed',
    'partially_succeeded',
    'succeeded',
    'cancelled',
  ] as const

  for (const status of statuses) {
    it(`returns non-empty label for ${status} in both locales`, () => {
      const zhLabel = getTaskStatusLabel('zh-CN', status)
      const enLabel = getTaskStatusLabel('en', status)
      expect(zhLabel.length).toBeGreaterThan(0)
      expect(enLabel.length).toBeGreaterThan(0)
    })
  }

  it('returns localized labels', () => {
    expect(getTaskStatusLabel('zh-CN', 'draft')).toBe('草稿')
    expect(getTaskStatusLabel('en', 'draft')).toBe('Draft')
    expect(getTaskStatusLabel('zh-CN', 'succeeded')).toBe('成功')
    expect(getTaskStatusLabel('en', 'succeeded')).toBe('Succeeded')
  })
})

// ---------------------------------------------------------------------------
// getPluginStatusLabel
// ---------------------------------------------------------------------------

describe('getPluginStatusLabel', () => {
  const statuses = [
    'not_started',
    'running',
    'installed_unverified',
    'verified_success',
    'failed',
    'needs_rerun',
  ] as const

  for (const status of statuses) {
    it(`returns non-empty label for ${status} in both locales`, () => {
      expect(getPluginStatusLabel('zh-CN', status).length).toBeGreaterThan(0)
      expect(getPluginStatusLabel('en', status).length).toBeGreaterThan(0)
    })
  }

  it('returns localized labels', () => {
    expect(getPluginStatusLabel('zh-CN', 'failed')).toBe('失败')
    expect(getPluginStatusLabel('en', 'failed')).toBe('Failed')
  })
})

// ---------------------------------------------------------------------------
// getPrecheckLevelLabel
// ---------------------------------------------------------------------------

describe('getPrecheckLevelLabel', () => {
  it('returns localized labels for all levels', () => {
    expect(getPrecheckLevelLabel('zh-CN', 'pass')).toBe('通过')
    expect(getPrecheckLevelLabel('en', 'pass')).toBe('Pass')
    expect(getPrecheckLevelLabel('zh-CN', 'warn')).toBe('警告')
    expect(getPrecheckLevelLabel('en', 'warn')).toBe('Warn')
    expect(getPrecheckLevelLabel('zh-CN', 'block')).toBe('阻塞')
    expect(getPrecheckLevelLabel('en', 'block')).toBe('Block')
  })
})

// ---------------------------------------------------------------------------
// getPrecheckItemMessage
// ---------------------------------------------------------------------------

describe('getPrecheckItemMessage', () => {
  it('returns mapped message for known error codes', () => {
    const msg = getPrecheckItemMessage('zh-CN', 'PLATFORM_UNSUPPORTED', 'fallback')
    expect(msg).toContain('操作系统')
  })

  it('preserves fallback text for existing environment warnings', () => {
    const zhFallback = '检测到已有相关运行时环境，请谨慎继续。'
    const enFallback = 'Template-declared check found existing environment conflict for: python'

    expect(getPrecheckItemMessage('zh-CN', 'EXISTING_ENV_DETECTED', zhFallback)).toBe(zhFallback)
    expect(getPrecheckItemMessage('en', 'EXISTING_ENV_DETECTED', enFallback)).toBe(enFallback)
  })

  it('returns fallback for unmapped error codes', () => {
    const msg = getPrecheckItemMessage('en', 'PERMISSION_DENIED', 'my fallback')
    expect(msg).toBe('my fallback')
  })
})

// ---------------------------------------------------------------------------
// getTemplateFieldLabel
// ---------------------------------------------------------------------------

describe('getTemplateFieldLabel', () => {
  it('returns localized label for known field keys', () => {
    expect(getTemplateFieldLabel('zh-CN', 'node.nodeVersion')).toBe('Node 版本')
    expect(getTemplateFieldLabel('en', 'node.nodeVersion')).toBe('Node Version')
  })

  it('falls back to key itself for unknown field keys', () => {
    expect(getTemplateFieldLabel('en', 'unknown.field')).toBe('unknown.field')
  })
})

// ---------------------------------------------------------------------------
// getTemplateOptionLabel
// ---------------------------------------------------------------------------

describe('getTemplateOptionLabel', () => {
  it('returns localized label for known option keys', () => {
    expect(getTemplateOptionLabel('zh-CN', 'nvm')).toBe('使用 nvm 管理 Node.js')
    expect(getTemplateOptionLabel('en', 'nvm')).toBe('Use nvm to Manage Node.js')
  })

  it('falls back to key itself for unknown option keys', () => {
    expect(getTemplateOptionLabel('en', 'unknown')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// getPluginSummary
// ---------------------------------------------------------------------------

describe('getPluginSummary', () => {
  it('returns localized summary for known plugin + mode', () => {
    expect(getPluginSummary('zh-CN', 'node-env', 'dry_run', 'fb')).toContain('演练计划')
    expect(getPluginSummary('en', 'node-env', 'real_run', 'fb')).toContain('Completed')
  })

  it('returns localized summary for git-env plugin', () => {
    expect(getPluginSummary('zh-CN', 'git-env', 'dry_run', 'fb')).toContain('Git')
    expect(getPluginSummary('en', 'git-env', 'real_run', 'fb')).toContain('Git')
  })

  it('returns fallback for unknown plugin', () => {
    expect(getPluginSummary('en', 'unknown-env', 'dry_run', 'my fallback')).toBe('my fallback')
  })
})

// ---------------------------------------------------------------------------
// getDetectedEnvironmentKindLabel
// ---------------------------------------------------------------------------

describe('getDetectedEnvironmentKindLabel', () => {
  it('returns localized label for node runtime_executable', () => {
    const detection: DetectedEnvironment = {
      id: 'node:runtime_executable:which:/usr/bin/node',
      tool: 'node',
      kind: 'runtime_executable',
      path: '/usr/bin/node',
      source: 'which',
      cleanupSupported: false,
    }
    expect(getDetectedEnvironmentKindLabel('zh-CN', detection)).toBe('Node 可执行文件')
    expect(getDetectedEnvironmentKindLabel('en', detection)).toBe('Node Executable')
  })

  it('returns localized label for java runtime_home', () => {
    const detection: DetectedEnvironment = {
      id: 'java:runtime_home:JAVA_HOME:/usr/lib/jvm',
      tool: 'java',
      kind: 'runtime_home',
      path: '/usr/lib/jvm',
      source: 'JAVA_HOME',
      cleanupSupported: false,
    }
    expect(getDetectedEnvironmentKindLabel('zh-CN', detection)).toBe('JAVA_HOME')
    expect(getDetectedEnvironmentKindLabel('en', detection)).toBe('JAVA_HOME')
  })

  it('returns localized label for python virtual_env', () => {
    const detection: DetectedEnvironment = {
      id: 'python:virtual_env:VIRTUAL_ENV:/tmp/venv',
      tool: 'python',
      kind: 'virtual_env',
      path: '/tmp/venv',
      source: 'VIRTUAL_ENV',
      cleanupSupported: false,
    }
    expect(getDetectedEnvironmentKindLabel('zh-CN', detection)).toBe('Python 虚拟环境')
    expect(getDetectedEnvironmentKindLabel('en', detection)).toBe('Python Virtual Environment')
  })

  it('falls back to kind for unmapped tool', () => {
    const detection = {
      id: 'rust:runtime_executable:which:/usr/bin/rustc',
      tool: 'rust' as DetectedEnvironment['tool'],
      kind: 'runtime_executable' as DetectedEnvironment['kind'],
      path: '/usr/bin/rustc',
      source: 'which',
      cleanupSupported: false,
    }
    expect(getDetectedEnvironmentKindLabel('en', detection)).toBe('runtime_executable')
  })
})

// ---------------------------------------------------------------------------
// getDetectedEnvironmentSourceLabel
// ---------------------------------------------------------------------------

describe('getDetectedEnvironmentSourceLabel', () => {
  const detection: DetectedEnvironment = {
    id: 'node:runtime_executable:which:/usr/bin/node',
    tool: 'node',
    kind: 'runtime_executable',
    path: '/usr/bin/node',
    source: 'which',
    cleanupSupported: false,
  }

  it('returns zh-CN formatted source label', () => {
    expect(getDetectedEnvironmentSourceLabel('zh-CN', detection)).toBe('来源：which')
  })

  it('returns en formatted source label', () => {
    expect(getDetectedEnvironmentSourceLabel('en', detection)).toBe('Source: which')
  })
})
