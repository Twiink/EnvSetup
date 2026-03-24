import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and shows envsetup shell', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()

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

  await page.getByRole('button', { name: '前端开发环境' }).click()
  await page.locator('select[id="frontend.nodeVersion"]').selectOption({ index: 0 })
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible()
  await expect(page.getByRole('button', { name: '创建任务' })).toBeEnabled()
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText(/草稿|执行中|就绪/)).toBeVisible()

  await app.close()
})
