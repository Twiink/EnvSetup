/**
 * 覆盖 GitHub Actions 真实安装、清理、重装与回滚矩阵。
 */

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type {
  AppPlatform,
  DetectedEnvironment,
  EnvChange,
  PluginInstallResult,
  PluginLifecycle,
  Primitive,
  ResolvedTemplate,
} from '../../src/main/core/contracts'
import {
  cleanupDetectedEnvironments,
  collectCleanupTrackedPaths,
  detectTemplateEnvironments,
} from '../../src/main/core/environment'
import { applyEnvChanges } from '../../src/main/core/envPersistence'
import { executeRollback } from '../../src/main/core/rollback'
import { createSnapshot, updateSnapshotMeta } from '../../src/main/core/snapshot'
import { createTask, executeTask } from '../../src/main/core/task'
import { inferTemplateFieldPrefix, loadTemplatesFromDirectory } from '../../src/main/core/template'
import gitEnvPlugin from '../../src/main/plugins/gitEnvPlugin'
import javaEnvPlugin from '../../src/main/plugins/javaEnvPlugin'
import nodeEnvPlugin from '../../src/main/plugins/nodeEnvPlugin'
import pythonEnvPlugin from '../../src/main/plugins/pythonEnvPlugin'
import { resolvePythonInstallPaths, resolveJavaInstallPaths } from '../../src/main/core/platform'

const execFileAsync = promisify(execFile)
const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const isCi = process.env.CI === 'true'
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const platform: AppPlatform = process.platform as AppPlatform
const originalEnv = { ...process.env }

let suiteDir: string
let sharedDownloadCacheDir: string
let sharedExtractedCacheDir: string
let tmpDir: string
let tasksDir: string
let snapshotsDir: string
let homeDir: string
let templatesById = new Map<string, ResolvedTemplate>()
const cleanupHookTimeout = isWindows ? 300_000 : 30_000

type RealCycleCase = {
  name: string
  tool: 'node' | 'java' | 'python' | 'git'
  pluginId: 'node-env' | 'java-env' | 'python-env' | 'git-env'
  plugin: PluginLifecycle
  templateId: string
  buildParams: (installRootDir: string) => Record<string, string>
  verifyPattern: RegExp
  expectInstallRootAfterInstall?: boolean
  verifyInstalledState?: () => Promise<void>
  verifyRolledBackState?: () => Promise<void>
}

function withSharedCaches(params: Record<string, string>): Record<string, string> {
  return {
    ...params,
    downloadCacheDir: sharedDownloadCacheDir,
    extractedCacheDir: sharedExtractedCacheDir,
  }
}

const allRealCycleCases: RealCycleCase[] = [
  {
    name: 'Node.js direct',
    tool: 'node',
    pluginId: 'node-env',
    plugin: nodeEnvPlugin,
    templateId: 'node-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        nodeManager: 'node',
        nodeVersion: '20.20.1',
        npmCacheDir: join(installRootDir, 'npm-cache'),
        npmGlobalPrefix: join(installRootDir, 'npm-global'),
      }),
    verifyPattern: /v\d+\.\d+\.\d+/,
  },
  {
    name: 'Node.js nvm',
    tool: 'node',
    pluginId: 'node-env',
    plugin: nodeEnvPlugin,
    templateId: 'node-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        nodeManager: 'nvm',
        nodeVersion: '20.20.1',
        npmCacheDir: join(installRootDir, 'npm-cache'),
        npmGlobalPrefix: join(installRootDir, 'npm-global'),
      }),
    verifyPattern: /v\d+\.\d+\.\d+/,
  },
  {
    name: 'Java JDK',
    tool: 'java',
    pluginId: 'java-env',
    plugin: javaEnvPlugin,
    templateId: 'java-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        javaManager: 'jdk',
        javaVersion: '21',
      }),
    verifyPattern: /(openjdk|temurin|version)/i,
  },
  {
    name: 'Java SDKMAN',
    tool: 'java',
    pluginId: 'java-env',
    plugin: javaEnvPlugin,
    templateId: 'java-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        javaManager: 'sdkman',
        javaVersion: '21',
      }),
    verifyPattern: /(openjdk|temurin|version)/i,
  },
  {
    name: 'Python direct',
    tool: 'python',
    pluginId: 'python-env',
    plugin: pythonEnvPlugin,
    templateId: 'python-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        pythonManager: 'python',
        pythonVersion: '3.12.10',
      }),
    verifyPattern: /Python\s+\d+\.\d+\.\d+/,
  },
  {
    name: 'Python conda',
    tool: 'python',
    pluginId: 'python-env',
    plugin: pythonEnvPlugin,
    templateId: 'python-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        pythonManager: 'conda',
        pythonVersion: '3.12.10',
        condaEnvName: 'base',
      }),
    verifyPattern: /Python\s+\d+\.\d+\.\d+/,
  },
  {
    name: 'Git direct',
    tool: 'git',
    pluginId: 'git-env',
    plugin: gitEnvPlugin,
    templateId: 'git-template',
    buildParams: (installRootDir) =>
      withSharedCaches({
        installRootDir,
        gitManager: 'git',
      }),
    verifyPattern: /git version/i,
  },
  ...(isMac
    ? [
        {
          name: 'Git Homebrew',
          tool: 'git',
          pluginId: 'git-env',
          plugin: gitEnvPlugin,
          templateId: 'git-template',
          buildParams: (installRootDir: string) =>
            withSharedCaches({
              installRootDir,
              gitManager: 'homebrew',
            }),
          verifyPattern: /git version/i,
          expectInstallRootAfterInstall: false,
          verifyInstalledState: async () => {
            expect(await isHomebrewGitInstalled()).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isHomebrewGitInstalled()).toBe(false)
          },
        } satisfies RealCycleCase,
      ]
    : []),
  ...(isWindows
    ? [
        {
          name: 'Git Scoop',
          tool: 'git',
          pluginId: 'git-env',
          plugin: gitEnvPlugin,
          templateId: 'git-template',
          buildParams: (installRootDir: string) =>
            withSharedCaches({
              installRootDir,
              gitManager: 'scoop',
            }),
          verifyPattern: /git version/i,
          expectInstallRootAfterInstall: false,
          verifyInstalledState: async () => {
            expect(await isScoopGitInstalled()).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isScoopGitInstalled()).toBe(false)
          },
        } satisfies RealCycleCase,
      ]
    : []),
]

function shouldRunRealCycleCaseInCi(testCase: RealCycleCase): boolean {
  if (!isCi) return true
  const ciTool = process.env.ENVSETUP_CI_TOOL
  if (ciTool) return testCase.tool === ciTool
  return true
}

const realCycleCases = allRealCycleCases.filter(shouldRunRealCycleCaseInCi)

beforeAll(async () => {
  suiteDir = await mkdtemp(join(tmpdir(), 'envsetup-real-cycle-suite-'))
  sharedDownloadCacheDir =
    process.env.ENVSETUP_DOWNLOAD_CACHE_DIR || join(suiteDir, 'download-cache')
  sharedExtractedCacheDir =
    process.env.ENVSETUP_EXTRACTED_CACHE_DIR || join(suiteDir, 'extracted-cache')
  await Promise.all([
    mkdir(sharedDownloadCacheDir, { recursive: true }),
    mkdir(sharedExtractedCacheDir, { recursive: true }),
  ])
  templatesById = new Map(
    (await loadTemplatesFromDirectory(join(process.cwd(), 'fixtures', 'templates'))).map(
      (template) => [template.id, template],
    ),
  )
})

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'envsetup-real-cycle-'))
  tasksDir = join(tmpDir, 'tasks')
  snapshotsDir = join(tmpDir, 'snapshots')
  homeDir = join(tmpDir, 'home')
  await mkdir(homeDir, { recursive: true })
  process.env = {
    ...originalEnv,
    HOME: homeDir,
    ...(isWindows ? { USERPROFILE: homeDir } : {}),
  }
})

afterEach(async () => {
  process.env = { ...originalEnv }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}, cleanupHookTimeout)

afterAll(async () => {
  await rm(suiteDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}, cleanupHookTimeout)

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function collectTaskTrackedPaths(params: Record<string, string>): string[] {
  return [
    ...new Set(
      [params.installRootDir, params.npmCacheDir, params.npmGlobalPrefix].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  ]
}

async function createPreInstallSnapshot(taskId: string, trackedPaths: string[]) {
  const snapshot = await createSnapshot({
    baseDir: snapshotsDir,
    taskId,
    type: 'auto',
    trackedPaths,
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

  const snapshot = await createPreInstallSnapshot(task.id, collectTaskTrackedPaths(params))
  const result = await executeTask({
    task,
    registry: { [testCase.pluginId]: testCase.plugin },
    platform,
    tasksDir,
    dryRun: false,
  })

  return { snapshot, result, params }
}

async function assertRealInstallSucceeded(
  testCase: RealCycleCase,
  installRootDir: string,
  pluginResult: PluginInstallResult | undefined,
  verifyChecks: string[],
  status: string,
  pluginStatus: string,
  pluginSnapshot?: { error?: string; errorCode?: string; logs: string[] },
) {
  if (status !== 'succeeded' || pluginStatus !== 'verified_success') {
    const detail = [
      `[${testCase.name}] task=${status} plugin=${pluginStatus}`,
      pluginSnapshot?.errorCode && `code: ${pluginSnapshot.errorCode}`,
      pluginSnapshot?.error && `error: ${pluginSnapshot.error}`,
      ...(pluginSnapshot?.logs?.slice(-20) ?? []),
    ]
      .filter(Boolean)
      .join('\n')
    console.error(detail)
  }
  expect(status).toBe('succeeded')
  expect(pluginStatus).toBe('verified_success')
  expect(pluginResult?.executionMode).toBe('real_run')
  expect(verifyChecks.join('\n')).toMatch(testCase.verifyPattern)

  if (testCase.expectInstallRootAfterInstall === false) {
    expect(await pathExists(installRootDir)).toBe(false)
  } else {
    expect(await pathExists(installRootDir)).toBe(true)
  }

  await testCase.verifyInstalledState?.()
}

async function assertRealRollbackSucceeded(
  testCase: RealCycleCase,
  snapshotId: string,
  installRootDir: string,
  rollbackCommands?: string[],
) {
  const rollbackResult = await executeRollback(snapshotsDir, snapshotId, [], [installRootDir], {
    rollbackCommands,
  })

  expect(rollbackResult.success).toBe(true)
  expect(rollbackResult.executionMode).toBe('real_run')
  if (testCase.expectInstallRootAfterInstall !== false) {
    expect(rollbackResult.directoriesRemoved).toBe(1)
  }
  expect(await pathExists(installRootDir)).toBe(false)
  await testCase.verifyRolledBackState?.()
}

async function commandSucceeds(file: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(file, args)
    return true
  } catch {
    return false
  }
}

async function isHomebrewGitInstalled(): Promise<boolean> {
  return commandSucceeds('sh', [
    '-c',
    `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; [ -n "$BREW_BIN" ] && "$BREW_BIN" list --versions git >/dev/null 2>&1`,
  ])
}

async function isScoopGitInstalled(): Promise<boolean> {
  return commandSucceeds('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = (Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue).Source }; if (-not $scoop) { $scoop = (Get-Command 'scoop' -ErrorAction SilentlyContinue).Source }; if (-not $scoop) { exit 1 }; if (-not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }; $rawPrefix = & $scoop prefix git 2>$null | Select-Object -First 1; if ($rawPrefix) { $prefix = $rawPrefix.ToString().Trim(); if ($prefix -and [System.IO.Path]::IsPathRooted($prefix) -and (Test-Path $prefix)) { exit 0 } }; $roots = @($env:SCOOP); $roots += Join-Path $env:USERPROFILE 'scoop'; $roots = $roots | Select-Object -Unique; foreach ($r in $roots) { $gc = Join-Path $r 'apps\\git\\current'; if (Test-Path $gc) { exit 0 }; $gd = Join-Path $r 'apps\\git'; if (Test-Path $gd) { $vd = Get-ChildItem -Path $gd -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'current' } | Select-Object -First 1; if ($vd) { exit 0 } } }; exit 1`,
  ])
}

function toTemplateValues(
  testCase: RealCycleCase,
  params: Record<string, string>,
): Record<string, Primitive> {
  const prefix = `${inferTemplateFieldPrefix(testCase.pluginId)}.`
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [`${prefix}${key}`, value]),
  )
}

function getTemplate(testCase: RealCycleCase): ResolvedTemplate {
  const template = templatesById.get(testCase.templateId)
  if (!template) {
    throw new Error(`Template not found: ${testCase.templateId}`)
  }
  return template
}

function expandWindowsEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, key: string) => process.env[key] ?? '')
}

function prependProcessPath(value: string) {
  const pathSeparator = process.platform === 'win32' ? ';' : ':'
  const normalizedValue = process.platform === 'win32' ? expandWindowsEnv(value) : value
  process.env.PATH = [normalizedValue, process.env.PATH ?? ''].filter(Boolean).join(pathSeparator)
}

async function persistUserEnvChanges(changes: EnvChange[]) {
  const userChanges = changes.filter((change) => change.scope === 'user')
  await applyEnvChanges({ changes: userChanges, platform })

  for (const change of userChanges) {
    if (change.kind === 'env') {
      process.env[change.key] = change.value
      continue
    }

    if (change.kind === 'path') {
      prependProcessPath(change.value)
    }
  }
}

async function hydrateDetectionEnvironment(
  testCase: RealCycleCase,
  params: Record<string, string>,
) {
  if (testCase.tool === 'python' && params.pythonManager === 'conda') {
    const installPaths = resolvePythonInstallPaths({
      ...params,
      platform,
      dryRun: false,
    } as Parameters<typeof resolvePythonInstallPaths>[0])
    process.env.CONDA_PREFIX = installPaths.condaEnvDir
    if (platform === 'darwin') {
      prependProcessPath(join(installPaths.condaDir, 'bin'))
    }
  }

  if (testCase.tool === 'java' && params.javaManager === 'sdkman') {
    const installPaths = resolveJavaInstallPaths({
      ...params,
      platform,
      dryRun: false,
    } as Parameters<typeof resolveJavaInstallPaths>[0])
    process.env.SDKMAN_DIR = installPaths.sdkmanDir
  }

  if (testCase.name === 'Git Homebrew') {
    try {
      const { stdout } = await execFileAsync('sh', [
        '-c',
        'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" --prefix git; fi',
      ])
      const prefix = stdout.trim()
      if (prefix.length > 0) {
        prependProcessPath(join(prefix, 'bin'))
      }
    } catch {
      // noop
    }
  }

  if (testCase.name === 'Git Scoop') {
    const scoopRoot = join(process.env.USERPROFILE ?? homeDir, 'scoop')
    process.env.SCOOP = scoopRoot
    prependProcessPath(join(scoopRoot, 'shims'))
  }
}

function pathBelongsToInstallRoot(
  candidatePath: string | undefined,
  installRootDir: string,
): boolean {
  if (!candidatePath) {
    return false
  }

  const normalizedCandidate = resolve(candidatePath)
  const normalizedRoot = resolve(installRootDir)
  const separator = process.platform === 'win32' ? '\\' : '/'

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${separator}`)
  )
}

function isHomebrewGitPath(candidatePath: string | undefined): boolean {
  if (!candidatePath) {
    return false
  }

  const normalizedPath = resolve(candidatePath)
  return (
    normalizedPath === '/opt/homebrew/bin/git' ||
    normalizedPath === '/usr/local/bin/git' ||
    normalizedPath.includes('/Cellar/git/') ||
    normalizedPath.includes('/Homebrew/Cellar/git/') ||
    normalizedPath.includes('/homebrew/opt/git/') ||
    normalizedPath.includes('/usr/local/opt/git/')
  )
}

function isScoopGitPath(candidatePath: string | undefined): boolean {
  return Boolean(candidatePath && resolve(candidatePath).toLowerCase().includes('\\scoop\\'))
}

function isRelevantCleanupDetection(
  testCase: RealCycleCase,
  detection: DetectedEnvironment,
  installRootDir: string,
): boolean {
  if (detection.tool !== testCase.tool) {
    return false
  }

  if (
    pathBelongsToInstallRoot(detection.path, installRootDir) ||
    pathBelongsToInstallRoot(detection.cleanupPath, installRootDir)
  ) {
    return true
  }

  if (testCase.name === 'Git Homebrew') {
    return isHomebrewGitPath(detection.path) || isHomebrewGitPath(detection.cleanupPath)
  }

  if (testCase.name === 'Git Scoop') {
    return (
      detection.source === 'SCOOP' ||
      isScoopGitPath(detection.path) ||
      isScoopGitPath(detection.cleanupPath)
    )
  }

  return false
}

function resolveRealCycleTimeout(testCase: RealCycleCase, scenario: 'fresh' | 'cleanup'): number {
  if (testCase.tool === 'git') {
    return isWindows || scenario === 'cleanup' ? 1_800_000 : 900_000
  }

  if (testCase.tool === 'java') {
    return scenario === 'cleanup' ? 1_200_000 : 900_000
  }

  if (
    testCase.tool === 'python' ||
    testCase.name.includes('SDKMAN') ||
    testCase.name.includes('Homebrew')
  ) {
    return 900_000
  }

  return 600_000
}

function logRealCyclePhase(testCase: RealCycleCase, scenario: 'fresh' | 'cleanup', phase: string) {
  console.info(`[${testCase.name}] ${scenario}: ${phase}`)
}

describe.skipIf(!isRealRun)('action real cycle matrix', () => {
  describe.each(realCycleCases)('$name', (testCase) => {
    it(
      'installs successfully with no existing environment and rolls back for real',
      async () => {
        logRealCyclePhase(testCase, 'fresh', 'starting install')
        const installRootDir = join(
          tmpDir,
          `${testCase.tool}-${testCase.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fresh`,
        )

        expect(await pathExists(installRootDir)).toBe(false)

        const { snapshot, result } = await runRealInstall(testCase, installRootDir)
        const plugin = result.plugins[0]

        logRealCyclePhase(testCase, 'fresh', 'verifying install')
        await assertRealInstallSucceeded(
          testCase,
          installRootDir,
          plugin.lastResult,
          plugin.verifyResult?.checks ?? [],
          result.status,
          plugin.status,
          plugin,
        )

        logRealCyclePhase(testCase, 'fresh', 'rolling back')
        await assertRealRollbackSucceeded(
          testCase,
          snapshot.id,
          installRootDir,
          plugin.lastResult?.rollbackCommands,
        )
      },
      resolveRealCycleTimeout(testCase, 'fresh'),
    )

    it(
      'cleans an existing environment, installs successfully, then rolls back for real',
      async () => {
        logRealCyclePhase(testCase, 'cleanup', 'starting seeded install')
        const installRootDir = join(
          tmpDir,
          `${testCase.tool}-${testCase.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cleanup`,
        )

        const seededInstall = await runRealInstall(testCase, installRootDir)
        const seededPlugin = seededInstall.result.plugins[0]

        logRealCyclePhase(testCase, 'cleanup', 'verifying seeded install')
        await assertRealInstallSucceeded(
          testCase,
          installRootDir,
          seededPlugin.lastResult,
          seededPlugin.verifyResult?.checks ?? [],
          seededInstall.result.status,
          seededPlugin.status,
          seededPlugin,
        )

        await persistUserEnvChanges(seededPlugin.lastResult?.envChanges ?? [])
        await hydrateDetectionEnvironment(testCase, seededInstall.params)

        logRealCyclePhase(testCase, 'cleanup', 'detecting installed environment')
        const detections = await detectTemplateEnvironments(
          getTemplate(testCase),
          toTemplateValues(testCase, seededInstall.params),
        )
        const cleanupTargets = detections.filter(
          (detection) =>
            detection.cleanupSupported &&
            isRelevantCleanupDetection(testCase, detection, installRootDir),
        )

        expect(cleanupTargets.length).toBeGreaterThan(0)

        const cleanupTrackedPaths = await collectCleanupTrackedPaths(cleanupTargets)
        expect(cleanupTrackedPaths.length).toBeGreaterThan(0)

        logRealCyclePhase(testCase, 'cleanup', 'snapshotting pre-cleanup state')
        await updateSnapshotMeta(
          snapshotsDir,
          await createSnapshot({
            baseDir: snapshotsDir,
            taskId: `${seededInstall.result.id}-cleanup`,
            type: 'manual',
            label: 'cleanup-backup',
            trackedPaths: cleanupTrackedPaths,
          }),
        )

        logRealCyclePhase(testCase, 'cleanup', 'cleaning detected environment')
        const cleanupResult = await cleanupDetectedEnvironments(cleanupTargets)
        expect(cleanupResult.errors).toEqual([])

        if (testCase.expectInstallRootAfterInstall === false) {
          await testCase.verifyRolledBackState?.()
        } else {
          expect(await pathExists(installRootDir)).toBe(false)
        }

        logRealCyclePhase(testCase, 'cleanup', 'reinstalling after cleanup')
        const { result } = await runRealInstall(testCase, installRootDir)
        const plugin = result.plugins[0]

        logRealCyclePhase(testCase, 'cleanup', 'verifying reinstall')
        await assertRealInstallSucceeded(
          testCase,
          installRootDir,
          plugin.lastResult,
          plugin.verifyResult?.checks ?? [],
          result.status,
          plugin.status,
          plugin,
        )
        // Full restore-to-pre-cleanup rollback is covered in action-real-rollback.test.ts.
      },
      resolveRealCycleTimeout(testCase, 'cleanup'),
    )
  })
})
