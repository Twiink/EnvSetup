import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { appendTaskLog, sanitizeLog } from './logger'
import type {
  AppPlatform,
  AppLocale,
  InstallTask,
  PluginExecutionInput,
  PluginInstallResult,
  PluginLifecycle,
  PluginVerifyResult,
  Primitive,
  PrecheckResult,
  TaskPluginSnapshot,
  TaskProgressEvent,
  TaskStatus,
} from './contracts'
import { DEFAULT_LOCALE } from '../../shared/locale'

export type CreateTaskInput = {
  templateId: string
  templateVersion: string
  locale?: AppLocale
  params: Record<string, Primitive>
  plugins: Array<{
    pluginId: string
    version: string
    params: Record<string, Primitive>
  }>
  precheck?: PrecheckResult
}

export type RerunComparison = {
  previous: {
    params: Record<string, Primitive>
    version: string
    context: Record<string, Primitive>
  }
  next: {
    params: Record<string, Primitive>
    version: string
    context: Record<string, Primitive>
  }
}

export type PluginRegistry = Record<string, PluginLifecycle>

function timestamp(): string {
  return new Date().toISOString()
}

function cloneTask(task: InstallTask): InstallTask {
  return JSON.parse(JSON.stringify(task)) as InstallTask
}

function finalizeTaskStatus(task: InstallTask): TaskStatus {
  const pluginStates = task.plugins.map((plugin) => plugin.status)

  if (pluginStates.every((status) => status === 'verified_success')) {
    return 'succeeded'
  }

  // installed_unverified means verify was never called — treat as failed for finalization
  const terminallyFailed = (status: string) =>
    status === 'failed' || status === 'installed_unverified'

  if (
    pluginStates.some(terminallyFailed) &&
    pluginStates.some((status) => status === 'verified_success')
  ) {
    return 'partially_succeeded'
  }

  if (pluginStates.some(terminallyFailed)) {
    return 'failed'
  }

  if (pluginStates.some((status) => status === 'running')) {
    return 'running'
  }

  if (pluginStates.some((status) => status === 'needs_rerun')) {
    return 'ready'
  }

  return task.status
}

function withTaskUpdate(task: InstallTask, updater: (draft: InstallTask) => void): InstallTask {
  const draft = cloneTask(task)
  updater(draft)
  draft.updatedAt = timestamp()
  draft.status = finalizeTaskStatus(draft)
  if (
    draft.status === 'succeeded' ||
    draft.status === 'failed' ||
    draft.status === 'partially_succeeded'
  ) {
    draft.finishedAt = draft.finishedAt ?? timestamp()
  }
  return draft
}

function buildPluginLogs(
  installResult: PluginInstallResult,
  verifyResult: PluginVerifyResult,
): string[] {
  return [
    ...installResult.logs,
    ...installResult.downloads.map((download) => `download=${download.tool}:${download.url}`),
    ...installResult.commands.map((command) => `command=${command}`),
    ...installResult.envChanges.map((change) => `${change.kind}:${change.key}=${change.value}`),
    ...verifyResult.checks.map((check) => `verify=${check}`),
  ].map((line) => sanitizeLog(line))
}

function buildExecutionInput(
  task: InstallTask,
  plugin: TaskPluginSnapshot,
  platform: AppPlatform,
  dryRun: boolean,
): PluginExecutionInput {
  // Merge context from all preceding verified plugins so later plugins can consume outputs
  const precedingContext: Record<string, Primitive> = {}
  for (const p of task.plugins) {
    if (p.pluginId === plugin.pluginId) break
    if (p.status === 'verified_success') {
      Object.assign(precedingContext, p.context)
    }
  }

  return {
    ...precedingContext,
    ...plugin.params,
    platform,
    dryRun,
    locale: task.locale,
  }
}

export function createTask(input: CreateTaskInput): InstallTask {
  const createdAt = timestamp()

  return {
    id: randomUUID(),
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    locale: input.locale ?? DEFAULT_LOCALE,
    status: 'draft',
    params: input.params,
    precheck: input.precheck,
    plugins: input.plugins.map(
      (plugin): TaskPluginSnapshot => ({
        pluginId: plugin.pluginId,
        version: plugin.version,
        status: 'not_started',
        params: plugin.params,
        logs: [],
        context: {},
      }),
    ),
    createdAt,
    updatedAt: createdAt,
  }
}

export function shouldRerunPlugin(input: RerunComparison): boolean {
  return (
    JSON.stringify(input.previous.params) !== JSON.stringify(input.next.params) ||
    input.previous.version !== input.next.version ||
    JSON.stringify(input.previous.context) !== JSON.stringify(input.next.context)
  )
}

export function applyPluginResult(
  task: InstallTask,
  pluginId: string,
  installResult: PluginInstallResult,
  verifyResult: PluginVerifyResult,
): InstallTask {
  return withTaskUpdate(task, (draft) => {
    const plugin = draft.plugins.find((entry) => entry.pluginId === pluginId)
    if (!plugin) {
      throw new Error(`Unknown plugin snapshot: ${pluginId}`)
    }

    plugin.lastResult = installResult
    plugin.verifyResult = verifyResult
    plugin.status =
      verifyResult.status === 'verified_success' ? 'verified_success' : installResult.status
    plugin.error = verifyResult.error ?? installResult.error
    plugin.errorCode = verifyResult.error
      ? 'VERIFY_FAILED'
      : installResult.error
        ? 'PLUGIN_EXECUTION_FAILED'
        : undefined
    plugin.finishedAt = timestamp()
    plugin.logs = [...plugin.logs, ...buildPluginLogs(installResult, verifyResult)]
  })
}

export async function persistTask(task: InstallTask, tasksDir: string): Promise<void> {
  await mkdir(tasksDir, { recursive: true })
  await writeFile(join(tasksDir, `${task.id}.json`), JSON.stringify(task, null, 2), 'utf8')
}

export async function loadTask(taskId: string, tasksDir: string): Promise<InstallTask> {
  const raw = await readFile(join(tasksDir, `${taskId}.json`), 'utf8')
  const task = JSON.parse(raw) as InstallTask
  return {
    ...task,
    locale: task.locale ?? DEFAULT_LOCALE,
  }
}

export async function executeTask(options: {
  task: InstallTask
  registry: PluginRegistry
  platform: AppPlatform
  tasksDir: string
  dryRun?: boolean
  pluginFilter?: string
  onProgress?: (event: TaskProgressEvent) => void
}): Promise<InstallTask> {
  const dryRun = options.dryRun ?? true
  let nextTask = withTaskUpdate(options.task, (draft) => {
    draft.status = 'running'
    draft.startedAt = draft.startedAt ?? timestamp()
  })
  await persistTask(nextTask, options.tasksDir)

  for (const plugin of nextTask.plugins) {
    if (options.pluginFilter && plugin.pluginId !== options.pluginFilter) {
      continue
    }

    if (!options.pluginFilter && plugin.status === 'verified_success') {
      continue
    }

    const runner = options.registry[plugin.pluginId]
    if (!runner) {
      nextTask = withTaskUpdate(nextTask, (draft) => {
        const draftPlugin = draft.plugins.find((entry) => entry.pluginId === plugin.pluginId)
        if (!draftPlugin) {
          return
        }
        draftPlugin.status = 'failed'
        draftPlugin.errorCode = 'PLUGIN_DEPENDENCY_MISSING'
        draftPlugin.error = `No plugin implementation registered for ${plugin.pluginId}.`
        draftPlugin.logs.push(draftPlugin.error)
        draftPlugin.finishedAt = timestamp()
      })
      await persistTask(nextTask, options.tasksDir)
      continue
    }

    nextTask = withTaskUpdate(nextTask, (draft) => {
      const draftPlugin = draft.plugins.find((entry) => entry.pluginId === plugin.pluginId)
      if (!draftPlugin) {
        return
      }
      draftPlugin.status = 'running'
      draftPlugin.error = undefined
      draftPlugin.errorCode = undefined
      draftPlugin.startedAt = draftPlugin.startedAt ?? timestamp()
      if (options.pluginFilter) {
        draftPlugin.logs = []
      }
    })
    await persistTask(nextTask, options.tasksDir)

    options.onProgress?.({
      taskId: nextTask.id,
      pluginId: plugin.pluginId,
      type: 'plugin_start',
      message: `Starting plugin: ${plugin.pluginId}`,
      timestamp: timestamp(),
    })

    try {
      const draftPlugin = nextTask.plugins.find((entry) => entry.pluginId === plugin.pluginId)
      if (!draftPlugin) {
        continue
      }

      const executionInput = buildExecutionInput(nextTask, draftPlugin, options.platform, dryRun)
      executionInput.onProgress = (event) => {
        options.onProgress?.({ ...event, taskId: nextTask.id })
      }

      if (runner.check) {
        const checkResult = await runner.check(executionInput)
        if (!checkResult.pass) {
          throw new Error(checkResult.message ?? 'Plugin pre-check failed')
        }
      }

      if (runner.prepare) {
        await runner.prepare(executionInput)
      }

      const installResult = await runner.install(executionInput)
      const verifyResult = await runner.verify({
        ...executionInput,
        installResult,
      })

      nextTask = applyPluginResult(nextTask, plugin.pluginId, installResult, verifyResult)
      await appendTaskLog(
        nextTask.id,
        buildPluginLogs(installResult, verifyResult),
        options.tasksDir,
      )

      options.onProgress?.({
        taskId: nextTask.id,
        pluginId: plugin.pluginId,
        type: 'plugin_done',
        message: `Plugin ${plugin.pluginId} finished`,
        timestamp: timestamp(),
      })
    } catch (error) {
      nextTask = withTaskUpdate(nextTask, (draft) => {
        const failedPlugin = draft.plugins.find((entry) => entry.pluginId === plugin.pluginId)
        if (!failedPlugin) {
          return
        }
        failedPlugin.status = 'failed'
        failedPlugin.errorCode = 'PLUGIN_EXECUTION_FAILED'
        failedPlugin.error = error instanceof Error ? error.message : String(error)
        failedPlugin.logs.push(failedPlugin.error)
        failedPlugin.finishedAt = timestamp()
      })
      await appendTaskLog(
        nextTask.id,
        [error instanceof Error ? error.message : String(error)],
        options.tasksDir,
      )
      options.onProgress?.({
        taskId: nextTask.id,
        pluginId: plugin.pluginId,
        type: 'command_error',
        message: error instanceof Error ? error.message : String(error),
        output: error instanceof Error ? error.message : String(error),
        timestamp: timestamp(),
      })
    }

    await persistTask(nextTask, options.tasksDir)
  }

  nextTask = withTaskUpdate(nextTask, (draft) => {
    draft.status = finalizeTaskStatus(draft)
    draft.resultLevel =
      draft.status === 'succeeded'
        ? 'success'
        : draft.status === 'partially_succeeded'
          ? 'partial'
          : draft.status === 'failed'
            ? 'failure'
            : draft.resultLevel
  })
  await persistTask(nextTask, options.tasksDir)
  options.onProgress?.({
    taskId: nextTask.id,
    pluginId: options.pluginFilter ?? 'task',
    type: 'task_done',
    message: `Task ${nextTask.status}`,
    timestamp: timestamp(),
  })
  return nextTask
}

export async function cancelTask(options: {
  task: InstallTask
  tasksDir: string
}): Promise<InstallTask> {
  if (
    options.task.status === 'succeeded' ||
    options.task.status === 'failed' ||
    options.task.status === 'partially_succeeded' ||
    options.task.status === 'cancelled'
  ) {
    return options.task
  }

  const cancelledTask = withTaskUpdate(options.task, (draft) => {
    draft.status = 'cancelled'
    draft.finishedAt = timestamp()
    for (const plugin of draft.plugins) {
      if (plugin.status === 'not_started' || plugin.status === 'needs_rerun') {
        plugin.status = 'failed'
        plugin.errorCode = 'USER_CANCELLED'
        plugin.error = 'Task cancelled by user'
        plugin.finishedAt = timestamp()
      }
    }
  })

  await persistTask(cancelledTask, options.tasksDir)
  return cancelledTask
}

export async function retryTaskPlugin(options: {
  task: InstallTask
  pluginId: string
  registry: PluginRegistry
  platform: AppPlatform
  tasksDir: string
  dryRun?: boolean
  onProgress?: (event: TaskProgressEvent) => void
}): Promise<InstallTask> {
  const resetTask = withTaskUpdate(options.task, (draft) => {
    const plugin = draft.plugins.find((entry) => entry.pluginId === options.pluginId)
    if (!plugin) {
      throw new Error(`Unknown plugin snapshot: ${options.pluginId}`)
    }

    plugin.status = 'needs_rerun'
    plugin.logs = []
    plugin.error = undefined
    plugin.errorCode = undefined
    plugin.finishedAt = undefined
    draft.finishedAt = undefined
  })

  await persistTask(resetTask, options.tasksDir)
  return executeTask({
    ...options,
    task: resetTask,
    pluginFilter: options.pluginId,
  })
}
