import type { PrecheckResult } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import { getPrecheckItemMessage, getPrecheckLevelLabel, getUiText } from '../copy'

type PrecheckPanelProps = {
  locale: AppLocale
  precheck?: PrecheckResult
  disabled?: boolean
  onRun: () => void
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

export function PrecheckPanel({ locale, precheck, disabled, onRun }: PrecheckPanelProps) {
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
          </>
        ) : (
          <p style={{ margin: 0, color: '#64748b' }}>{getUiText(locale, 'precheckEmpty')}</p>
        )}
      </div>
    </section>
  )
}
