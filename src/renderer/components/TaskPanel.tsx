import type { InstallTask } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import { getPluginStatusLabel, getPluginSummary, getTaskStatusLabel, getUiText } from '../copy'

type TaskPanelProps = {
  locale: AppLocale
  task?: InstallTask
  busy?: boolean
  canCreate: boolean
  onCreateTask: () => void
  onStartTask: () => void
  onRetryPlugin: (pluginId: string) => void
}

export function TaskPanel({
  locale,
  task,
  busy,
  canCreate,
  onCreateTask,
  onStartTask,
  onRetryPlugin,
}: TaskPanelProps) {
  return (
    <section
      style={{
        padding: '1.25rem',
        borderRadius: '24px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(241,245,249,0.95))',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <h2 style={{ margin: 0 }}>{getUiText(locale, 'taskTitle')}</h2>
          <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
            {getUiText(locale, 'taskDescription')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCreateTask}
            disabled={!canCreate || busy}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(17, 24, 39, 0.12)',
              padding: '0.8rem 1.2rem',
              background: !canCreate || busy ? '#cbd5e1' : '#fff',
              cursor: !canCreate || busy ? 'not-allowed' : 'pointer',
            }}
          >
            {getUiText(locale, 'createTask')}
          </button>
          <button
            type="button"
            onClick={onStartTask}
            disabled={!task || busy}
            style={{
              borderRadius: '999px',
              border: 'none',
              padding: '0.8rem 1.2rem',
              background: !task || busy ? '#cbd5e1' : '#0f766e',
              color: '#fff',
              cursor: !task || busy ? 'not-allowed' : 'pointer',
            }}
          >
            {getUiText(locale, 'startTask')}
          </button>
        </div>
      </header>

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.85rem' }}>
        {task ? (
          <>
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{getUiText(locale, 'taskStatus')}</strong>
              <span
                style={{
                  borderRadius: '999px',
                  padding: '0.3rem 0.7rem',
                  background: '#e2e8f0',
                  textTransform: 'uppercase',
                  fontSize: '0.8rem',
                }}
              >
                {getTaskStatusLabel(locale, task.status)}
              </span>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {task.plugins.map((plugin) => (
                <article
                  key={plugin.pluginId}
                  style={{
                    borderRadius: '18px',
                    border: '1px solid rgba(148,163,184,0.25)',
                    padding: '1rem',
                    background: '#fff',
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
                      <strong>{plugin.pluginId}</strong>
                      <p style={{ margin: '0.35rem 0 0', color: '#64748b' }}>v{plugin.version}</p>
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
                          borderRadius: '999px',
                          padding: '0.3rem 0.7rem',
                          background: '#f1f5f9',
                          fontSize: '0.8rem',
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
                            borderRadius: '999px',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            padding: '0.45rem 0.8rem',
                            background: '#fff',
                            color: '#b91c1c',
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {getUiText(locale, 'retryPlugin')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {plugin.lastResult ? (
                    <div style={{ marginTop: '0.85rem', color: '#334155', lineHeight: 1.6 }}>
                      <p style={{ margin: 0 }}>
                        {getPluginSummary(
                          locale,
                          plugin.pluginId,
                          plugin.lastResult.executionMode,
                          plugin.lastResult.summary,
                        )}
                      </p>
                      <p style={{ margin: '0.45rem 0 0' }}>
                        Node {plugin.lastResult.version} · {getUiText(locale, 'cacheLabel')}{' '}
                        {plugin.lastResult.paths.npmCacheDir}
                      </p>
                    </div>
                  ) : null}
                  {plugin.logs.length > 0 ? (
                    <pre
                      style={{
                        margin: '0.85rem 0 0',
                        padding: '0.85rem',
                        borderRadius: '14px',
                        background: '#0f172a',
                        color: '#e2e8f0',
                        overflowX: 'auto',
                        fontSize: '0.82rem',
                      }}
                    >
                      {plugin.logs.join('\n')}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <p style={{ margin: 0, color: '#64748b' }}>{getUiText(locale, 'noTask')}</p>
        )}
      </div>
    </section>
  )
}
