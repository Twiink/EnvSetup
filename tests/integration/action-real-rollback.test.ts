/**
 * Real rollback integration tests.
 *
 * Tests the snapshot → install → verify → rollback cycle using REAL plugins.
 * After a real install succeeds, we corrupt the installation and verify that
 * snapshot rollback restores the tracked files.
 *
 * Guard: all tests are skipped unless ENVSETUP_REAL_RUN=1.
 */
import { constants } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cleanupDetectedEnvironment } from '../../src/main/core/environment'
import { executeRollback, suggestRollbackSnapshots } from '../../src/main/core/rollback'
import { createSnapshot, updateSnapshotMeta } from '../../src/main/core/snapshot'
import { createTask, executeTask, loadTask } from '../../src/main/core/task'
import type { DetectedEnvironment } from '../../src/main/core/contracts'

import nodeEnvPlugin from '../../src/main/plugins/nodeEnvPlugin'
import javaEnvPlugin from '../../src/main/plugins/javaEnvPlugin'
import pythonEnvPlugin from '../../src/main/plugins/pythonEnvPlugin'
import gitEnvPlugin from '../../src/main/plugins/gitEnvPlugin'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const platform = process.platform as 'darwin' | 'win32'
const isMac = platform === 'darwin'
const isWindows = platform === 'win32'

let tmpDir: string
let tasksDir: string
let snapshotsDir: string
let downloadCacheDir: string
let homeDir: string
let previousHome: string | undefined
let previousUserProfile: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-real-rollback-'))
  tasksDir = join(tmpDir, 'tasks')
  snapshotsDir = join(tmpDir, 'snapshots')
  downloadCacheDir = join(tmpDir, 'download-cache')
  homeDir = join(tmpDir, 'home')
  await mkdir(downloadCacheDir, { recursive: true })
  await mkdir(homeDir, { recursive: true })
  previousHome = process.env.HOME
  previousUserProfile = process.env.USERPROFILE
  process.env.HOME = homeDir
  process.env.USERPROFILE = homeDir
})

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }

  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE
  } else {
    process.env.USERPROFILE = previousUserProfile
  }

  await rm(tmpDir, { recursive: true, force: true })
})

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function makeDetection(
  tool: 'node' | 'java' | 'python' | 'git',
  installRootDir: string,
): DetectedEnvironment {
  return {
    id: `${tool}:managed_root:test:${installRootDir}`,
    tool,
    kind: 'managed_root',
    path: installRootDir,
    source: 'test',
    cleanupSupported: true,
    cleanupPath: installRootDir,
  }
}

async function executePersistedTaskRollback(
  taskId: string,
  snapshotId: string,
  trackedPaths: string[],
  installPaths?: string[],
) {
  const task = await loadTask(taskId, tasksDir)
  const rollbackCommands = [
    ...new Set(task.plugins.flatMap((plugin) => plugin.lastResult?.rollbackCommands ?? [])),
  ]

  return executeRollback(snapshotsDir, snapshotId, trackedPaths, installPaths, {
    rollbackCommands,
  })
}

// ============================================================
// Node.js direct — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Node.js direct', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install → snapshot installed state → corrupt → rollback restores files',
      async () => {
        const installRootDir = join(tmpDir, 'node-rollback')
        const npmCacheDir = join(tmpDir, 'npm-cache-rb')
        const npmGlobalPrefix = join(tmpDir, 'npm-global-rb')

        // Create a tracked file that exists before installation
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'marker.txt')
        await writeFile(trackedFile, 'pre-install-state')

        // Take a pre-install snapshot
        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-install',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        // Run real installation
        const task = createTask({
          templateId: 'node-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            nodeManager: 'node',
            nodeVersion: '20.20.1',
            npmCacheDir,
            npmGlobalPrefix,
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'node-env',
              version: '1.0.0',
              params: {
                installRootDir,
                nodeManager: 'node',
                nodeVersion: '20.20.1',
                npmCacheDir,
                npmGlobalPrefix,
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'node-env': nodeEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt the tracked file (simulating a bad update)
        await writeFile(trackedFile, 'corrupted-by-bad-update')
        expect(await readFile(trackedFile, 'utf8')).toBe('corrupted-by-bad-update')

        // Rollback to pre-install state
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )

    it('rollback suggestions rank pre-install snapshot correctly', async () => {
      const installRootDir = join(tmpDir, 'node-suggest')
      await mkdir(installRootDir, { recursive: true })
      const trackedFile = join(installRootDir, 'track.txt')
      await writeFile(trackedFile, 'original')

      const task = createTask({
        templateId: 'node-template',
        templateVersion: '1.0.0',
        params: { installRootDir, nodeManager: 'node', nodeVersion: '20.20.1' },
        plugins: [
          {
            pluginId: 'node-env',
            version: '1.0.0',
            params: { installRootDir, nodeManager: 'node', nodeVersion: '20.20.1' },
          },
        ],
      })

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [trackedFile],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const suggestions = await suggestRollbackSnapshots(snapshotsDir, task.id)
      expect(suggestions.length).toBeGreaterThanOrEqual(1)
      expect(suggestions[0].snapshotId).toBe(snapshot.id)
      expect(suggestions[0].confidence).toBe('high')
    })
  })
})

// ============================================================
// Java JDK — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Java JDK', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install → corrupt tracked marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'java-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'java-marker.txt')
        await writeFile(trackedFile, 'java-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-java',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'java-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            javaManager: 'jdk',
            javaVersion: '21',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'java-env',
              version: '1.0.0',
              params: {
                installRootDir,
                javaManager: 'jdk',
                javaVersion: '21',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'java-env': javaEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt
        await writeFile(trackedFile, 'corrupted-java')

        // Rollback
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Python conda — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Python conda', () => {
  const TIMEOUT = 600_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install → corrupt tracked marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'python-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'python-marker.txt')
        await writeFile(trackedFile, 'python-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-python',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'python-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            pythonManager: 'conda',
            pythonVersion: '3.12.10',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'python-env',
              version: '1.0.0',
              params: {
                installRootDir,
                pythonManager: 'conda',
                pythonVersion: '3.12.10',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'python-env': pythonEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt
        await writeFile(trackedFile, 'corrupted-python')

        // Rollback
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Git direct — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Git direct', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install → corrupt tracked marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'git-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'git-marker.txt')
        await writeFile(trackedFile, 'git-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-git',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'git-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            gitManager: 'git',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'git-env',
              version: '1.0.0',
              params: {
                installRootDir,
                gitManager: 'git',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'git-env': gitEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt
        await writeFile(trackedFile, 'corrupted-git')

        // Rollback
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Git Homebrew (macOS only) — install, snapshot, rollback
// ============================================================

describe('real rollback — Git Homebrew', () => {
  const TIMEOUT = 600_000

  describe.skipIf(!isRealRun || !isMac)('gated by ENVSETUP_REAL_RUN + macOS', () => {
    it(
      'install via homebrew → corrupt marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'git-brew-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'brew-marker.txt')
        await writeFile(trackedFile, 'brew-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-git-brew',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'git-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            gitManager: 'homebrew',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'git-env',
              version: '1.0.0',
              params: {
                installRootDir,
                gitManager: 'homebrew',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'git-env': gitEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        await writeFile(trackedFile, 'corrupted-brew')

        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Node.js nvm — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Node.js nvm', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install via nvm → corrupt tracked marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'node-nvm-rollback')
        const npmCacheDir = join(tmpDir, 'npm-cache-nvm-rb')
        const npmGlobalPrefix = join(tmpDir, 'npm-global-nvm-rb')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'nvm-marker.txt')
        await writeFile(trackedFile, 'nvm-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-nvm',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'node-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            nodeManager: 'nvm',
            nodeVersion: '20.20.1',
            npmCacheDir,
            npmGlobalPrefix,
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'node-env',
              version: '1.0.0',
              params: {
                installRootDir,
                nodeManager: 'nvm',
                nodeVersion: '20.20.1',
                npmCacheDir,
                npmGlobalPrefix,
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'node-env': nodeEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        await writeFile(trackedFile, 'corrupted-nvm')

        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Java SDKMAN — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Java SDKMAN', () => {
  const TIMEOUT = 600_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install via SDKMAN → corrupt tracked marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'java-sdkman-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'sdkman-marker.txt')
        await writeFile(trackedFile, 'sdkman-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-sdkman',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'java-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            javaManager: 'sdkman',
            javaVersion: '21',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'java-env',
              version: '1.0.0',
              params: {
                installRootDir,
                javaManager: 'sdkman',
                javaVersion: '21',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'java-env': javaEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        await writeFile(trackedFile, 'corrupted-sdkman')

        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Python direct — install, snapshot, corrupt, rollback
// ============================================================

describe('real rollback — Python direct', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'install via standalone Python → corrupt tracked marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'python-direct-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'python-direct-marker.txt')
        await writeFile(trackedFile, 'python-direct-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-python-direct',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'python-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            pythonManager: 'python',
            pythonVersion: '3.12.10',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'python-env',
              version: '1.0.0',
              params: {
                installRootDir,
                pythonManager: 'python',
                pythonVersion: '3.12.10',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'python-env': pythonEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        await writeFile(trackedFile, 'corrupted-python-direct')

        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Git Scoop (Windows only) — install, snapshot, rollback
// ============================================================

describe('real rollback — Git Scoop', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun || !isWindows)('gated by ENVSETUP_REAL_RUN + Windows', () => {
    it(
      'install via Scoop → corrupt marker → rollback restores',
      async () => {
        const installRootDir = join(tmpDir, 'git-scoop-rollback')

        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'scoop-marker.txt')
        await writeFile(trackedFile, 'scoop-pre-install')

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-git-scoop',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        const task = createTask({
          templateId: 'git-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            gitManager: 'scoop',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'git-env',
              version: '1.0.0',
              params: {
                installRootDir,
                gitManager: 'scoop',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'git-env': gitEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        await writeFile(trackedFile, 'corrupted-scoop')

        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          preSnapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Multi-file rollback with real plugin output
// ============================================================

describe('real rollback — multi-file with Node.js', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'rollback restores multiple tracked files after install',
      async () => {
        const installRootDir = join(tmpDir, 'node-multi-rollback')
        const npmCacheDir = join(tmpDir, 'npm-cache-multi')
        const npmGlobalPrefix = join(tmpDir, 'npm-global-multi')

        await mkdir(installRootDir, { recursive: true })

        const files = [
          join(installRootDir, 'config.json'),
          join(installRootDir, 'env.sh'),
          join(installRootDir, 'version.txt'),
        ]
        const originals = ['{"version":"original"}', 'export NODE_HOME=/original', 'v0.0.0']
        for (let i = 0; i < files.length; i++) {
          await writeFile(files[i], originals[i])
        }

        const preSnapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'pre-multi',
          type: 'auto',
          trackedPaths: files,
        })
        await updateSnapshotMeta(snapshotsDir, preSnapshot)

        // Real install (which may overwrite install root contents)
        const task = createTask({
          templateId: 'node-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            nodeManager: 'node',
            nodeVersion: '20.20.1',
            npmCacheDir,
            npmGlobalPrefix,
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'node-env',
              version: '1.0.0',
              params: {
                installRootDir,
                nodeManager: 'node',
                nodeVersion: '20.20.1',
                npmCacheDir,
                npmGlobalPrefix,
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'node-env': nodeEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt all tracked files
        for (const file of files) {
          await writeFile(file, 'corrupted')
        }

        // Rollback
        const rollbackResult = await executePersistedTaskRollback(task.id, preSnapshot.id, files, [
          installRootDir,
        ])
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.filesRestored).toBe(3)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Cleanup → install → rollback (full cycle)
// ============================================================

describe('real rollback — cleanup then install then rollback (Node.js)', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'cleanup existing → create marker → snapshot → install → corrupt → rollback',
      async () => {
        const installRootDir = join(tmpDir, 'node-full-cycle')
        const npmCacheDir = join(tmpDir, 'npm-cache-fc')
        const npmGlobalPrefix = join(tmpDir, 'npm-global-fc')

        // Create old environment
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'old.txt'), 'stale')

        // Cleanup
        await cleanupDetectedEnvironment(makeDetection('node', installRootDir))
        expect(await pathExists(installRootDir)).toBe(false)

        // Set up fresh state
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'fresh.txt')
        await writeFile(trackedFile, 'after-cleanup')

        const snapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'post-cleanup',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, snapshot)

        // Real install
        const task = createTask({
          templateId: 'node-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            nodeManager: 'node',
            nodeVersion: '20.20.1',
            npmCacheDir,
            npmGlobalPrefix,
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'node-env',
              version: '1.0.0',
              params: {
                installRootDir,
                nodeManager: 'node',
                nodeVersion: '20.20.1',
                npmCacheDir,
                npmGlobalPrefix,
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'node-env': nodeEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt tracked file
        await writeFile(trackedFile, 'corrupted-after-install')

        // Rollback to post-cleanup state
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          snapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Cleanup → install → rollback (full cycle) — Java JDK
// ============================================================

describe('real rollback — cleanup then install then rollback (Java JDK)', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'cleanup existing → create marker → snapshot → install → corrupt → rollback',
      async () => {
        const installRootDir = join(tmpDir, 'java-full-cycle')

        // Create old environment
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'old-jdk.txt'), 'stale')

        // Cleanup
        await cleanupDetectedEnvironment(makeDetection('java', installRootDir))
        expect(await pathExists(installRootDir)).toBe(false)

        // Set up fresh state
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'fresh-java.txt')
        await writeFile(trackedFile, 'after-java-cleanup')

        const snapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'post-java-cleanup',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, snapshot)

        // Real install
        const task = createTask({
          templateId: 'java-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            javaManager: 'jdk',
            javaVersion: '21',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'java-env',
              version: '1.0.0',
              params: {
                installRootDir,
                javaManager: 'jdk',
                javaVersion: '21',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'java-env': javaEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt tracked file
        await writeFile(trackedFile, 'corrupted-after-java-install')

        // Rollback to post-cleanup state
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          snapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Cleanup → install → rollback (full cycle) — Python conda
// ============================================================

describe('real rollback — cleanup then install then rollback (Python conda)', () => {
  const TIMEOUT = 600_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'cleanup existing → create marker → snapshot → install → corrupt → rollback',
      async () => {
        const installRootDir = join(tmpDir, 'python-full-cycle')

        // Create old environment
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'old-conda.txt'), 'stale')

        // Cleanup
        await cleanupDetectedEnvironment(makeDetection('python', installRootDir))
        expect(await pathExists(installRootDir)).toBe(false)

        // Set up fresh state
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'fresh-python.txt')
        await writeFile(trackedFile, 'after-python-cleanup')

        const snapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'post-python-cleanup',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, snapshot)

        // Real install
        const task = createTask({
          templateId: 'python-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            pythonManager: 'conda',
            pythonVersion: '3.12.10',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'python-env',
              version: '1.0.0',
              params: {
                installRootDir,
                pythonManager: 'conda',
                pythonVersion: '3.12.10',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'python-env': pythonEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt tracked file
        await writeFile(trackedFile, 'corrupted-after-python-install')

        // Rollback to post-cleanup state
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          snapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})

// ============================================================
// Cleanup → install → rollback (full cycle) — Git direct
// ============================================================

describe('real rollback — cleanup then install then rollback (Git direct)', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it(
      'cleanup existing → create marker → snapshot → install → corrupt → rollback',
      async () => {
        const installRootDir = join(tmpDir, 'git-full-cycle')

        // Create old environment
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'old-git.txt'), 'stale')

        // Cleanup
        await cleanupDetectedEnvironment(makeDetection('git', installRootDir))
        expect(await pathExists(installRootDir)).toBe(false)

        // Set up fresh state
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'fresh-git.txt')
        await writeFile(trackedFile, 'after-git-cleanup')

        const snapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: 'post-git-cleanup',
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, snapshot)

        // Real install
        const task = createTask({
          templateId: 'git-template',
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            gitManager: 'git',
            downloadCacheDir,
          },
          plugins: [
            {
              pluginId: 'git-env',
              version: '1.0.0',
              params: {
                installRootDir,
                gitManager: 'git',
                downloadCacheDir,
              },
            },
          ],
        })

        const result = await executeTask({
          task,
          registry: { 'git-env': gitEnvPlugin },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Corrupt tracked file
        await writeFile(trackedFile, 'corrupted-after-git-install')

        // Rollback to post-cleanup state
        const rollbackResult = await executePersistedTaskRollback(
          task.id,
          snapshot.id,
          [trackedFile],
          [installRootDir],
        )
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.envVariablesRestored).toBeGreaterThan(0)
        expect(rollbackResult.directoriesRemoved).toBe(1)
        expect(await pathExists(installRootDir)).toBe(false)
      },
      TIMEOUT,
    )
  })
})
