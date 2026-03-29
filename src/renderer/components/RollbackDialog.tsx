/**
 * Collects rollback decisions when a task fails or cleanup restoration is required.
 */

import { useState } from 'react'

import type { FailureAnalysis, RollbackResult, RollbackSuggestion } from '../../main/core/contracts'

type RollbackDialogProps = {
  failureAnalysis?: FailureAnalysis
  suggestions: RollbackSuggestion[]
  busy?: boolean
  onExecute: (snapshotId: string, trackedPaths?: string[]) => void
  onClose: () => void
  result?: RollbackResult
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: '#166534',
  medium: '#b45309',
  low: '#64748b',
}

export function RollbackDialog({
  failureAnalysis,
  suggestions,
  busy,
  onExecute,
  onClose,
  result,
}: RollbackDialogProps) {
  const [selected, setSelected] = useState<string | null>(
    suggestions.length > 0 ? suggestions[0].snapshotId : null,
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '24px',
          padding: '1.75rem',
          width: '100%',
          maxWidth: '480px',
          display: 'grid',
          gap: '1rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Rollback System</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: '999px',
              border: 'none',
              padding: '0.4rem 0.75rem',
              background: '#f1f5f9',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* 失败分析摘要 */}
        {failureAnalysis && (
          <div
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '14px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'grid',
              gap: '0.35rem',
            }}
          >
            <strong style={{ color: '#b91c1c', fontSize: '0.9rem' }}>
              Failure: {failureAnalysis.category}
            </strong>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#7f1d1d' }}>
              {failureAnalysis.message}
            </p>
            {failureAnalysis.suggestedAction && (
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#92400e' }}>
                Suggestion: {failureAnalysis.suggestedAction}
              </p>
            )}
          </div>
        )}

        {/* 回滚建议列表 */}
        {suggestions.length === 0 ? (
          <p style={{ margin: 0, color: '#64748b' }}>No rollback snapshots available.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b' }}>
              Select a snapshot to restore:
            </p>
            {suggestions.map((s) => (
              <label
                key={s.snapshotId}
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'flex-start',
                  padding: '0.85rem',
                  borderRadius: '14px',
                  border: `2px solid ${selected === s.snapshotId ? '#111827' : 'rgba(0,0,0,0.08)'}`,
                  cursor: 'pointer',
                  background: selected === s.snapshotId ? '#f8fafc' : '#fff',
                }}
              >
                <input
                  type="radio"
                  name="snapshot"
                  value={s.snapshotId}
                  checked={selected === s.snapshotId}
                  onChange={() => setSelected(s.snapshotId)}
                  style={{ marginTop: '0.15rem' }}
                />
                <div style={{ display: 'grid', gap: '0.2rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.9rem' }}>
                      {s.snapshotLabel ?? s.snapshotId.slice(0, 8)}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        background: '#f1f5f9',
                        color: CONFIDENCE_COLOR[s.confidence] ?? '#64748b',
                        fontWeight: 600,
                      }}
                    >
                      {s.confidence}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.82rem', color: '#64748b' }}>{s.reason}</span>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {new Date(s.createdAt).toLocaleString()}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}

        {/* 执行结果 */}
        {result && (
          <div
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '14px',
              background: result.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${result.success ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            <strong style={{ color: result.success ? '#166534' : '#b91c1c', fontSize: '0.9rem' }}>
              {result.success ? 'Rollback succeeded' : 'Rollback failed'}
            </strong>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#334155' }}>
              {result.message} · {result.filesRestored} files restored
            </p>
          </div>
        )}

        {/* 执行按钮 */}
        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => selected && onExecute(selected)}
          style={{
            borderRadius: '999px',
            border: 'none',
            padding: '0.9rem',
            background: !selected || busy ? '#cbd5e1' : '#b91c1c',
            color: '#fff',
            cursor: !selected || busy ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {busy ? 'Rolling back…' : 'Execute Rollback'}
        </button>
      </div>
    </div>
  )
}
