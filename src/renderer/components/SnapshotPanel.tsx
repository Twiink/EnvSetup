/**
 * 展示快照列表以及清理、回滚相关信息。
 */

import { useState } from 'react'

import type { SnapshotMeta } from '../../main/core/contracts'
import type { AppLocale } from '../../shared/locale'
import { getUiText } from '../copy'

type SnapshotPanelProps = {
  locale: AppLocale
  snapshots?: SnapshotMeta
  busy?: boolean
  onCreateSnapshot: () => void
  onDeleteSnapshot: (snapshotId: string) => void
  onRollbackSnapshot: (snapshotId: string) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function SnapshotPanel({
  locale,
  snapshots,
  busy,
  onCreateSnapshot,
  onDeleteSnapshot,
  onRollbackSnapshot,
}: SnapshotPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const list = snapshots?.snapshots ?? []

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
          <h2 style={{ margin: 0 }}>{getUiText(locale, 'snapshotTitle')}</h2>
          <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
            {getUiText(locale, 'snapshotDescription')}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateSnapshot}
          style={{
            borderRadius: '999px',
            border: 'none',
            padding: '0.8rem 1.2rem',
            background: busy ? '#cbd5e1' : '#111827',
            color: '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {getUiText(locale, 'createSnapshot')}
        </button>
      </header>

      <div style={{ marginTop: '1rem' }}>
        {list.length === 0 ? (
          <p style={{ margin: 0, color: '#64748b' }}>{getUiText(locale, 'snapshotEmpty')}</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {list.map((entry) => (
              <article
                key={entry.id}
                style={{
                  padding: '1rem',
                  borderRadius: '16px',
                  border: '1px solid rgba(0,0,0,0.08)',
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <strong style={{ fontSize: '0.95rem' }}>
                      {entry.label ?? `Snapshot ${entry.id.slice(0, 8)}`}
                    </strong>
                    <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      {entry.type === 'auto'
                        ? getUiText(locale, 'snapshotTypeAuto')
                        : getUiText(locale, 'snapshotTypeManual')}{' '}
                      · {formatDate(entry.createdAt)}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      {getUiText(locale, 'snapshotTaskLabel')}: {entry.taskId.slice(0, 8)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRollbackSnapshot(entry.id)}
                      style={{
                        borderRadius: '999px',
                        border: 'none',
                        padding: '0.4rem 0.75rem',
                        background: busy ? '#cbd5e1' : '#fee2e2',
                        color: busy ? '#94a3b8' : '#b91c1c',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        fontSize: '0.82rem',
                      }}
                    >
                      {getUiText(locale, 'snapshotRollback')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                      style={{
                        borderRadius: '999px',
                        border: '1px solid rgba(0,0,0,0.12)',
                        padding: '0.4rem 0.75rem',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                      }}
                    >
                      {expanded === entry.id
                        ? getUiText(locale, 'snapshotHideDetails')
                        : getUiText(locale, 'snapshotDetails')}
                    </button>
                    {entry.canDelete && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDeleteSnapshot(entry.id)}
                        style={{
                          borderRadius: '999px',
                          border: 'none',
                          padding: '0.4rem 0.75rem',
                          background: busy ? '#cbd5e1' : '#fee2e2',
                          color: busy ? '#94a3b8' : '#b91c1c',
                          cursor: busy ? 'not-allowed' : 'pointer',
                          fontSize: '0.82rem',
                        }}
                      >
                        {getUiText(locale, 'snapshotDelete')}
                      </button>
                    )}
                  </div>
                </div>

                {expanded === entry.id && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      paddingTop: '0.75rem',
                      borderTop: '1px solid rgba(0,0,0,0.06)',
                      display: 'grid',
                      gap: '0.4rem',
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      ID: <code style={{ fontSize: '0.8rem' }}>{entry.id}</code>
                    </span>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
