import type { DetectedEnvironment, PrecheckResult } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import {
  getDetectedEnvironmentKindLabel,
  getDetectedEnvironmentSourceLabel,
  getPrecheckItemMessage,
  getPrecheckLevelLabel,
  getUiText,
} from '../copy'

type PrecheckPanelProps = {
  locale: AppLocale
  precheck?: PrecheckResult
  disabled?: boolean
  busy?: boolean
  onRun: () => void
  onCleanup: (detection: DetectedEnvironment) => void
}

function levelColor(level: PrecheckResult['level']) {
  if (level === 'pass') {
    return '#166534'
  }
  if (level === 'warn') {
    return '#b45309'
  }
  return '#b91c1c'
}

export function PrecheckPanel({
  locale,
  precheck,
  disabled,
  busy,
  onRun,
  onCleanup,
}: PrecheckPanelProps) {
  return (
    <section
      style={{ padding: '1.25rem', borderRadius: '24px', background: 'rgba(250, 250, 249, 0.92)' }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <h2 style={{ margin: 0 }}>{getUiText(locale, 'precheckTitle')}</h2>
          <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
            {getUiText(locale, 'precheckDescription')}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onRun}
          style={{
            borderRadius: '999px',
            border: 'none',
            padding: '0.8rem 1.2rem',
            background: disabled ? '#cbd5e1' : '#111827',
            color: '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {getUiText(locale, 'runPrecheck')}
        </button>
      </header>

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
        {precheck ? (
          <>
            <div
              style={{
                display: 'inline-flex',
                width: 'fit-content',
                borderRadius: '999px',
                padding: '0.3rem 0.8rem',
                background: `${levelColor(precheck.level)}18`,
                color: levelColor(precheck.level),
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              {getPrecheckLevelLabel(locale, precheck.level)}
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#334155', lineHeight: 1.7 }}>
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
            {precheck.detections.length > 0 ? (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <strong>{getUiText(locale, 'detectedEnvironmentTitle')}</strong>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {precheck.detections.map((detection) => (
                    <article
                      key={detection.id}
                      style={{
                        borderRadius: '18px',
                        border: '1px solid rgba(148,163,184,0.24)',
                        background: '#fff',
                        padding: '0.9rem 1rem',
                        display: 'grid',
                        gap: '0.5rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.8rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong>{getDetectedEnvironmentKindLabel(locale, detection)}</strong>
                        {detection.cleanupSupported ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCleanup(detection)}
                            style={{
                              borderRadius: '999px',
                              border: '1px solid rgba(185, 28, 28, 0.18)',
                              padding: '0.45rem 0.8rem',
                              background: busy ? '#cbd5e1' : '#fef2f2',
                              color: '#b91c1c',
                              cursor: busy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {getUiText(locale, 'cleanupEnvironment')}
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                            {getUiText(locale, 'cleanupUnavailable')}
                          </span>
                        )}
                      </div>
                      <code
                        style={{
                          padding: '0.65rem 0.75rem',
                          borderRadius: '14px',
                          background: '#0f172a',
                          color: '#e2e8f0',
                          overflowX: 'auto',
                        }}
                      >
                        {detection.path}
                      </code>
                      <p style={{ margin: 0, color: '#64748b', fontSize: '0.88rem' }}>
                        {getDetectedEnvironmentSourceLabel(locale, detection)}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0, color: '#64748b' }}>{getUiText(locale, 'precheckEmpty')}</p>
        )}
      </div>
    </section>
  )
}
