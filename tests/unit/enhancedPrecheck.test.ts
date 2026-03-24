import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DownloadArtifact,
  EnvChange,
  PluginInstallResult,
} from '../../src/main/core/contracts'
import {
  detectConflicts,
  generateImpactSummary,
  generateInstallPlan,
  runEnhancedPrecheck,
  runPrecheck,
} from '../../src/main/core/enhancedPrecheck'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})

const DEFAULT_DOWNLOAD_SIZE = 10_485_760
const DEFAULT_FILE_SIZE = 1_048_576

function makeResult(overrides: Partial<PluginInstallResult> = {}): PluginInstallResult {
  return {
    status: 'installed_unverified',
    executionMode: 'dry_run',
    version: '1.0.0',
    paths: {},
    envChanges: [],
    downloads: [],
    commands: [],
    logs: [],
    summary: '',
    ...overrides,
  }
}

function makeEnvChange(key: string, value: string, kind: EnvChange['kind'] = 'env'): EnvChange {
  return { kind, key, value, scope: 'user', description: '' }
}

function makeDownload(url: string): DownloadArtifact {
  return { kind: 'archive', tool: 'node', url, official: true }
}

// ============================================================
// generateInstallPlan
// ============================================================

describe('generateInstallPlan', () => {
  it('returns empty plan for empty input', () => {
    const plan = generateInstallPlan([])
    expect(plan.fileOperations).toEqual([])
    expect(plan.envChanges).toEqual([])
    expect(plan.estimatedDiskUsage).toBe(0)
    expect(plan.estimatedDownloadSize).toBe(0)
    expect(plan.estimatedDurationMs).toBe(0)
    expect(plan.pluginCount).toBe(0)
  })

  it('infers file operations from downloads URLs', () => {
    const plan = generateInstallPlan([
      makeResult({
        downloads: [makeDownload('https://nodejs.org/dist/v18.0.0/node-v18.0.0-darwin-x64.tar.gz')],
      }),
    ])
    expect(plan.fileOperations).toHaveLength(1)
    expect(plan.fileOperations[0].type).toBe('create')
    expect(plan.fileOperations[0].path).toBe('node-v18.0.0-darwin-x64.tar.gz')
    expect(plan.estimatedDownloadSize).toBe(DEFAULT_DOWNLOAD_SIZE)
  })

  it('infers file operations from paths', () => {
    const plan = generateInstallPlan([
      makeResult({ paths: { bin: '/usr/local/bin/node', lib: '/usr/local/lib/node' } }),
    ])
    expect(plan.fileOperations).toHaveLength(2)
    expect(plan.fileOperations.every((f) => f.type === 'create')).toBe(true)
  })

  it('maps EnvChange.kind=env to action=set', () => {
    const plan = generateInstallPlan([
      makeResult({ envChanges: [makeEnvChange('NODE_HOME', '/usr/local', 'env')] }),
    ])
    expect(plan.envChanges).toHaveLength(1)
    expect(plan.envChanges[0].action).toBe('set')
    expect(plan.envChanges[0].key).toBe('NODE_HOME')
  })

  it('maps EnvChange.kind=path to action=append', () => {
    const plan = generateInstallPlan([
      makeResult({ envChanges: [makeEnvChange('PATH', '/usr/local/bin', 'path')] }),
    ])
    expect(plan.envChanges[0].action).toBe('append')
  })

  it('merges results from multiple plugins', () => {
    const plan = generateInstallPlan([
      makeResult({
        downloads: [makeDownload('https://example.com/tool-a.tar.gz')],
        envChanges: [makeEnvChange('TOOL_A', '1.0.0', 'env')],
        commands: ['install-a'],
      }),
      makeResult({
        paths: { bin: '/usr/local/bin/tool-b' },
        envChanges: [makeEnvChange('PATH', '/usr/local/bin', 'path')],
        commands: ['install-b', 'verify-b'],
      }),
    ])
    expect(plan.pluginCount).toBe(2)
    expect(plan.envChanges).toHaveLength(2)
    // 1 download + 1 path = 2 file ops
    expect(plan.fileOperations).toHaveLength(2)
    // 3 commands * 5000 + ceil(10MB/10MB) * 3000 = 15000 + 3000
    expect(plan.estimatedDurationMs).toBe(18_000)
  })

  it('calculates disk usage from file operations', () => {
    const plan = generateInstallPlan([
      makeResult({
        downloads: [makeDownload('https://example.com/large.tar.gz')],
      }),
    ])
    // one create op with DEFAULT_DOWNLOAD_SIZE (from download) + one from paths (none)
    expect(plan.estimatedDiskUsage).toBe(DEFAULT_DOWNLOAD_SIZE)
  })
})

// ============================================================
// detectConflicts
// ============================================================

describe('detectConflicts', () => {
  it('detects no conflicts when paths and env are clear', () => {
    const plan = generateInstallPlan([
      makeResult({
        downloads: [makeDownload('https://example.com/node.tar.gz')],
        envChanges: [makeEnvChange('NODE_HOME', '/usr/local')],
      }),
    ])
    const conflicts = detectConflicts(plan, [], {})
    expect(conflicts).toHaveLength(0)
  })

  it('detects file_exists conflict', () => {
    const plan = generateInstallPlan([
      makeResult({ downloads: [makeDownload('https://example.com/node.tar.gz')] }),
    ])
    const conflicts = detectConflicts(plan, ['node.tar.gz'], {})
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('file_exists')
    expect(conflicts[0].path).toBe('node.tar.gz')
  })

  it('detects env_conflict for set action', () => {
    const plan = generateInstallPlan([
      makeResult({ envChanges: [makeEnvChange('NODE_HOME', '/usr/local', 'env')] }),
    ])
    const conflicts = detectConflicts(plan, [], { NODE_HOME: '/old/path' })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('env_conflict')
    expect(conflicts[0].key).toBe('NODE_HOME')
  })

  it('does not flag append action as env_conflict', () => {
    const plan = generateInstallPlan([
      makeResult({ envChanges: [makeEnvChange('PATH', '/usr/local/bin', 'path')] }),
    ])
    const conflicts = detectConflicts(plan, [], { PATH: '/existing/path' })
    expect(conflicts).toHaveLength(0)
  })

  it('detects version_mismatch via *_VERSION key pattern', () => {
    const plan = generateInstallPlan([
      makeResult({ envChanges: [makeEnvChange('NODE_VERSION', '20.0.0', 'env')] }),
    ])
    const conflicts = detectConflicts(plan, [], {}, { node: '18.0.0' })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('version_mismatch')
    expect(conflicts[0].key).toBe('node')
  })

  it('no version_mismatch when versions match', () => {
    const plan = generateInstallPlan([
      makeResult({ envChanges: [makeEnvChange('NODE_VERSION', '18.0.0', 'env')] }),
    ])
    const conflicts = detectConflicts(plan, [], {}, { node: '18.0.0' })
    expect(conflicts).toHaveLength(0)
  })
})

// ============================================================
// generateImpactSummary
// ============================================================

describe('generateImpactSummary', () => {
  it('counts file operations correctly', () => {
    const plan = generateInstallPlan([
      makeResult({
        downloads: [
          makeDownload('https://example.com/a.tar.gz'),
          makeDownload('https://example.com/b.tar.gz'),
        ],
        envChanges: [makeEnvChange('TOOL_HOME', '/opt/tool')],
      }),
    ])
    const summary = generateImpactSummary(plan)
    expect(summary.filesCreated).toBe(2)
    expect(summary.filesModified).toBe(0)
    expect(summary.filesDeleted).toBe(0)
    expect(summary.envVarsChanged).toBe(1)
    expect(summary.totalDiskUsage).toBe(2 * DEFAULT_DOWNLOAD_SIZE)
  })

  it('returns zeros for empty plan', () => {
    const summary = generateImpactSummary(generateInstallPlan([]))
    expect(summary.filesCreated).toBe(0)
    expect(summary.filesModified).toBe(0)
    expect(summary.filesDeleted).toBe(0)
    expect(summary.envVarsChanged).toBe(0)
    expect(summary.totalDiskUsage).toBe(0)
  })
})

// ============================================================
// runEnhancedPrecheck
// ============================================================

describe('runEnhancedPrecheck', () => {
  it('canProceed is true when no conflicts', () => {
    const result = runEnhancedPrecheck([makeResult()], [], {})
    expect(result.canProceed).toBe(true)
    expect(result.conflicts).toHaveLength(0)
  })

  it('canProceed is false when file_exists conflict exists', () => {
    const result = runEnhancedPrecheck(
      [makeResult({ downloads: [makeDownload('https://example.com/node.tar.gz')] })],
      ['node.tar.gz'],
      {},
    )
    expect(result.canProceed).toBe(false)
  })

  it('canProceed is true when only version_mismatch conflict', () => {
    const result = runEnhancedPrecheck(
      [makeResult({ envChanges: [makeEnvChange('NODE_VERSION', '20.0.0', 'env')] })],
      [],
      {},
      { node: '18.0.0' },
    )
    // version_mismatch is non-blocking
    expect(result.canProceed).toBe(true)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('version_mismatch')
  })

  it('returns complete result structure', () => {
    const result = runEnhancedPrecheck([makeResult()], [], {})
    expect(result).toHaveProperty('plan')
    expect(result).toHaveProperty('conflicts')
    expect(result).toHaveProperty('impact')
    expect(result).toHaveProperty('canProceed')
  })
})

// ============================================================
// runPrecheck
// ============================================================

describe('runPrecheck', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('handles empty plugin results', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const result = await runPrecheck([])
    expect(result.canProceed).toBe(true)
    expect(result.conflicts).toHaveLength(0)
    expect(result.plan.pluginCount).toBe(0)
  })

  it('detects existing paths from plugin paths via existsSync', async () => {
    vi.mocked(existsSync).mockImplementation((p) => p === '/usr/local/bin/node')
    const plan = generateInstallPlan([makeResult({ paths: { bin: '/usr/local/bin/node' } })])
    // file op for '/usr/local/bin/node' will be 'create' -> conflict since it exists
    const result = await runPrecheck([makeResult({ paths: { bin: '/usr/local/bin/node' } })])
    expect(result.conflicts.some((c) => c.type === 'file_exists')).toBe(true)
    expect(result.canProceed).toBe(false)
  })
})
