import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'

const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'

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

test.describe('real install', () => {
  test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')

  test('frontend env installs nvm and node successfully', async () => {
    test.setTimeout(180_000)

    const installRoot = process.env.RUNNER_TEMP
      ? path.join(process.env.RUNNER_TEMP, 'envsetup-e2e')
      : path.join(os.tmpdir(), 'envsetup-e2e')

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

    try {
      // Wait for templates to load asynchronously, then select frontend template
      await expect(page.getByRole('button', { name: '前端开发环境' })).toBeVisible({ timeout: 15_000 })
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
      await page.getByRole('button', { name: '开始执行' }).click()

      // Wait for task to reach terminal state (success or failure)
      await expect(page.getByText(/verified_success|succeeded|全部完成|failed|失败/).first()).toBeVisible({
        timeout: 150_000,
      })

      // Dump logs regardless of outcome so CI artifacts contain full details
      await dumpTaskLogs(dataDir)

      // Fail the test if the task actually failed
      const didFail = await page.getByText(/failed|失败/).first().isVisible()
      if (didFail) {
        throw new Error('Task reached failed state — see task log output above for details')
      }
    } finally {
      await dumpTaskLogs(dataDir)
      await app.close()
    }
  })
})
