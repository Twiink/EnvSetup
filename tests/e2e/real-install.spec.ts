/**
 * 覆盖打包应用中的真实安装端到端场景。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const execFileAsync = promisify(execFile)

async function walkFiles(rootDir: string, maxDepth = 5): Promise<string[]> {
  async function visit(currentDir: string, depth: number, acc: string[]) {
    if (depth > maxDepth) {
      return
    }
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name)
      acc.push(entryPath)
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1, acc)
      }
    }
  }

  const files: string[] = []
  await visit(rootDir, 0, files)
  return files
}

async function resolvePackagedExecutable(): Promise<string | undefined> {
  if (process.env.ENVSETUP_ELECTRON_EXECUTABLE) {
    return process.env.ENVSETUP_ELECTRON_EXECUTABLE
  }

  if (process.env.ENVSETUP_PACKAGED_RUN !== '1') {
    return undefined
  }

  const distDir = path.join(process.cwd(), 'dist')
  const files = await walkFiles(distDir, 6)

  if (isMac) {
    const appBundle = files.find((entry) => entry.endsWith('.app'))
    if (!appBundle) {
      throw new Error(`Packaged macOS app not found under ${distDir}`)
    }
    const macOsDir = path.join(appBundle, 'Contents', 'MacOS')
    const binaries = await fs.readdir(macOsDir)
    if (!binaries[0]) {
      throw new Error(`Packaged macOS binary not found in ${macOsDir}`)
    }
    return path.join(macOsDir, binaries[0])
  }

  if (isWindows) {
    const executable = files.find(
      (entry) => entry.toLowerCase().includes('unpacked') && entry.toLowerCase().endsWith('.exe'),
    )
    if (!executable) {
      throw new Error(`Packaged Windows executable not found under ${distDir}`)
    }
    return executable
  }

  return undefined
}

async function dumpTaskLogs(dataDir: string): Promise<void> {
  const tasksDir = path.join(dataDir, 'tasks')
  try {
    const files = await fs.readdir(tasksDir)
    const logFiles = files.filter((f) => f.endsWith('.log'))
    for (const f of logFiles) {
      const content = await fs.readFile(path.join(tasksDir, f), 'utf8')
      console.log(`\n=== Task log: ${f} ===\n${content}\n=== end ${f} ===`)
    }
  } catch {
    console.log(`(no task logs found in ${tasksDir})`)
  }
}

function makeInstallRoot(name: string): string {
  return process.env.RUNNER_TEMP
    ? path.join(process.env.RUNNER_TEMP, `envsetup-e2e-${name}`)
    : path.join(os.tmpdir(), `envsetup-e2e-${name}`)
}

function makeDataDir(name: string): string {
  return path.join(process.cwd(), 'test-results', `envsetup-real-${name}-data`)
}

function toCaseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function cleanupInstallRoot(installRoot: string): Promise<void> {
  try {
    await fs.rm(installRoot, { recursive: true, force: true })
  } catch {
    // Real-install E2E should not fail on best-effort local cleanup.
  }
}

async function launchRealRunApp(
  installRoot: string,
): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = makeDataDir(path.basename(installRoot))
  await fs.rm(dataDir, { recursive: true, force: true })
  const executablePath = await resolvePackagedExecutable()
  const app = await electron.launch({
    args: executablePath ? [] : ['.'],
    cwd: process.cwd(),
    executablePath,
    env: {
      ...process.env,
      ENVSETUP_REAL_RUN: '1',
      ENVSETUP_PACKAGED_RUN: process.env.ENVSETUP_PACKAGED_RUN,
      ENVSETUP_INSTALL_ROOT: installRoot,
      ENVSETUP_DATA_DIR: dataDir,
    },
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()
  return { app, page, dataDir }
}

async function createAndStartTask(
  page: Page,
  templateId: string,
  overrides: Record<string, string>,
): Promise<{
  id: string
  status: string
  snapshotId?: string
  pluginStatuses: string[]
  pluginExecutionModes: Array<string | null>
}> {
  return page.evaluate(
    async ({ templateId, overrides }) => {
      const bootstrap = await window.envSetup.loadBootstrap()
      const template = bootstrap.templates.find((entry) => entry.id === templateId)
      if (!template) {
        throw new Error(`Template not found: ${templateId}`)
      }

      const values = Object.fromEntries(
        Object.values(template.fields).map((field) => [field.key, field.value]),
      ) as Record<string, string>

      if ('node.nodeVersion' in values && bootstrap.nodeLtsVersions[0]) {
        values['node.nodeVersion'] = bootstrap.nodeLtsVersions[0]
      }

      if ('java.javaVersion' in values && bootstrap.javaLtsVersions[0]) {
        values['java.javaVersion'] = bootstrap.javaLtsVersions[0]
      }

      if ('python.pythonVersion' in values && bootstrap.pythonVersions[0]) {
        values['python.pythonVersion'] = bootstrap.pythonVersions[0]
      }

      if ('git.gitVersion' in values && bootstrap.gitVersions[0]) {
        values['git.gitVersion'] = bootstrap.gitVersions[0]
      }

      Object.assign(values, overrides)

      const task = await window.envSetup.createTask({
        templateId,
        values,
        locale: 'zh-CN',
      })
      const started = await window.envSetup.startTask(task.id)

      return {
        id: started.id,
        status: started.status,
        snapshotId: (started as typeof started & { snapshotId?: string }).snapshotId,
        pluginStatuses: started.plugins.map((plugin) => plugin.status),
        pluginExecutionModes: started.plugins.map(
          (plugin) => plugin.lastResult?.executionMode ?? null,
        ),
      }
    },
    { templateId, overrides },
  )
}

async function executeRollbackViaApp(page: Page, snapshotId: string, installRoot: string) {
  return page.evaluate(
    async ({ snapshotId, installRoot }) =>
      window.envSetup.executeRollback({
        snapshotId,
        installPaths: [installRoot],
      }),
    { snapshotId, installRoot },
  )
}

async function isHomebrewGitInstalled(): Promise<boolean> {
  try {
    await execFileAsync('sh', [
      '-c',
      `BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; [ -n "$BREW_BIN" ] && "$BREW_BIN" list --versions git >/dev/null 2>&1`,
    ])
    return true
  } catch {
    return false
  }
}

async function isScoopGitInstalled(): Promise<boolean> {
  try {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = (Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue).Source }; if (-not $scoop) { $scoop = (Get-Command 'scoop' -ErrorAction SilentlyContinue).Source }; if (-not $scoop) { exit 1 }; if (-not $env:SCOOP) { $env:SCOOP = Split-Path (Split-Path $scoop -Parent) -Parent }; $rawPrefix = & $scoop prefix git 2>$null | Select-Object -First 1; if ($rawPrefix) { $prefix = $rawPrefix.ToString().Trim(); if ($prefix -and [System.IO.Path]::IsPathRooted($prefix) -and (Test-Path $prefix)) { exit 0 } }; $roots = @($env:SCOOP); $roots += Join-Path $env:USERPROFILE 'scoop'; $roots = $roots | Select-Object -Unique; foreach ($r in $roots) { $gc = Join-Path $r 'apps\\git\\current'; if (Test-Path $gc) { exit 0 }; $gd = Join-Path $r 'apps\\git'; if (Test-Path $gd) { $vd = Get-ChildItem -Path $gd -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'current' } | Select-Object -First 1; if ($vd) { exit 0 } } }; exit 1`,
    ])
    return true
  } catch {
    return false
  }
}

async function runNodeInstallFlow(page: Page, managerLabel: string) {
  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeManager"]').selectOption({ label: managerLabel })
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 150_000,
  })
}

async function runJavaInstallFlow(page: Page, managerLabel: string) {
  await expect(page.getByRole('button', { name: 'Java 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Java 开发环境' }).click()
  await page.locator('select[id="java.javaManager"]').selectOption({ label: managerLabel })
  await page.locator('select[id="java.javaVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 300_000,
  })
}

async function runPythonInstallFlow(page: Page, managerLabel: string, timeout = 300_000) {
  await expect(page.getByRole('button', { name: 'Python 开发环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Python 开发环境' }).click()
  await page.locator('select[id="python.pythonManager"]').selectOption({ label: managerLabel })
  await page.locator('select[id="python.pythonVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({ timeout })
}

async function runGitInstallFlow(page: Page, managerLabel: string) {
  await expect(page.getByRole('button', { name: 'Git 版本控制' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Git 版本控制' }).click()
  await page.locator('select[id="git.gitManager"]').selectOption({ label: managerLabel })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 300_000,
  })
}

const realRollbackCases = [
  {
    name: 'node direct',
    templateId: 'node-template',
    buildOverrides: (installRoot: string) => ({
      'node.nodeManager': 'node',
      'node.installRootDir': installRoot,
      'node.npmCacheDir': `${installRoot}-cache`,
      'node.npmGlobalPrefix': `${installRoot}-global`,
    }),
  },
  {
    name: 'node nvm',
    templateId: 'node-template',
    buildOverrides: (installRoot: string) => ({
      'node.nodeManager': 'nvm',
      'node.installRootDir': installRoot,
      'node.npmCacheDir': `${installRoot}-cache`,
      'node.npmGlobalPrefix': `${installRoot}-global`,
    }),
  },
  {
    name: 'java jdk',
    templateId: 'java-template',
    buildOverrides: (installRoot: string) => ({
      'java.javaManager': 'jdk',
      'java.installRootDir': installRoot,
    }),
  },
  {
    name: 'java sdkman',
    templateId: 'java-template',
    buildOverrides: (installRoot: string) => ({
      'java.javaManager': 'sdkman',
      'java.installRootDir': installRoot,
    }),
  },
  {
    name: 'python direct',
    templateId: 'python-template',
    buildOverrides: (installRoot: string) => ({
      'python.pythonManager': 'python',
      'python.pythonVersion': '3.12.10',
      'python.installRootDir': installRoot,
    }),
  },
  {
    name: 'python conda',
    templateId: 'python-template',
    buildOverrides: (installRoot: string) => ({
      'python.pythonManager': 'conda',
      'python.installRootDir': installRoot,
      'python.condaEnvName': 'base',
    }),
  },
  {
    name: 'git direct',
    templateId: 'git-template',
    buildOverrides: (installRoot: string) => ({
      'git.gitManager': 'git',
      'git.installRootDir': installRoot,
    }),
  },
  ...(isMac
    ? [
        {
          name: 'git homebrew',
          templateId: 'git-template',
          buildOverrides: (installRoot: string) => ({
            'git.gitManager': 'homebrew',
            'git.installRootDir': installRoot,
          }),
          verifyInstalledState: async () => {
            expect(await isHomebrewGitInstalled()).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isHomebrewGitInstalled()).toBe(false)
          },
        },
      ]
    : []),
  ...(isWindows
    ? [
        {
          name: 'git scoop',
          templateId: 'git-template',
          buildOverrides: (installRoot: string) => ({
            'git.gitManager': 'scoop',
            'git.installRootDir': installRoot,
          }),
          verifyInstalledState: async () => {
            expect(await isScoopGitInstalled()).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isScoopGitInstalled()).toBe(false)
          },
        },
      ]
    : []),
] as const

test.describe('real install', () => {
  test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')
  // Packaged E2E stays as a smoke suite. The manager/platform matrix is covered by
  // tests/integration/action-real-cycle-matrix.test.ts, while this suite only verifies
  // that the packaged Electron binary can execute a representative real-run flow end-to-end.

  // ============================================================
  // Node.js
  // ============================================================

  test.skip('node direct install reaches terminal success path', async () => {
    test.setTimeout(180_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('node-direct'))
    try {
      await runNodeInstallFlow(page, '直接安装 Node.js')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test('node nvm install reaches terminal success path', async () => {
    test.setTimeout(180_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('node-nvm'))
    try {
      await runNodeInstallFlow(page, '使用 nvm 管理 Node.js')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  // ============================================================
  // Java
  // ============================================================

  test.skip('java jdk install reaches terminal success path', async () => {
    test.setTimeout(300_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('java-jdk'))
    try {
      await runJavaInstallFlow(page, '直接安装 JDK (Temurin)')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test.skip('java sdkman install reaches terminal success path', async () => {
    test.setTimeout(600_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('java-sdkman'))
    try {
      await runJavaInstallFlow(page, '使用 SDKMAN 管理 Java')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  // ============================================================
  // Python
  // ============================================================

  test.skip('python conda install reaches terminal success path', async () => {
    test.setTimeout(600_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('python-conda'))
    try {
      await runPythonInstallFlow(page, '使用 Miniconda 管理 Python', 600_000)
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test.skip('python direct install reaches terminal success path', async () => {
    test.setTimeout(600_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('python-direct'))
    try {
      await runPythonInstallFlow(page, '直接安装 Python', 600_000)
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  // ============================================================
  // Git
  // ============================================================

  test.skip('git direct install reaches terminal success path', async () => {
    test.setTimeout(300_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('git-direct'))
    try {
      await runGitInstallFlow(page, '直接安装 Git')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test.skip('git homebrew install reaches terminal success path', async () => {
    test.skip(!isMac, 'Homebrew macOS only')
    test.setTimeout(600_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('git-homebrew'))
    try {
      await runGitInstallFlow(page, '使用 Homebrew 安装 Git')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test.skip('git scoop install reaches terminal success path', async () => {
    test.skip(!isWindows, 'Scoop Windows only')
    test.setTimeout(300_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('git-scoop'))
    try {
      await runGitInstallFlow(page, '使用 Scoop 安装 Git')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })
})

test.describe('real rollback via built Electron app IPC', () => {
  test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')

  for (const testCase of realRollbackCases) {
    test(`${testCase.name} removes installed directory`, async () => {
      test.skip(
        testCase.name !== 'node nvm',
        'Packaged E2E keeps one representative real rollback case; full manager coverage lives in integration tests.',
      )
      test.setTimeout(600_000)
      const installRoot = makeInstallRoot(`rollback-${toCaseSlug(testCase.name)}`)
      await cleanupInstallRoot(installRoot)

      const { app, page, dataDir } = await launchRealRunApp(installRoot)

      try {
        const started = await createAndStartTask(
          page,
          testCase.templateId,
          testCase.buildOverrides(installRoot),
        )

        expect(started.status).toBe('succeeded')
        expect(started.snapshotId).toBeTruthy()
        expect(started.pluginStatuses).toContain('verified_success')
        expect(started.pluginExecutionModes).toContain('real_run')
        await testCase.verifyInstalledState?.()

        const rollbackResult = await executeRollbackViaApp(page, started.snapshotId!, installRoot)

        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.executionMode).toBe('real_run')
        expect(rollbackResult.directoriesRemoved).toBeGreaterThanOrEqual(1)
        await expect(fs.access(installRoot)).rejects.toThrow()
        await testCase.verifyRolledBackState?.()
      } finally {
        await dumpTaskLogs(dataDir)
        await app.close().catch(() => {})
        await cleanupInstallRoot(installRoot)
      }
    })
  }
})
