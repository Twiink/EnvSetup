import { constants } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type {
  AppPlatform,
  DetectedEnvironment,
  PluginLifecycle,
} from '../../src/main/core/contracts'
import { cleanupDetectedEnvironment } from '../../src/main/core/environment'
import { executeRollback } from '../../src/main/core/rollback'
import { createSnapshot, updateSnapshotMeta } from '../../src/main/core/snapshot'
import { createTask, executeTask } from '../../src/main/core/task'
import gitEnvPlugin from '../../src/main/plugins/gitEnvPlugin'
import javaEnvPlugin from '../../src/main/plugins/javaEnvPlugin'
import nodeEnvPlugin from '../../src/main/plugins/nodeEnvPlugin'
import pythonEnvPlugin from '../../src/main/plugins/pythonEnvPlugin'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const platform: AppPlatform = process.platform as AppPlatform

let suiteDir: string
let sharedDownloadCacheDir: string
let tmpDir: string
let tasksDir: string
let snapshotsDir: string

type RealCycleCase = {
  name: string
  tool: 'node' | 'java' | 'python' | 'git'
  pluginId: 'node-env' | 'java-env' | 'python-env' | 'git-env'
  plugin: PluginLifecycle
  templateId: string
  buildParams: (installRootDir: string) => Record<string, string>
  verifyPattern: RegExp
}

const realCycleCases: RealCycleCase[] = [
  {
    name: 'Node.js direct',
    tool: 'node',
    pluginId: 'node-env',
    plugin: nodeEnvPlugin,
    templateId: 'node-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      nodeManager: 'node',
      nodeVersion: '20.20.1',
      npmCacheDir: join(installRootDir, 'npm-cache'),
      npmGlobalPrefix: join(installRootDir, 'npm-global'),
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /v\d+\.\d+\.\d+/,
  },
  {
    name: 'Node.js nvm',
    tool: 'node',
    pluginId: 'node-env',
    plugin: nodeEnvPlugin,
    templateId: 'node-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      nodeManager: 'nvm',
      nodeVersion: '20.20.1',
      npmCacheDir: join(installRootDir, 'npm-cache'),
      npmGlobalPrefix: join(installRootDir, 'npm-global'),
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /v\d+\.\d+\.\d+/,
  },
  {
    name: 'Java JDK',
    tool: 'java',
    pluginId: 'java-env',
    plugin: javaEnvPlugin,
    templateId: 'java-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      javaManager: 'jdk',
      javaVersion: '21',
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /(openjdk|temurin|version)/i,
  },
  {
    name: 'Java SDKMAN',
    tool: 'java',
    pluginId: 'java-env',
    plugin: javaEnvPlugin,
    templateId: 'java-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      javaManager: 'sdkman',
      javaVersion: '21',
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /(openjdk|temurin|version)/i,
  },
  {
    name: 'Python direct',
    tool: 'python',
    pluginId: 'python-env',
    plugin: pythonEnvPlugin,
    templateId: 'python-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      pythonManager: 'python',
      pythonVersion: '3.12.10',
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /Python\s+\d+\.\d+\.\d+/,
  },
  {
    name: 'Python conda',
    tool: 'python',
    pluginId: 'python-env',
    plugin: pythonEnvPlugin,
    templateId: 'python-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      pythonManager: 'conda',
      pythonVersion: '3.12.10',
      condaEnvName: 'base',
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /Python\s+\d+\.\d+\.\d+/,
  },
  {
    name: 'Git direct',
    tool: 'git',
    pluginId: 'git-env',
    plugin: gitEnvPlugin,
    templateId: 'git-template',
    buildParams: (installRootDir) => ({
      installRootDir,
      gitManager: 'git',
      downloadCacheDir: sharedDownloadCacheDir,
    }),
    verifyPattern: /git version/i,
  },
]

beforeAll(async () => {
  suiteDir = await mkdtemp(join(tmpdir(), 'envsetup-real-cycle-suite-'))
  sharedDownloadCacheDir = join(suiteDir, 'download-cache')
  await mkdir(sharedDownloadCacheDir, { recursive: true })
})

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-real-cycle-'))
  tasksDir = join(tmpDir, 'tasks')
  snapshotsDir = join(tmpDir, 'snapshots')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

afterAll(async () => {
  await rm(suiteDir, { recursive: true, force: true })
})

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function makeDetection(tool: RealCycleCase['tool'], installRootDir: string): DetectedEnvironment {
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

async function createPreInstallSnapshot(taskId: string) {
  const snapshot = await createSnapshot({
    baseDir: snapshotsDir,
    taskId,
    type: 'auto',
    trackedPaths: [],
  })
  await updateSnapshotMeta(snapshotsDir, snapshot)
  return snapshot
}

async function runRealInstall(testCase: RealCycleCase, installRootDir: string) {
  const params = testCase.buildParams(installRootDir)
  const task = createTask({
    templateId: testCase.templateId,
    templateVersion: '1.0.0',
    params,
    plugins: [
      {
        pluginId: testCase.pluginId,
        version: '1.0.0',
        params,
      },
    ],
  })

  const snapshot = await createPreInstallSnapshot(task.id)
  const result = await executeTask({
    task,
    registry: { [testCase.pluginId]: testCase.plugin },
    platform,
    tasksDir,
    dryRun: false,
  })

  return { snapshot, result }
}

async function assertRealInstallSucceeded(
  testCase: RealCycleCase,
  installRootDir: string,
  verifyChecks: string[],
  executionMode: string | undefined,
  status: string,
  pluginStatus: string,
) {
  expect(status).toBe('succeeded')
  expect(pluginStatus).toBe('verified_success')
  expect(executionMode).toBe('real_run')
  expect(verifyChecks.join('\n')).toMatch(testCase.verifyPattern)
  expect(await pathExists(installRootDir)).toBe(true)
}

async function assertRealRollbackSucceeded(snapshotId: string, installRootDir: string) {
  const rollbackResult = await executeRollback(snapshotsDir, snapshotId, [], [installRootDir])

  expect(rollbackResult.success).toBe(true)
  expect(rollbackResult.executionMode).toBe('real_run')
  expect(rollbackResult.directoriesRemoved).toBe(1)
  expect(await pathExists(installRootDir)).toBe(false)
}

describe.skipIf(!isRealRun)('action real cycle matrix', () => {
  describe.each(realCycleCases)('$name', (testCase) => {
    const timeout =
      testCase.tool === 'python' || testCase.name.includes('SDKMAN') ? 900_000 : 600_000

    it(
      'installs successfully with no existing environment and rolls back for real',
      async () => {
        const installRootDir = join(
          tmpDir,
          `${testCase.tool}-${testCase.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fresh`,
        )

        expect(await pathExists(installRootDir)).toBe(false)

        const { snapshot, result } = await runRealInstall(testCase, installRootDir)
        const plugin = result.plugins[0]

        await assertRealInstallSucceeded(
          testCase,
          installRootDir,
          plugin.verifyResult?.checks ?? [],
          plugin.lastResult?.executionMode,
          result.status,
          plugin.status,
        )

        await assertRealRollbackSucceeded(snapshot.id, installRootDir)
      },
      timeout,
    )

    it(
      'cleans an existing environment, installs successfully, then rolls back for real',
      async () => {
        const installRootDir = join(
          tmpDir,
          `${testCase.tool}-${testCase.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cleanup`,
        )

        await mkdir(installRootDir, { recursive: true })
        await writeFile(join(installRootDir, 'stale.txt'), 'stale')

        const cleanupResult = await cleanupDetectedEnvironment(
          makeDetection(testCase.tool, installRootDir),
        )
        expect(cleanupResult.removedPath).toBe(installRootDir)
        expect(await pathExists(installRootDir)).toBe(false)

        const { snapshot, result } = await runRealInstall(testCase, installRootDir)
        const plugin = result.plugins[0]

        await assertRealInstallSucceeded(
          testCase,
          installRootDir,
          plugin.verifyResult?.checks ?? [],
          plugin.lastResult?.executionMode,
          result.status,
          plugin.status,
        )

        await assertRealRollbackSucceeded(snapshot.id, installRootDir)
      },
      timeout,
    )
  })
})
