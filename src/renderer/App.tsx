import { useEffect, useState } from 'react'

import type {
  DetectedEnvironment,
  InstallTask,
  Primitive,
  PrecheckResult,
  ResolvedTemplate,
  TaskProgressEvent,
} from '../main/core/contracts'
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from '../shared/locale'
import { validateResolvedTemplateValues } from '../shared/templateFields'
import { getLocaleButtonLabel, getUiText } from './copy'
import { OverrideForm } from './components/OverrideForm'
import { PrecheckPanel } from './components/PrecheckPanel'
import { TaskPanel } from './components/TaskPanel'
import { TemplatePanel } from './components/TemplatePanel'

function buildInitialValues(
  template: ResolvedTemplate,
  nodeLtsVersions: string[],
  javaLtsVersions: string[],
  pythonVersions: string[],
  gitVersions: string[],
): Record<string, Primitive> {
  const values = Object.fromEntries(
    Object.values(template.fields).map((field) => [field.key, field.value]),
  )

  const templateNodeVersion = values['node.nodeVersion']
  if (
    nodeLtsVersions.length > 0 &&
    (typeof templateNodeVersion !== 'string' || !nodeLtsVersions.includes(templateNodeVersion))
  ) {
    values['node.nodeVersion'] = nodeLtsVersions[0]
  }

  const templateJavaVersion = values['java.javaVersion']
  if (
    javaLtsVersions.length > 0 &&
    (typeof templateJavaVersion !== 'string' || !javaLtsVersions.includes(templateJavaVersion))
  ) {
    values['java.javaVersion'] = javaLtsVersions[0]
  }

  const templatePythonVersion = values['python.pythonVersion']
  if (
    pythonVersions.length > 0 &&
    (typeof templatePythonVersion !== 'string' || !pythonVersions.includes(templatePythonVersion))
  ) {
    values['python.pythonVersion'] = pythonVersions[0]
  }

  const templateGitVersion = values['git.gitVersion']
  if (
    gitVersions.length > 0 &&
    (typeof templateGitVersion !== 'string' || !gitVersions.includes(templateGitVersion))
  ) {
    values['git.gitVersion'] = gitVersions[0]
  }

  return values
}

function buildFieldOptions(
  values: Record<string, Primitive>,
  nodeLtsVersions: string[],
  javaLtsVersions: string[],
  pythonVersions: string[],
  gitVersions: string[],
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

  return {
    'node.nodeVersion': nodeVersions,
    'java.javaVersion': javaVersionsList,
    'python.pythonVersion': pythonVersionsList,
    'git.gitVersion': gitVersionsList,
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

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_LOCALE
    }

    return normalizeLocale(window.localStorage.getItem('envsetup.locale'))
  })
  const [templates, setTemplates] = useState<ResolvedTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [nodeLtsVersions, setNodeLtsVersions] = useState<string[]>([])
  const [javaLtsVersions, setJavaLtsVersions] = useState<string[]>([])
  const [pythonVersions, setPythonVersions] = useState<string[]>([])
  const [gitVersions, setGitVersions] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, Primitive>>({})
  const [precheck, setPrecheck] = useState<PrecheckResult>()
  const [task, setTask] = useState<InstallTask>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [importMessage, setImportMessage] = useState<string>()
  const [taskProgressEvents, setTaskProgressEvents] = useState<TaskProgressEvent[]>([])
  const [taskMessage, setTaskMessage] = useState<string>()
  const [cleanupBackup, setCleanupBackup] = useState<{ snapshotId: string; message: string }>()
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = getUiText(locale, 'documentTitle')
    window.localStorage.setItem('envsetup.locale', locale)
  }, [locale])

  useEffect(() => {
    let active = true

    async function loadTemplates() {
      try {
        const {
          templates: nextTemplates,
          nodeLtsVersions: nextNodeLtsVersions,
          javaLtsVersions: nextJavaLtsVersions,
          pythonVersions: nextPythonVersions,
          gitVersions: nextGitVersions,
        } = await window.envSetup.loadBootstrap()
        if (!active) {
          return
        }
        if (nextTemplates.length === 0) {
          setError('No templates found — fixtures/templates may be missing or empty')
          return
        }

        const firstTemplate = nextTemplates[0]
        setTemplates(nextTemplates)
        setNodeLtsVersions(nextNodeLtsVersions)
        setJavaLtsVersions(nextJavaLtsVersions)
        setPythonVersions(nextPythonVersions)
        setGitVersions(nextGitVersions)
        setSelectedTemplateId(firstTemplate.id)
        setValues(
          buildInitialValues(
            firstTemplate,
            nextNodeLtsVersions,
            nextJavaLtsVersions,
            nextPythonVersions,
            nextGitVersions,
          ),
        )
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
  }, [])

  useEffect(() => {
    return () => {
      removeTaskProgressListenerSafely()
    }
  }, [])

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
    const template = getTemplateById(templates, templateId)
    if (!template) {
      return
    }

    setSelectedTemplateId(templateId)
    setValues(
      buildInitialValues(template, nodeLtsVersions, javaLtsVersions, pythonVersions, gitVersions),
    )
    setPrecheck(undefined)
    setTask(undefined)
    setTaskProgressEvents([])
    setError(undefined)
    setCleanupBackup(undefined)
  }

  function handleChange(key: string, value: Primitive) {
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }))
    setPrecheck(undefined)
    setTask(undefined)
    setTaskProgressEvents([])
    setError(undefined)
  }

  async function handleRunPrecheck() {
    if (!selectedTemplate) {
      return
    }

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
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateTask() {
    if (!selectedTemplate || !canCreateTask) {
      return
    }

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
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setBusy(false)
    }
  }

  async function handleStartTask() {
    if (!task) {
      return
    }

    setBusy(true)
    setError(undefined)
    setTaskProgressEvents([])
    removeTaskProgressListenerSafely()
    registerTaskProgressListener((event) => {
      if (event.taskId !== task.id) {
        return
      }
      setTaskProgressEvents((currentEvents) => [...currentEvents, event])
    })

    try {
      const nextTask = await window.envSetup.startTask(task.id)
      setTask(nextTask)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      removeTaskProgressListenerSafely()
      setBusy(false)
    }
  }

  async function handleCancelTask() {
    if (!task) {
      return
    }

    setBusy(true)
    setError(undefined)

    try {
      const nextTask = await window.envSetup.cancelTask(task.id)
      setTask(nextTask)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    } finally {
      setBusy(false)
    }
  }

  async function handleImportPlugin() {
    setBusy(true)
    setError(undefined)
    setImportMessage(undefined)

    try {
      const pluginPath = await window.envSetup.pickDirectory()
      if (!pluginPath) {
        return
      }
      await window.envSetup.importPluginFromPath(pluginPath)
      setImportMessage(getUiText(locale, 'importPluginSuccess'))
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError))
    } finally {
      setBusy(false)
    }
  }

  async function handleRetryPlugin(pluginId: string) {
    if (!task) {
      return
    }

    setBusy(true)
    setError(undefined)
    setTaskProgressEvents([])
    removeTaskProgressListenerSafely()
    registerTaskProgressListener((event) => {
      if (event.taskId !== task.id || event.pluginId !== pluginId) {
        return
      }
      setTaskProgressEvents((currentEvents) => [...currentEvents, event])
    })

    try {
      const nextTask = await window.envSetup.retryPlugin(task.id, pluginId)
      setTask(nextTask)
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : String(retryError))
    } finally {
      removeTaskProgressListenerSafely()
      setBusy(false)
    }
  }

  async function handleApplyEnvChanges(pluginId: string) {
    if (!task) {
      return
    }

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
      setError(applyError instanceof Error ? applyError.message : String(applyError))
    } finally {
      setBusy(false)
    }
  }

  async function handleCleanupDetections(detections: DetectedEnvironment[]) {
    if (!selectedTemplate || detections.length === 0) {
      return
    }

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
      setPrecheck(nextPrecheck)

      if (cleanupErrors.length > 0) {
        setError(cleanupErrors.join(' | '))
      }
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    } finally {
      setBusy(false)
    }
  }

  async function handleRollbackCleanup() {
    if (!selectedTemplate || !cleanupBackup) {
      return
    }

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
      setPrecheck(nextPrecheck)

      if (rollbackResult.success) {
        setCleanupBackup(undefined)
      } else {
        setError(
          rollbackResult.errors.map((entry) => entry.error).join(' | ') || rollbackResult.message,
        )
      }
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
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
              gap: '0.75rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: '0.5rem',
            }}
          >
            <span style={{ fontSize: '0.85rem', color: '#7D746D' }}>
              {getUiText(locale, 'languageLabel')}
            </span>
            {(['zh-CN', 'en'] as const).map((targetLocale) => (
              <button
                key={targetLocale}
                type="button"
                onClick={() => setLocale(targetLocale)}
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

        {importMessage ? (
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

        {taskMessage ? (
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

        {cleanupBackup ? (
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
        </div>
      </div>
    </main>
  )
}
