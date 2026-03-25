import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and shows envsetup shell', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()

  await expect(page.getByRole('heading', { name: '开工吧' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '团队标准模板' })).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'EnvSetup' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Team Standard Templates' })).toBeVisible()

  await app.close()
})

test('user can select template and create task', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()

  // Wait for templates to load asynchronously before interacting
  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible()
  await expect(page.getByRole('button', { name: '创建任务' })).toBeEnabled()
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|执行中|就绪/)).toBeVisible()

  await app.close()
})

test('dev mode defaults to dry-run when starting a task', async () => {
  // Launch without ENVSETUP_REAL_RUN — dev mode should default to dry-run
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ENVSETUP_REAL_RUN: undefined,
    },
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()

  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: '开始执行' }).click()

  // In dev mode (not packaged), the default is dry-run.
  // Expect the plugin to finish and show the dry-run summary text.
  await expect(page.getByText(/已生成.*演练计划|校验成功|成功/).first()).toBeVisible({
    timeout: 60_000,
  })

  await app.close()
})
