/**
 * 渲染面向小白用户的基础知识页。
 */

import { useEffect, useRef, useState } from 'react'

import type { AppLocale } from '../../shared/locale'
import { resolveLocalizedText } from '../../shared/locale'
import {
  type BeginnerGuideCodeSample,
  type BeginnerGuideItem,
  beginnerGuideSections,
} from '../beginnerGuideContent'
import { getUiText } from '../copy'

type BeginnerGuidePanelProps = {
  locale: AppLocale
}

function getClipboardSupport(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
}

function CodeSample({
  sample,
  locale,
  canCopy,
  copyLabel,
  onCopy,
}: {
  sample: BeginnerGuideCodeSample
  locale: AppLocale
  canCopy?: boolean
  copyLabel?: string
  onCopy?: () => void
}) {
  return (
    <div style={{ display: 'grid', gap: '0.35rem' }}>
      {sample.label ? (
        <span style={{ fontSize: '0.82rem', color: '#8B827A', fontWeight: 600 }}>
          {resolveLocalizedText(sample.label, locale)}
        </span>
      ) : null}
      <code
        style={{
          display: 'block',
          padding: '0.8rem 1rem',
          borderRadius: '10px',
          background: '#2A2421',
          color: '#F8F4EE',
          fontSize: '0.88rem',
          lineHeight: 1.6,
          fontFamily: 'Menlo, Monaco, Consolas, monospace',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {sample.value}
      </code>
      {onCopy ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            disabled={!canCopy}
            onClick={onCopy}
            style={{
              borderRadius: '8px',
              border: canCopy ? '1px solid #D47A6A' : '1px solid #E2D8CF',
              background: canCopy ? '#FFF0EE' : '#F5F0EA',
              color: canCopy ? '#C55B49' : '#A49C95',
              padding: '0.45rem 0.85rem',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: canCopy ? 'pointer' : 'not-allowed',
            }}
          >
            {copyLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GuideItemCard({
  item,
  locale,
  canCopy,
  getCopyLabel,
  onCopy,
}: {
  item: BeginnerGuideItem
  locale: AppLocale
  canCopy: boolean
  getCopyLabel: (key: string) => string
  onCopy: (id: string, command: string) => void
}) {
  return (
    <article
      style={{
        display: 'grid',
        gap: '1rem',
        padding: '1.35rem',
        borderRadius: '16px',
        border: '1px solid #EFEAE4',
        background: '#FFFEFC',
        boxShadow: '0 4px 14px rgba(169, 132, 103, 0.05)',
        alignContent: 'start',
      }}
    >
      <header style={{ display: 'grid', gap: '0.45rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#2A2421', fontWeight: 600 }}>
          {resolveLocalizedText(item.title, locale)}
        </h3>
        <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.65 }}>
          {resolveLocalizedText(item.description, locale)}
        </p>
      </header>

      {item.command ? (
        <div
          style={{
            display: 'grid',
            gap: '0.75rem',
            padding: '1rem',
            borderRadius: '14px',
            background: '#F7F3EE',
            border: '1px solid #EFE5DB',
          }}
        >
          <CodeSample
            sample={{ value: item.command }}
            locale={locale}
            canCopy={canCopy}
            copyLabel={getCopyLabel(item.id)}
            onCopy={() => onCopy(item.id, item.command)}
          />
        </div>
      ) : null}

      {item.bullets?.length ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: '1.2rem',
            display: 'grid',
            gap: '0.5rem',
            color: '#4A403A',
            lineHeight: 1.65,
          }}
        >
          {item.bullets.map((bullet, index) => (
            <li key={`${item.id}-bullet-${index}`}>{resolveLocalizedText(bullet, locale)}</li>
          ))}
        </ul>
      ) : null}

      {item.steps?.length ? (
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          {item.steps.map((step) => (
            <section
              key={step.id}
              style={{
                display: 'grid',
                gap: '0.55rem',
                padding: '0.95rem 1rem',
                borderRadius: '12px',
                background: '#FAF8F4',
                border: '1px solid #F0E8DE',
              }}
            >
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                <strong style={{ color: '#2A2421', fontSize: '0.96rem' }}>
                  {resolveLocalizedText(step.title, locale)}
                </strong>
                {step.description ? (
                  <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.6 }}>
                    {resolveLocalizedText(step.description, locale)}
                  </p>
                ) : null}
              </div>
              {step.commands?.length ? (
                <div style={{ display: 'grid', gap: '0.65rem' }}>
                  {step.commands.map((sample, index) => (
                    <CodeSample
                      key={`${step.id}-command-${index}`}
                      sample={sample}
                      locale={locale}
                      canCopy={canCopy}
                      copyLabel={getCopyLabel(`${item.id}-${step.id}-${index}`)}
                      onCopy={() => onCopy(`${item.id}-${step.id}-${index}`, sample.value)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}

      {item.example ? (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.82rem', color: '#8B827A', fontWeight: 600 }}>
            {getUiText(locale, 'guideExampleLabel')}
          </span>
          <code
            style={{
              display: 'block',
              padding: '0.8rem 1rem',
              borderRadius: '10px',
              background: '#2A2421',
              color: '#F8F4EE',
              fontSize: '0.88rem',
              lineHeight: 1.6,
              fontFamily: 'Menlo, Monaco, Consolas, monospace',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {item.example}
          </code>
        </div>
      ) : null}

      {item.tip ? (
        <div
          style={{
            padding: '0.9rem 1rem',
            borderRadius: '12px',
            background: '#F3F8EE',
            border: '1px solid #DDE8D2',
            color: '#496640',
            lineHeight: 1.6,
          }}
        >
          <strong>{getUiText(locale, 'guideTipLabel')}:</strong>{' '}
          {resolveLocalizedText(item.tip, locale)}
        </div>
      ) : null}

      {item.pitfall ? (
        <div
          style={{
            padding: '0.9rem 1rem',
            borderRadius: '12px',
            background: '#FFF5EF',
            border: '1px solid #F0D8CB',
            color: '#945541',
            lineHeight: 1.6,
          }}
        >
          <strong>{getUiText(locale, 'guidePitfallLabel')}:</strong>{' '}
          {resolveLocalizedText(item.pitfall, locale)}
        </div>
      ) : null}
    </article>
  )
}

export function BeginnerGuidePanel({ locale }: BeginnerGuidePanelProps) {
  const [copyFeedback, setCopyFeedback] = useState<{
    itemId: string
    status: 'copied' | 'failed'
  }>()
  const resetTimerRef = useRef<number | undefined>(undefined)
  const canCopy = getClipboardSupport()

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  function handleCopy(itemId: string, command: string) {
    if (!canCopy) {
      return
    }

    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopyFeedback({ itemId, status: 'copied' })
      })
      .catch(() => {
        setCopyFeedback({ itemId, status: 'failed' })
      })
      .finally(() => {
        if (resetTimerRef.current !== undefined) {
          window.clearTimeout(resetTimerRef.current)
        }
        resetTimerRef.current = window.setTimeout(() => {
          setCopyFeedback(undefined)
        }, 1800)
      })
  }

  function getCopyLabel(itemId: string): string {
    if (!canCopy) {
      return getUiText(locale, 'guideCopyUnavailable')
    }

    if (copyFeedback?.itemId === itemId && copyFeedback.status === 'copied') {
      return getUiText(locale, 'guideCopyDone')
    }

    if (copyFeedback?.itemId === itemId && copyFeedback.status === 'failed') {
      return getUiText(locale, 'guideCopyFailed')
    }

    return getUiText(locale, 'guideCopyCommand')
  }

  return (
    <section
      style={{
        display: 'grid',
        gap: '1.75rem',
        padding: '2rem',
        borderRadius: '20px',
        background: '#FFFFFF',
        border: '1px solid #EFEAE4',
        boxShadow: '0 6px 18px rgba(169, 132, 103, 0.06)',
      }}
    >
      <header style={{ display: 'grid', gap: '0.75rem' }}>
        <p
          style={{
            margin: 0,
            fontSize: '0.82rem',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#D47A6A',
            fontWeight: 700,
          }}
        >
          {getUiText(locale, 'guideBadge')}
        </p>
        <h2 style={{ margin: 0, fontSize: 'clamp(1.75rem, 3vw, 2.3rem)', color: '#2A2421' }}>
          {getUiText(locale, 'guideTitle')}
        </h2>
        <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.7, maxWidth: '52rem' }}>
          {getUiText(locale, 'guideDescription')}
        </p>
      </header>

      <nav
        aria-label={getUiText(locale, 'guideQuickNavLabel')}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          padding: '1rem',
          borderRadius: '14px',
          background: '#FBF7F2',
          border: '1px solid #F0E6DC',
        }}
      >
        {beginnerGuideSections.map((section) => (
          <a
            key={section.id}
            href={`#guide-section-${section.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.45rem 0.8rem',
              borderRadius: '999px',
              background: '#FFF0EE',
              color: '#C55B49',
              fontSize: '0.86rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            {resolveLocalizedText(section.title, locale)}
          </a>
        ))}
      </nav>

      <div style={{ display: 'grid', gap: '1.75rem' }}>
        {beginnerGuideSections.map((section) => (
          <section
            key={section.id}
            id={`guide-section-${section.id}`}
            style={{
              display: 'grid',
              gap: '1rem',
              scrollMarginTop: '1.5rem',
            }}
          >
            <header style={{ display: 'grid', gap: '0.4rem' }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.78rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#C87563',
                  fontWeight: 700,
                }}
              >
                {resolveLocalizedText(section.eyebrow, locale)}
              </p>
              <h3 style={{ margin: 0, fontSize: '1.45rem', color: '#2A2421', fontWeight: 600 }}>
                {resolveLocalizedText(section.title, locale)}
              </h3>
              <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.65 }}>
                {resolveLocalizedText(section.description, locale)}
              </p>
            </header>

            <div
              style={{
                display: 'grid',
                gap: '1rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              }}
            >
              {section.items.map((item) => (
                <GuideItemCard
                  key={item.id}
                  item={item}
                  locale={locale}
                  canCopy={canCopy}
                  getCopyLabel={getCopyLabel}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
