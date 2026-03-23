import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('merges file operations and env changes from multiple plugins', () => {
    const plan = generateInstallPlan([
      {
        files: [{ path: '/usr/local/bin/node', action: 'create', size: 2048 }],
        envChanges: [{ key: 'NODE_HOME', value: '/usr/local', action: 'set' }],
        downloads: [{ url: 'https://nodejs.org/node.tar.gz', size: 20_971_520 }],
        commands: ['tar -xzf node.tar.gz', 'mv node /usr/local/bin/node'],
      },
      {
        files: [{ path: '/usr/local/bin/npm', action: 'create', size: 1024 }],
        envChanges: [{ key: 'PATH', value: '/usr/local/bin', action: 'append' }],
      },
    ])
    expect(plan.pluginCount).toBe(2)
    expect(plan.fileOperations).toHaveLength(2)
    expect(plan.envChanges).toHaveLength(2)
    expect(plan.estimatedDiskUsage).toBe(2048 + 1024)
    expect(plan.estimatedDownloadSize).toBe(20_971_520)
    // 2 commands * 5000 + ceil(20MB/10MB) * 3000 = 10000 + 6000
    expect(plan.estimatedDurationMs).toBe(16_000)
  })

  it('uses default sizes when size is not provided', () => {
    const plan = generateInstallPlan([
      {
        files: [{ path: '/some/file', action: 'create' }],
        downloads: [{ url: 'https://example.com/file' }],
      },
    ])
    expect(plan.estimatedDiskUsage).toBe(1_048_576)
    expect(plan.estimatedDownloadSize).toBe(10_485_760)
    // 0 commands * 5000 + ceil(10MB/10MB) * 3000 = 3000
    expect(plan.estimatedDurationMs).toBe(3_000)
  })

  it('does not count delete operations in disk usage', () => {
    const plan = generateInstallPlan([
      {
        files: [
          { path: '/old/file', action: 'delete', size: 500_000 },
          { path: '/new/file', action: 'create', size: 100_000 },
        ],
      },
    ])
    expect(plan.estimatedDiskUsage).toBe(100_000)
  })

  it('counts symlink as a file operation but zero disk usage (no size)', () => {
    const plan = generateInstallPlan([
      {
        files: [{ path: '/usr/local/bin/nvm', action: 'symlink' }],
      },
    ])
    // symlink without size uses DEFAULT_FILE_SIZE because type is not create/modify? No —
    // symlink is not create or modify so it does NOT add to disk usage
    expect(plan.estimatedDiskUsage).toBe(0)
    expect(plan.fileOperations).toHaveLength(1)
    expect(plan.fileOperations[0].type).toBe('symlink')
  })
})

describe('detectConflicts', () => {
  it('returns no conflicts when nothing overlaps', () => {
    const plan = generateInstallPlan([
      {
        files: [{ path: '/new/path', action: 'create' }],
        envChanges: [{ key: 'NEW_VAR', value: '1', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, ['/existing/path'], { EXISTING_VAR: 'x' })
    expect(conflicts).toHaveLength(0)
  })

  it('detects file_exists conflict for create operations', () => {
    const plan = generateInstallPlan([
      { files: [{ path: '/usr/local/bin/node', action: 'create' }] },
    ])
    const conflicts = detectConflicts(plan, ['/usr/local/bin/node'], {})
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('file_exists')
    expect(conflicts[0].path).toBe('/usr/local/bin/node')
  })

  it('does not flag modify or delete operations as file_exists conflict', () => {
    const plan = generateInstallPlan([
      {
        files: [
          { path: '/etc/profile', action: 'modify' },
          { path: '/old/file', action: 'delete' },
        ],
      },
    ])
    const conflicts = detectConflicts(plan, ['/etc/profile', '/old/file'], {})
    expect(conflicts).toHaveLength(0)
  })

  it('detects env_conflict for set actions on existing env vars', () => {
    const plan = generateInstallPlan([
      { envChanges: [{ key: 'NODE_HOME', value: '/new', action: 'set' }] },
    ])
    const conflicts = detectConflicts(plan, [], { NODE_HOME: '/old' })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('env_conflict')
    expect(conflicts[0].key).toBe('NODE_HOME')
    expect(conflicts[0].detail).toContain('/old')
  })

  it('does not flag append or remove actions as env_conflict', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [
          { key: 'PATH', value: '/new/bin', action: 'append' },
          { key: 'OLD_VAR', value: '', action: 'remove' },
        ],
      },
    ])
    const conflicts = detectConflicts(plan, [], { PATH: '/usr/bin', OLD_VAR: 'something' })
    expect(conflicts).toHaveLength(0)
  })

  it('detects multiple conflicts simultaneously', () => {
    const plan = generateInstallPlan([
      {
        files: [{ path: '/bin/node', action: 'create' }],
        envChanges: [{ key: 'NODE_HOME', value: '/new', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, ['/bin/node'], { NODE_HOME: '/old' })
    expect(conflicts).toHaveLength(2)
  })
})

describe('generateImpactSummary', () => {
  it('counts each file operation type correctly', () => {
    const plan = generateInstallPlan([
      {
        files: [
          { path: '/a', action: 'create', size: 100 },
          { path: '/b', action: 'create', size: 200 },
          { path: '/c', action: 'modify', size: 50 },
          { path: '/d', action: 'delete' },
          { path: '/e', action: 'symlink' },
        ],
        envChanges: [
          { key: 'A', value: '1', action: 'set' },
          { key: 'B', value: '2', action: 'append' },
        ],
      },
    ])
    const summary = generateImpactSummary(plan)
    expect(summary.filesCreated).toBe(3)  // create x2 + symlink x1
    expect(summary.filesModified).toBe(1)
    expect(summary.filesDeleted).toBe(1)
    expect(summary.envVarsChanged).toBe(2)
    expect(summary.totalDiskUsage).toBe(350)  // 100 + 200 + 50
  })

  it('returns zeros for empty plan', () => {
    const plan = generateInstallPlan([])
    const summary = generateImpactSummary(plan)
    expect(summary.filesCreated).toBe(0)
    expect(summary.filesModified).toBe(0)
    expect(summary.filesDeleted).toBe(0)
    expect(summary.envVarsChanged).toBe(0)
    expect(summary.totalDiskUsage).toBe(0)
    expect(summary.estimatedDurationMs).toBe(0)
  })
})

describe('runEnhancedPrecheck', () => {
  it('returns canProceed=true when no conflicts', () => {
    const result = runEnhancedPrecheck(
      [{ files: [{ path: '/new/path', action: 'create', size: 1024 }] }],
      [],
      {},
    )
    expect(result.canProceed).toBe(true)
    expect(result.conflicts).toHaveLength(0)
    expect(result.plan.pluginCount).toBe(1)
    expect(result.impact.filesCreated).toBe(1)
  })

  it('returns canProceed=false when conflicts exist', () => {
    const result = runEnhancedPrecheck(
      [{ files: [{ path: '/existing/file', action: 'create' }] }],
      ['/existing/file'],
      {},
    )
    expect(result.canProceed).toBe(false)
    expect(result.conflicts).toHaveLength(1)
  })

  it('aggregates plan, conflicts and impact correctly end-to-end', () => {
    const result = runEnhancedPrecheck(
      [
        {
          files: [
            { path: '/usr/local/bin/node', action: 'create', size: 50_000 },
            { path: '/etc/profile', action: 'modify', size: 200 },
          ],
          envChanges: [{ key: 'NODE_HOME', value: '/usr/local', action: 'set' }],
          downloads: [{ url: 'https://nodejs.org/node.tar.gz', size: 30_000_000 }],
          commands: ['install node'],
        },
      ],
      [],
      {},
    )
    expect(result.canProceed).toBe(true)
    expect(result.plan.estimatedDownloadSize).toBe(30_000_000)
    expect(result.plan.estimatedDiskUsage).toBe(50_200)
    expect(result.impact.filesCreated).toBe(1)
    expect(result.impact.filesModified).toBe(1)
    expect(result.impact.envVarsChanged).toBe(1)
  })
})

describe('detectConflicts – version_mismatch', () => {
  it('detects version_mismatch when installed version differs from requested', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [{ key: 'NODE_VERSION', value: '20.11.0', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, [], {}, { node: '18.0.0' })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('version_mismatch')
    expect(conflicts[0].key).toBe('node')
    expect(conflicts[0].detail).toBe('Installed: 18.0.0, requested: 20.11.0')
  })

  it('does not emit version_mismatch when versions match', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [{ key: 'NODE_VERSION', value: '20.11.0', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, [], {}, { node: '20.11.0' })
    expect(conflicts).toHaveLength(0)
  })

  it('does not emit version_mismatch when tool is not in installedVersions', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [{ key: 'NODE_VERSION', value: '20.11.0', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, [], {}, {})
    expect(conflicts).toHaveLength(0)
  })

  it('ignores envChanges without semver value', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [{ key: 'NODE_VERSION', value: 'lts', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, [], {}, { node: '18.0.0' })
    expect(conflicts).toHaveLength(0)
  })

  it('ignores envChanges whose key does not match *_VERSION pattern', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [{ key: 'NODE_HOME', value: '20.11.0', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, [], {}, { node: '18.0.0' })
    expect(conflicts).toHaveLength(0)
  })

  it('skips version_mismatch check when installedVersions is undefined', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [{ key: 'NODE_VERSION', value: '20.11.0', action: 'set' }],
      },
    ])
    const conflicts = detectConflicts(plan, [], {})
    expect(conflicts).toHaveLength(0)
  })

  it('detects version_mismatch for java and python tool names', () => {
    const plan = generateInstallPlan([
      {
        envChanges: [
          { key: 'JAVA_VERSION', value: '17.0.1', action: 'set' },
          { key: 'PYTHON_VERSION', value: '3.11.0', action: 'set' },
        ],
      },
    ])
    const conflicts = detectConflicts(plan, [], {}, { java: '11.0.0', python: '3.9.0' })
    expect(conflicts).toHaveLength(2)
    expect(conflicts.map((c) => c.key)).toEqual(['java', 'python'])
  })
})

describe('runPrecheck', () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReset()
  })

  it('uses existsSync to detect existing paths – no conflicts when file absent', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const result = await runPrecheck([
      { files: [{ path: '/tmp/new-file', action: 'create', size: 1024 }] },
    ])
    expect(result.canProceed).toBe(true)
    expect(result.plan.pluginCount).toBe(1)
  })

  it('reports file_exists conflict when file is present on disk', async () => {
    vi.mocked(existsSync).mockImplementation((p) => p === '/tmp/existing-file')

    const result = await runPrecheck([
      { files: [{ path: '/tmp/existing-file', action: 'create', size: 512 }] },
    ])
    expect(result.canProceed).toBe(false)
    expect(result.conflicts[0].type).toBe('file_exists')
    expect(result.conflicts[0].path).toBe('/tmp/existing-file')
  })

  it('passes installedVersions through to detectConflicts', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const result = await runPrecheck(
      [
        {
          envChanges: [{ key: 'NODE_VERSION', value: '20.11.0', action: 'set' }],
        },
      ],
      { node: '18.0.0' },
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('version_mismatch')
  })

  it('handles empty plugin results', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const result = await runPrecheck([])
    expect(result.canProceed).toBe(true)
    expect(result.conflicts).toHaveLength(0)
    expect(result.plan.pluginCount).toBe(0)
  })
})
