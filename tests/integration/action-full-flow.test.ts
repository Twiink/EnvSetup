/**
 * 覆盖 CI 场景下完整的安装、清理与回滚集成流程。
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  AppPlatform,
  DetectedEnvironment,
  PluginExecutionInput,
  PluginInstallResult,
  PluginLifecycle,
  PluginVerifyResult,
} from '../../src/main/core/contracts'
import { cleanupDetectedEnvironment } from '../../src/main/core/environment'
import {
  createSnapshot,
  markSnapshotDeletable,
  updateSnapshotMeta,
} from '../../src/main/core/snapshot'
import { createTask, executeTask, loadTask } from '../../src/main/core/task'

import nodeEnvPlugin from '../../src/main/plugins/nodeEnvPlugin'
import javaEnvPlugin from '../../src/main/plugins/javaEnvPlugin'
import pythonEnvPlugin from '../../src/main/plugins/pythonEnvPlugin'
import gitEnvPlugin from '../../src/main/plugins/gitEnvPlugin'
import mysqlEnvPlugin from '../../src/main/plugins/mysqlEnvPlugin'
import redisEnvPlugin from '../../src/main/plugins/redisEnvPlugin'
import mavenEnvPlugin from '../../src/main/plugins/mavenEnvPlugin'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

const platform: AppPlatform = process.platform as AppPlatform

let tmpDir: string
let tasksDir: string
let snapshotsDir: string
let homeDir: string
let previousHome: string | undefined
let previousUserProfile: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-action-flow-'))
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

  if (process.platform === 'win32') {
    const normalized = targetPath.replace(/\//g, '\\').toLowerCase()
    const tempMarker = '\\appdata\\local\\temp\\'
    const markerIndex = normalized.indexOf(tempMarker)
    return markerIndex >= 0 ? normalized.slice(markerIndex + tempMarker.length) : normalized
  }

  return targetPath
}

function expectRemovedPath(actualPath: string | undefined, expectedPath: string): void {
  expect(normalizeCleanupPath(actualPath)).toBe(normalizeCleanupPath(expectedPath))
}

type Case = {
  tool: 'node' | 'java' | 'python' | 'git' | 'mysql' | 'redis' | 'maven'
  managerKey: string
  manager: string
  versionKey?: string
}

const cases: Case[] = [
  { tool: 'node', managerKey: 'nodeManager', manager: 'node', versionKey: 'nodeVersion' },
  { tool: 'node', managerKey: 'nodeManager', manager: 'nvm', versionKey: 'nodeVersion' },
  { tool: 'java', managerKey: 'javaManager', manager: 'jdk', versionKey: 'javaVersion' },
  { tool: 'java', managerKey: 'javaManager', manager: 'sdkman', versionKey: 'javaVersion' },
  { tool: 'python', managerKey: 'pythonManager', manager: 'python', versionKey: 'pythonVersion' },
  { tool: 'python', managerKey: 'pythonManager', manager: 'conda', versionKey: 'pythonVersion' },
  { tool: 'git', managerKey: 'gitManager', manager: 'git', versionKey: 'gitVersion' },
  { tool: 'git', managerKey: 'gitManager', manager: 'homebrew', versionKey: 'gitVersion' },
  { tool: 'git', managerKey: 'gitManager', manager: 'scoop', versionKey: 'gitVersion' },
  { tool: 'mysql', managerKey: 'mysqlManager', manager: 'mysql' },
  { tool: 'mysql', managerKey: 'mysqlManager', manager: 'package' },
  { tool: 'redis', managerKey: 'redisManager', manager: 'redis' },
  { tool: 'redis', managerKey: 'redisManager', manager: 'package' },
  { tool: 'maven', managerKey: 'mavenManager', manager: 'maven', versionKey: 'mavenVersion' },
  { tool: 'maven', managerKey: 'mavenManager', manager: 'package' },
].filter((c) => {
  if (c.manager === 'homebrew' && process.platform !== 'darwin') return false
  if (c.manager === 'scoop' && process.platform !== 'win32') return false
  return true
})

function makePlugin(tool: string, manager: string): PluginLifecycle {
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
            input.mavenVersion ??
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

function makeDetection(tool: Case['tool'], installRootDir: string): DetectedEnvironment {
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

async function expectPersistedRollbackMetadata(
  taskId: string,
  tasksDir: string,
  expectedCommands?: string[],
) {
  const persisted = await loadTask(taskId, tasksDir)
  expect(persisted.plugins[0].lastResult?.rollbackCommands ?? []).toEqual(expectedCommands ?? [])
  return persisted
}

describe('action full flow integration', () => {
  describe.each(cases)('$tool via $manager', ({ tool, managerKey, manager, versionKey }) => {
    it('cleans existing environment and installs successfully', async () => {
      const installRootDir = join(tmpDir, `${tool}-${manager}-existing`)
      await mkdir(installRootDir, { recursive: true })
      await writeFile(join(installRootDir, 'stale.txt'), 'stale')

      const cleanupResult = await cleanupDetectedEnvironment(makeDetection(tool, installRootDir))
      expectRemovedPath(cleanupResult.removedPath, installRootDir)

      const task = createTask({
        templateId: `${tool}-template`,
        templateVersion: '1.0.0',
        params: {
          installRootDir,
          [managerKey]: manager,
          ...(versionKey ? { [versionKey]: '1.0.0' } : {}),
        },
        plugins: [
          {
            pluginId: `${tool}-env`,
            version: '1.0.0',
            params: {
              installRootDir,
              [managerKey]: manager,
              ...(versionKey ? { [versionKey]: '1.0.0' } : {}),
            },
          },
        ],
      })

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [installRootDir],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const nextTask = await executeTask({
        task,
        registry: { [`${tool}-env`]: makePlugin(tool, manager) },
        platform,
        tasksDir,
        dryRun: false,
      })

      await markSnapshotDeletable(snapshotsDir, snapshot.id)
      const persisted = await loadTask(task.id, tasksDir)
      const markerPath = join(installRootDir, `${tool}-${manager}.installed`)

      expect(nextTask.status).toBe('succeeded')
      expect(nextTask.plugins[0].status).toBe('verified_success')
      expect(nextTask.plugins[0].verifyResult?.checks).toContain(`verified ${markerPath}`)
      expect(await readFile(markerPath, 'utf8')).toBe(`${tool}:${manager}`)
      expect(persisted.status).toBe('succeeded')
    })

    it('installs successfully when no environment exists', async () => {
      const installRootDir = join(tmpDir, `${tool}-${manager}-fresh`)

      const task = createTask({
        templateId: `${tool}-template`,
        templateVersion: '1.0.0',
        params: {
          installRootDir,
          [managerKey]: manager,
          ...(versionKey ? { [versionKey]: '1.0.0' } : {}),
        },
        plugins: [
          {
            pluginId: `${tool}-env`,
            version: '1.0.0',
            params: {
              installRootDir,
              [managerKey]: manager,
              ...(versionKey ? { [versionKey]: '1.0.0' } : {}),
            },
          },
        ],
      })

      const snapshot = await createSnapshot({
        baseDir: snapshotsDir,
        taskId: task.id,
        type: 'auto',
        trackedPaths: [installRootDir],
      })
      await updateSnapshotMeta(snapshotsDir, snapshot)

      const nextTask = await executeTask({
        task,
        registry: { [`${tool}-env`]: makePlugin(tool, manager) },
        platform,
        tasksDir,
        dryRun: false,
      })

      await markSnapshotDeletable(snapshotsDir, snapshot.id)
      const markerPath = join(installRootDir, `${tool}-${manager}.installed`)

      expect(nextTask.status).toBe('succeeded')
      expect(nextTask.plugins[0].status).toBe('verified_success')
      expect(await readFile(markerPath, 'utf8')).toBe(`${tool}:${manager}`)
    })
  })
})

// ============================================================
// Real plugin tests — gated by ENVSETUP_REAL_RUN
// ============================================================

type RealCase = {
  tool: 'node' | 'java' | 'python' | 'git' | 'mysql' | 'redis' | 'maven'
  pluginId: string
  plugin: PluginLifecycle
  templateId: string
  params: Record<string, string>
}

function buildRealCases(tmpBase: string, downloadCacheDir: string): RealCase[] {
  const all: RealCase[] = [
    {
      tool: 'node',
      pluginId: 'node-env',
      plugin: nodeEnvPlugin,
      templateId: 'node-template',
      params: {
        installRootDir: join(tmpBase, 'node-direct'),
        nodeManager: 'node',
        nodeVersion: '20.20.1',
        npmCacheDir: join(tmpBase, 'npm-cache'),
        npmGlobalPrefix: join(tmpBase, 'npm-global'),
        downloadCacheDir,
      },
    },
    {
      tool: 'node',
      pluginId: 'node-env',
      plugin: nodeEnvPlugin,
      templateId: 'node-template',
      params: {
        installRootDir: join(tmpBase, 'node-nvm'),
        nodeManager: 'nvm',
        nodeVersion: '20.20.1',
        npmCacheDir: join(tmpBase, 'npm-cache-nvm'),
        npmGlobalPrefix: join(tmpBase, 'npm-global-nvm'),
        downloadCacheDir,
      },
    },
    {
      tool: 'java',
      pluginId: 'java-env',
      plugin: javaEnvPlugin,
      templateId: 'java-template',
      params: {
        installRootDir: join(tmpBase, 'java-jdk'),
        javaManager: 'jdk',
        javaVersion: '21',
        downloadCacheDir,
      },
    },
    {
      tool: 'java',
      pluginId: 'java-env',
      plugin: javaEnvPlugin,
      templateId: 'java-template',
      params: {
        installRootDir: join(tmpBase, 'java-sdkman'),
        javaManager: 'sdkman',
        javaVersion: '21',
        downloadCacheDir,
      },
    },
    {
      tool: 'python',
      pluginId: 'python-env',
      plugin: pythonEnvPlugin,
      templateId: 'python-template',
      params: {
        installRootDir: join(tmpBase, 'python-conda'),
        pythonManager: 'conda',
        pythonVersion: '3.12.10',
        downloadCacheDir,
      },
    },
    {
      tool: 'python',
      pluginId: 'python-env',
      plugin: pythonEnvPlugin,
      templateId: 'python-template',
      params: {
        installRootDir: join(tmpBase, 'python-direct'),
        pythonManager: 'python',
        pythonVersion: '3.12.10',
        downloadCacheDir,
      },
    },
    {
      tool: 'git',
      pluginId: 'git-env',
      plugin: gitEnvPlugin,
      templateId: 'git-template',
      params: { installRootDir: join(tmpBase, 'git-direct'), gitManager: 'git', downloadCacheDir },
    },
    {
      tool: 'mysql',
      pluginId: 'mysql-env',
      plugin: mysqlEnvPlugin,
      templateId: 'mysql-template',
      params: {
        installRootDir: join(tmpBase, 'mysql-direct'),
        mysqlManager: 'mysql',
        downloadCacheDir,
      },
    },
    {
      tool: 'mysql',
      pluginId: 'mysql-env',
      plugin: mysqlEnvPlugin,
      templateId: 'mysql-template',
      params: {
        installRootDir: join(tmpBase, 'mysql-package'),
        mysqlManager: 'package',
        downloadCacheDir,
      },
    },
    {
      tool: 'redis',
      pluginId: 'redis-env',
      plugin: redisEnvPlugin,
      templateId: 'redis-template',
      params: {
        installRootDir: join(tmpBase, 'redis-direct'),
        redisManager: 'redis',
        downloadCacheDir,
      },
    },
    {
      tool: 'redis',
      pluginId: 'redis-env',
      plugin: redisEnvPlugin,
      templateId: 'redis-template',
      params: {
        installRootDir: join(tmpBase, 'redis-package'),
        redisManager: 'package',
        downloadCacheDir,
      },
    },
    {
      tool: 'maven',
      pluginId: 'maven-env',
      plugin: mavenEnvPlugin,
      templateId: 'maven-template',
      params: {
        installRootDir: join(tmpBase, 'maven-direct'),
        mavenManager: 'maven',
        mavenVersion: '3.9.11',
        downloadCacheDir,
      },
    },
    {
      tool: 'maven',
      pluginId: 'maven-env',
      plugin: mavenEnvPlugin,
      templateId: 'maven-template',
      params: {
        installRootDir: join(tmpBase, 'maven-package'),
        mavenManager: 'package',
        downloadCacheDir,
      },
    },
  ]

  if (isMac) {
    all.push({
      tool: 'git',
      pluginId: 'git-env',
      plugin: gitEnvPlugin,
      templateId: 'git-template',
      params: {
        installRootDir: join(tmpBase, 'git-brew'),
        gitManager: 'homebrew',
        downloadCacheDir,
      },
    })
  }

  if (isWindows) {
    all.push({
      tool: 'git',
      pluginId: 'git-env',
      plugin: gitEnvPlugin,
      templateId: 'git-template',
      params: { installRootDir: join(tmpBase, 'git-scoop'), gitManager: 'scoop', downloadCacheDir },
    })
  }

  return all
}

describe.skipIf(!isRealRun)('action full flow — real plugins', () => {
  const TIMEOUT = 600_000
  let realTmpDir: string
  let realTasksDir: string
  let realSnapshotsDir: string
  let realDownloadCacheDir: string

  beforeEach(async () => {
    realTmpDir = await mkdtemp(join(tmpdir(), 'envsetup-real-flow-'))
    realTasksDir = join(realTmpDir, 'tasks')
    realSnapshotsDir = join(realTmpDir, 'snapshots')
    realDownloadCacheDir = join(realTmpDir, 'download-cache')
    await mkdir(realDownloadCacheDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(realTmpDir, { recursive: true, force: true })
  })

  it(
    'fresh install succeeds for all tools with real plugins',
    async () => {
      const realCases = buildRealCases(realTmpDir, realDownloadCacheDir)

      for (const rc of realCases) {
        const task = createTask({
          templateId: rc.templateId,
          templateVersion: '1.0.0',
          params: rc.params,
          plugins: [{ pluginId: rc.pluginId, version: '1.0.0', params: rc.params }],
        })

        const snapshot = await createSnapshot({
          baseDir: realSnapshotsDir,
          taskId: task.id,
          type: 'auto',
          trackedPaths: [],
        })
        await updateSnapshotMeta(realSnapshotsDir, snapshot)

        const result = await executeTask({
          task,
          registry: { [rc.pluginId]: rc.plugin },
          platform,
          tasksDir: realTasksDir,
          dryRun: false,
        })

        await markSnapshotDeletable(realSnapshotsDir, snapshot.id)
        const persisted = await expectPersistedRollbackMetadata(
          task.id,
          realTasksDir,
          result.plugins[0].lastResult?.rollbackCommands,
        )
        expect(result.status).toBe('succeeded')
        expect(result.plugins[0].status).toBe('verified_success')
        if (
          rc.params.gitManager === 'homebrew' ||
          rc.params.gitManager === 'scoop' ||
          rc.params.mysqlManager === 'package' ||
          rc.params.redisManager === 'package' ||
          rc.params.mavenManager === 'package'
        ) {
          expect(persisted.plugins[0].lastResult?.rollbackCommands?.length ?? 0).toBeGreaterThan(0)
        }
      }
    },
    TIMEOUT,
  )

  it(
    'cleanup existing env then install succeeds for all tools with real plugins',
    async () => {
      const realCases = buildRealCases(realTmpDir, realDownloadCacheDir)

      for (const rc of realCases) {
        const installRootDir = rc.params.installRootDir
        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'stale.txt'), 'old')

        await cleanupDetectedEnvironment({
          id: `${rc.tool}:managed_root:test:${installRootDir}`,
          tool: rc.tool,
          kind: 'managed_root',
          path: installRootDir,
          source: 'test',
          cleanupSupported: true,
          cleanupPath: installRootDir,
        })

        const task = createTask({
          templateId: rc.templateId,
          templateVersion: '1.0.0',
          params: rc.params,
          plugins: [{ pluginId: rc.pluginId, version: '1.0.0', params: rc.params }],
        })

        const snapshot = await createSnapshot({
          baseDir: realSnapshotsDir,
          taskId: task.id,
          type: 'auto',
          trackedPaths: [],
        })
        await updateSnapshotMeta(realSnapshotsDir, snapshot)

        const result = await executeTask({
          task,
          registry: { [rc.pluginId]: rc.plugin },
          platform,
          tasksDir: realTasksDir,
          dryRun: false,
        })

        await markSnapshotDeletable(realSnapshotsDir, snapshot.id)
        const persisted = await expectPersistedRollbackMetadata(
          task.id,
          realTasksDir,
          result.plugins[0].lastResult?.rollbackCommands,
        )
        expect(result.status).toBe('succeeded')
        expect(result.plugins[0].status).toBe('verified_success')
        if (
          rc.params.gitManager === 'homebrew' ||
          rc.params.gitManager === 'scoop' ||
          rc.params.mysqlManager === 'package' ||
          rc.params.redisManager === 'package' ||
          rc.params.mavenManager === 'package'
        ) {
          expect(persisted.plugins[0].lastResult?.rollbackCommands?.length ?? 0).toBeGreaterThan(0)
        }
      }
    },
    TIMEOUT,
  )
})
