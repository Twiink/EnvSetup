import os from 'node:os'
import { test, expect, _electron as electron } from '@playwright/test'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'

test.describe('real install', () => {
  test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')

  test('frontend env installs nvm and node successfully', async () => {
    test.setTimeout(180_000)

    const installRoot = process.env.RUNNER_TEMP ?? os.tmpdir()

    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        ENVSETUP_REAL_RUN: '1',
        ENVSETUP_INSTALL_ROOT: installRoot,
      },
    })

    const page = await app.firstWindow()

    // Select frontend template
    await page.getByRole('button', { name: '前端开发环境' }).click()

    // Select first LTS version from dropdown
    await page.locator('select[id="frontend.nodeVersion"]').selectOption({ index: 0 })

    // Run precheck
    await page.getByRole('button', { name: '运行预检' }).click()
    await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })

    // Create task
    await page.getByRole('button', { name: '创建任务' }).click()
    await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })

    // Start task
    await page.getByRole('button', { name: '启动任务' }).click()

    // Wait for task to reach terminal state
    await expect(page.getByText(/verified_success|succeeded|全部完成/)).toBeVisible({
      timeout: 150_000,
    })

    await app.close()
  })
})
