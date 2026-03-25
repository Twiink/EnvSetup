import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

async function launchZhApp(env?: NodeJS.ProcessEnv): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ...env } })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()
  return { app, page }
}

async function selectNodeTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
}

async function selectJavaTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Java 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Java 开发环境' }).click()
  await page.locator('select[id="java.javaVersion"]').selectOption({ index: 0 })
}

async function selectPythonTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Python 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Python 开发环境' }).click()
  await page.locator('select[id="python.pythonVersion"]').selectOption({ index: 0 })
}

async function selectGitTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Git 版本控制' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Git 版本控制' }).click()
}

async function runDryRunFlow(page: Page) {
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })

  const cleanupButton = page.getByRole('button', { name: '一键清理' }).first()
  if (await cleanupButton.isVisible().catch(() => false)) {
    await cleanupButton.click()
    await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })
  }

  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '开始执行' }).click()

  await expect(page.getByText(/已生成|校验成功|成功|失败|部分成功/).first()).toBeVisible({
    timeout: 60_000,
  })
}

test('app launches and shows envsetup shell', async () => {
  const { app, page } = await launchZhApp()

  await expect(page.getByRole('heading', { name: '开工吧' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '团队标准模板' })).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'EnvSetup' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Team Standard Templates' })).toBeVisible()

  await app.close()
})

test('user can select template and create task', async () => {
  const { app, page } = await launchZhApp()

  await selectNodeTemplate(page)
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible()
  await expect(page.getByRole('button', { name: '创建任务' })).toBeEnabled()
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|执行中|就绪/)).toBeVisible()

  await app.close()
})

test('user can run Node.js action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectNodeTemplate(page)
  await runDryRunFlow(page)
  await app.close()
})

test('user can run Java action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectJavaTemplate(page)
  await runDryRunFlow(page)
  await app.close()
})

test('user can run Python action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectPythonTemplate(page)
  await runDryRunFlow(page)
  await app.close()
})

test('user can run Git action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectGitTemplate(page)
  await runDryRunFlow(page)
  await app.close()
})
