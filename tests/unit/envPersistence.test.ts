import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { EnvChange } from '../../src/main/core/contracts'
import { previewEnvChanges, applyEnvChanges } from '../../src/main/core/envPersistence'

describe('previewEnvChanges', () => {
  it('counts env, path, and profile changes correctly', () => {
    const changes: EnvChange[] = [
      { kind: 'env', key: 'NODE_HOME', value: '/opt/node', scope: 'user', description: 'node home' },
      { kind: 'path', key: 'PATH', value: '/opt/node/bin', scope: 'user', description: 'node bin' },
      { kind: 'profile', key: 'nvm_init', value: 'source ~/.nvm/nvm.sh', scope: 'user', target: '~/.zshrc', description: 'nvm init' },
    ]

    const preview = previewEnvChanges(changes)

    expect(preview.envCount).toBe(1)
    expect(preview.pathCount).toBe(1)
    expect(preview.profileCount).toBe(1)
    expect(preview.targets).toEqual(['NODE_HOME', 'PATH', '~/.zshrc'])
  })

  it('deduplicates targets', () => {
    const changes: EnvChange[] = [
      { kind: 'env', key: 'A', value: '1', scope: 'user', target: '~/.zshrc', description: 'a' },
      { kind: 'env', key: 'B', value: '2', scope: 'user', target: '~/.zshrc', description: 'b' },
    ]

    const preview = previewEnvChanges(changes)

    expect(preview.targets).toEqual(['~/.zshrc'])
  })
})

describe('applyEnvChanges (darwin)', () => {
  let tempDir: string
  let profilePath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `envsetup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, { recursive: true })
    profilePath = join(tempDir, '.zshrc')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes managed block to profile file', async () => {
    await writeFile(profilePath, '# existing content\n', 'utf8')

    const changes: EnvChange[] = [
      { kind: 'env', key: 'NODE_HOME', value: '/opt/node', scope: 'user', target: profilePath, description: 'node' },
      { kind: 'path', key: 'PATH', value: '/opt/node/bin', scope: 'user', target: profilePath, description: 'path' },
    ]

    const result = await applyEnvChanges({ changes, platform: 'darwin' })

    expect(result.applied).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)

    const content = await readFile(profilePath, 'utf8')
    expect(content).toContain('# envsetup: managed block:start')
    expect(content).toContain('export NODE_HOME="/opt/node"')
    expect(content).toContain('export PATH="/opt/node/bin:$PATH"')
    expect(content).toContain('# envsetup: managed block:end')
    expect(content).toContain('# existing content')
  })

  it('replaces existing managed block on re-apply', async () => {
    const initial = [
      '# existing content',
      '# envsetup: managed block:start',
      'export OLD="value"',
      '# envsetup: managed block:end',
      '',
    ].join('\n')
    await writeFile(profilePath, initial, 'utf8')

    const changes: EnvChange[] = [
      { kind: 'env', key: 'NEW_KEY', value: 'new_value', scope: 'user', target: profilePath, description: 'new' },
    ]

    const result = await applyEnvChanges({ changes, platform: 'darwin' })

    expect(result.applied).toHaveLength(1)

    const content = await readFile(profilePath, 'utf8')
    expect(content).not.toContain('export OLD="value"')
    expect(content).toContain('export NEW_KEY="new_value"')
    // Only one managed block
    const blockCount = (content.match(/managed block:start/g) ?? []).length
    expect(blockCount).toBe(1)
  })

  it('filters out session-scoped changes', async () => {
    const changes: EnvChange[] = [
      { kind: 'env', key: 'PERSIST', value: '1', scope: 'user', target: profilePath, description: 'persist' },
      { kind: 'env', key: 'TEMP', value: '2', scope: 'session', target: profilePath, description: 'temp' },
    ]

    const result = await applyEnvChanges({ changes, platform: 'darwin' })

    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].key).toBe('PERSIST')
  })

  it('creates profile file if it does not exist', async () => {
    const newProfile = join(tempDir, '.new_profile')
    const changes: EnvChange[] = [
      { kind: 'env', key: 'FOO', value: 'bar', scope: 'user', target: newProfile, description: 'foo' },
    ]

    const result = await applyEnvChanges({ changes, platform: 'darwin' })

    expect(result.applied).toHaveLength(1)
    const content = await readFile(newProfile, 'utf8')
    expect(content).toContain('export FOO="bar"')
  })

  it('handles profile kind changes as raw lines', async () => {
    const changes: EnvChange[] = [
      { kind: 'profile', key: 'nvm_init', value: 'source ~/.nvm/nvm.sh', scope: 'user', target: profilePath, description: 'nvm' },
    ]

    const result = await applyEnvChanges({ changes, platform: 'darwin' })

    expect(result.applied).toHaveLength(1)
    const content = await readFile(profilePath, 'utf8')
    expect(content).toContain('source ~/.nvm/nvm.sh')
  })
})
