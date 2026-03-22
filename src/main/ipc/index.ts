import { ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { ensureAppPaths } from '../core/appPaths'
import { importPluginFromDirectory, importPluginFromZip } from '../core/plugin'
import { buildRuntimePrecheckInput, runPrecheck } from '../core/precheck'
import {
  createTask,
  executeTask,
  loadTask,
  persistTask,
  retryTaskPlugin,
  type PluginRegistry,
} from '../core/task'
import { loadTemplatesFromDirectory, mapTemplateValuesToPluginParams } from '../core/template'
import type { InstallTask, Primitive, ResolvedTemplate } from '../core/contracts'
import frontendEnvPlugin from '../plugins/frontendEnvPlugin'
import { normalizeLocale } from '../../shared/locale'

const BUILTIN_TEMPLATE_DIR = join(process.cwd(), 'fixtures', 'templates')
const BUILTIN_PLUGINS: PluginRegistry = {
  'frontend-env': frontendEnvPlugin,
}

const taskCache = new Map<string, InstallTask>()
let ipcRegistered = false

async function listTemplates(): Promise<ResolvedTemplate[]> {
  return loadTemplatesFromDirectory(BUILTIN_TEMPLATE_DIR)
}

async function getTemplate(templateId: string): Promise<ResolvedTemplate> {
  const template = (await listTemplates()).find((entry) => entry.id === templateId)
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }
  return template
}

async function getTask(taskId: string, tasksDir: string): Promise<InstallTask> {
  return taskCache.get(taskId) ?? loadTask(taskId, tasksDir)
}

export function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return
  }

  ipcRegistered = true

  ipcMain.handle('template:list', async () => listTemplates())

  ipcMain.handle(
    'task:precheck',
    async (
      _event,
      payload: { templateId: string; values: Record<string, Primitive>; locale: string },
    ) => {
      const template = await getTemplate(payload.templateId)
      const input = await buildRuntimePrecheckInput(template, payload.values)
      return runPrecheck(input, normalizeLocale(payload.locale))
    },
  )

  ipcMain.handle(
    'task:create',
    async (
      _event,
      payload: {
        templateId: string
        values: Record<string, Primitive>
        precheck?: InstallTask['precheck']
        locale: string
      },
    ) => {
      const [paths, template] = await Promise.all([
        ensureAppPaths(),
        getTemplate(payload.templateId),
      ])
      const task = createTask({
        templateId: template.id,
        templateVersion: template.version,
        locale: normalizeLocale(payload.locale),
        params: payload.values,
        precheck: payload.precheck,
        plugins: template.plugins.map((plugin) => ({
          pluginId: plugin.pluginId,
          version: plugin.version,
          params: mapTemplateValuesToPluginParams(plugin.pluginId, payload.values),
        })),
      })

      taskCache.set(task.id, task)
      await persistTask(task, paths.tasksDir)

      return task
    },
  )

  ipcMain.handle('task:start', async (_event, taskId: string) => {
    const paths = await ensureAppPaths()
    const task = await getTask(taskId, paths.tasksDir)
    const nextTask = await executeTask({
      task,
      registry: BUILTIN_PLUGINS,
      platform: process.platform === 'win32' ? 'win32' : 'darwin',
      tasksDir: paths.tasksDir,
      dryRun: true,
    })
    taskCache.set(nextTask.id, nextTask)
    return nextTask
  })

  ipcMain.handle(
    'task:retry-plugin',
    async (_event, payload: { taskId: string; pluginId: string }) => {
      const paths = await ensureAppPaths()
      const task = await getTask(payload.taskId, paths.tasksDir)
      const nextTask = await retryTaskPlugin({
        task,
        pluginId: payload.pluginId,
        registry: BUILTIN_PLUGINS,
        platform: process.platform === 'win32' ? 'win32' : 'darwin',
        tasksDir: paths.tasksDir,
        dryRun: true,
      })
      taskCache.set(nextTask.id, nextTask)
      return nextTask
    },
  )

  ipcMain.handle('plugin:import', async (_event, payload: { path: string }) => {
    const paths = await ensureAppPaths()
    const pathStat = await stat(payload.path)

    if (pathStat.isDirectory()) {
      return importPluginFromDirectory(payload.path, {
        registryDir: paths.pluginsDir,
      })
    }

    if (extname(payload.path).toLowerCase() === '.zip') {
      return importPluginFromZip(payload.path, paths.pluginStagingDir, {
        registryDir: paths.pluginsDir,
      })
    }

    throw new Error(`Unsupported plugin import path: ${payload.path}`)
  })
}
