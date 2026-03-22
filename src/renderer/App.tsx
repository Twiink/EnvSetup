import { useEffect, useState } from 'react'

import type {
  InstallTask,
  Primitive,
  PrecheckResult,
  ResolvedTemplate,
} from '../main/core/contracts'
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from '../shared/locale'
import { validateResolvedTemplateValues } from '../shared/templateFields'
import { getLocaleButtonLabel, getUiText } from './copy'
import { OverrideForm } from './components/OverrideForm'
import { PrecheckPanel } from './components/PrecheckPanel'
import { TaskPanel } from './components/TaskPanel'
import { TemplatePanel } from './components/TemplatePanel'

function buildInitialValues(template: ResolvedTemplate): Record<string, Primitive> {
  return Object.fromEntries(Object.values(template.fields).map((field) => [field.key, field.value]))
}

function getTemplateById(
  templates: ResolvedTemplate[],
  templateId: string,
): ResolvedTemplate | undefined {
  return templates.find((template) => template.id === templateId)
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
  const [values, setValues] = useState<Record<string, Primitive>>({})
  const [precheck, setPrecheck] = useState<PrecheckResult>()
  const [task, setTask] = useState<InstallTask>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = getUiText(locale, 'documentTitle')
    window.localStorage.setItem('envsetup.locale', locale)
  }, [locale])

  useEffect(() => {
    let active = true

    async function loadTemplates() {
      try {
        const nextTemplates = await window.envSetup.listTemplates()
        if (!active || nextTemplates.length === 0) {
          return
        }

        const firstTemplate = nextTemplates[0]
        setTemplates(nextTemplates)
        setSelectedTemplateId(firstTemplate.id)
        setValues(buildInitialValues(firstTemplate))
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

  const selectedTemplate = getTemplateById(templates, selectedTemplateId)
  const validationErrors = selectedTemplate
    ? validateResolvedTemplateValues(selectedTemplate, values, locale)
    : {}
  const canCreateTask =
    Boolean(selectedTemplate) &&
    Object.keys(validationErrors).length === 0 &&
    precheck !== undefined &&
    precheck.level !== 'block'

  function handleSelectTemplate(templateId: string) {
    const template = getTemplateById(templates, templateId)
    if (!template) {
      return
    }

    setSelectedTemplateId(templateId)
    setValues(buildInitialValues(template))
    setPrecheck(undefined)
    setTask(undefined)
    setError(undefined)
  }

  function handleChange(key: string, value: Primitive) {
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }))
    setPrecheck(undefined)
    setTask(undefined)
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
      })
      setTask(nextTask)
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

    try {
      const nextTask = await window.envSetup.startTask(task.id)
      setTask(nextTask)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
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

    try {
      const nextTask = await window.envSetup.retryPlugin(task.id, pluginId)
      setTask(nextTask)
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : String(retryError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        background: 'radial-gradient(circle at top left, #fff7ed, #f8fafc 55%, #e2e8f0)',
        color: '#111827',
        fontFamily: '"IBM Plex Sans", "Avenir Next", "SF Pro Display", sans-serif',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        <header
          style={{
            display: 'grid',
            gap: '0.6rem',
            padding: '1.5rem',
            borderRadius: '28px',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,237,213,0.92))',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.10)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.82rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#b45309',
            }}
          >
            {getUiText(locale, 'appBadge')}
          </p>
          <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 4vw, 3.5rem)', lineHeight: 1 }}>
            {getUiText(locale, 'appTitle')}
          </h1>
          <p style={{ margin: 0, maxWidth: '54rem', color: '#475569', lineHeight: 1.7 }}>
            {getUiText(locale, 'appDescription')}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', color: '#475569' }}>
              {getUiText(locale, 'languageLabel')}
            </span>
            {(['zh-CN', 'en'] as const).map((targetLocale) => (
              <button
                key={targetLocale}
                type="button"
                onClick={() => setLocale(targetLocale)}
                aria-pressed={locale === targetLocale}
                style={{
                  borderRadius: '999px',
                  border:
                    locale === targetLocale
                      ? '1px solid rgba(217, 119, 6, 0.45)'
                      : '1px solid rgba(148, 163, 184, 0.35)',
                  padding: '0.5rem 0.9rem',
                  background:
                    locale === targetLocale ? 'rgba(255, 237, 213, 0.9)' : 'rgba(255,255,255,0.76)',
                  cursor: 'pointer',
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
              padding: '1rem 1.2rem',
              borderRadius: '18px',
              background: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid rgba(248, 113, 113, 0.35)',
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gap: '1.25rem',
            gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
          }}
        >
          <TemplatePanel
            locale={locale}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            onSelect={handleSelectTemplate}
          />

          <div style={{ display: 'grid', gap: '1rem' }}>
            <OverrideForm
              locale={locale}
              template={selectedTemplate}
              values={values}
              errors={validationErrors}
              onChange={handleChange}
            />
            <PrecheckPanel
              locale={locale}
              precheck={precheck}
              disabled={!selectedTemplate || busy || Object.keys(validationErrors).length > 0}
              onRun={handleRunPrecheck}
            />
            <TaskPanel
              locale={locale}
              task={task}
              busy={busy}
              canCreate={canCreateTask}
              onCreateTask={handleCreateTask}
              onStartTask={handleStartTask}
              onRetryPlugin={handleRetryPlugin}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
