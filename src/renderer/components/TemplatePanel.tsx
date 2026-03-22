import type { ResolvedTemplate } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import { resolveLocalizedText } from '../../shared/locale'
import { getUiText } from '../copy'

type TemplatePanelProps = {
  locale: AppLocale
  templates: ResolvedTemplate[]
  selectedTemplateId: string
  onSelect: (templateId: string) => void
}

const cardStyle = {
  borderRadius: '18px',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'rgba(255, 252, 247, 0.92)',
  padding: '1rem',
  textAlign: 'left' as const,
  cursor: 'pointer',
}

export function TemplatePanel({
  locale,
  templates,
  selectedTemplateId,
  onSelect,
}: TemplatePanelProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: '1rem',
        padding: '1.25rem',
        borderRadius: '24px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,245,230,0.9))',
        boxShadow: '0 24px 60px rgba(15, 23, 42, 0.08)',
      }}
    >
      <header style={{ display: 'grid', gap: '0.35rem' }}>
        <p
          style={{
            margin: 0,
            fontSize: '0.8rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#b45309',
          }}
        >
          {getUiText(locale, 'templatesEyebrow')}
        </p>
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#111827' }}>
          {getUiText(locale, 'templatesTitle')}
        </h2>
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
          {getUiText(locale, 'templatesDescription')}
        </p>
      </header>

      <div style={{ display: 'grid', gap: '0.85rem' }}>
        {templates.map((template) => {
          const selected = template.id === selectedTemplateId

          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.id)}
              aria-pressed={selected}
              style={{
                ...cardStyle,
                borderColor: selected ? '#d97706' : 'rgba(15, 23, 42, 0.12)',
                background: selected
                  ? 'linear-gradient(135deg, #fff7ed, #ffedd5)'
                  : cardStyle.background,
                boxShadow: selected ? '0 12px 30px rgba(217, 119, 6, 0.18)' : 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  alignItems: 'center',
                }}
              >
                <strong style={{ fontSize: '1rem', color: '#111827' }}>
                  {resolveLocalizedText(template.name, locale)}
                </strong>
                <span style={{ fontSize: '0.75rem', color: '#7c2d12' }}>v{template.version}</span>
              </div>
              <p style={{ margin: '0.6rem 0 0', color: '#475569', lineHeight: 1.55 }}>
                {resolveLocalizedText(template.description, locale)}
              </p>
              <p style={{ margin: '0.8rem 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                {template.platforms.join(' / ')}
              </p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
