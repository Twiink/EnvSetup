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
  borderRadius: '12px',
  border: '1px solid #EFEAE4',
  background: '#FFFFFF',
  padding: '1.25rem',
  textAlign: 'left' as const,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
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
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        padding: '2rem',
        borderRadius: '16px',
        background: '#FFFFFF',
        border: '1px solid #EFEAE4',
        boxShadow: '0 4px 16px rgba(169, 132, 103, 0.04)',
      }}
    >
      <header style={{ display: 'grid', gap: '0.4rem' }}>
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
          {getUiText(locale, 'templatesEyebrow')}
        </p>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#2A2421', fontWeight: 500 }}>
          {getUiText(locale, 'templatesTitle')}
        </h2>
        <p style={{ margin: 0, color: '#7D746D', lineHeight: 1.6 }}>
          {getUiText(locale, 'templatesDescription')}
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}
      >
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
                borderColor: selected ? '#D47A6A' : '#EFEAE4',
                background: selected ? '#FFF6F4' : cardStyle.background,
                boxShadow: selected ? '0 4px 12px rgba(212, 122, 106, 0.12)' : 'none',
                transform: selected ? 'translateY(-2px)' : 'none',
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
                <strong style={{ fontSize: '1.05rem', color: '#2A2421', fontWeight: 600 }}>
                  {resolveLocalizedText(template.name, locale)}
                </strong>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: '#D47A6A',
                    fontWeight: 500,
                    background: '#FFF0EE',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                  }}
                >
                  v{template.version}
                </span>
              </div>
              <p
                style={{
                  margin: '0.75rem 0 0',
                  color: '#7D746D',
                  lineHeight: 1.6,
                  fontSize: '0.9rem',
                }}
              >
                {resolveLocalizedText(template.description, locale)}
              </p>
              <p
                style={{
                  margin: '1rem 0 0',
                  fontSize: '0.8rem',
                  color: '#A49C95',
                  fontWeight: 500,
                }}
              >
                {template.platforms.join(' • ')}
              </p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
