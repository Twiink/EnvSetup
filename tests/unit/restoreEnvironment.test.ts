import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Snapshot } from '../../src/main/core/contracts'

let tmpDir: string

// Mock homedir to redirect .zshrc writes to a temp directory
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return {
    ...original,
    homedir: () => tmpDir,
  }
})

// Lazy import after mock is set up
const { restoreEnvironment } = await import('../../src/main/core/snapshot')

function makeEnv(
  variables: Record<string, string>,
  path: string[] = ['/usr/bin', '/usr/local/bin'],
): Snapshot['environment'] {
  return { variables, path }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-restore-env-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('restoreEnvironment (darwin)', () => {
  it('writes managed block with export lines to .zshrc', async () => {
    const env = makeEnv({ NODE_HOME: '/opt/node', JAVA_HOME: '/opt/java' })

    await restoreEnvironment(env, 'darwin')

    const content = await readFile(join(tmpDir, '.zshrc'), 'utf8')
    expect(content).toContain('# EnvSetup managed block - begin')
    expect(content).toContain('# EnvSetup managed block - end')
    expect(content).toContain('export NODE_HOME="/opt/node"')
    expect(content).toContain('export JAVA_HOME="/opt/java"')
  })

  it('replaces existing managed block on repeated calls', async () => {
    const env1 = makeEnv({ FOO: 'first' })
    const env2 = makeEnv({ BAR: 'second' })

    await restoreEnvironment(env1, 'darwin')
    await restoreEnvironment(env2, 'darwin')

    const content = await readFile(join(tmpDir, '.zshrc'), 'utf8')
    const blockCount = (content.match(/# EnvSetup managed block - begin/g) ?? []).length
    expect(blockCount).toBe(1)
    expect(content).not.toContain('export FOO=')
    expect(content).toContain('export BAR="second"')
  })

  it('preserves non-managed content in .zshrc', async () => {
    const zshrcPath = join(tmpDir, '.zshrc')
    await writeFile(zshrcPath, '# my custom config\nexport MY_VAR="hello"\n')

    await restoreEnvironment(makeEnv({ NODE_HOME: '/opt/node' }), 'darwin')

    const content = await readFile(zshrcPath, 'utf8')
    expect(content).toContain('# my custom config')
    expect(content).toContain('export MY_VAR="hello"')
    expect(content).toContain('# EnvSetup managed block - begin')
    expect(content).toContain('export NODE_HOME="/opt/node"')
  })

  it('creates .zshrc if it does not exist', async () => {
    await restoreEnvironment(makeEnv({ TEST: 'value' }), 'darwin')

    const content = await readFile(join(tmpDir, '.zshrc'), 'utf8')
    expect(content).toContain('# EnvSetup managed block - begin')
    expect(content).toContain('export TEST="value"')
  })

  it('returns correct count of restored variables', async () => {
    const env = makeEnv({
      A: '1',
      B: '2',
      C: '3',
    }, ['/a', '/b'])

    const count = await restoreEnvironment(env, 'darwin')
    // 3 variables + 1 PATH = 4
    expect(count).toBe(4)
  })

  it('assembles PATH from path array', async () => {
    const env = makeEnv({}, ['/usr/bin', '/usr/local/bin', '/opt/node/bin'])

    await restoreEnvironment(env, 'darwin')

    const content = await readFile(join(tmpDir, '.zshrc'), 'utf8')
    expect(content).toContain('export PATH="/usr/bin:/usr/local/bin:/opt/node/bin"')
  })

  it('skips PATH key from variables and uses path array instead', async () => {
    const env = makeEnv(
      { PATH: '/should/be/ignored', NODE_HOME: '/opt/node' },
      ['/actual/path'],
    )

    await restoreEnvironment(env, 'darwin')

    const content = await readFile(join(tmpDir, '.zshrc'), 'utf8')
    expect(content).not.toContain('/should/be/ignored')
    expect(content).toContain('export PATH="/actual/path"')
    expect(content).toContain('export NODE_HOME="/opt/node"')
  })
})
