import { useMemo, useState } from 'react'

import type { InstallTask, TaskProgressEvent } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import { getPluginStatusLabel, getPluginSummary, getTaskStatusLabel, getUiText } from '../copy'

type TaskPanelProps = {
  locale: AppLocale
  task?: InstallTask
  progressEvents: TaskProgressEvent[]
  busy?: boolean
  canCreate: boolean
  onCreateTask: () => void
  onStartTask: () => void
  onRetryPlugin: (pluginId: string) => void
  onCancelTask: () => void
  onApplyEnvChanges: (pluginId: string) => void
}

function getPluginStatusStyles(status: InstallTask['plugins'][number]['status']) {
  if (status === 'failed') {
    return {
      background: '#FFF0F0',
      color: '#C65D5D',
    }
  }

  if (status === 'verified_success') {
    return {
      background: '#EDF5EC',
      color: '#4B7340',
    }
  }

  if (status === 'running') {
    return {
      background: '#FFF5E8',
      color: '#C27628',
    }
  }

  return {
    background: '#EFEAE4',
    color: '#7D746D',
  }
}

export function TaskPanel({
  locale,
  task,
  progressEvents,
  busy,
  canCreate,
  onCreateTask,
  onStartTask,
  onRetryPlugin,
  onCancelTask,
  onApplyEnvChanges,
}: TaskPanelProps) {
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})

  const pluginProgressMap = useMemo(() => {
    const map = new Map<string, TaskProgressEvent[]>()

    for (const event of progressEvents) {
      const current = map.get(event.pluginId) ?? []
      current.push(event)
      map.set(event.pluginId, current)
    }

    return map
  }, [progressEvents])

  function toggleLog(pluginId: string) {
    setExpandedLogs((current) => ({
      ...current,
      [pluginId]: !(current[pluginId] ?? true),
    }))
  }

  return (
    <section
      style={{
        padding: '2rem',
        borderRadius: '16px',
        background: '#FFFFFF',
        border: '1px solid #EFEAE4',
        boxShadow: '0 4px 16px rgba(169, 132, 103, 0.04)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#2A2421', fontWeight: 500 }}>
            {getUiText(locale, 'taskTitle')}
          </h2>
          <p style={{ margin: 0, color: '#7D746D', lineHeight: 1.6 }}>
            {getUiText(locale, 'taskDescription')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCreateTask}
            disabled={!canCreate || busy}
            style={{
              borderRadius: '6px',
              border: '1px solid #EFEAE4',
              padding: '0.6rem 1.25rem',
              background: !canCreate || busy ? '#F5F0EA' : '#FFFFFF',
              color: !canCreate || busy ? '#A49C95' : '#4A403A',
              cursor: !canCreate || busy ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              fontSize: '0.95rem',
              transition: 'all 0.2s',
            }}
          >
            {getUiText(locale, 'createTask')}
          </button>
          <button
            type="button"
            onClick={onStartTask}
            disabled={!task || busy}
            style={{
              borderRadius: '6px',
              border: 'none',
              padding: '0.6rem 1.25rem',
              background: !task || busy ? '#EFEAE4' : '#C27628',
              color: !task || busy ? '#A49C95' : '#FFFFFF',
              cursor: !task || busy ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              fontSize: '0.95rem',
              transition: 'background 0.2s',
            }}
          >
            {getUiText(locale, 'startTask')}
          </button>
          {task?.status === 'running' && (
            <button
              type="button"
              onClick={onCancelTask}
              disabled={busy}
              style={{
                borderRadius: '6px',
                border: '1px solid #F5D5D5',
                padding: '0.6rem 1.25rem',
                background: busy ? '#F5F0EA' : '#FFF0F0',
                color: busy ? '#A49C95' : '#C65D5D',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '0.95rem',
              }}
            >
              {getUiText(locale, 'cancelTask')}
            </button>
          )}
        </div>
      </header>

      <div style={{ display: 'grid', gap: '1rem' }}>
        {task ? (
          <>
            <div
              style={{
                display: 'flex',
                gap: '0.8rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: '0.5rem',
              }}
            >
              <strong style={{ color: '#2A2421' }}>{getUiText(locale, 'taskStatus')}</strong>
              <span
                style={{
                  borderRadius: '6px',
                  padding: '0.35rem 0.75rem',
                  background: '#F9F7F5',
                  color: '#4A403A',
                  textTransform: 'uppercase',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: '1px solid #EFEAE4',
                }}
              >
                {getTaskStatusLabel(locale, task.status)}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '1rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                alignItems: 'start',
              }}
            >
              {task.plugins.map((plugin) => {
                const pluginEvents = pluginProgressMap.get(plugin.pluginId) ?? []
                const latestProgress = [...pluginEvents]
                  .reverse()
                  .find(
                    (event) =>
                      event.type === 'command_start' ||
                      event.type === 'command_done' ||
                      event.type === 'command_error',
                  )
                const liveLogs = pluginEvents.flatMap((event) => {
                  const lines = []
                  if (event.type === 'command_start') {
                    lines.push(`$ ${event.message}`)
                  }
                  if (event.output) {
                    lines.push(event.output)
                  }
                  if (event.type === 'command_error' && !event.output) {
                    lines.push(event.message)
                  }
                  return lines.filter(Boolean)
                })
                const allLogs = plugin.status === 'running' ? [...plugin.logs, ...liveLogs] : plugin.logs
                const isLogExpanded = expandedLogs[plugin.pluginId] ?? true
                const statusStyles = getPluginStatusStyles(plugin.status)

                return (
                  <article
                    key={plugin.pluginId}
                    style={{
                      borderRadius: '8px',
                      border: '1px solid #EFEAE4',
                      padding: '1.25rem',
                      background: '#FDFBF7',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <strong style={{ color: '#3D3531', fontSize: '1.05rem' }}>
                          {plugin.pluginId}
                        </strong>
                        <p style={{ margin: '0.35rem 0 0', color: '#A49C95', fontSize: '0.85rem' }}>
                          v{plugin.version}
                        </p>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.65rem',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            borderRadius: '4px',
                            padding: '0.3rem 0.6rem',
                            background: statusStyles.background,
                            color: statusStyles.color,
                            fontSize: '0.8rem',
                            fontWeight: 500,
                          }}
                        >
                          {getPluginStatusLabel(locale, plugin.status)}
                        </span>
                        {plugin.status === 'failed' ? (
                          <button
                            type="button"
                            onClick={() => onRetryPlugin(plugin.pluginId)}
                            disabled={busy}
                            style={{
                              borderRadius: '6px',
                              border: '1px solid #D47A6A',
                              padding: '0.4rem 0.85rem',
                              background: '#FFF0EE',
                              color: '#D47A6A',
                              cursor: busy ? 'not-allowed' : 'pointer',
                              fontSize: '0.85rem',
                              fontWeight: 500,
                              transition: 'all 0.2s',
                            }}
                          >
                            {getUiText(locale, 'retryPlugin')}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {latestProgress?.commandIndex && latestProgress.commandTotal ? (
                      <div
                        style={{
                          marginTop: '1rem',
                          padding: '0.75rem 0.9rem',
                          borderRadius: '6px',
                          background: '#FFF7ED',
                          border: '1px solid #F5DEC2',
                          color: '#8A5723',
                          fontSize: '0.9rem',
                          fontWeight: 500,
                        }}
                      >
                        {getUiText(locale, 'pluginRunningProgress')} {latestProgress.commandIndex}/
                        {latestProgress.commandTotal}
                      </div>
                    ) : null}

                    {plugin.lastResult ? (
                      <div
                        style={{
                          marginTop: '1rem',
                          color: '#4A403A',
                          lineHeight: 1.6,
                          fontSize: '0.95rem',
                        }}
                      >
                        <p style={{ margin: 0 }}>
                          {getPluginSummary(
                            locale,
                            plugin.pluginId,
                            plugin.lastResult.executionMode,
                            plugin.lastResult.summary,
                          )}
                        </p>
                        <p style={{ margin: '0.5rem 0 0', color: '#7D746D', fontSize: '0.85rem' }}>
                          Node {plugin.lastResult.version} · {getUiText(locale, 'cacheLabel')}{' '}
                          {plugin.lastResult.paths.npmCacheDir}
                        </p>
                        <p style={{ margin: '0.75rem 0 0', color: '#7D746D', fontSize: '0.85rem' }}>
                          {getUiText(locale, 'downloadItems')}（{plugin.lastResult.downloads.length}）
                        </p>
                        <ul style={{ margin: '0.35rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.85rem' }}>
                          {plugin.lastResult.downloads.map((download) => (
                            <li key={`${download.kind}:${download.url}`}>{download.url}</li>
                          ))}
                        </ul>
                        <p style={{ margin: '0.75rem 0 0', color: '#7D746D', fontSize: '0.85rem' }}>
                          {getUiText(locale, 'commandPlan')}（{plugin.lastResult.commands.length}）
                        </p>
                        <ul style={{ margin: '0.35rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.85rem' }}>
                          {plugin.lastResult.commands.map((command) => (
                            <li key={command}>{command}</li>
                          ))}
                        </ul>
                        <p style={{ margin: '0.75rem 0 0', color: '#7D746D', fontSize: '0.85rem' }}>
                          {getUiText(locale, 'envChangesLabel')}（{plugin.lastResult.envChanges.length}）
                        </p>
                        <ul style={{ margin: '0.35rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.85rem' }}>
                          {plugin.lastResult.envChanges.map((change) => (
                            <li key={`${change.kind}:${change.key}:${change.target ?? ''}`}>
                              {change.kind} · {change.key} = {change.value}
                            </li>
                          ))}
                        </ul>
                        {plugin.lastResult.envChanges.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => onApplyEnvChanges(plugin.pluginId)}
                            disabled={busy}
                            style={{
                              marginTop: '0.8rem',
                              borderRadius: '6px',
                              border: '1px solid #D47A6A',
                              padding: '0.4rem 0.85rem',
                              background: '#FFF0EE',
                              color: '#D47A6A',
                              cursor: busy ? 'not-allowed' : 'pointer',
                              fontSize: '0.85rem',
                              fontWeight: 500,
                            }}
                          >
                            {getUiText(locale, 'applyEnvChanges')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {allLogs.length > 0 ? (
                      <div style={{ marginTop: '1rem' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.75rem',
                            marginBottom: isLogExpanded ? '0.75rem' : 0,
                          }}
                        >
                          <strong style={{ color: '#3D3531', fontSize: '0.9rem' }}>
                            {getUiText(locale, 'logTerminalTitle')}
                          </strong>
                          <button
                            type="button"
                            onClick={() => toggleLog(plugin.pluginId)}
                            style={{
                              border: '1px solid #EFEAE4',
                              background: '#FFFFFF',
                              color: '#7D746D',
                              borderRadius: '6px',
                              padding: '0.35rem 0.7rem',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                            }}
                          >
                            {isLogExpanded
                              ? getUiText(locale, 'logTerminalCollapse')
                              : getUiText(locale, 'logTerminalExpand')}
                          </button>
                        </div>
                        {isLogExpanded ? (
                          <pre
                            style={{
                              margin: 0,
                              padding: '1rem',
                              borderRadius: '6px',
                              background: '#2A2421',
                              color: '#F4EFEA',
                              overflowX: 'auto',
                              maxHeight: '260px',
                              fontSize: '0.85rem',
                              lineHeight: 1.6,
                              fontFamily: 'Menlo, Monaco, Consolas, monospace',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {allLogs.join('\n')}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </>
        ) : (
          <p
            style={{
              margin: 0,
              color: '#7D746D',
              padding: '1rem',
              background: '#F9F7F5',
              borderRadius: '8px',
              border: '1px solid #EFEAE4',
            }}
          >
            {getUiText(locale, 'noTask')}
          </p>
        )}
      </div>
    </section>
  )
}
