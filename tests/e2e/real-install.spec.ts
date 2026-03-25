import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

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

async function launchRealRunApp(installRoot: string): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = path.join(process.cwd(), '.envsetup-data')
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ENVSETUP_REAL_RUN: '1',
      ENVSETUP_INSTALL_ROOT: installRoot,
    },
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()
  return { app, page, dataDir }
}

async function runNodeInstallFlow(page: Page, managerLabel: string) {
  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeManager"]').selectOption({ label: managerLabel })
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({ timeout: 150_000 })
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
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({ timeout: 300_000 })
}

async function runPythonInstallFlow(page: Page, managerLabel: string, timeout = 300_000) {
  await expect(page.getByRole('button', { name: 'Python 开发环境' })).toBeVisible({ timeout: 15_000 })
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
  await expect(page.getByText(/成功|失败|部分成功|校验成功/).first()).toBeVisible({ timeout: 300_000 })
}

test.describe('real install', () => {
  test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')

  // ============================================================
  // Node.js
  // ============================================================

  test('node direct install reaches terminal success path', async () => {
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

  test('java jdk install reaches terminal success path', async () => {
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

  test('java sdkman install reaches terminal success path', async () => {
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

  test('python conda install reaches terminal success path', async () => {
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

  // ============================================================
  // Git
  // ============================================================

  test('git direct install reaches terminal success path', async () => {
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

  test('git homebrew install reaches terminal success path', async () => {
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

  test('git scoop install reaches terminal success path', async () => {
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
