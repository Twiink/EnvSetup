import type {
  DetectedEnvironment,
  EnhancedPrecheckResult,
  PrecheckResult,
} from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import {
  getDetectedEnvironmentKindLabel,
  getDetectedEnvironmentSourceLabel,
  getNetworkCheckToolLabel,
  getPrecheckItemMessage,
  getPrecheckLevelLabel,
  getUiText,
} from '../copy'

type PrecheckPanelProps = {
  locale: AppLocale
  precheck?: PrecheckResult
  enhancedPrecheck?: EnhancedPrecheckResult
  disabled?: boolean
  busy?: boolean
  onRun: () => void
  onCleanup: (detections: DetectedEnvironment[]) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function PrecheckPanel({
  locale,
  precheck,
  enhancedPrecheck,
  disabled,
  busy,
  onRun,
  onCleanup,
}: PrecheckPanelProps) {
  const cleanupDetections =
    precheck?.detections.filter((detection) => detection.cleanupSupported) ?? []
  const networkChecks = precheck?.networkChecks ?? []

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
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#2A2421', fontWeight: 500 }}>
            {getUiText(locale, 'precheckTitle')}
          </h2>
          <p style={{ margin: 0, color: '#7D746D', lineHeight: 1.6 }}>
            {getUiText(locale, 'precheckDescription')}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onRun}
          style={{
            borderRadius: '6px',
            border: 'none',
            padding: '0.6rem 1.25rem',
            background: disabled ? '#F5F0EA' : '#2A2421',
            color: disabled ? '#A49C95' : '#FFFFFF',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '0.95rem',
            transition: 'background 0.2s',
          }}
        >
          {getUiText(locale, 'runPrecheck')}
        </button>
      </header>

      <div style={{ display: 'grid', gap: '1rem' }}>
        {precheck ? (
          <>
            <div
              style={{
                display: 'inline-flex',
                width: 'fit-content',
                borderRadius: '6px',
                padding: '0.35rem 0.75rem',
                background:
                  precheck.level === 'pass'
                    ? '#EDF5EC'
                    : precheck.level === 'warn'
                      ? '#FFF5EA'
                      : '#FFF0F0',
                color:
                  precheck.level === 'pass'
                    ? '#4B7340'
                    : precheck.level === 'warn'
                      ? '#C27628'
                      : '#C65D5D',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: `1px solid ${precheck.level === 'pass' ? '#D5E8D1' : precheck.level === 'warn' ? '#F7DDBE' : '#F5D5D5'}`,
              }}
            >
              {getPrecheckLevelLabel(locale, precheck.level)}
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: '1.25rem',
                color: '#4A403A',
                lineHeight: 1.7,
                fontSize: '0.95rem',
              }}
            >
              {precheck.items.length > 0 ? (
                precheck.items.map((item) => (
                  <li key={`${item.code}-${item.message}`}>
                    {getPrecheckItemMessage(locale, item.code, item.message)}
                  </li>
                ))
              ) : (
                <li>{getUiText(locale, 'precheckAllPassed')}</li>
              )}
            </ul>
            {networkChecks.length > 0 ? (
              <div style={{ display: 'grid', gap: '1rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  <strong style={{ color: '#2A2421', fontWeight: 600 }}>
                    {getUiText(locale, 'networkCheckTitle')}
                  </strong>
                  <p style={{ margin: 0, color: '#7D746D', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    {getUiText(locale, 'networkCheckDescription')}
                  </p>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: '1rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    alignItems: 'start',
                  }}
                >
                  {networkChecks.map((check) => (
                    <article
                      key={check.id}
                      style={{
                        borderRadius: '8px',
                        border: '1px solid #EFEAE4',
                        background: check.reachable ? '#F7FBF6' : '#FFF7F7',
                        padding: '1rem 1.25rem',
                        display: 'grid',
                        gap: '0.75rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '0.2rem' }}>
                          <strong style={{ color: '#3D3531' }}>{check.host}</strong>
                          <span style={{ color: '#7D746D', fontSize: '0.9rem' }}>
                            {getNetworkCheckToolLabel(locale, check.tool)}
                          </span>
                        </div>
                        <span
                          style={{
                            borderRadius: '999px',
                            padding: '0.25rem 0.65rem',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: check.reachable ? '#EDF5EC' : '#FFF0F0',
                            color: check.reachable ? '#4B7340' : '#C65D5D',
                            border: `1px solid ${check.reachable ? '#D5E8D1' : '#F5D5D5'}`,
                          }}
                        >
                          {getUiText(
                            locale,
                            check.reachable ? 'networkCheckReachable' : 'networkCheckUnreachable',
                          )}
                        </span>
                      </div>
                      <code
                        style={{
                          padding: '0.75rem 1rem',
                          borderRadius: '6px',
                          background: '#2A2421',
                          color: '#F4EFEA',
                          overflowX: 'auto',
                          fontSize: '0.85rem',
                          fontFamily: 'Menlo, Monaco, Consolas, monospace',
                        }}
                      >
                        {check.url}
                      </code>
                      <div style={{ display: 'grid', gap: '0.35rem', color: '#5B514B' }}>
                        <span style={{ fontSize: '0.9rem' }}>
                          {getUiText(locale, 'networkCheckLatency')}:{' '}
                          {formatDuration(check.durationMs)}
                        </span>
                        {typeof check.statusCode === 'number' ? (
                          <span style={{ fontSize: '0.9rem' }}>
                            {getUiText(locale, 'networkCheckStatus')}: {check.statusCode}
                          </span>
                        ) : null}
                        {check.error ? (
                          <span style={{ fontSize: '0.9rem', color: '#A54646' }}>
                            {getUiText(locale, 'networkCheckError')}: {check.error}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
            {precheck.detections.length > 0 ? (
              <div style={{ display: 'grid', gap: '1rem', marginTop: '0.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.8rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ color: '#2A2421', fontWeight: 600 }}>
                    {getUiText(locale, 'detectedEnvironmentTitle')}
                  </strong>
                  {cleanupDetections.length > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onCleanup(cleanupDetections)}
                      style={{
                        borderRadius: '6px',
                        border: '1px solid #D47A6A',
                        padding: '0.4rem 0.85rem',
                        background: busy ? '#F5F0EA' : '#FFF0EE',
                        color: busy ? '#A49C95' : '#D47A6A',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        transition: 'all 0.2s',
                      }}
                    >
                      {getUiText(locale, 'cleanupEnvironment')}
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.85rem', color: '#A49C95' }}>
                      {getUiText(locale, 'cleanupUnavailable')}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: '1rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    alignItems: 'start',
                  }}
                >
                  {precheck.detections.map((detection) => (
                    <article
                      key={detection.id}
                      style={{
                        borderRadius: '8px',
                        border: '1px solid #EFEAE4',
                        background: '#FDFBF7',
                        padding: '1rem 1.25rem',
                        display: 'grid',
                        gap: '0.75rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <strong style={{ color: '#3D3531' }}>
                          {getDetectedEnvironmentKindLabel(locale, detection)}
                        </strong>
                      </div>
                      <code
                        style={{
                          padding: '0.75rem 1rem',
                          borderRadius: '6px',
                          background: '#2A2421',
                          color: '#F4EFEA',
                          overflowX: 'auto',
                          fontSize: '0.85rem',
                          fontFamily: 'Menlo, Monaco, Consolas, monospace',
                        }}
                      >
                        {detection.path}
                      </code>
                      <p style={{ margin: 0, color: '#7D746D', fontSize: '0.9rem' }}>
                        {getDetectedEnvironmentSourceLabel(locale, detection)}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
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
            {getUiText(locale, 'precheckEmpty')}
          </p>
        )}
      </div>

      {enhancedPrecheck && (
        <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
          {enhancedPrecheck.conflicts.length > 0 && (
            <div
              style={{
                padding: '1rem 1.25rem',
                borderRadius: '8px',
                background: '#FFF0F0',
                border: '1px solid #F5D5D5',
              }}
            >
              <strong style={{ color: '#C65D5D', fontSize: '0.95rem' }}>
                {enhancedPrecheck.conflicts.length} conflict
                {enhancedPrecheck.conflicts.length > 1 ? 's' : ''} detected
              </strong>
              <ul
                style={{
                  margin: '0.5rem 0 0',
                  paddingLeft: '1.25rem',
                  display: 'grid',
                  gap: '0.4rem',
                }}
              >
                {enhancedPrecheck.conflicts.map((conflict, i) => (
                  <li key={i} style={{ fontSize: '0.9rem', color: '#A54646' }}>
                    <strong style={{ fontWeight: 600 }}>{conflict.type}</strong>: {conflict.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div
            style={{
              padding: '1rem 1.25rem',
              borderRadius: '8px',
              background: '#FDFBF7',
              border: '1px solid #EFEAE4',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: '#7D746D',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Files created
              </span>
              <strong style={{ fontSize: '1.1rem', color: '#2A2421' }}>
                {enhancedPrecheck.impact.filesCreated}
              </strong>
            </div>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: '#7D746D',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Files modified
              </span>
              <strong style={{ fontSize: '1.1rem', color: '#2A2421' }}>
                {enhancedPrecheck.impact.filesModified}
              </strong>
            </div>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: '#7D746D',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Env vars changed
              </span>
              <strong style={{ fontSize: '1.1rem', color: '#2A2421' }}>
                {enhancedPrecheck.impact.envVarsChanged}
              </strong>
            </div>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: '#7D746D',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Disk usage
              </span>
              <strong style={{ fontSize: '1.1rem', color: '#2A2421' }}>
                {formatBytes(enhancedPrecheck.impact.totalDiskUsage)}
              </strong>
            </div>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: '#7D746D',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Est. duration
              </span>
              <strong style={{ fontSize: '1.1rem', color: '#2A2421' }}>
                {formatDuration(enhancedPrecheck.impact.estimatedDurationMs)}
              </strong>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
