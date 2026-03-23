import type { ChangeEvent } from 'react'

import type { Primitive, ResolvedTemplate } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import { isTemplateFieldActive } from '../../shared/templateFields'
import { getTemplateFieldLabel, getTemplateOptionLabel, getUiText } from '../copy'

type OverrideFormProps = {
  locale: AppLocale
  template?: ResolvedTemplate
  values: Record<string, Primitive>
  errors: Record<string, string>
  busy?: boolean
  fieldOptions?: Record<string, string[]>
  onChange: (key: string, value: Primitive) => void
  onPickDirectory: (key: string) => void | Promise<void>
}

export function OverrideForm({
  locale,
  template,
  values,
  errors,
  busy,
  fieldOptions = {},
  onChange,
  onPickDirectory,
}: OverrideFormProps) {
  if (!template) {
    return (
      <section
        style={{
          padding: '1.25rem',
          borderRadius: '24px',
          background: 'rgba(255, 255, 255, 0.72)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>{getUiText(locale, 'overridesTitle')}</h2>
        <p style={{ marginBottom: 0, color: '#64748b' }}>{getUiText(locale, 'overridesEmpty')}</p>
      </section>
    )
  }

  const activeFields = Object.values(template.fields).filter((field) =>
    isTemplateFieldActive(field, values),
  )

  return (
    <section
      style={{ padding: '1.25rem', borderRadius: '24px', background: 'rgba(255, 255, 255, 0.82)' }}
    >
      <header style={{ display: 'grid', gap: '0.35rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{getUiText(locale, 'overridesTitle')}</h2>
        <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
          {getUiText(locale, 'overridesDescription')}
        </p>
      </header>

      <div style={{ display: 'grid', gap: '1rem' }}>
        {activeFields.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: '0.95rem 1rem',
              borderRadius: '16px',
              background: 'rgba(248, 250, 252, 0.9)',
              color: '#64748b',
              lineHeight: 1.65,
            }}
          >
            {getUiText(locale, 'overridesNoEditableFields')}
          </p>
        ) : null}
        {activeFields.map((field) => {
            const value = values[field.key]
            const selectOptions = fieldOptions[field.key] ?? field.enum
            const commonStyle = {
              width: '100%',
              borderRadius: '14px',
              border: '1px solid rgba(148, 163, 184, 0.4)',
              padding: '0.75rem 0.9rem',
              background: '#fff',
              fontSize: '0.95rem',
            }
            const label = getTemplateFieldLabel(locale, field.key)

            return (
              <label
                key={field.key}
                htmlFor={field.key}
                style={{ display: 'grid', gap: '0.45rem' }}
              >
                <span style={{ fontWeight: 600, color: '#111827' }}>{label}</span>
                {selectOptions && selectOptions.length > 0 ? (
                  <select
                    id={field.key}
                    value={typeof value === 'string' ? value : ''}
                    disabled={!field.editable}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      onChange(field.key, event.currentTarget.value)
                    }
                    style={commonStyle}
                  >
                    {selectOptions.map((option) => (
                      <option key={option} value={option}>
                        {getTemplateOptionLabel(locale, option)}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'path' ? (
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      id={field.key}
                      type="text"
                      value={typeof value === 'string' ? value : ''}
                      disabled={!field.editable}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onChange(field.key, event.currentTarget.value)
                      }
                      style={commonStyle}
                    />
                    <button
                      type="button"
                      disabled={!field.editable || busy}
                      aria-label={`${label} ${getUiText(locale, 'browseFolder')}`}
                      onClick={() => {
                        void onPickDirectory(field.key)
                      }}
                      style={{
                        flexShrink: 0,
                        borderRadius: '14px',
                        border: '1px solid rgba(217, 119, 6, 0.24)',
                        padding: '0.75rem 0.95rem',
                        background: !field.editable || busy ? '#cbd5e1' : '#fff7ed',
                        color: '#9a3412',
                        cursor: !field.editable || busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {getUiText(locale, 'browseFolder')}
                    </button>
                  </div>
                ) : typeof field.value === 'boolean' ? (
                  <input
                    id={field.key}
                    type="checkbox"
                    checked={Boolean(value)}
                    disabled={!field.editable}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onChange(field.key, event.currentTarget.checked)
                    }
                    style={{ width: '1.1rem', height: '1.1rem' }}
                  />
                ) : typeof field.value === 'number' ? (
                  <input
                    id={field.key}
                    type="number"
                    value={typeof value === 'number' ? value : ''}
                    disabled={!field.editable}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onChange(field.key, Number(event.currentTarget.value))
                    }
                    style={commonStyle}
                  />
                ) : (
                  <input
                    id={field.key}
                    type="text"
                    value={typeof value === 'string' ? value : ''}
                    disabled={!field.editable}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onChange(field.key, event.currentTarget.value)
                    }
                    style={commonStyle}
                  />
                )}
                <span
                  style={{
                    minHeight: '1rem',
                    color: errors[field.key] ? '#b91c1c' : '#64748b',
                    fontSize: '0.84rem',
                  }}
                >
                  {errors[field.key] ??
                    (field.required
                      ? getUiText(locale, 'requiredField')
                      : getUiText(locale, 'optionalField'))}
                </span>
              </label>
            )
          })}
      </div>
    </section>
  )
}
