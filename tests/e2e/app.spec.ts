import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

async function launchZhApp(
  env?: NodeJS.ProcessEnv,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ...env } })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('envsetup.locale', 'zh-CN'))
  await page.reload()
  return { app, page }
}

function makeInstallRoot(name: string): string {
  return process.env.RUNNER_TEMP
    ? path.join(process.env.RUNNER_TEMP, `envsetup-dev-${name}`)
    : path.join(os.tmpdir(), `envsetup-dev-${name}`)
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
      const templates = await window.envSetup.listTemplates()
      const template = templates.find((entry) => entry.id === templateId)
      if (!template) {
        throw new Error(`Template not found: ${templateId}`)
      }

      const values = Object.fromEntries(
        Object.values(template.fields).map((field) => [field.key, field.value]),
      ) as Record<string, string>

      if ('node.nodeVersion' in values) {
        const nodeVersions = await window.envSetup.listNodeLtsVersions()
        if (nodeVersions[0]) {
          values['node.nodeVersion'] = nodeVersions[0]
        }
      }

      if ('java.javaVersion' in values) {
        const javaVersions = await window.envSetup.listJavaLtsVersions()
        if (javaVersions[0]) {
          values['java.javaVersion'] = javaVersions[0]
        }
      }

      if ('python.pythonVersion' in values) {
        const pythonVersions = await window.envSetup.listPythonVersions()
        if (pythonVersions[0]) {
          values['python.pythonVersion'] = pythonVersions[0]
        }
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

async function selectNodeTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Node.js 开发环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Node.js 开发环境' }).click()
  await page.locator('select[id="node.nodeVersion"]').selectOption({ index: 0 })
}

async function selectJavaTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Java 开发环境' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Java 开发环境' }).click()
  await page.locator('select[id="java.javaVersion"]').selectOption({ index: 0 })
}

async function selectPythonTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Python 开发环境' })).toBeVisible({
    timeout: 15_000,
  })
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

const dryRunRollbackCases = [
  {
    name: 'Node.js',
    templateId: 'node-template',
    buildOverrides: (installRoot: string) => ({
      'node.nodeManager': 'node',
      'node.installRootDir': installRoot,
      'node.npmCacheDir': `${installRoot}-cache`,
      'node.npmGlobalPrefix': `${installRoot}-global`,
    }),
  },
  {
    name: 'Java',
    templateId: 'java-template',
    buildOverrides: (installRoot: string) => ({
      'java.javaManager': 'jdk',
      'java.installRootDir': installRoot,
    }),
  },
  {
    name: 'Python',
    templateId: 'python-template',
    buildOverrides: (installRoot: string) => ({
      'python.pythonManager': 'conda',
      'python.installRootDir': installRoot,
      'python.condaEnvName': 'base',
    }),
  },
  {
    name: 'Git',
    templateId: 'git-template',
    buildOverrides: (installRoot: string) => ({
      'git.gitManager': 'git',
      'git.installRootDir': installRoot,
    }),
  },
] as const

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

test.describe('dev dry-run rollback', () => {
  for (const testCase of dryRunRollbackCases) {
    test(`${testCase.name} rollback remains simulated in dev mode`, async () => {
      const installRoot = makeInstallRoot(`${testCase.templateId}-rollback`)
      const markerPath = path.join(installRoot, 'marker.txt')
      await fs.rm(installRoot, { recursive: true, force: true })

      const { app, page } = await launchZhApp()

      try {
        const started = await createAndStartTask(
          page,
          testCase.templateId,
          testCase.buildOverrides(installRoot),
        )

        expect(started.status).toBe('succeeded')
        expect(started.snapshotId).toBeTruthy()
        expect(started.pluginStatuses).toContain('verified_success')
        expect(started.pluginExecutionModes).toContain('dry_run')

        await fs.mkdir(installRoot, { recursive: true })
        await fs.writeFile(markerPath, 'should-stay')

        const rollbackResult = await executeRollbackViaApp(page, started.snapshotId!, installRoot)

        expect(rollbackResult.success).toBe(true)
        expect(rollbackResult.executionMode).toBe('dry_run')
        await expect(fs.readFile(markerPath, 'utf8')).resolves.toBe('should-stay')
      } finally {
        await fs.rm(installRoot, { recursive: true, force: true })
        await app.close()
      }
    })
  }
})
