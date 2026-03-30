/**
 * Real rollback coverage for MySQL / Redis / Maven.
 *
 * These cases complement action-real-cycle-matrix by proving that the
 * post-cleanup snapshot can be restored after a real install mutates the
 * machine state.
 */
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  AppPlatform,
  DetectedEnvironment,
  PluginLifecycle,
} from '../../src/main/core/contracts'
import { cleanupDetectedEnvironment } from '../../src/main/core/environment'
import { executeRollback } from '../../src/main/core/rollback'
import { createSnapshot, updateSnapshotMeta } from '../../src/main/core/snapshot'
import { createTask, executeTask, loadTask } from '../../src/main/core/task'
import mavenEnvPlugin from '../../src/main/plugins/mavenEnvPlugin'
import mysqlEnvPlugin from '../../src/main/plugins/mysqlEnvPlugin'
import redisEnvPlugin from '../../src/main/plugins/redisEnvPlugin'

const execFileAsync = promisify(execFile)
const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const isCi = process.env.CI === 'true'
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const platform = process.platform as AppPlatform

type RealRollbackTool = 'mysql' | 'redis' | 'maven'

function selectCiVersion(tool: RealRollbackTool, fallback: string): string {
  return process.env.ENVSETUP_CI_TOOL === tool && process.env.ENVSETUP_CI_VERSION
    ? process.env.ENVSETUP_CI_VERSION
    : fallback
}

const mysqlTestVersion = selectCiVersion('mysql', '8.4.8')
const redisTestVersion = selectCiVersion('redis', '7.4.7')
const mavenTestVersion = selectCiVersion('maven', '3.9.11')

type RealRollbackCase = {
  name: string
  tool: RealRollbackTool
  pluginId: 'mysql-env' | 'redis-env' | 'maven-env'
  plugin: PluginLifecycle
  templateId: 'mysql-template' | 'redis-template' | 'maven-template'
  timeout: number
  buildParams: (installRootDir: string, downloadCacheDir: string) => Record<string, string>
  verifyInstalledState?: (installRootDir: string) => Promise<void>
  verifyRolledBackState?: (installRootDir: string) => Promise<void>
}

let tmpDir: string
let tasksDir: string
let snapshotsDir: string
let downloadCacheDir: string
let homeDir: string
let previousHome: string | undefined
let previousUserProfile: string | undefined

beforeEach(async () => {
  tmpDir = await rmAndMakeTemp('envsetup-real-rb-matrix-')
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

  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
})

async function rmAndMakeTemp(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  return dir
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function makeDetection(tool: RealRollbackTool, installRootDir: string): DetectedEnvironment {
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

async function isHomebrewFormulaInstalled(formula: string): Promise<boolean> {
  try {
    await execFileAsync('sh', [
      '-c',
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; [ -n "$BREW_BIN" ] && "$BREW_BIN" list --versions ${formula} >/dev/null 2>&1`,
    ])
    return true
  } catch {
    return false
  }
}

async function isScoopPackageInstalled(packageName: string): Promise<boolean> {
  try {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `$pkg = '${packageName}'; $scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = (Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue).Source }; if (-not $scoop) { $scoop = (Get-Command 'scoop' -ErrorAction SilentlyContinue).Source }; if (-not $scoop) { exit 1 }; if (-not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }; $rawPrefix = & $scoop prefix $pkg 2>$null | Select-Object -First 1; if ($rawPrefix) { $prefix = $rawPrefix.ToString().Trim(); if ($prefix -and [System.IO.Path]::IsPathRooted($prefix) -and (Test-Path $prefix)) { exit 0 } }; $roots = @($env:SCOOP); $roots += Join-Path $env:USERPROFILE 'scoop'; $roots = $roots | Select-Object -Unique; foreach ($r in $roots) { $current = Join-Path $r ('apps\\' + $pkg + '\\current'); if (Test-Path $current) { exit 0 }; $dir = Join-Path $r ('apps\\' + $pkg); if (Test-Path $dir) { $vd = Get-ChildItem -Path $dir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'current' } | Select-Object -First 1; if ($vd) { exit 0 } } }; exit 1`,
    ])
    return true
  } catch {
    return false
  }
}

function shouldRunCaseInCi(testCase: RealRollbackCase): boolean {
  if (!isCi) return true
  const ciTool = process.env.ENVSETUP_CI_TOOL
  if (!ciTool) return true
  return testCase.tool === ciTool
}

const allRealRollbackCases: RealRollbackCase[] = [
  {
    name: 'Maven direct',
    tool: 'maven',
    pluginId: 'maven-env',
    plugin: mavenEnvPlugin,
    templateId: 'maven-template',
    timeout: 300_000,
    buildParams: (installRootDir, cacheDir) => ({
      installRootDir,
      mavenManager: 'maven',
      mavenVersion: mavenTestVersion,
      downloadCacheDir: cacheDir,
    }),
    verifyInstalledState: async (installRootDir) => {
      expect(await pathExists(join(installRootDir, `maven-${mavenTestVersion}`))).toBe(true)
    },
  },
  {
    name: 'Maven package',
    tool: 'maven',
    pluginId: 'maven-env',
    plugin: mavenEnvPlugin,
    templateId: 'maven-template',
    timeout: 300_000,
    buildParams: (installRootDir, cacheDir) => ({
      installRootDir,
      mavenManager: 'package',
      mavenVersion: mavenTestVersion,
      downloadCacheDir: cacheDir,
    }),
    verifyInstalledState: async () => {
      if (isMac) {
        expect(await isHomebrewFormulaInstalled(`maven@${mavenTestVersion}`)).toBe(true)
      }
      if (isWindows) {
        expect(await isScoopPackageInstalled('maven')).toBe(true)
      }
    },
    verifyRolledBackState: async () => {
      if (isMac) {
        expect(await isHomebrewFormulaInstalled(`maven@${mavenTestVersion}`)).toBe(false)
      }
      if (isWindows) {
        expect(await isScoopPackageInstalled('maven')).toBe(false)
      }
    },
  },
  {
    name: 'MySQL direct',
    tool: 'mysql',
    pluginId: 'mysql-env',
    plugin: mysqlEnvPlugin,
    templateId: 'mysql-template',
    timeout: 300_000,
    buildParams: (installRootDir: string, cacheDir: string) => ({
      installRootDir,
      mysqlManager: 'mysql',
      mysqlVersion: mysqlTestVersion,
      downloadCacheDir: cacheDir,
    }),
    verifyInstalledState: async (installRootDir) => {
      expect(await pathExists(join(installRootDir, 'mysql'))).toBe(true)
    },
  },
  {
    name: 'Redis direct',
    tool: 'redis',
    pluginId: 'redis-env',
    plugin: redisEnvPlugin,
    templateId: 'redis-template',
    timeout: isWindows ? 600_000 : 300_000,
    buildParams: (installRootDir: string, cacheDir: string) => ({
      installRootDir,
      redisManager: 'redis',
      redisVersion: redisTestVersion,
      downloadCacheDir: cacheDir,
    }),
    verifyInstalledState: async (installRootDir) => {
      if (isMac) {
        expect(await pathExists(join(installRootDir, 'redis', 'src', 'redis-server'))).toBe(true)
      }
      if (isWindows) {
        expect(await pathExists(join(installRootDir, 'redis'))).toBe(true)
      }
    },
  },
  ...(isMac
    ? [
        {
          name: 'MySQL package',
          tool: 'mysql',
          pluginId: 'mysql-env',
          plugin: mysqlEnvPlugin,
          templateId: 'mysql-template',
          timeout: 300_000,
          buildParams: (installRootDir: string, cacheDir: string) => ({
            installRootDir,
            mysqlManager: 'package',
            mysqlVersion: mysqlTestVersion,
            downloadCacheDir: cacheDir,
          }),
          verifyInstalledState: async () => {
            expect(await isHomebrewFormulaInstalled(`mysql@${mysqlTestVersion}`)).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isHomebrewFormulaInstalled(`mysql@${mysqlTestVersion}`)).toBe(false)
          },
        } satisfies RealRollbackCase,
        {
          name: 'Redis package',
          tool: 'redis',
          pluginId: 'redis-env',
          plugin: redisEnvPlugin,
          templateId: 'redis-template',
          timeout: 300_000,
          buildParams: (installRootDir: string, cacheDir: string) => ({
            installRootDir,
            redisManager: 'package',
            redisVersion: redisTestVersion,
            downloadCacheDir: cacheDir,
          }),
          verifyInstalledState: async () => {
            expect(await isHomebrewFormulaInstalled(`redis@${redisTestVersion}`)).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isHomebrewFormulaInstalled(`redis@${redisTestVersion}`)).toBe(false)
          },
        } satisfies RealRollbackCase,
      ]
    : []),
  ...(isWindows
    ? [
        {
          name: 'MySQL package',
          tool: 'mysql',
          pluginId: 'mysql-env',
          plugin: mysqlEnvPlugin,
          templateId: 'mysql-template',
          timeout: 300_000,
          buildParams: (installRootDir: string, cacheDir: string) => ({
            installRootDir,
            mysqlManager: 'package',
            mysqlVersion: mysqlTestVersion,
            downloadCacheDir: cacheDir,
          }),
          verifyInstalledState: async () => {
            expect(await isScoopPackageInstalled('mysql')).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isScoopPackageInstalled('mysql')).toBe(false)
          },
        } satisfies RealRollbackCase,
        {
          name: 'Redis package',
          tool: 'redis',
          pluginId: 'redis-env',
          plugin: redisEnvPlugin,
          templateId: 'redis-template',
          timeout: 300_000,
          buildParams: (installRootDir: string, cacheDir: string) => ({
            installRootDir,
            redisManager: 'package',
            redisVersion: redisTestVersion,
            downloadCacheDir: cacheDir,
          }),
          verifyInstalledState: async () => {
            expect(await isScoopPackageInstalled('redis')).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isScoopPackageInstalled('redis')).toBe(false)
          },
        } satisfies RealRollbackCase,
      ]
    : []),
]

const realRollbackCases = allRealRollbackCases.filter(shouldRunCaseInCi)

describe.skipIf(!isRealRun || realRollbackCases.length === 0)(
  'action real rollback matrix — mysql redis maven',
  () => {
    describe.each(realRollbackCases)('$name', (testCase) => {
      it(
        'cleanup existing -> install -> rollback restores post-cleanup state',
        async () => {
          const installRootDir = join(
            tmpDir,
            `${testCase.tool}-${testCase.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-full-cycle`,
          )

          await mkdir(installRootDir, { recursive: true })
          await writeFile(join(installRootDir, 'old.txt'), 'stale')

          await cleanupDetectedEnvironment(makeDetection(testCase.tool, installRootDir))
          expect(await pathExists(installRootDir)).toBe(false)

          await mkdir(installRootDir, { recursive: true })
          const trackedFile = join(installRootDir, 'fresh.txt')
          await writeFile(trackedFile, `after-${testCase.tool}-cleanup`)

          const snapshot = await createSnapshot({
            baseDir: snapshotsDir,
            taskId: `post-${testCase.tool}-cleanup`,
            type: 'auto',
            trackedPaths: [trackedFile],
          })
          await updateSnapshotMeta(snapshotsDir, snapshot)

          const params = testCase.buildParams(installRootDir, downloadCacheDir)
          const task = createTask({
            templateId: testCase.templateId,
            templateVersion: '1.0.0',
            params,
            plugins: [{ pluginId: testCase.pluginId, version: '1.0.0', params }],
          })

          const result = await executeTask({
            task,
            registry: { [testCase.pluginId]: testCase.plugin },
            platform,
            tasksDir,
            dryRun: false,
          })
          expect(result.status).toBe('succeeded')
          expect(result.plugins[0].status).toBe('verified_success')
          await testCase.verifyInstalledState?.(installRootDir)

          await writeFile(trackedFile, 'corrupted-after-install')

          const rollbackResult = await executePersistedTaskRollback(
            task.id,
            snapshot.id,
            [trackedFile],
            [installRootDir],
          )
          expect(rollbackResult.success).toBe(true)
          expect(rollbackResult.executionMode).toBe('real_run')
          expect(rollbackResult.envVariablesRestored).toBeGreaterThanOrEqual(0)
          expect(rollbackResult.directoriesRemoved).toBeGreaterThanOrEqual(1)
          expect(await pathExists(installRootDir)).toBe(false)
          await testCase.verifyRolledBackState?.(installRootDir)
        },
        testCase.timeout,
      )
    })
  },
)
