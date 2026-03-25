// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FailureAnalysis, RollbackResult, RollbackSuggestion } from '../../src/main/core/contracts'
import { RollbackDialog } from '../../src/renderer/components/RollbackDialog'

const suggestions: RollbackSuggestion[] = [
  {
    snapshotId: 'snapshot-1',
    snapshotLabel: 'Before install',
    confidence: 'high',
    reason: 'Most recent automatic snapshot',
    createdAt: new Date().toISOString(),
  },
  {
    snapshotId: 'snapshot-2',
    snapshotLabel: 'Manual backup',
    confidence: 'medium',
    reason: 'Created by user before changes',
    createdAt: new Date().toISOString(),
  },
]

const failureAnalysis: FailureAnalysis = {
  category: 'conflict',
  message: 'Target path already exists',
  retryable: false,
  suggestedAction: 'Rollback to previous snapshot',
}

const result: RollbackResult = {
  success: true,
  snapshotId: 'snapshot-1',
  filesRestored: 3,
  errors: [],
  message: 'Rollback completed',
}

afterEach(() => {
  cleanup()
})

describe('RollbackDialog', () => {
  it('renders no snapshots message when suggestions empty', () => {
    render(<RollbackDialog suggestions={[]} onExecute={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('No rollback snapshots available.')).toBeInTheDocument()
  })

  it('renders suggestion list with radio buttons', () => {
    render(<RollbackDialog suggestions={suggestions} onExecute={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('Before install')).toBeInTheDocument()
    expect(screen.getByText('Manual backup')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('first suggestion is pre-selected', () => {
    render(<RollbackDialog suggestions={suggestions} onExecute={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getAllByRole('radio')[0]).toBeChecked()
  })

  it('calls onExecute with selected snapshot id when button clicked', () => {
    const onExecute = vi.fn()
    render(<RollbackDialog suggestions={suggestions} onExecute={onExecute} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Execute Rollback' }))
    expect(onExecute).toHaveBeenCalledWith('snapshot-1')
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<RollbackDialog suggestions={suggestions} onExecute={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders failure analysis summary when provided', () => {
    render(
      <RollbackDialog
        suggestions={suggestions}
        failureAnalysis={failureAnalysis}
        onExecute={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Failure: conflict')).toBeInTheDocument()
    expect(screen.getByText('Target path already exists')).toBeInTheDocument()
    expect(screen.getByText('Suggestion: Rollback to previous snapshot')).toBeInTheDocument()
  })

  it('renders rollback result', () => {
    render(
      <RollbackDialog
        suggestions={suggestions}
        result={result}
        onExecute={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Rollback succeeded')).toBeInTheDocument()
    expect(screen.getByText(/Rollback completed/)).toBeInTheDocument()
    expect(screen.getByText(/3 files restored/)).toBeInTheDocument()
  })

  it('disables execute button when busy', () => {
    render(
      <RollbackDialog
        suggestions={suggestions}
        busy={true}
        onExecute={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Rolling back…' })).toBeDisabled()
  })
})
