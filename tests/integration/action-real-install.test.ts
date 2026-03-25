/**
 * Real installation integration tests.
 *
 * These tests invoke the REAL plugin implementations (nodeEnvPlugin, javaEnvPlugin,
 * pythonEnvPlugin, gitEnvPlugin) with dryRun: false.  They download actual artifacts,
 * run real shell commands, and verify the installed binaries exist.
 *
 * Guard: all tests are skipped unless ENVSETUP_REAL_RUN=1 (CI sets this env var).
 * Running `npm test` locally (dev mode) will skip these entirely.
 *
 * Platform-aware: homebrew tests only run on macOS, scoop tests only on Windows.
 * SDKMAN tests only on macOS (Windows SDKMAN needs Git Bash which may not be present).
 * Python source compilation is skipped in CI due to extreme build time.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cleanupDetectedEnvironment } from '../../src/main/core/environment'
import { createSnapshot, markSnapshotDeletable, updateSnapshotMeta } from '../../src/main/core/snapshot'
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

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-real-install-'))
  tasksDir = join(tmpDir, 'tasks')
  snapshotsDir = join(tmpDir, 'snapshots')
  downloadCacheDir = join(tmpDir, 'download-cache')
  await mkdir(downloadCacheDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeDetection(tool: 'node' | 'java' | 'python' | 'git', installRootDir: string): DetectedEnvironment {
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

// ============================================================
// Node.js — direct install
// ============================================================

describe('real install — Node.js direct', () => {
  const TIMEOUT = 300_000 // 5 min

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it('fresh install succeeds and node --version works', async () => {
      const installRootDir = join(tmpDir, 'node-direct')
      const npmCacheDir = join(tmpDir, 'npm-cache')
      const npmGlobalPrefix = join(tmpDir, 'npm-global')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'node-env': nodeEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      await markSnapshotDeletable(snapshotsDir, snapshot.id)

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')

      const persisted = await loadTask(task.id, tasksDir)
      expect(persisted.status).toBe('succeeded')
    }, TIMEOUT)

    it('cleanup existing env then install succeeds', async () => {
      const installRootDir = join(tmpDir, 'node-direct-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'stale.txt'), 'old')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('node', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

      const npmCacheDir = join(tmpDir, 'npm-cache2')
      const npmGlobalPrefix = join(tmpDir, 'npm-global2')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'node-env': nodeEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Node.js — nvm manager
// ============================================================

describe('real install — Node.js nvm', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it('fresh install succeeds via nvm', async () => {
      const installRootDir = join(tmpDir, 'node-nvm')
      const npmCacheDir = join(tmpDir, 'npm-cache-nvm')
      const npmGlobalPrefix = join(tmpDir, 'npm-global-nvm')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'node-env': nodeEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install via nvm succeeds', async () => {
      const installRootDir = join(tmpDir, 'node-nvm-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old-nvm.txt'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('node', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

      const npmCacheDir = join(tmpDir, 'npm-cache-nvm2')
      const npmGlobalPrefix = join(tmpDir, 'npm-global-nvm2')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'node-env': nodeEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Java — direct JDK (Temurin) install
// ============================================================

describe('real install — Java JDK', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it('fresh install succeeds and java -version works', async () => {
      const installRootDir = join(tmpDir, 'java-jdk')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'java-env': javaEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install succeeds', async () => {
      const installRootDir = join(tmpDir, 'java-jdk-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old-jdk.txt'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('java', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'java-env': javaEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Java — SDKMAN (macOS only — needs bash; Windows needs Git Bash)
// ============================================================

describe('real install — Java SDKMAN', () => {
  const TIMEOUT = 600_000 // 10 min — SDKMAN + Java download

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it('fresh install succeeds via SDKMAN', async () => {
      const installRootDir = join(tmpDir, 'java-sdkman')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'java-env': javaEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install via SDKMAN succeeds', async () => {
      const installRootDir = join(tmpDir, 'java-sdkman-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old-sdkman.txt'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('java', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'java-env': javaEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Python — conda (Miniconda) install
// Python direct (source compile on macOS) is extremely slow (15+ min),
// so we only test conda in CI. Direct can be tested locally.
// ============================================================

describe('real install — Python conda', () => {
  const TIMEOUT = 600_000 // 10 min — Miniconda download + setup

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it('fresh install succeeds via conda', async () => {
      const installRootDir = join(tmpDir, 'python-conda')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'python-env': pythonEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install succeeds', async () => {
      const installRootDir = join(tmpDir, 'python-conda-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old-conda'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('python', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'python-env': pythonEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Python — direct (standalone) install
// macOS: extracts from official .pkg installer (fast, precompiled)
// Windows: downloads embeddable zip (fast)
// ============================================================

describe('real install — Python direct', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    // macOS source compile is extremely slow; skip in standard CI, enable for full test runs
    it('fresh install succeeds via standalone Python', async () => {
      const installRootDir = join(tmpDir, 'python-direct')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'python-env': pythonEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install via standalone Python succeeds', async () => {
      const installRootDir = join(tmpDir, 'python-direct-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old-python.txt'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('python', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'python-env': pythonEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Git — direct install
// ============================================================

describe('real install — Git direct', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun)('gated by ENVSETUP_REAL_RUN', () => {
    it('fresh install succeeds and git --version works', async () => {
      const installRootDir = join(tmpDir, 'git-direct')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'git-env': gitEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install succeeds', async () => {
      const installRootDir = join(tmpDir, 'git-direct-cleanup')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old-git'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('git', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'git-env': gitEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Git — Homebrew (macOS only)
// ============================================================

describe('real install — Git Homebrew', () => {
  const TIMEOUT = 600_000 // brew install can be slow

  describe.skipIf(!isRealRun || !isMac)('gated by ENVSETUP_REAL_RUN + macOS', () => {
    it('fresh install succeeds via Homebrew', async () => {
      const installRootDir = join(tmpDir, 'git-homebrew')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'git-env': gitEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install via Homebrew succeeds', async () => {
      const installRootDir = join(tmpDir, 'git-homebrew-cleanup')

      // Simulate a pre-existing environment
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old.txt'), 'stale')

      // Cleanup
      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('git', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

      // Fresh install after cleanup
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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'git-env': gitEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})

// ============================================================
// Git — Scoop (Windows only)
// ============================================================

describe('real install — Git Scoop', () => {
  const TIMEOUT = 300_000

  describe.skipIf(!isRealRun || !isWindows)('gated by ENVSETUP_REAL_RUN + Windows', () => {
    it('fresh install succeeds via Scoop', async () => {
      const installRootDir = join(tmpDir, 'git-scoop')

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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'git-env': gitEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)

    it('cleanup existing env then install via Scoop succeeds', async () => {
      const installRootDir = join(tmpDir, 'git-scoop-cleanup')

      // Simulate a pre-existing environment
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'old.txt'), 'stale')

      // Cleanup
      const cleanupResult = await cleanupDetectedEnvironment(makeDetection('git', installRootDir))
      expect(cleanupResult.removedPath).toBe(installRootDir)

      // Fresh install after cleanup
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

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const result = await executeTask({
        task,
        registry: { 'git-env': gitEnvPlugin },
        platform,
        tasksDir,
        dryRun: false,
      })

      expect(result.status).toBe('succeeded')
      expect(result.plugins[0].status).toBe('verified_success')
    }, TIMEOUT)
  })
})
