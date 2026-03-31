/**
 * 渲染面向小白用户的知识中心页面。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { AppLocale, LocalizedTextInput } from '../../shared/locale'
import { resolveLocalizedText } from '../../shared/locale'
import {
  beginnerGuideTopics,
  getBeginnerGuideTopic,
  type BeginnerGuideBullet,
  type BeginnerGuideCodeSample,
  type BeginnerGuideEnvVar,
  type BeginnerGuideFaq,
  type BeginnerGuidePlatform,
  type BeginnerGuideToolId,
  type BeginnerGuideTopic,
} from '../beginnerGuideContent'
import { getUiText } from '../copy'

type BeginnerGuidePanelProps = {
  locale: AppLocale
}

const platformLabelMap: Record<'darwin' | 'win32', LocalizedTextInput> = {
  darwin: { 'zh-CN': 'macOS', en: 'macOS' },
  win32: { 'zh-CN': 'Windows', en: 'Windows' },
}

function getClipboardSupport(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
}

function detectGuidePlatform(): 'darwin' | 'win32' {
  if (typeof navigator === 'undefined') {
    return 'darwin'
  }

  const platformInfo = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  return platformInfo.includes('win') ? 'win32' : 'darwin'
}

function getPlatformLabel(locale: AppLocale, platform: 'darwin' | 'win32'): string {
  return resolveLocalizedText(platformLabelMap[platform], locale)
}

function partitionByPlatform<T extends { platform?: BeginnerGuidePlatform }>(
  items: T[] | undefined,
  currentPlatform: 'darwin' | 'win32',
): { primary: T[]; secondary: T[] } {
  const entries = items ?? []
  const primary = entries.filter(
    (item) =>
      item.platform === undefined ||
      item.platform === 'generic' ||
      item.platform === currentPlatform,
  )
  const secondary = entries.filter(
    (item) =>
      item.platform !== undefined &&
      item.platform !== 'generic' &&
      item.platform !== currentPlatform,
  )

  return { primary, secondary }
}

function getSecondaryPlatform<T extends { platform?: BeginnerGuidePlatform }>(
  items: T[],
): 'darwin' | 'win32' | undefined {
  const platform = items.find(
    (item) => item.platform === 'darwin' || item.platform === 'win32',
  )?.platform
  return platform === 'darwin' || platform === 'win32' ? platform : undefined
}

function PlatformDisclosure({
  locale,
  platform,
  children,
}: {
  locale: AppLocale
  platform?: 'darwin' | 'win32'
  children: ReactNode
}) {
  if (!platform) {
    return null
  }

  return (
    <details
      style={{
        display: 'grid',
        gap: '0.8rem',
        padding: '0.9rem 1rem',
        borderRadius: '12px',
        background: '#F9F6F1',
        border: '1px solid #E9DFD3',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          color: '#8A5B3C',
          fontSize: '0.88rem',
          fontWeight: 700,
        }}
      >
        {getUiText(locale, 'guideOtherPlatformLabel')} · {getPlatformLabel(locale, platform)}
      </summary>
      <div style={{ display: 'grid', gap: '0.8rem' }}>{children}</div>
    </details>
  )
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
  canCopy: boolean
  copyLabel: string
  onCopy: () => void
}) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.82rem', color: '#8B827A', fontWeight: 700 }}>
          {sample.label
            ? resolveLocalizedText(sample.label, locale)
            : getUiText(locale, 'guideExampleLabel')}
        </span>
        <button
          type="button"
          disabled={!canCopy}
          onClick={onCopy}
          style={{
            borderRadius: '8px',
            border: canCopy ? '1px solid #D47A6A' : '1px solid #E2D8CF',
            background: canCopy ? '#FFF0EE' : '#F5F0EA',
            color: canCopy ? '#C55B49' : '#A49C95',
            padding: '0.35rem 0.75rem',
            fontSize: '0.8rem',
            fontWeight: 700,
            cursor: canCopy ? 'pointer' : 'not-allowed',
          }}
        >
          {copyLabel}
        </button>
      </div>
      <code
        style={{
          display: 'block',
          padding: '0.8rem 1rem',
          borderRadius: '12px',
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
    </div>
  )
}

function renderBulletList(locale: AppLocale, items: BeginnerGuideBullet[]) {
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: '1.2rem',
        display: 'grid',
        gap: '0.45rem',
        color: '#4A403A',
        lineHeight: 1.65,
      }}
    >
      {items.map((bullet, index) => (
        <li key={`${index}-${resolveLocalizedText(bullet.text, locale)}`}>
          {resolveLocalizedText(bullet.text, locale)}
        </li>
      ))}
    </ul>
  )
}

function renderEnvVars(locale: AppLocale, envVars: BeginnerGuideEnvVar[]) {
  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {envVars.map((entry) => (
        <article
          key={entry.id}
          style={{
            display: 'grid',
            gap: '0.35rem',
            padding: '0.85rem 0.95rem',
            borderRadius: '12px',
            background: '#FAF8F4',
            border: '1px solid #EFE5DB',
          }}
        >
          <strong style={{ color: '#2A2421', fontSize: '0.95rem' }}>{entry.name}</strong>
          <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.6 }}>
            {resolveLocalizedText(entry.description, locale)}
          </p>
          {entry.example ? (
            <code
              style={{
                display: 'block',
                padding: '0.65rem 0.8rem',
                borderRadius: '10px',
                background: '#2F2926',
                color: '#F8F4EE',
                fontSize: '0.84rem',
                lineHeight: 1.55,
                fontFamily: 'Menlo, Monaco, Consolas, monospace',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {entry.example}
            </code>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function renderFaqs(locale: AppLocale, faqs: BeginnerGuideFaq[]) {
  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      {faqs.map((entry) => (
        <article
          key={entry.id}
          style={{
            display: 'grid',
            gap: '0.35rem',
            padding: '0.9rem 1rem',
            borderRadius: '12px',
            background: '#FAF8F4',
            border: '1px solid #EFE5DB',
          }}
        >
          <strong style={{ color: '#2A2421', lineHeight: 1.55 }}>
            {resolveLocalizedText(entry.question, locale)}
          </strong>
          <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.65 }}>
            {resolveLocalizedText(entry.answer, locale)}
          </p>
        </article>
      ))}
    </div>
  )
}

function GuideCard({
  card,
  locale,
  currentPlatform,
  canCopy,
  getCopyLabel,
  onCopy,
}: {
  card: BeginnerGuideTopic['sections'][number]['cards'][number]
  locale: AppLocale
  currentPlatform: 'darwin' | 'win32'
  canCopy: boolean
  getCopyLabel: (id: string) => string
  onCopy: (id: string, value: string) => void
}) {
  const { primary: primaryBullets, secondary: secondaryBullets } = partitionByPlatform(
    card.bullets,
    currentPlatform,
  )
  const { primary: primarySamples, secondary: secondarySamples } = partitionByPlatform(
    card.codeSamples,
    currentPlatform,
  )
  const { primary: primaryEnvVars, secondary: secondaryEnvVars } = partitionByPlatform(
    card.envVars,
    currentPlatform,
  )
  const { primary: primaryFaqs, secondary: secondaryFaqs } = partitionByPlatform(
    card.faqs,
    currentPlatform,
  )

  return (
    <article
      style={{
        display: 'grid',
        gap: '1rem',
        padding: '1.35rem',
        borderRadius: '18px',
        border: '1px solid #EFEAE4',
        background: '#FFFEFC',
        boxShadow: '0 4px 14px rgba(169, 132, 103, 0.05)',
        alignContent: 'start',
      }}
    >
      <header style={{ display: 'grid', gap: '0.45rem' }}>
        {card.eyebrow ? (
          <span
            style={{
              width: 'fit-content',
              padding: '0.22rem 0.55rem',
              borderRadius: '999px',
              background: '#FFF0EE',
              color: '#C55B49',
              fontSize: '0.76rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            {resolveLocalizedText(card.eyebrow, locale)}
          </span>
        ) : null}
        <h4 style={{ margin: 0, fontSize: '1.08rem', color: '#2A2421', fontWeight: 700 }}>
          {resolveLocalizedText(card.title, locale)}
        </h4>
        <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.65 }}>
          {resolveLocalizedText(card.description, locale)}
        </p>
      </header>

      {primaryBullets.length > 0 ? renderBulletList(locale, primaryBullets) : null}

      {primarySamples.length > 0 ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <strong style={{ color: '#2A2421' }}>{getUiText(locale, 'guideCodeSamplesLabel')}</strong>
          {primarySamples.map((sample) => (
            <CodeSample
              key={sample.id}
              sample={sample}
              locale={locale}
              canCopy={canCopy}
              copyLabel={getCopyLabel(sample.id)}
              onCopy={() => onCopy(sample.id, sample.value)}
            />
          ))}
        </div>
      ) : null}

      {primaryEnvVars.length > 0 ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <strong style={{ color: '#2A2421' }}>{getUiText(locale, 'guideEnvVarsLabel')}</strong>
          {renderEnvVars(locale, primaryEnvVars)}
        </div>
      ) : null}

      {primaryFaqs.length > 0 ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <strong style={{ color: '#2A2421' }}>{getUiText(locale, 'guideFaqLabel')}</strong>
          {renderFaqs(locale, primaryFaqs)}
        </div>
      ) : null}

      {card.tip ? (
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
          {resolveLocalizedText(card.tip, locale)}
        </div>
      ) : null}

      {card.pitfall ? (
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
          {resolveLocalizedText(card.pitfall, locale)}
        </div>
      ) : null}

      {secondaryBullets.length > 0 ? (
        <PlatformDisclosure locale={locale} platform={getSecondaryPlatform(secondaryBullets)}>
          {renderBulletList(locale, secondaryBullets)}
        </PlatformDisclosure>
      ) : null}

      {secondarySamples.length > 0 ? (
        <PlatformDisclosure locale={locale} platform={getSecondaryPlatform(secondarySamples)}>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {secondarySamples.map((sample) => (
              <CodeSample
                key={sample.id}
                sample={sample}
                locale={locale}
                canCopy={canCopy}
                copyLabel={getCopyLabel(sample.id)}
                onCopy={() => onCopy(sample.id, sample.value)}
              />
            ))}
          </div>
        </PlatformDisclosure>
      ) : null}

      {secondaryEnvVars.length > 0 ? (
        <PlatformDisclosure locale={locale} platform={getSecondaryPlatform(secondaryEnvVars)}>
          {renderEnvVars(locale, secondaryEnvVars)}
        </PlatformDisclosure>
      ) : null}

      {secondaryFaqs.length > 0 ? (
        <PlatformDisclosure locale={locale} platform={getSecondaryPlatform(secondaryFaqs)}>
          {renderFaqs(locale, secondaryFaqs)}
        </PlatformDisclosure>
      ) : null}
    </article>
  )
}

export function BeginnerGuidePanel({ locale }: BeginnerGuidePanelProps) {
  const [selectedToolId, setSelectedToolId] = useState<BeginnerGuideToolId>('overview')
  const [copyFeedback, setCopyFeedback] = useState<{
    id: string
    status: 'copied' | 'failed'
  }>()
  const resetTimerRef = useRef<number | undefined>(undefined)
  const canCopy = getClipboardSupport()
  const currentPlatform = detectGuidePlatform()
  const selectedTopic = getBeginnerGuideTopic(selectedToolId)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  function handleCopy(id: string, value: string) {
    if (!canCopy) {
      return
    }

    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopyFeedback({ id, status: 'copied' })
      })
      .catch(() => {
        setCopyFeedback({ id, status: 'failed' })
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

  function getCopyLabel(id: string): string {
    if (!canCopy) {
      return getUiText(locale, 'guideCopyUnavailable')
    }

    if (copyFeedback?.id === id && copyFeedback.status === 'copied') {
      return getUiText(locale, 'guideCopyDone')
    }

    if (copyFeedback?.id === id && copyFeedback.status === 'failed') {
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
        <p style={{ margin: 0, color: '#6F655E', lineHeight: 1.7, maxWidth: '56rem' }}>
          {getUiText(locale, 'guideDescription')}
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: '1fr',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '0.6rem',
            padding: '1rem 1.1rem',
            borderRadius: '16px',
            background: '#FBF7F2',
            border: '1px solid #F0E6DC',
          }}
        >
          <strong style={{ color: '#2A2421' }}>
            {getUiText(locale, 'guideCurrentPlatformLabel')}
          </strong>
          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.35rem 0.75rem',
                borderRadius: '999px',
                background: '#FFF0EE',
                color: '#C55B49',
                fontSize: '0.84rem',
                fontWeight: 700,
              }}
            >
              {getPlatformLabel(locale, currentPlatform)}
            </span>
          </div>
          <p style={{ margin: 0, color: '#7D746D', lineHeight: 1.6 }}>
            {getUiText(locale, 'guidePlatformHint')}
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '0.55rem',
            padding: '1rem 1.1rem',
            borderRadius: '16px',
            background: '#FBF7F2',
            border: '1px solid #F0E6DC',
          }}
        >
          <strong style={{ color: '#2A2421' }}>
            {resolveLocalizedText(selectedTopic.title, locale)}
          </strong>
          <p style={{ margin: 0, color: '#7D746D', lineHeight: 1.6 }}>
            {resolveLocalizedText(selectedTopic.description, locale)}
          </p>
        </div>
      </div>

      <nav
        aria-label={getUiText(locale, 'guideToolsNavLabel')}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          padding: '1rem',
          borderRadius: '16px',
          background: '#FBF7F2',
          border: '1px solid #F0E6DC',
        }}
      >
        {beginnerGuideTopics.map((topic) => {
          const selected = topic.id === selectedToolId

          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => setSelectedToolId(topic.id)}
              aria-pressed={selected}
              style={{
                borderRadius: '999px',
                border: selected ? '1px solid #D47A6A' : '1px solid #E7DCD0',
                padding: '0.5rem 0.9rem',
                background: selected ? '#FFF0EE' : '#FFFFFF',
                color: selected ? '#C55B49' : '#6F655E',
                cursor: 'pointer',
                fontSize: '0.86rem',
                fontWeight: selected ? 700 : 600,
              }}
            >
              {resolveLocalizedText(topic.title, locale)}
            </button>
          )
        })}
      </nav>

      <nav
        aria-label={getUiText(locale, 'guideSectionsNavLabel')}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.7rem',
          paddingBottom: '0.25rem',
        }}
      >
        {selectedTopic.sections.map((section) => (
          <a
            key={section.id}
            href={`#guide-topic-${selectedTopic.id}-section-${section.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.38rem 0.78rem',
              borderRadius: '999px',
              background: '#FFF7EC',
              color: '#A76A2F',
              fontSize: '0.83rem',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            {resolveLocalizedText(section.title, locale)}
          </a>
        ))}
      </nav>

      <div style={{ display: 'grid', gap: '1.8rem' }}>
        {selectedTopic.sections.map((section) => (
          <section
            key={section.id}
            id={`guide-topic-${selectedTopic.id}-section-${section.id}`}
            style={{
              display: 'grid',
              gap: '1rem',
              padding: '1.15rem 1.2rem 1.25rem',
              borderRadius: '20px',
              background: '#FCFAF6',
              border: '1px solid #F1E8DE',
              scrollMarginTop: '1.5rem',
            }}
          >
            <header style={{ display: 'grid', gap: '0.35rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.32rem', color: '#2A2421', fontWeight: 700 }}>
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
                gridTemplateColumns: '1fr',
              }}
            >
              {section.cards.map((card) => (
                <GuideCard
                  key={card.id}
                  card={card}
                  locale={locale}
                  currentPlatform={currentPlatform}
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
