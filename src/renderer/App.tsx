/**
 * 协调模板选择、本地化、预检与任务状态的主界面组件。
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import type {
  BootstrapData,
  DetectedEnvironment,
  InstallTask,
  LogLevel,
  Primitive,
  PrecheckResult,
  ResolvedTemplate,
  RollbackResult,
  RollbackSuggestion,
  SnapshotMeta,
  TaskProgressEvent,
} from '../main/core/contracts'
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from '../shared/locale'
import { validateResolvedTemplateValues } from '../shared/templateFields'
import { getLocaleButtonLabel, getUiText } from './copy'
import { BeginnerGuidePanel } from './components/BeginnerGuidePanel'
import { OverrideForm } from './components/OverrideForm'
import { PrecheckPanel } from './components/PrecheckPanel'
import { RollbackDialog } from './components/RollbackDialog'
import { SnapshotPanel } from './components/SnapshotPanel'
import { TaskPanel } from './components/TaskPanel'
import { TemplatePanel } from './components/TemplatePanel'

type AppView = 'workspace' | 'guide'

function buildInitialValues(
  template: ResolvedTemplate,
  nodeLtsVersions: string[],
  javaLtsVersions: string[],
  pythonVersions: string[],
  gitVersions: string[],
  mysqlVersions: string[],
  redisVersions: string[],
  mavenVersions: string[],
): Record<string, Primitive> {
  // 先使用模板默认值，再用当前可用版本列表纠正已经失效的默认版本。
  const values = Object.fromEntries(
    Object.values(template.fields).map((field) => [field.key, field.value]),
  )

  const templateNodeVersion = values['node.nodeVersion']
  if (
    'node.nodeVersion' in values &&
    nodeLtsVersions.length > 0 &&
    (typeof templateNodeVersion !== 'string' || !nodeLtsVersions.includes(templateNodeVersion))
  ) {
    values['node.nodeVersion'] = nodeLtsVersions[0]
  }

  const templateJavaVersion = values['java.javaVersion']
  if (
    'java.javaVersion' in values &&
    javaLtsVersions.length > 0 &&
    (typeof templateJavaVersion !== 'string' || !javaLtsVersions.includes(templateJavaVersion))
  ) {
    values['java.javaVersion'] = javaLtsVersions[0]
  }

  const templatePythonVersion = values['python.pythonVersion']
  if (
    'python.pythonVersion' in values &&
    pythonVersions.length > 0 &&
    (typeof templatePythonVersion !== 'string' || !pythonVersions.includes(templatePythonVersion))
  ) {
    values['python.pythonVersion'] = pythonVersions[0]
  }

  const templateGitVersion = values['git.gitVersion']
  if (
    'git.gitVersion' in values &&
    gitVersions.length > 0 &&
    (typeof templateGitVersion !== 'string' || !gitVersions.includes(templateGitVersion))
  ) {
    values['git.gitVersion'] = gitVersions[0]
  }

  const templateMysqlVersion = values['mysql.mysqlVersion']
  if (
    'mysql.mysqlVersion' in values &&
    mysqlVersions.length > 0 &&
    (typeof templateMysqlVersion !== 'string' || !mysqlVersions.includes(templateMysqlVersion))
  ) {
    values['mysql.mysqlVersion'] = mysqlVersions[0]
  }

  const templateRedisVersion = values['redis.redisVersion']
  if (
    'redis.redisVersion' in values &&
    redisVersions.length > 0 &&
    (typeof templateRedisVersion !== 'string' || !redisVersions.includes(templateRedisVersion))
  ) {
    values['redis.redisVersion'] = redisVersions[0]
  }

  const templateMavenVersion = values['maven.mavenVersion']
  if (
    'maven.mavenVersion' in values &&
    mavenVersions.length > 0 &&
    (typeof templateMavenVersion !== 'string' || !mavenVersions.includes(templateMavenVersion))
  ) {
    values['maven.mavenVersion'] = mavenVersions[0]
  }

  return values
}

function buildFieldOptions(
  values: Record<string, Primitive>,
  nodeLtsVersions: string[],
  javaLtsVersions: string[],
  pythonVersions: string[],
  gitVersions: string[],
  mysqlVersions: string[],
  redisVersions: string[],
  mavenVersions: string[],
): Record<string, string[]> {
  const currentNodeVersion =
    typeof values['node.nodeVersion'] === 'string' ? values['node.nodeVersion'] : undefined
  const nodeVersions =
    nodeLtsVersions.length > 0 ? nodeLtsVersions : currentNodeVersion ? [currentNodeVersion] : []

  const currentJavaVersion =
    typeof values['java.javaVersion'] === 'string' ? values['java.javaVersion'] : undefined
  const javaVersionsList =
    javaLtsVersions.length > 0 ? javaLtsVersions : currentJavaVersion ? [currentJavaVersion] : []

  const currentPythonVersion =
    typeof values['python.pythonVersion'] === 'string' ? values['python.pythonVersion'] : undefined
  const pythonVersionsList =
    pythonVersions.length > 0 ? pythonVersions : currentPythonVersion ? [currentPythonVersion] : []

  const currentGitVersion =
    typeof values['git.gitVersion'] === 'string' ? values['git.gitVersion'] : undefined
  const gitVersionsList =
    gitVersions.length > 0 ? gitVersions : currentGitVersion ? [currentGitVersion] : []

  const currentMysqlVersion =
    typeof values['mysql.mysqlVersion'] === 'string' ? values['mysql.mysqlVersion'] : undefined
  const mysqlVersionsList =
    mysqlVersions.length > 0 ? mysqlVersions : currentMysqlVersion ? [currentMysqlVersion] : []

  const currentRedisVersion =
    typeof values['redis.redisVersion'] === 'string' ? values['redis.redisVersion'] : undefined
  const redisVersionsList =
    redisVersions.length > 0 ? redisVersions : currentRedisVersion ? [currentRedisVersion] : []

  const currentMavenVersion =
    typeof values['maven.mavenVersion'] === 'string' ? values['maven.mavenVersion'] : undefined
  const mavenVersionsList =
    mavenVersions.length > 0 ? mavenVersions : currentMavenVersion ? [currentMavenVersion] : []

  return {
    'node.nodeVersion': nodeVersions,
    'java.javaVersion': javaVersionsList,
    'python.pythonVersion': pythonVersionsList,
    'git.gitVersion': gitVersionsList,
    'mysql.mysqlVersion': mysqlVersionsList,
    'redis.redisVersion': redisVersionsList,
    'maven.mavenVersion': mavenVersionsList,
  }
}

function getTemplateById(
  templates: ResolvedTemplate[],
  templateId: string,
): ResolvedTemplate | undefined {
  return templates.find((template) => template.id === templateId)
}

function removeTaskProgressListenerSafely() {
  window.envSetup.removeTaskProgressListener?.()
}

function registerTaskProgressListener(callback: (event: TaskProgressEvent) => void) {
  window.envSetup.onTaskProgress?.(callback)
}

function collectInstallPathsFromTask(task?: InstallTask): string[] {
  if (!task) {
    return []
  }

  return [
    ...new Set(
      task.plugins.flatMap((plugin) => {
        const installRootDir = plugin.lastResult?.paths.installRootDir ?? plugin.params.installRootDir
        return typeof installRootDir === 'string' && installRootDir.length > 0 ? [installRootDir] : []
      }),
    ),
  ]
}

export default function App() {
  const selectedTemplateIdRef = useRef('')
  const activeTaskIdRef = useRef<string>()
  const [locale, setLocale] = useState<AppLocale>(() => {
    // 语言偏好持久化在 localStorage，刷新后直接恢复。
    if (typeof window === 'undefined') {
      return DEFAULT_LOCALE
    }

    return normalizeLocale(window.localStorage.getItem('envsetup.locale'))
  })
  const [currentView, setCurrentView] = useState<AppView>('workspace')
  const [templates, setTemplates] = useState<ResolvedTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [nodeLtsVersions, setNodeLtsVersions] = useState<string[]>([])
  const [javaLtsVersions, setJavaLtsVersions] = useState<string[]>([])
  const [pythonVersions, setPythonVersions] = useState<string[]>([])
  const [gitVersions, setGitVersions] = useState<string[]>([])
  const [mysqlVersions, setMysqlVersions] = useState<string[]>([])
  const [redisVersions, setRedisVersions] = useState<string[]>([])
  const [mavenVersions, setMavenVersions] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, Primitive>>({})
  const [precheck, setPrecheck] = useState<PrecheckResult>()
  const [task, setTask] = useState<InstallTask>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [importMessage, setImportMessage] = useState<string>()
  const [taskProgressEvents, setTaskProgressEvents] = useState<TaskProgressEvent[]>([])
  const [taskMessage, setTaskMessage] = useState<string>()
  const [cleanupBackup, setCleanupBackup] = useState<{ snapshotId: string; message: string }>()
  const [snapshots, setSnapshots] = useState<SnapshotMeta>()
  const [rollbackResult, setRollbackResult] = useState<RollbackResult>()
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false)
  const [rollbackSuggestions, setRollbackSuggestions] = useState<RollbackSuggestion[]>([])
  const [exportMessage, setExportMessage] = useState<string>()

  function emitLog(level: LogLevel, source: string, message: string, context?: Record<string, unknown>) {
    window.envSetup.writeLog({ level, source, message, context }).catch(() => {})
  }
  const syncBootstrapData = useCallback((
    bootstrap: BootstrapData,
    preferredTemplateId?: string,
    options: { resetWorkspaceState?: boolean } = {},
  ) => {
    const {
      templates: nextTemplates,
      nodeLtsVersions: nextNodeLtsVersions,
      javaLtsVersions: nextJavaLtsVersions,
      pythonVersions: nextPythonVersions,
      gitVersions: nextGitVersions,
      mysqlVersions: nextMysqlVersions,
      redisVersions: nextRedisVersions,
      mavenVersions: nextMavenVersions,
    } = bootstrap

    if (nextTemplates.length === 0) {
      setError('No templates found — fixtures/templates may be missing or empty')
      return
    }

    const nextSelectedTemplate =
      getTemplateById(nextTemplates, preferredTemplateId ?? selectedTemplateIdRef.current) ??
      nextTemplates[0]

    setTemplates(nextTemplates)
    setNodeLtsVersions(nextNodeLtsVersions)
    setJavaLtsVersions(nextJavaLtsVersions)
    setPythonVersions(nextPythonVersions)
    setGitVersions(nextGitVersions)
    setMysqlVersions(nextMysqlVersions)
    setRedisVersions(nextRedisVersions)
    setMavenVersions(nextMavenVersions)
    setSelectedTemplateId(nextSelectedTemplate.id)
    selectedTemplateIdRef.current = nextSelectedTemplate.id
    setValues(
      buildInitialValues(
        nextSelectedTemplate,
        nextNodeLtsVersions,
        nextJavaLtsVersions,
        nextPythonVersions,
        nextGitVersions,
        nextMysqlVersions,
        nextRedisVersions,
        nextMavenVersions,
      ),
    )

    if (options.resetWorkspaceState) {
      setPrecheck(undefined)
      setTask(undefined)
      setTaskProgressEvents([])
      setTaskMessage(undefined)
      setCleanupBackup(undefined)
      setRollbackResult(undefined)
      setRollbackSuggestions([])
      setRollbackDialogOpen(false)
      activeTaskIdRef.current = undefined
    }
  }, [])

  const refreshSnapshots = useCallback(async () => {
    const nextSnapshots = await window.envSetup.listSnapshots()
    setSnapshots(nextSnapshots)
  }, [])

  const handleTaskProgressEvent = useEffectEvent((event: TaskProgressEvent) => {
    if (!activeTaskIdRef.current || event.taskId !== activeTaskIdRef.current) {
      return
    }

    setTaskProgressEvents((currentEvents) => [...currentEvents, event])

    if (event.taskSnapshot) {
      activeTaskIdRef.current = event.taskSnapshot.id
      setTask(event.taskSnapshot)

      if (
        event.taskSnapshot.rollbackSuggestions &&
        event.taskSnapshot.rollbackSuggestions.length > 0
      ) {
        setRollbackSuggestions(event.taskSnapshot.rollbackSuggestions)
        setRollbackDialogOpen(true)
      }
    }

    if (event.type === 'task_done') {
      void refreshSnapshots()
    }
  })

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = getUiText(locale, 'documentTitle')
    window.localStorage.setItem('envsetup.locale', locale)
  }, [locale])

  useEffect(() => {
    selectedTemplateIdRef.current = selectedTemplateId
  }, [selectedTemplateId])

  useEffect(() => {
    activeTaskIdRef.current = task?.id
  }, [task?.id])

  useEffect(() => {
    let active = true

    async function loadTemplates() {
      try {
        // 启动时一次性加载模板和版本清单，避免页面初始化阶段多次请求主进程。
        const bootstrap = await window.envSetup.loadBootstrap()
        if (!active) {
          return
        }
        if (bootstrap.templates.length === 0) {
          setError('No templates found — fixtures/templates may be missing or empty')
          return
        }

        syncBootstrapData(bootstrap)
      } catch (loadError) {
        if (!active) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    }

    void loadTemplates()

    return () => {
      active = false
    }
  }, [syncBootstrapData])

  useEffect(() => {
    registerTaskProgressListener((event) => {
      handleTaskProgressEvent(event)
    })

    void refreshSnapshots()

    return () => {
      // 组件卸载时清理 IPC 监听器，防止重复挂载后收到旧任务事件。
      removeTaskProgressListenerSafely()
    }
  }, [refreshSnapshots])

  const selectedTemplate = getTemplateById(templates, selectedTemplateId)
  const validationErrors = selectedTemplate
    ? validateResolvedTemplateValues(selectedTemplate, values, locale)
    : {}
  const canCreateTask =
    Boolean(selectedTemplate) &&
    selectedTemplate.plugins.length > 0 &&
    Object.keys(validationErrors).length === 0 &&
    precheck !== undefined &&
    precheck.level !== 'block'

  function handleSelectTemplate(templateId: string) {
    emitLog('info', 'renderer', 'template:select', { templateId })
    const template = getTemplateById(templates, templateId)
    if (!template) {
      return
    }

    // 切换模板后，预检、任务结果和清理备份都不再可信，需要整体重置。
    setSelectedTemplateId(templateId)
    setValues(
      buildInitialValues(
        template,
        nodeLtsVersions,
        javaLtsVersions,
        pythonVersions,
        gitVersions,
        mysqlVersions,
        redisVersions,
        mavenVersions,
      ),
    )
    setPrecheck(undefined)
    setTask(undefined)
    setTaskProgressEvents([])
    setTaskMessage(undefined)
    setError(undefined)
    setCleanupBackup(undefined)
    setRollbackResult(undefined)
    setRollbackSuggestions([])
    setRollbackDialogOpen(false)
    activeTaskIdRef.current = undefined
  }

  function handleChange(key: string, value: Primitive) {
    emitLog('info', 'renderer', 'form:change', { key, value })
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }))
    setPrecheck(undefined)
    setTask(undefined)
    setTaskProgressEvents([])
    setTaskMessage(undefined)
    setError(undefined)
    setRollbackResult(undefined)
    setRollbackSuggestions([])
    setRollbackDialogOpen(false)
  }

  async function handleRunPrecheck() {
    if (!selectedTemplate) {
      return
    }

    emitLog('info', 'renderer', 'precheck:run', { templateId: selectedTemplate.id })
    setBusy(true)
    setError(undefined)

    try {
      const nextPrecheck = await window.envSetup.runPrecheck({
        templateId: selectedTemplate.id,
        values,
        locale,
      })
      setPrecheck(nextPrecheck)
    } catch (runError) {
      const msg = runError instanceof Error ? runError.message : String(runError)
      emitLog('error', 'renderer', 'precheck:run failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateTask() {
    if (!selectedTemplate || !canCreateTask) {
      return
    }

    emitLog('info', 'renderer', 'task:create', { templateId: selectedTemplate.id, values })
    setBusy(true)
    setError(undefined)

    try {
      const nextTask = await window.envSetup.createTask({
        templateId: selectedTemplate.id,
        values,
        precheck,
        locale,
        rollbackBaseSnapshotId: cleanupBackup?.snapshotId,
      })
      setTask(nextTask)
      setTaskProgressEvents([])
      activeTaskIdRef.current = nextTask.id
    } catch (createError) {
      const msg = createError instanceof Error ? createError.message : String(createError)
      emitLog('error', 'renderer', 'task:create failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleStartTask() {
    if (!task) {
      return
    }

    emitLog('info', 'renderer', 'task:start', { taskId: task.id })
    setBusy(true)
    setError(undefined)
    setTaskProgressEvents([])
    setRollbackResult(undefined)
    setRollbackSuggestions([])
    setRollbackDialogOpen(false)

    try {
      activeTaskIdRef.current = task.id
      const nextTask = await window.envSetup.startTask(task.id)
      setTask(nextTask)
      await refreshSnapshots()
    } catch (startError) {
      const msg = startError instanceof Error ? startError.message : String(startError)
      emitLog('error', 'renderer', 'task:start failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelTask() {
    if (!task) {
      return
    }

    emitLog('info', 'renderer', 'task:cancel', { taskId: task.id })
    setBusy(true)
    setError(undefined)

    try {
      const nextTask = await window.envSetup.cancelTask(task.id)
      setTask(nextTask)
    } catch (cancelError) {
      const msg = cancelError instanceof Error ? cancelError.message : String(cancelError)
      emitLog('error', 'renderer', 'task:cancel failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleImportPlugin() {
    emitLog('info', 'renderer', 'plugin:import')
    setBusy(true)
    setError(undefined)
    setImportMessage(undefined)

    try {
      const pluginPath = await window.envSetup.pickPluginImportPath()
      if (!pluginPath) {
        return
      }
      const importedPlugin = await window.envSetup.importPluginFromPath(pluginPath)
      syncBootstrapData(await window.envSetup.loadBootstrap(), importedPlugin.templateId, {
        resetWorkspaceState: true,
      })
      setImportMessage(getUiText(locale, 'importPluginSuccess'))
    } catch (importError) {
      const msg = importError instanceof Error ? importError.message : String(importError)
      emitLog('error', 'renderer', 'plugin:import failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleRetryPlugin(pluginId: string) {
    if (!task) {
      return
    }

    emitLog('info', 'renderer', 'task:retry', { taskId: task.id, pluginId })
    setBusy(true)
    setError(undefined)
    setTaskProgressEvents([])
    setRollbackResult(undefined)
    setRollbackSuggestions([])
    setRollbackDialogOpen(false)

    try {
      activeTaskIdRef.current = task.id
      const nextTask = await window.envSetup.retryPlugin(task.id, pluginId)
      setTask(nextTask)
      await refreshSnapshots()
    } catch (retryError) {
      const msg = retryError instanceof Error ? retryError.message : String(retryError)
      emitLog('error', 'renderer', 'task:retry failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleApplyEnvChanges(pluginId: string) {
    if (!task) {
      return
    }

    emitLog('info', 'renderer', 'env:apply', { pluginId })
    const plugin = task.plugins.find((entry) => entry.pluginId === pluginId)
    const changes = plugin?.lastResult?.envChanges ?? []
    if (changes.length === 0) {
      return
    }

    setBusy(true)
    setError(undefined)

    try {
      await window.envSetup.previewEnvChanges(changes)
      const result = await window.envSetup.applyEnvChanges({ changes })
      setTaskMessage(
        `${getUiText(locale, 'applyEnvChangesSuccess')} (${result.applied.length}/${changes.length})`,
      )
    } catch (applyError) {
      const msg = applyError instanceof Error ? applyError.message : String(applyError)
      emitLog('error', 'renderer', 'env:apply failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleCleanupDetections(detections: DetectedEnvironment[]) {
    if (!selectedTemplate || detections.length === 0) {
      return
    }

    emitLog('info', 'renderer', 'cleanup:batch', { count: detections.length })
    setBusy(true)
    setError(undefined)

    try {
      const cleanupTargets = detections.filter((detection) => detection.cleanupSupported)
      const cleanupResult = await window.envSetup.cleanupEnvironments(cleanupTargets)
      const cleanupErrors = cleanupResult.errors.map((entry) => entry.error)
      setCleanupBackup({
        snapshotId: cleanupResult.snapshotId,
        message: cleanupResult.message,
      })
      setTaskMessage(cleanupResult.message)

      const nextPrecheck = await window.envSetup.runPrecheck({
        templateId: selectedTemplate.id,
        values,
        locale,
      })
      // 清理会改变本地环境状态，因此完成后立刻重跑预检刷新界面。
      setPrecheck(nextPrecheck)

      if (cleanupErrors.length > 0) {
        setError(cleanupErrors.join(' | '))
      }
    } catch (cleanupError) {
      const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      emitLog('error', 'renderer', 'cleanup:batch failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleRollbackCleanup() {
    if (!selectedTemplate || !cleanupBackup) {
      return
    }

    emitLog('info', 'renderer', 'rollback:cleanup', { snapshotId: cleanupBackup.snapshotId })
    setBusy(true)
    setError(undefined)

    try {
      const rollbackResult = await window.envSetup.executeRollback({
        snapshotId: cleanupBackup.snapshotId,
      })
      setTaskMessage(rollbackResult.message)

      const nextPrecheck = await window.envSetup.runPrecheck({
        templateId: selectedTemplate.id,
        values,
        locale,
      })
      // 回滚后同样需要重新探测环境，保证后续创建任务使用的是恢复后的状态。
      setPrecheck(nextPrecheck)

      if (rollbackResult.success) {
        setCleanupBackup(undefined)
        await refreshSnapshots()
      } else {
        setError(
          rollbackResult.errors.map((entry) => entry.error).join(' | ') || rollbackResult.message,
        )
      }
    } catch (rollbackError) {
      const msg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      emitLog('error', 'renderer', 'rollback:cleanup failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handlePickDirectory(key: string) {
    const selectedPath = await window.envSetup.pickDirectory(
      typeof values[key] === 'string' ? values[key] : undefined,
    )

    if (!selectedPath) {
      return
    }

    handleChange(key, selectedPath)
  }

  async function handleCreateSnapshot() {
    if (!task) {
      setError(locale === 'zh-CN' ? '请先创建任务，再创建快照。' : 'Create a task before creating a snapshot.')
      return
    }

    emitLog('info', 'renderer', 'snapshot:create', { taskId: task.id })
    setBusy(true)
    setError(undefined)

    try {
      await window.envSetup.createSnapshot({
        taskId: task.id,
        label: `${task.templateId}-manual`,
      })
      await refreshSnapshots()
      setTaskMessage(locale === 'zh-CN' ? '快照已创建。' : 'Snapshot created.')
    } catch (snapshotError) {
      const msg = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
      emitLog('error', 'renderer', 'snapshot:create failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSnapshot(snapshotId: string) {
    emitLog('info', 'renderer', 'snapshot:delete', { snapshotId })
    setBusy(true)
    setError(undefined)

    try {
      await window.envSetup.deleteSnapshot(snapshotId)
      await refreshSnapshots()
    } catch (deleteError) {
      const msg = deleteError instanceof Error ? deleteError.message : String(deleteError)
      emitLog('error', 'renderer', 'snapshot:delete failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  function handleOpenSnapshotRollback(snapshotId: string) {
    const snapshot = snapshots?.snapshots.find((entry) => entry.id === snapshotId)
    if (!snapshot) {
      return
    }

    setRollbackResult(undefined)
    setRollbackSuggestions([
      {
        snapshotId,
        snapshotLabel: snapshot.label,
        createdAt: snapshot.createdAt,
        reason:
          locale === 'zh-CN'
            ? '由快照列表手动选择，立即恢复到该状态。'
            : 'Manually selected from the snapshot list for immediate restore.',
        confidence: 'high',
      },
    ])
    setRollbackDialogOpen(true)
  }

  async function handleExecuteRollback(snapshotId: string) {
    emitLog('info', 'renderer', 'rollback:execute', { snapshotId })
    setBusy(true)
    setError(undefined)
    setRollbackResult(undefined)

    try {
      const result = await window.envSetup.executeRollback({
        snapshotId,
        installPaths: collectInstallPathsFromTask(task),
      })
      setRollbackResult(result)
      setTaskMessage(result.message)
      await refreshSnapshots()

      if (selectedTemplate) {
        const nextPrecheck = await window.envSetup.runPrecheck({
          templateId: selectedTemplate.id,
          values,
          locale,
        })
        setPrecheck(nextPrecheck)
      }

      if (result.success) {
        setRollbackDialogOpen(false)
        setRollbackSuggestions([])
        setTask((currentTask) =>
          currentTask ? { ...currentTask, rollbackSuggestions: undefined } : currentTask,
        )
      }
    } catch (rollbackError) {
      const msg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      emitLog('error', 'renderer', 'rollback:execute failed', { error: msg })
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleExportLogs(format: 'text' | 'json') {
    emitLog('info', 'renderer', 'log:export', { format })
    setBusy(true)
    setExportMessage(undefined)
    setError(undefined)

    try {
      const result = await window.envSetup.exportLogs(format)
      if (result) {
        setExportMessage(getUiText(locale, 'exportLogsSuccess'))
      } else {
        setExportMessage(getUiText(locale, 'exportLogsCancelled'))
      }
    } catch (exportError) {
      const msg = exportError instanceof Error ? exportError.message : String(exportError)
      emitLog('error', 'renderer', 'log:export failed', { error: msg })
      setError(`${getUiText(locale, 'exportLogsError')}: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2.5rem 2rem',
        background: 'linear-gradient(135deg, #FFFDFB 0%, #F7F3EE 100%)',
        color: '#3D3531',
        fontFamily: '"Inter", "Helvetica Neue", sans-serif',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '2rem' }}>
        <header
          style={{
            display: 'grid',
            gap: '0.75rem',
            padding: '2rem',
            borderRadius: '16px',
            background: '#FFFFFF',
            border: '1px solid #EFEAE4',
            boxShadow: '0 4px 16px rgba(169, 132, 103, 0.04)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.8rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#D47A6A',
              fontWeight: 600,
            }}
          >
            {getUiText(locale, 'appBadge')}
          </p>
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: '#2A2421',
            }}
          >
            {getUiText(locale, 'appTitle')}
          </h1>
          <p style={{ margin: 0, maxWidth: '54rem', color: '#7D746D', lineHeight: 1.6 }}>
            {getUiText(locale, 'appDescription')}
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              marginTop: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {(
                [
                  ['workspace', 'workspaceView'],
                  ['guide', 'guideView'],
                ] as const
              ).map(([view, labelKey]) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => {
                    emitLog('info', 'renderer', 'view:switch', { to: view })
                    setCurrentView(view)
                  }}
                  aria-pressed={currentView === view}
                  style={{
                    borderRadius: '999px',
                    border: currentView === view ? '1px solid #D47A6A' : '1px solid #EFEAE4',
                    padding: '0.45rem 0.95rem',
                    background: currentView === view ? '#FFF0EE' : '#FFFFFF',
                    color: currentView === view ? '#D47A6A' : '#7D746D',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: currentView === view ? 600 : 500,
                    transition: 'all 0.2s',
                  }}
                >
                  {getUiText(locale, labelKey)}
                </button>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '0.85rem', color: '#7D746D' }}>
                {getUiText(locale, 'languageLabel')}
              </span>
              {(['zh-CN', 'en'] as const).map((targetLocale) => (
                <button
                  key={targetLocale}
                  type="button"
                  onClick={() => {
                    emitLog('info', 'renderer', 'locale:switch', { to: targetLocale })
                    setLocale(targetLocale)
                  }}
                  aria-pressed={locale === targetLocale}
                  style={{
                    borderRadius: '6px',
                    border: locale === targetLocale ? '1px solid #D47A6A' : '1px solid #EFEAE4',
                    padding: '0.4rem 0.8rem',
                    background: locale === targetLocale ? '#FFF0EE' : '#FFFFFF',
                    color: locale === targetLocale ? '#D47A6A' : '#7D746D',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: locale === targetLocale ? 500 : 400,
                    transition: 'all 0.2s',
                  }}
                >
                  {getLocaleButtonLabel(targetLocale)}
                </button>
              ))}
              <span style={{ color: '#EFEAE4' }}>|</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleExportLogs('text')}
                style={{
                  borderRadius: '6px',
                  border: '1px solid #EFEAE4',
                  padding: '0.4rem 0.8rem',
                  background: busy ? '#F7F3EE' : '#FFFFFF',
                  color: busy ? '#A49C95' : '#7D746D',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 400,
                  transition: 'all 0.2s',
                }}
              >
                {getUiText(locale, 'exportLogsText')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleExportLogs('json')}
                style={{
                  borderRadius: '6px',
                  border: '1px solid #EFEAE4',
                  padding: '0.4rem 0.8rem',
                  background: busy ? '#F7F3EE' : '#FFFFFF',
                  color: busy ? '#A49C95' : '#7D746D',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 400,
                  transition: 'all 0.2s',
                }}
              >
                {getUiText(locale, 'exportLogsJson')}
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: '#FFF0F0',
              color: '#C65D5D',
              border: '1px solid #F5D5D5',
              fontSize: '0.95rem',
            }}
          >
            {error}
          </div>
        ) : null}

        {exportMessage ? (
          <div
            role="status"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: '#F2F6ED',
              color: '#6B8E53',
              border: '1px solid #DEE8D5',
              fontSize: '0.95rem',
            }}
          >
            {exportMessage}
          </div>
        ) : null}

        {currentView === 'workspace' && importMessage ? (
          <div
            role="status"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: '#F2F6ED',
              color: '#6B8E53',
              border: '1px solid #DEE8D5',
              fontSize: '0.95rem',
            }}
          >
            {importMessage}
          </div>
        ) : null}

        {currentView === 'workspace' && taskMessage ? (
          <div
            role="status"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: '#F2F6ED',
              color: '#6B8E53',
              border: '1px solid #DEE8D5',
              fontSize: '0.95rem',
            }}
          >
            {taskMessage}
          </div>
        ) : null}

        {currentView === 'workspace' && cleanupBackup ? (
          <div
            role="status"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: '#FFF8EC',
              color: '#8B5A2B',
              border: '1px solid #F3D8AC',
              fontSize: '0.95rem',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <strong>{getUiText(locale, 'cleanupRollbackReady')}</strong>
              <span>{cleanupBackup.message}</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleRollbackCleanup}
              style={{
                borderRadius: '6px',
                border: '1px solid #D47A6A',
                padding: '0.5rem 1rem',
                background: busy ? '#F7F3EE' : '#FFF0EE',
                color: busy ? '#A49C95' : '#D47A6A',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              {getUiText(locale, 'rollbackCleanup')}
            </button>
          </div>
        ) : null}

        {currentView === 'workspace' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleImportPlugin}
                disabled={busy}
                style={{
                  borderRadius: '6px',
                  border: '1px solid #EFEAE4',
                  padding: '0.5rem 1.25rem',
                  background: busy ? '#F7F3EE' : '#FFFFFF',
                  color: busy ? '#A49C95' : '#4A403A',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                }}
              >
                {getUiText(locale, 'importPlugin')}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <TemplatePanel
                locale={locale}
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onSelect={handleSelectTemplate}
              />

              <OverrideForm
                locale={locale}
                template={selectedTemplate}
                values={values}
                errors={validationErrors}
                busy={busy}
                fieldOptions={buildFieldOptions(
                  values,
                  nodeLtsVersions,
                  javaLtsVersions,
                  pythonVersions,
                  gitVersions,
                  mysqlVersions,
                  redisVersions,
                  mavenVersions,
                )}
                onChange={handleChange}
                onPickDirectory={handlePickDirectory}
              />

              <PrecheckPanel
                locale={locale}
                precheck={precheck}
                disabled={!selectedTemplate || busy || Object.keys(validationErrors).length > 0}
                busy={busy}
                onRun={handleRunPrecheck}
                onCleanup={handleCleanupDetections}
              />

              <TaskPanel
                locale={locale}
                task={task}
                progressEvents={taskProgressEvents}
                busy={busy}
                canCreate={canCreateTask}
                onCreateTask={handleCreateTask}
                onStartTask={handleStartTask}
                onCancelTask={handleCancelTask}
                onRetryPlugin={handleRetryPlugin}
                onApplyEnvChanges={handleApplyEnvChanges}
              />

              <SnapshotPanel
                locale={locale}
                snapshots={snapshots}
                busy={busy}
                onCreateSnapshot={handleCreateSnapshot}
                onDeleteSnapshot={handleDeleteSnapshot}
                onRollbackSnapshot={handleOpenSnapshotRollback}
              />
            </div>
          </>
        ) : (
          <BeginnerGuidePanel locale={locale} />
        )}
      </div>
      {currentView === 'workspace' && rollbackDialogOpen ? (
        <RollbackDialog
          locale={locale}
          suggestions={rollbackSuggestions}
          busy={busy}
          result={rollbackResult}
          onExecute={handleExecuteRollback}
          onClose={() => {
            setRollbackDialogOpen(false)
            setRollbackResult(undefined)
            setRollbackSuggestions([])
          }}
        />
      ) : null}
    </main>
  )
}
