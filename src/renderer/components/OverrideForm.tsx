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
          padding: '2rem',
          borderRadius: '16px',
          background: '#FFFFFF',
          border: '1px solid #EFEAE4',
          boxShadow: '0 4px 16px rgba(169, 132, 103, 0.04)',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.4rem', color: '#2A2421', fontWeight: 500 }}>
          {getUiText(locale, 'overridesTitle')}
        </h2>
        <p style={{ marginBottom: 0, color: '#7D746D', lineHeight: 1.6 }}>
          {getUiText(locale, 'overridesEmpty')}
        </p>
      </section>
    )
  }

  const activeFields = Object.values(template.fields).filter((field) =>
    isTemplateFieldActive(field, values),
  )

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
      <header style={{ display: 'grid', gap: '0.4rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#2A2421', fontWeight: 500 }}>
          {getUiText(locale, 'overridesTitle')}
        </h2>
        <p style={{ margin: 0, color: '#7D746D', lineHeight: 1.6 }}>
          {getUiText(locale, 'overridesDescription')}
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gap: '1.25rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        {activeFields.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: '1rem',
              borderRadius: '8px',
              background: '#F9F7F5',
              color: '#7D746D',
              lineHeight: 1.6,
              border: '1px solid #EFEAE4',
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
            borderRadius: '8px',
            border: '1px solid #E6DFD7',
            padding: '0.85rem 1rem',
            background: '#FDFBF7',
            fontSize: '0.95rem',
            color: '#3D3531',
            transition: 'border-color 0.2s',
            outline: 'none',
          }
          const label = getTemplateFieldLabel(locale, field.key)

          return (
            <label key={field.key} htmlFor={field.key} style={{ display: 'grid', gap: '0.5rem' }}>
              <span style={{ fontWeight: 500, color: '#4A403A', fontSize: '0.95rem' }}>
                {label}
              </span>
              {selectOptions && selectOptions.length > 0 ? (
                <select
                  id={field.key}
                  value={typeof value === 'string' ? value : ''}
                  disabled={!field.editable}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    onChange(field.key, event.currentTarget.value)
                  }
                  style={{
                    ...commonStyle,
                    cursor: !field.editable ? 'not-allowed' : 'pointer',
                    opacity: !field.editable ? 0.6 : 1,
                  }}
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
                    style={{
                      ...commonStyle,
                      opacity: !field.editable ? 0.6 : 1,
                    }}
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
                      borderRadius: '8px',
                      border: '1px solid #D47A6A',
                      padding: '0.85rem 1rem',
                      background: !field.editable || busy ? '#F5F0EA' : '#FFF0EE',
                      color: !field.editable || busy ? '#A49C95' : '#D47A6A',
                      cursor: !field.editable || busy ? 'not-allowed' : 'pointer',
                      fontWeight: 500,
                      fontSize: '0.9rem',
                      transition: 'all 0.2s',
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
                  style={{
                    width: '1.25rem',
                    height: '1.25rem',
                    accentColor: '#D47A6A',
                    cursor: !field.editable ? 'not-allowed' : 'pointer',
                  }}
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
                  style={{
                    ...commonStyle,
                    opacity: !field.editable ? 0.6 : 1,
                  }}
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
                  style={{
                    ...commonStyle,
                    opacity: !field.editable ? 0.6 : 1,
                  }}
                />
              )}
              <span
                style={{
                  minHeight: '1rem',
                  color: errors[field.key] ? '#C65D5D' : '#A49C95',
                  fontSize: '0.85rem',
                  fontWeight: 400,
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
