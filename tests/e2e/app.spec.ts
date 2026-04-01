/**
 * 覆盖桌面应用从启动到任务执行的主要端到端流程。
 */

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

test.describe.configure({ timeout: 120_000 })

function resolveDevElectronExecutable(): string {
  if (process.platform === 'darwin') {
    return path.join(
      process.cwd(),
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  }

  if (process.platform === 'win32') {
    return path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
  }

  return path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron')
}

async function launchZhApp(
  env?: NodeJS.ProcessEnv,
): Promise<{ app: ElectronApplication; page: Page }> {
  const dataDir = path.join(
    process.env.RUNNER_TEMP ?? os.tmpdir(),
    `envsetup-dev-data-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const app = await electron.launch({
    executablePath: resolveDevElectronExecutable(),
    args: ['.'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ENVSETUP_SKIP_NETWORK_CHECKS: '1',
      ENVSETUP_DATA_DIR: dataDir,
      ...env,
    },
  })
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
      const completed = await new Promise<Awaited<ReturnType<typeof window.envSetup.startTask>>>(
        (resolve, reject) => {
          let settled = false
          const timeoutId = window.setTimeout(() => {
            if (settled) {
              return
            }
            settled = true
            window.envSetup.removeTaskProgressListener()
            reject(new Error(`Timed out waiting for task_done: ${task.id}`))
          }, 180_000)

          const settle = (nextTask: Awaited<ReturnType<typeof window.envSetup.startTask>>) => {
            if (settled) {
              return
            }
            settled = true
            window.clearTimeout(timeoutId)
            window.envSetup.removeTaskProgressListener()
            resolve(nextTask)
          }

          window.envSetup.onTaskProgress((event) => {
            if (event.taskId === task.id && event.type === 'task_done' && event.taskSnapshot) {
              settle(event.taskSnapshot)
            }
          })

          void (async () => {
            try {
              const started = await window.envSetup.startTask(task.id)
              if (started.status !== 'running') {
                settle(started)
              }
            } catch (error) {
              if (settled) {
                return
              }
              settled = true
              window.clearTimeout(timeoutId)
              window.envSetup.removeTaskProgressListener()
              reject(error)
            }
          })()
        },
      )

      return {
        id: completed.id,
        status: completed.status,
        snapshotId: (completed as typeof completed & { snapshotId?: string }).snapshotId,
        pluginStatuses: completed.plugins.map((plugin) => plugin.status),
        pluginExecutionModes: completed.plugins.map(
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
  await page
    .locator('select[id="git.gitManager"]')
    .selectOption(process.platform === 'win32' ? 'scoop' : 'homebrew')
  await page.locator('select[id="git.gitVersion"]').selectOption({ index: 0 })
}

async function selectMysqlTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'MySQL 数据库环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'MySQL 数据库环境' }).click()
}

async function selectRedisTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Redis 缓存环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Redis 缓存环境' }).click()
}

async function selectMavenTemplate(page: Page) {
  await expect(page.getByRole('button', { name: 'Maven 构建环境' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Maven 构建环境' }).click()
  await page.locator('select[id="maven.mavenVersion"]').selectOption({ index: 0 })
}

async function waitForCreateTaskEnabled(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="create-task-button"]')
    return button instanceof HTMLButtonElement && !button.disabled
  }, { timeout: 30_000 })
}

async function runDryRunFlow(page: Page) {
  await page.getByRole('button', { name: '运行预检' }).click()
  await expect(page.getByTestId('precheck-level-badge')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('precheck-level-badge')).toContainText(/通过|警告|阻塞/, {
    timeout: 30_000,
  })
  await waitForCreateTaskEnabled(page)
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByTestId('task-status-badge')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('task-status-badge')).toContainText(/草稿|就绪|执行中/, {
    timeout: 30_000,
  })
  await page.getByRole('button', { name: '开始执行' }).click()

  await expect(page.getByTestId('task-status-badge')).toContainText(/成功|失败|部分成功|已取消/, {
    timeout: 90_000,
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
  {
    name: 'MySQL',
    templateId: 'mysql-template',
    buildOverrides: (installRoot: string) => ({
      'mysql.mysqlManager': 'package',
      'mysql.installRootDir': installRoot,
    }),
  },
  {
    name: 'Redis',
    templateId: 'redis-template',
    buildOverrides: (installRoot: string) => ({
      'redis.redisManager': 'package',
      'redis.installRootDir': installRoot,
    }),
  },
  {
    name: 'Maven',
    templateId: 'maven-template',
    buildOverrides: (installRoot: string) => ({
      'maven.mavenManager': 'maven',
      'maven.mavenVersion': '3.9.11',
      'maven.installRootDir': installRoot,
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
  await expect(page.getByTestId('precheck-level-badge')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('precheck-level-badge')).toContainText(/通过|警告|阻塞/, {
    timeout: 30_000,
  })

  await waitForCreateTaskEnabled(page)
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByTestId('task-status-badge')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('task-status-badge')).toContainText(/草稿|执行中|就绪/, {
    timeout: 30_000,
  })

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

test('user can run MySQL action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectMysqlTemplate(page)
  await runDryRunFlow(page)
  await app.close()
})

test('user can run Redis action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectRedisTemplate(page)
  await runDryRunFlow(page)
  await app.close()
})

test('user can run Maven action flow in dev dry-run mode', async () => {
  const { app, page } = await launchZhApp({ ENVSETUP_REAL_RUN: undefined as never })
  await selectMavenTemplate(page)
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
