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

type StoredTaskRecord = {
  snapshotId?: string
  params?: Record<string, unknown>
  plugins?: Array<{
    params?: { installRootDir?: unknown }
    lastResult?: { paths?: Record<string, unknown> }
  }>
}

async function resolveLatestTaskRecord(dataDir: string): Promise<StoredTaskRecord | undefined> {
  const tasksDir = path.join(dataDir, 'tasks')

  try {
    const taskFiles = (await fs.readdir(tasksDir))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .reverse()

    for (const taskFile of taskFiles) {
      return JSON.parse(
        await fs.readFile(path.join(tasksDir, taskFile), 'utf8'),
      ) as StoredTaskRecord
    }
  } catch {
    return undefined
  }

  return undefined
}

async function resolveTaskInstallRoot(dataDir: string): Promise<string | undefined> {
  const raw = await resolveLatestTaskRecord(dataDir)
  if (!raw) {
    return undefined
  }

  const resultInstallRoot = raw.plugins?.find(
    (plugin) => typeof plugin.lastResult?.paths?.installRootDir === 'string',
  )?.lastResult?.paths?.installRootDir
  if (typeof resultInstallRoot === 'string' && resultInstallRoot.length > 0) {
    return path.resolve(process.cwd(), resultInstallRoot)
  }

  const pluginInstallRoot = raw.plugins?.find(
    (plugin) => typeof plugin.params?.installRootDir === 'string',
  )?.params?.installRootDir
  if (typeof pluginInstallRoot === 'string' && pluginInstallRoot.length > 0) {
    return path.resolve(process.cwd(), pluginInstallRoot)
  }

  const taskInstallRoot = Object.entries(raw.params ?? {}).find(
    ([key, value]) => key.endsWith('.installRootDir') && typeof value === 'string',
  )?.[1]
  if (typeof taskInstallRoot === 'string' && taskInstallRoot.length > 0) {
    return path.resolve(process.cwd(), taskInstallRoot)
  }

  return undefined
}

async function resolveTaskResultPath(
  dataDir: string,
  pathKey: string,
): Promise<string | undefined> {
  const raw = await resolveLatestTaskRecord(dataDir)
  if (!raw) {
    return undefined
  }

  const resultPath = raw.plugins?.find(
    (plugin) => typeof plugin.lastResult?.paths?.[pathKey] === 'string',
  )?.lastResult?.paths?.[pathKey]

  if (typeof resultPath === 'string' && resultPath.length > 0) {
    return path.resolve(process.cwd(), resultPath)
  }

  return undefined
}

async function resolveTaskSnapshotId(dataDir: string): Promise<string | undefined> {
  const raw = await resolveLatestTaskRecord(dataDir)
  if (typeof raw?.snapshotId === 'string' && raw.snapshotId.length > 0) {
    return raw.snapshotId
  }

  return undefined
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

      if ('mysql.mysqlVersion' in values && bootstrap.mysqlVersions[0]) {
        values['mysql.mysqlVersion'] = bootstrap.mysqlVersions[0]
      }

      if ('redis.redisVersion' in values && bootstrap.redisVersions[0]) {
        values['redis.redisVersion'] = bootstrap.redisVersions[0]
      }

      if ('maven.mavenVersion' in values && bootstrap.mavenVersions[0]) {
        values['maven.mavenVersion'] = bootstrap.mavenVersions[0]
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
  return isHomebrewFormulaInstalled('git')
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

async function isScoopGitInstalled(): Promise<boolean> {
  return isScoopPackageInstalled('git')
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

async function runNodeInstallFlow(page: Page, managerLabel: string) {
  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeManager"]').selectOption({ label: managerLabel })
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
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
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
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
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({ timeout })
}

async function runGitInstallFlow(page: Page, managerLabel: string) {
  await expect(page.getByRole('button', { name: 'Git 版本控制' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Git 版本控制' }).click()
  await page.locator('select[id="git.gitManager"]').selectOption({ label: managerLabel })
  const gitVersionSelect = page.locator('select[id="git.gitVersion"]')
  if (await gitVersionSelect.isVisible().catch(() => false)) {
    await gitVersionSelect.selectOption({ index: 0 })
  }
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 300_000,
  })
}

async function runMysqlInstallFlow(page: Page, managerLabel?: string) {
  await expect(page.getByRole('button', { name: 'MySQL 数据库环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'MySQL 数据库环境' }).click()
  if (managerLabel) {
    await page.locator('select[id="mysql.mysqlManager"]').selectOption({ label: managerLabel })
  }
  const mysqlVersionSelect = page.locator('select[id="mysql.mysqlVersion"]')
  if (await mysqlVersionSelect.isVisible().catch(() => false)) {
    await mysqlVersionSelect.selectOption({ index: 0 })
  }
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 300_000,
  })
}

async function runRedisInstallFlow(page: Page, managerLabel?: string) {
  await expect(page.getByRole('button', { name: 'Redis 缓存环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Redis 缓存环境' }).click()
  if (managerLabel) {
    await page.locator('select[id="redis.redisManager"]').selectOption({ label: managerLabel })
  }
  const redisVersionSelect = page.locator('select[id="redis.redisVersion"]')
  if (await redisVersionSelect.isVisible().catch(() => false)) {
    await redisVersionSelect.selectOption({ index: 0 })
  }
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 300_000,
  })
}

async function runMavenInstallFlow(page: Page, managerLabel?: string, selectVersion = true) {
  await expect(page.getByRole('button', { name: 'Maven 构建环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Maven 构建环境' }).click()
  if (managerLabel) {
    await page.locator('select[id="maven.mavenManager"]').selectOption({ label: managerLabel })
  }
  if (selectVersion) {
    await page.locator('select[id="maven.mavenVersion"]').selectOption({ index: 0 })
  }
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({
    timeout: 300_000,
  })
}

type RealRollbackCase = {
  name: string
  templateId: string
  buildOverrides: (installRoot: string) => Record<string, string>
  expectInstallRootAfterInstall?: boolean
  verifyInstalledState?: (installRoot: string) => Promise<void>
  verifyRolledBackState?: (installRoot: string) => Promise<void>
}

const realRollbackCases: RealRollbackCase[] = [
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
  {
    name: 'mysql direct',
    templateId: 'mysql-template',
    buildOverrides: (installRoot: string) => ({
      'mysql.mysqlManager': 'mysql',
      'mysql.installRootDir': installRoot,
    }),
    verifyInstalledState: async (installRoot: string) => {
      await expect(fs.access(path.join(installRoot, 'mysql'))).resolves.toBeUndefined()
    },
  },
  {
    name: 'maven direct',
    templateId: 'maven-template',
    buildOverrides: (installRoot: string) => ({
      'maven.mavenManager': 'maven',
      'maven.mavenVersion': '3.9.11',
      'maven.installRootDir': installRoot,
    }),
    verifyInstalledState: async (installRoot: string) => {
      await expect(fs.access(path.join(installRoot, 'maven-3.9.11'))).resolves.toBeUndefined()
    },
  },
  {
    name: 'maven package',
    templateId: 'maven-template',
    buildOverrides: (installRoot: string) => ({
      'maven.mavenManager': 'package',
      'maven.installRootDir': installRoot,
    }),
    expectInstallRootAfterInstall: false,
    verifyInstalledState: async () => {
      if (isMac) {
        expect(await isHomebrewFormulaInstalled('maven')).toBe(true)
      }
      if (isWindows) {
        expect(await isScoopPackageInstalled('maven')).toBe(true)
      }
    },
    verifyRolledBackState: async () => {
      if (isMac) {
        expect(await isHomebrewFormulaInstalled('maven')).toBe(false)
      }
      if (isWindows) {
        expect(await isScoopPackageInstalled('maven')).toBe(false)
      }
    },
  },
  ...(isMac
    ? [
        {
          name: 'redis direct',
          templateId: 'redis-template',
          buildOverrides: (installRoot: string) => ({
            'redis.redisManager': 'redis',
            'redis.installRootDir': installRoot,
          }),
          verifyInstalledState: async (installRoot: string) => {
            await expect(
              fs.access(path.join(installRoot, 'redis', 'src', 'redis-server')),
            ).resolves.toBeUndefined()
          },
        },
        {
          name: 'mysql package',
          templateId: 'mysql-template',
          buildOverrides: (installRoot: string) => ({
            'mysql.mysqlManager': 'package',
            'mysql.installRootDir': installRoot,
          }),
          expectInstallRootAfterInstall: false,
          verifyInstalledState: async () => {
            expect(await isHomebrewFormulaInstalled('mysql')).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isHomebrewFormulaInstalled('mysql')).toBe(false)
          },
        },
        {
          name: 'redis package',
          templateId: 'redis-template',
          buildOverrides: (installRoot: string) => ({
            'redis.redisManager': 'package',
            'redis.installRootDir': installRoot,
          }),
          expectInstallRootAfterInstall: false,
          verifyInstalledState: async () => {
            expect(await isHomebrewFormulaInstalled('redis')).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isHomebrewFormulaInstalled('redis')).toBe(false)
          },
        },
      ]
    : []),
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
          name: 'redis direct',
          templateId: 'redis-template',
          buildOverrides: (installRoot: string) => ({
            'redis.redisManager': 'redis',
            'redis.installRootDir': installRoot,
          }),
          verifyInstalledState: async (installRoot: string) => {
            await expect(fs.access(path.join(installRoot, 'redis'))).resolves.toBeUndefined()
          },
        },
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
        {
          name: 'mysql package',
          templateId: 'mysql-template',
          buildOverrides: (installRoot: string) => ({
            'mysql.mysqlManager': 'package',
            'mysql.installRootDir': installRoot,
          }),
          expectInstallRootAfterInstall: false,
          verifyInstalledState: async () => {
            expect(await isScoopPackageInstalled('mysql')).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isScoopPackageInstalled('mysql')).toBe(false)
          },
        },
        {
          name: 'redis package',
          templateId: 'redis-template',
          buildOverrides: (installRoot: string) => ({
            'redis.redisManager': 'package',
            'redis.installRootDir': installRoot,
          }),
          expectInstallRootAfterInstall: false,
          verifyInstalledState: async () => {
            expect(await isScoopPackageInstalled('redis')).toBe(true)
          },
          verifyRolledBackState: async () => {
            expect(await isScoopPackageInstalled('redis')).toBe(false)
          },
        },
      ]
    : []),
]

test.describe('real install', () => {
  test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')
  // Packaged E2E stays as a smoke suite. The manager/platform matrix is covered by
  // tests/integration/action-real-cycle-matrix.test.ts and
  // tests/integration/action-real-rollback-matrix.test.ts, while this suite verifies a
  // small representative set of real-run flows against the packaged Electron binary.

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

  // ============================================================
  // MySQL / Redis / Maven
  // ============================================================

  test('mysql direct install reaches terminal success path', async () => {
    test.setTimeout(600_000)
    const installRoot = makeInstallRoot('mysql-direct')
    const { app, page, dataDir } = await launchRealRunApp(installRoot)
    try {
      await runMysqlInstallFlow(page, '直接安装 MySQL 官方归档')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
      const actualInstallRoot = (await resolveTaskInstallRoot(dataDir)) ?? installRoot
      await expect(fs.access(path.join(actualInstallRoot, 'mysql'))).resolves.toBeUndefined()
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test('mysql package install reaches terminal success path', async () => {
    test.setTimeout(300_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('mysql-package'))
    try {
      await runMysqlInstallFlow(page, '使用平台包管理器安装')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
      expect(
        await (isMac ? isHomebrewFormulaInstalled('mysql') : isScoopPackageInstalled('mysql')),
      ).toBe(true)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test('redis direct install reaches terminal success path', async () => {
    test.setTimeout(600_000)
    const installRoot = makeInstallRoot('redis-direct')
    const { app, page, dataDir } = await launchRealRunApp(installRoot)
    try {
      await runRedisInstallFlow(page, '直接安装 Redis 官方发行版')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
      const actualInstallRoot = (await resolveTaskInstallRoot(dataDir)) ?? installRoot
      await expect(fs.access(path.join(actualInstallRoot, 'redis'))).resolves.toBeUndefined()
      if (isWindows) {
        const snapshotId = await resolveTaskSnapshotId(dataDir)
        if (!snapshotId) {
          throw new Error(`Redis direct packaged task snapshot not found in ${dataDir}`)
        }
        const rollbackResult = await executeRollbackViaApp(page, snapshotId, actualInstallRoot)
        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.executionMode).toBe('real_run')
      }
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test('redis package install reaches terminal success path', async () => {
    test.setTimeout(300_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('redis-package'))
    try {
      await runRedisInstallFlow(page, '使用平台包管理器安装')
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
      expect(
        await (isMac ? isHomebrewFormulaInstalled('redis') : isScoopPackageInstalled('redis')),
      ).toBe(true)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test('maven package install reaches terminal success path', async () => {
    test.setTimeout(300_000)
    const { app, page, dataDir } = await launchRealRunApp(makeInstallRoot('maven-package'))
    try {
      await runMavenInstallFlow(page, '使用平台包管理器安装', false)
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
      expect(
        await (isMac ? isHomebrewFormulaInstalled('maven') : isScoopPackageInstalled('maven')),
      ).toBe(true)
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })

  test('maven direct install reaches terminal success path', async () => {
    test.setTimeout(300_000)
    const installRoot = makeInstallRoot('maven-direct')
    const { app, page, dataDir } = await launchRealRunApp(installRoot)
    try {
      await runMavenInstallFlow(page)
      await dumpTaskLogs(dataDir)
      await expect(page.getByText(/^失败$|^Failed$/)).toHaveCount(0)
      const actualMavenDir =
        (await resolveTaskResultPath(dataDir, 'mavenDir')) ??
        path.join((await resolveTaskInstallRoot(dataDir)) ?? installRoot, 'maven-3.9.11')
      await expect(fs.access(actualMavenDir)).resolves.toBeUndefined()
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
      const packagedRollbackCases = new Set([
        'node nvm',
        'mysql direct',
        'mysql package',
        'redis direct',
        'redis package',
        'maven package',
        'maven direct',
      ])
      test.skip(
        !packagedRollbackCases.has(testCase.name),
        'Packaged E2E keeps a small real rollback smoke set; the full manager matrix lives in integration tests.',
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
        await testCase.verifyInstalledState?.(installRoot)

        const rollbackResult = await executeRollbackViaApp(page, started.snapshotId!, installRoot)

        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.executionMode).toBe('real_run')
        if (testCase.expectInstallRootAfterInstall !== false) {
          expect(rollbackResult.directoriesRemoved).toBeGreaterThanOrEqual(1)
        }
        await expect(fs.access(installRoot)).rejects.toThrow()
        await testCase.verifyRolledBackState?.(installRoot)
      } finally {
        await dumpTaskLogs(dataDir)
        await app.close().catch(() => {})
        await cleanupInstallRoot(installRoot)
      }
    })
  }
})
