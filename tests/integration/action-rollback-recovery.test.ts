import { constants } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  AppPlatform,
  PluginExecutionInput,
  PluginInstallResult,
  PluginLifecycle,
  PluginVerifyResult,
} from '../../src/main/core/contracts'
import { executeRollback, suggestRollbackSnapshots } from '../../src/main/core/rollback'
import { createSnapshot, updateSnapshotMeta } from '../../src/main/core/snapshot'
import { createTask, executeTask, loadTask } from '../../src/main/core/task'
import { cleanupDetectedEnvironment } from '../../src/main/core/environment'
import type { DetectedEnvironment } from '../../src/main/core/contracts'

import nodeEnvPlugin from '../../src/main/plugins/nodeEnvPlugin'
import javaEnvPlugin from '../../src/main/plugins/javaEnvPlugin'
import pythonEnvPlugin from '../../src/main/plugins/pythonEnvPlugin'
import gitEnvPlugin from '../../src/main/plugins/gitEnvPlugin'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const platform: AppPlatform = process.platform as AppPlatform

let tmpDir: string
let tasksDir: string
let snapshotsDir: string
let homeDir: string
let previousHome: string | undefined
let previousUserProfile: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-rollback-flow-'))
  tasksDir = join(tmpDir, 'tasks')
  snapshotsDir = join(tmpDir, 'snapshots')
  homeDir = join(tmpDir, 'home')
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

function normalizeCleanupPath(targetPath: string | undefined): string | undefined {
  if (!targetPath) {
    return targetPath
  }

  if (process.platform === 'darwin') {
    return targetPath.replace(/^\/private(?=\/var\/)/, '')
  }

  return targetPath
}

function expectRemovedPath(actualPath: string | undefined, expectedPath: string): void {
  expect(normalizeCleanupPath(actualPath)).toBe(normalizeCleanupPath(expectedPath))
}

// ============================================================
// Helper: make a failing plugin that mutates tracked files
// ============================================================

type ToolCase = {
  tool: 'node' | 'java' | 'python' | 'git'
  managerKey: string
  manager: string
  versionKey: string
  pluginId: string
  templateId: string
}

const allCases: ToolCase[] = [
  {
    tool: 'node',
    managerKey: 'nodeManager',
    manager: 'node',
    versionKey: 'nodeVersion',
    pluginId: 'node-env',
    templateId: 'node-template',
  },
  {
    tool: 'node',
    managerKey: 'nodeManager',
    manager: 'nvm',
    versionKey: 'nodeVersion',
    pluginId: 'node-env',
    templateId: 'node-template',
  },
  {
    tool: 'java',
    managerKey: 'javaManager',
    manager: 'jdk',
    versionKey: 'javaVersion',
    pluginId: 'java-env',
    templateId: 'java-template',
  },
  {
    tool: 'java',
    managerKey: 'javaManager',
    manager: 'sdkman',
    versionKey: 'javaVersion',
    pluginId: 'java-env',
    templateId: 'java-template',
  },
  {
    tool: 'python',
    managerKey: 'pythonManager',
    manager: 'python',
    versionKey: 'pythonVersion',
    pluginId: 'python-env',
    templateId: 'python-template',
  },
  {
    tool: 'python',
    managerKey: 'pythonManager',
    manager: 'conda',
    versionKey: 'pythonVersion',
    pluginId: 'python-env',
    templateId: 'python-template',
  },
  {
    tool: 'git',
    managerKey: 'gitManager',
    manager: 'git',
    versionKey: 'gitVersion',
    pluginId: 'git-env',
    templateId: 'git-template',
  },
  {
    tool: 'git',
    managerKey: 'gitManager',
    manager: 'homebrew',
    versionKey: 'gitVersion',
    pluginId: 'git-env',
    templateId: 'git-template',
  },
  {
    tool: 'git',
    managerKey: 'gitManager',
    manager: 'scoop',
    versionKey: 'gitVersion',
    pluginId: 'git-env',
    templateId: 'git-template',
  },
].filter((c) => {
  if (c.manager === 'homebrew' && process.platform !== 'darwin') return false
  if (c.manager === 'scoop' && process.platform !== 'win32') return false
  return true
})

function makeFailingPlugin(tool: string, manager: string, trackedFiles: string[]): PluginLifecycle {
  return {
    install: async (_input: PluginExecutionInput): Promise<PluginInstallResult> => {
      // Mutate all tracked files during install to simulate partial writes
      for (const filePath of trackedFiles) {
        await writeFile(filePath, `broken-by-${tool}-${manager}`)
      }
      return {
        status: 'installed_unverified',
        executionMode: 'real_run',
        version: '1.0.0',
        paths: { installRootDir: trackedFiles[0] ? join(trackedFiles[0], '..') : '' },
        envChanges: [
          {
            kind: 'env',
            key: `${tool.toUpperCase()}_HOME`,
            value: '/tmp/broken',
            scope: 'user',
            description: `${tool} home (broken)`,
          },
        ],
        downloads: [],
        commands: [`install ${tool} via ${manager}`],
        logs: [`installed ${tool} via ${manager} (will fail verify)`],
        summary: `Installed ${tool} via ${manager} (broken)`,
      }
    },
    verify: async (
      _input: PluginExecutionInput & { installResult: PluginInstallResult },
    ): Promise<PluginVerifyResult> => ({
      status: 'failed',
      checks: [`${tool}-${manager} verify failed intentionally`],
      error: `verification of ${tool} via ${manager} failed intentionally`,
    }),
  }
}

function makeSuccessPlugin(tool: string, manager: string): PluginLifecycle {
  return {
    install: async (input: PluginExecutionInput): Promise<PluginInstallResult> => {
      const installRootDir = String(input.installRootDir)
      const markerPath = join(installRootDir, `${tool}-${manager}.installed`)
      await mkdir(installRootDir, { recursive: true })
      await writeFile(markerPath, `${tool}:${manager}`)
      return {
        status: 'installed_unverified',
        executionMode: 'real_run',
        version: String(
          input.version ??
            input.nodeVersion ??
            input.javaVersion ??
            input.pythonVersion ??
            input.gitVersion ??
            '1.0.0',
        ),
        paths: { installRootDir, markerPath },
        envChanges: [
          {
            kind: 'env',
            key: `${tool.toUpperCase()}_HOME`,
            value: installRootDir,
            scope: 'user',
            description: `${tool} home`,
          },
        ],
        downloads: [],
        commands: [`install ${tool} via ${manager}`],
        logs: [`installed ${tool} via ${manager}`],
        summary: `Installed ${tool} via ${manager}`,
      }
    },
    verify: async (
      input: PluginExecutionInput & { installResult: PluginInstallResult },
    ): Promise<PluginVerifyResult> => {
      const markerPath = String(input.installResult.paths.markerPath)
      const content = await readFile(markerPath, 'utf8')
      return {
        status: content === `${tool}:${manager}` ? 'verified_success' : 'failed',
        checks: [`verified ${markerPath}`],
        error: content === `${tool}:${manager}` ? undefined : 'marker mismatch',
      }
    },
  }
}

function makeDetection(tool: ToolCase['tool'], installRootDir: string): DetectedEnvironment {
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function executePersistedTaskRollback(options: {
  snapshotsDir: string
  tasksDir: string
  taskId: string
  snapshotId: string
  trackedPaths: string[]
  installPaths?: string[]
}) {
  const task = await loadTask(options.taskId, options.tasksDir)
  const rollbackCommands = [
    ...new Set(task.plugins.flatMap((plugin) => plugin.lastResult?.rollbackCommands ?? [])),
  ]

  return executeRollback(
    options.snapshotsDir,
    options.snapshotId,
    options.trackedPaths,
    options.installPaths,
    { rollbackCommands },
  )
}

function expectNoUnexpectedRollbackErrors(
  rollbackResult: Awaited<ReturnType<typeof executeRollback>>,
) {
  const unexpectedErrors = rollbackResult.errors.filter(
    (error) => error.path !== 'environment' && error.path !== 'shellConfigs',
  )
  expect(unexpectedErrors).toHaveLength(0)
}

// ============================================================
// Test suite: rollback recovery for ALL tools × install modes
// ============================================================

describe('action rollback recovery integration', () => {
  describe.each(allCases)(
    '$tool via $manager — rollback after failed install',
    ({ tool, managerKey, manager, versionKey, pluginId, templateId }) => {
      it('rolls back single tracked file after failed execution', async () => {
        const installRootDir = join(tmpDir, `${tool}-${manager}-rollback`)
        const trackedFile = join(installRootDir, 'state.txt')
        await mkdir(installRootDir, { recursive: true })
        await writeFile(trackedFile, 'before-install')

        const task = createTask({
          templateId,
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            [managerKey]: manager,
            [versionKey]: '1.0.0',
          },
          plugins: [
            {
              pluginId,
              version: '1.0.0',
              params: {
                installRootDir,
                [managerKey]: manager,
                [versionKey]: '1.0.0',
              },
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

        const failedTask = await executeTask({
          task,
          registry: { [pluginId]: makeFailingPlugin(tool, manager, [trackedFile]) },
          platform,
          tasksDir,
          dryRun: false,
        })

        // Verify the task failed
        expect(failedTask.status).toBe('failed')
        expect(failedTask.plugins[0].status).not.toBe('verified_success')

        // Verify the file was mutated during install
        expect(await readFile(trackedFile, 'utf8')).toBe(`broken-by-${tool}-${manager}`)

        // Verify persisted state is also failed
        const persisted = await loadTask(task.id, tasksDir)
        expect(persisted.status).toBe('failed')

        // Get rollback suggestions
        const suggestions = await suggestRollbackSnapshots(snapshotsDir, task.id)
        expect(suggestions.length).toBeGreaterThanOrEqual(1)
        expect(suggestions[0].snapshotId).toBe(snapshot.id)
        expect(suggestions[0].confidence).toBe('high')

        // Execute rollback
        const rollbackResult = await executePersistedTaskRollback({
          snapshotsDir,
          tasksDir,
          taskId: task.id,
          snapshotId: snapshot.id,
          trackedPaths: [trackedFile],
        })
        expect(rollbackResult.filesRestored).toBe(1)
        expectNoUnexpectedRollbackErrors(rollbackResult)

        // Verify file content is restored
        expect(await readFile(trackedFile, 'utf8')).toBe('before-install')
      })

      it('rolls back multiple tracked files after failed execution', async () => {
        const installRootDir = join(tmpDir, `${tool}-${manager}-multi-rollback`)
        const files = [
          join(installRootDir, 'config.json'),
          join(installRootDir, 'env.sh'),
          join(installRootDir, 'version.txt'),
        ]
        const originalContents = [
          `{"tool":"${tool}","version":"original"}`,
          `export ${tool.toUpperCase()}_HOME=/original`,
          'v0.0.0',
        ]

        await mkdir(installRootDir, { recursive: true })
        for (let i = 0; i < files.length; i++) {
          await writeFile(files[i], originalContents[i])
        }

        const task = createTask({
          templateId,
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            [managerKey]: manager,
            [versionKey]: '1.0.0',
          },
          plugins: [
            {
              pluginId,
              version: '1.0.0',
              params: {
                installRootDir,
                [managerKey]: manager,
                [versionKey]: '1.0.0',
              },
            },
          ],
        })

        const snapshot = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: task.id,
          type: 'auto',
          trackedPaths: files,
        })
        await updateSnapshotMeta(snapshotsDir, snapshot)

        const failedTask = await executeTask({
          task,
          registry: { [pluginId]: makeFailingPlugin(tool, manager, files) },
          platform,
          tasksDir,
          dryRun: false,
        })

        expect(failedTask.status).toBe('failed')

        // All files should be mutated
        for (const file of files) {
          expect(await readFile(file, 'utf8')).toBe(`broken-by-${tool}-${manager}`)
        }

        // Rollback all files
        const rollbackResult = await executePersistedTaskRollback({
          snapshotsDir,
          tasksDir,
          taskId: task.id,
          snapshotId: snapshot.id,
          trackedPaths: files,
        })
        expect(rollbackResult.filesRestored).toBe(3)
        expectNoUnexpectedRollbackErrors(rollbackResult)

        // Verify all files restored to original content
        for (let i = 0; i < files.length; i++) {
          expect(await readFile(files[i], 'utf8')).toBe(originalContents[i])
        }
      })
    },
  )

  // ============================================================
  // Rollback + re-install flow: rollback after failure, then install successfully
  // ============================================================

  describe.each(allCases)(
    '$tool via $manager — rollback then successful re-install',
    ({ tool, managerKey, manager, versionKey, pluginId, templateId }) => {
      it('can successfully install after rolling back a failed attempt', async () => {
        const installRootDir = join(tmpDir, `${tool}-${manager}-reinstall`)
        const trackedFile = join(installRootDir, 'state.txt')
        await mkdir(installRootDir, { recursive: true })
        await writeFile(trackedFile, 'pristine')

        // Phase 1: Create snapshot, run failing install, rollback
        const task1 = createTask({
          templateId,
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            [managerKey]: manager,
            [versionKey]: '1.0.0',
          },
          plugins: [
            {
              pluginId,
              version: '1.0.0',
              params: {
                installRootDir,
                [managerKey]: manager,
                [versionKey]: '1.0.0',
              },
            },
          ],
        })

        const snapshot1 = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: task1.id,
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, snapshot1)

        const failedTask = await executeTask({
          task: task1,
          registry: { [pluginId]: makeFailingPlugin(tool, manager, [trackedFile]) },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(failedTask.status).toBe('failed')

        // Rollback
        const rollbackResult = await executePersistedTaskRollback({
          snapshotsDir,
          tasksDir,
          taskId: task1.id,
          snapshotId: snapshot1.id,
          trackedPaths: [trackedFile],
        })
        expectNoUnexpectedRollbackErrors(rollbackResult)
        expect(await readFile(trackedFile, 'utf8')).toBe('pristine')

        // Phase 2: Successful install after rollback
        const task2 = createTask({
          templateId,
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            [managerKey]: manager,
            [versionKey]: '1.0.0',
          },
          plugins: [
            {
              pluginId,
              version: '1.0.0',
              params: {
                installRootDir,
                [managerKey]: manager,
                [versionKey]: '1.0.0',
              },
            },
          ],
        })

        const snapshot2 = await createSnapshot({
          baseDir: snapshotsDir,
          taskId: task2.id,
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(snapshotsDir, snapshot2)

        const successTask = await executeTask({
          task: task2,
          registry: { [pluginId]: makeSuccessPlugin(tool, manager) },
          platform,
          tasksDir,
          dryRun: false,
        })

        expect(successTask.status).toBe('succeeded')
        expect(successTask.plugins[0].status).toBe('verified_success')

        const markerPath = join(installRootDir, `${tool}-${manager}.installed`)
        expect(await readFile(markerPath, 'utf8')).toBe(`${tool}:${manager}`)
      })
    },
  )

  // ============================================================
  // Cleanup existing environment → install → fail → rollback
  // ============================================================

  describe.each(allCases)(
    '$tool via $manager — cleanup existing env, install, fail, rollback',
    ({ tool, managerKey, manager, versionKey, pluginId, templateId }) => {
      it('cleans existing env, fails install, then rolls back successfully', async () => {
        // Setup: create an existing environment
        const installRootDir = join(tmpDir, `${tool}-${manager}-cleanup-rollback`)
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'existing.txt'), 'old-install')

        // Cleanup existing env
        const cleanupResult = await cleanupDetectedEnvironment(makeDetection(tool, installRootDir))
        expectRemovedPath(cleanupResult.removedPath, installRootDir)
        expect(await pathExists(installRootDir)).toBe(false)

        // Recreate directory and a new tracked file for fresh install
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'new-state.txt')
        await writeFile(trackedFile, 'fresh-start')

        const task = createTask({
          templateId,
          templateVersion: '1.0.0',
          params: {
            installRootDir,
            [managerKey]: manager,
            [versionKey]: '1.0.0',
          },
          plugins: [
            {
              pluginId,
              version: '1.0.0',
              params: {
                installRootDir,
                [managerKey]: manager,
                [versionKey]: '1.0.0',
              },
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

        // Run failing install
        const failedTask = await executeTask({
          task,
          registry: { [pluginId]: makeFailingPlugin(tool, manager, [trackedFile]) },
          platform,
          tasksDir,
          dryRun: false,
        })
        expect(failedTask.status).toBe('failed')
        expect(await readFile(trackedFile, 'utf8')).toBe(`broken-by-${tool}-${manager}`)

        // Rollback to fresh-start state
        const rollbackResult = await executePersistedTaskRollback({
          snapshotsDir,
          tasksDir,
          taskId: task.id,
          snapshotId: snapshot.id,
          trackedPaths: [trackedFile],
        })
        expectNoUnexpectedRollbackErrors(rollbackResult)
        expect(rollbackResult.filesRestored).toBe(1)
        expect(await readFile(trackedFile, 'utf8')).toBe('fresh-start')
      })
    },
  )

  // ============================================================
  // Rollback suggestion confidence scoring
  // ============================================================

  describe('rollback suggestion confidence', () => {
    it('ranks same-task auto snapshots as high confidence', async () => {
      const installRootDir = join(tmpDir, 'confidence-test')
      const trackedFile = join(installRootDir, 'state.txt')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(trackedFile, 'original')

      const task = createTask({
        templateId: 'node-template',
        templateVersion: '1.0.0',
        params: { installRootDir, nodeManager: 'node', nodeVersion: '20.0.0' },
        plugins: [
          {
            pluginId: 'node-env',
            version: '1.0.0',
            params: { installRootDir, nodeManager: 'node', nodeVersion: '20.0.0' },
          },
        ],
      })

      const autoSnapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [trackedFile],
      })
      await updateSnapshotMeta(snapshotsDir, autoSnapshot)

      const manualSnapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'manual',
        label: 'manual backup',
        trackedPaths: [trackedFile],
      })
      await updateSnapshotMeta(snapshotsDir, manualSnapshot)

      const suggestions = await suggestRollbackSnapshots(snapshotsDir, task.id)

      // Auto snapshot should be high, manual should be low
      const autoSuggestion = suggestions.find((s) => s.snapshotId === autoSnapshot.id)
      const manualSuggestion = suggestions.find((s) => s.snapshotId === manualSnapshot.id)

      expect(autoSuggestion).toBeDefined()
      expect(autoSuggestion!.confidence).toBe('high')
      expect(manualSuggestion).toBeDefined()
      expect(manualSuggestion!.confidence).toBe('low')
    })

    it('ranks conflict-category suggestions correctly', async () => {
      const installRootDir = join(tmpDir, 'conflict-confidence')
      await mkdir(installRootDir, { recursive: true })

      // Create snapshot from a different task (pre-existing state)
      const otherTask = createTask({
        templateId: 'java-template',
        templateVersion: '1.0.0',
        params: { installRootDir },
        plugins: [{ pluginId: 'java-env', version: '1.0.0', params: { installRootDir } }],
      })

      const otherSnapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: otherTask.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, otherSnapshot)

      // Create snapshot from current task
      const currentTask = createTask({
        templateId: 'node-template',
        templateVersion: '1.0.0',
        params: { installRootDir },
        plugins: [{ pluginId: 'node-env', version: '1.0.0', params: { installRootDir } }],
      })

      const currentSnapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: currentTask.id,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(snapshotsDir, currentSnapshot)

      // For conflict failures, pre-task (other) snapshots should rank higher
      const suggestions = await suggestRollbackSnapshots(snapshotsDir, currentTask.id, {
        category: 'conflict',
        message: 'File conflict detected',
        retryable: false,
      })

      expect(suggestions.length).toBeGreaterThanOrEqual(2)
      // First suggestion should be from the other task (high confidence for conflict)
      expect(suggestions[0].snapshotId).toBe(otherSnapshot.id)
      expect(suggestions[0].confidence).toBe('high')
    })
  })

  // ============================================================
  // Edge cases
  // ============================================================

  describe('rollback edge cases', () => {
    it('handles rollback when tracked file has been deleted', async () => {
      const installRootDir = join(tmpDir, 'deleted-file-rollback')
      const trackedFile = join(installRootDir, 'will-be-deleted.txt')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(trackedFile, 'exists-before-install')

      const task = createTask({
        templateId: 'git-template',
        templateVersion: '1.0.0',
        params: { installRootDir, gitManager: 'git' },
        plugins: [
          {
            pluginId: 'git-env',
            version: '1.0.0',
            params: { installRootDir, gitManager: 'git' },
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

      // Plugin deletes the file during install
      const deletingPlugin: PluginLifecycle = {
        install: async (): Promise<PluginInstallResult> => {
          await rm(trackedFile, { force: true })
          return {
            status: 'installed_unverified',
            executionMode: 'real_run',
            version: '1.0.0',
            paths: { installRootDir },
            envChanges: [],
            downloads: [],
            commands: ['delete file'],
            logs: ['deleted tracked file'],
            summary: 'deleted file',
          }
        },
        verify: async (): Promise<PluginVerifyResult> => ({
          status: 'failed',
          checks: ['file missing'],
          error: 'expected file was deleted',
        }),
      }

      const failedTask = await executeTask({
        task,
        registry: { 'git-env': deletingPlugin },
        platform: 'darwin',
        tasksDir,
        dryRun: false,
      })
      expect(failedTask.status).toBe('failed')
      expect(await pathExists(trackedFile)).toBe(false)

      // Rollback should restore the deleted file
      const rollbackResult = await executePersistedTaskRollback({
        snapshotsDir,
        tasksDir,
        taskId: task.id,
        snapshotId: snapshot.id,
        trackedPaths: [trackedFile],
      })
      expectNoUnexpectedRollbackErrors(rollbackResult)
      expect(rollbackResult.filesRestored).toBe(1)
      expect(await readFile(trackedFile, 'utf8')).toBe('exists-before-install')
    })

    it('returns empty suggestions when no snapshots match the task', async () => {
      const suggestions = await suggestRollbackSnapshots(snapshotsDir, 'nonexistent-task-id')
      expect(suggestions).toHaveLength(0)
    })

    it('rollback with empty tracked paths list uses full mode', async () => {
      const installRootDir = join(tmpDir, 'full-mode-rollback')
      const trackedFile = join(installRootDir, 'data.txt')
      await mkdir(installRootDir, { recursive: true })
      await writeFile(trackedFile, 'original-full')

      const task = createTask({
        templateId: 'python-template',
        templateVersion: '1.0.0',
        params: { installRootDir, pythonManager: 'python', pythonVersion: '3.12' },
        plugins: [
          {
            pluginId: 'python-env',
            version: '1.0.0',
            params: { installRootDir, pythonManager: 'python', pythonVersion: '3.12' },
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

      await writeFile(trackedFile, 'mutated-full')

      // Rollback with empty array → full mode (restores all files in snapshot)
      const rollbackResult = await executeRollback(snapshotsDir, snapshot.id, [])
      expectNoUnexpectedRollbackErrors(rollbackResult)
      expect(rollbackResult.filesRestored).toBe(1)
      expect(await readFile(trackedFile, 'utf8')).toBe('original-full')
    })
  })
})

// ============================================================
// Real plugin rollback tests — gated by ENVSETUP_REAL_RUN
// ============================================================

type RealRollbackCase = {
  label: string
  tool: 'node' | 'java' | 'python' | 'git'
  pluginId: string
  plugin: PluginLifecycle
  templateId: string
  buildParams: (tmpBase: string, downloadCacheDir: string) => Record<string, string>
}

const realRollbackCases: RealRollbackCase[] = [
  {
    label: 'Node.js direct',
    tool: 'node',
    pluginId: 'node-env',
    plugin: nodeEnvPlugin,
    templateId: 'node-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'node-rb'),
      nodeManager: 'node',
      nodeVersion: '20.20.1',
      npmCacheDir: join(t, 'npm-c'),
      npmGlobalPrefix: join(t, 'npm-g'),
      downloadCacheDir: d,
    }),
  },
  {
    label: 'Node.js nvm',
    tool: 'node',
    pluginId: 'node-env',
    plugin: nodeEnvPlugin,
    templateId: 'node-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'nvm-rb'),
      nodeManager: 'nvm',
      nodeVersion: '20.20.1',
      npmCacheDir: join(t, 'npm-c2'),
      npmGlobalPrefix: join(t, 'npm-g2'),
      downloadCacheDir: d,
    }),
  },
  {
    label: 'Java JDK',
    tool: 'java',
    pluginId: 'java-env',
    plugin: javaEnvPlugin,
    templateId: 'java-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'java-rb'),
      javaManager: 'jdk',
      javaVersion: '21',
      downloadCacheDir: d,
    }),
  },
  {
    label: 'Java SDKMAN',
    tool: 'java',
    pluginId: 'java-env',
    plugin: javaEnvPlugin,
    templateId: 'java-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'sdkman-rb'),
      javaManager: 'sdkman',
      javaVersion: '21',
      downloadCacheDir: d,
    }),
  },
  {
    label: 'Python conda',
    tool: 'python',
    pluginId: 'python-env',
    plugin: pythonEnvPlugin,
    templateId: 'python-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'conda-rb'),
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      downloadCacheDir: d,
    }),
  },
  {
    label: 'Python direct',
    tool: 'python',
    pluginId: 'python-env',
    plugin: pythonEnvPlugin,
    templateId: 'python-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'pydirect-rb'),
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      downloadCacheDir: d,
    }),
  },
  {
    label: 'Git direct',
    tool: 'git',
    pluginId: 'git-env',
    plugin: gitEnvPlugin,
    templateId: 'git-template',
    buildParams: (t, d) => ({
      installRootDir: join(t, 'git-rb'),
      gitManager: 'git',
      downloadCacheDir: d,
    }),
  },
  ...(process.platform === 'darwin'
    ? [
        {
          label: 'Git Homebrew',
          tool: 'git' as const,
          pluginId: 'git-env',
          plugin: gitEnvPlugin,
          templateId: 'git-template',
          buildParams: (t: string, d: string) => ({
            installRootDir: join(t, 'brew-rb'),
            gitManager: 'homebrew',
            downloadCacheDir: d,
          }),
        },
      ]
    : []),
  ...(process.platform === 'win32'
    ? [
        {
          label: 'Git Scoop',
          tool: 'git' as const,
          pluginId: 'git-env',
          plugin: gitEnvPlugin,
          templateId: 'git-template',
          buildParams: (t: string, d: string) => ({
            installRootDir: join(t, 'scoop-rb'),
            gitManager: 'scoop',
            downloadCacheDir: d,
          }),
        },
      ]
    : []),
]

describe.skipIf(!isRealRun)('action rollback recovery — real plugins', () => {
  const TIMEOUT = 600_000
  let realTmpDir: string
  let realTasksDir: string
  let realSnapshotsDir: string
  let realDownloadCacheDir: string

  beforeEach(async () => {
    realTmpDir = await mkdtemp(join(tmpdir(), 'envsetup-real-rb-'))
    realTasksDir = join(realTmpDir, 'tasks')
    realSnapshotsDir = join(realTmpDir, 'snapshots')
    realDownloadCacheDir = join(realTmpDir, 'download-cache')
    await mkdir(realDownloadCacheDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(realTmpDir, { recursive: true, force: true })
  })

  describe.each(realRollbackCases)('$label — real install then rollback', (rc) => {
    it(
      'install → rollback removes installed directory',
      async () => {
        const params = rc.buildParams(realTmpDir, realDownloadCacheDir)
        const installRootDir = params.installRootDir

        const task = createTask({
          templateId: rc.templateId,
          templateVersion: '1.0.0',
          params,
          plugins: [{ pluginId: rc.pluginId, version: '1.0.0', params }],
        })

        const trackedFile = join(installRootDir, 'track.txt')
        await mkdir(installRootDir, { recursive: true })
        await writeFile(trackedFile, 'before-install')

        const snapshot = await createSnapshot({
          baseDir: realSnapshotsDir,
          taskId: task.id,
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(realSnapshotsDir, snapshot)

        const result = await executeTask({
          task,
          registry: { [rc.pluginId]: rc.plugin },
          platform,
          tasksDir: realTasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Rollback with directory cleanup
        const rollbackResult = await executePersistedTaskRollback({
          snapshotsDir: realSnapshotsDir,
          tasksDir: realTasksDir,
          taskId: task.id,
          snapshotId: snapshot.id,
          trackedPaths: [trackedFile],
          installPaths: [installRootDir],
        })
        expectNoUnexpectedRollbackErrors(rollbackResult)
        expect(rollbackResult.directoriesRemoved).toBe(1)

        // Verify installed directory is removed
        try {
          await access(installRootDir, constants.F_OK)
          expect.unreachable('installRootDir should have been removed')
        } catch {
          // expected — directory does not exist
        }
      },
      TIMEOUT,
    )

    it(
      'cleanup existing → install → rollback removes directory',
      async () => {
        const params = rc.buildParams(realTmpDir, realDownloadCacheDir)
        const installRootDir = params.installRootDir

        // Create old environment
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'old.txt'), 'stale')

        // Cleanup
        await cleanupDetectedEnvironment({
          id: `${rc.tool}:managed_root:test:${installRootDir}`,
          tool: rc.tool,
          kind: 'managed_root',
          path: installRootDir,
          source: 'test',
          cleanupSupported: true,
          cleanupPath: installRootDir,
        })

        // Fresh state
        await mkdir(installRootDir, { recursive: true })
        const trackedFile = join(installRootDir, 'fresh.txt')
        await writeFile(trackedFile, 'after-cleanup')

        const task = createTask({
          templateId: rc.templateId,
          templateVersion: '1.0.0',
          params,
          plugins: [{ pluginId: rc.pluginId, version: '1.0.0', params }],
        })

        const snapshot = await createSnapshot({
          baseDir: realSnapshotsDir,
          taskId: task.id,
          type: 'auto',
          trackedPaths: [trackedFile],
        })
        await updateSnapshotMeta(realSnapshotsDir, snapshot)

        const result = await executeTask({
          task,
          registry: { [rc.pluginId]: rc.plugin },
          platform,
          tasksDir: realTasksDir,
          dryRun: false,
        })
        expect(result.status).toBe('succeeded')

        // Rollback with directory cleanup
        const rollbackResult = await executePersistedTaskRollback({
          snapshotsDir: realSnapshotsDir,
          tasksDir: realTasksDir,
          taskId: task.id,
          snapshotId: snapshot.id,
          trackedPaths: [trackedFile],
          installPaths: [installRootDir],
        })
        expectNoUnexpectedRollbackErrors(rollbackResult)
        expect(rollbackResult.directoriesRemoved).toBe(1)

        try {
          await access(installRootDir, constants.F_OK)
          expect.unreachable('installRootDir should have been removed')
        } catch {
          // expected
        }
      },
      TIMEOUT,
    )
  })
})
