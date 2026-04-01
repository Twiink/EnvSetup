/**
 * snapshot-panel 视图及交互行为的渲染测试。
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SnapshotMeta } from '../../src/main/core/contracts'
import { SnapshotPanel } from '../../src/renderer/components/SnapshotPanel'

const makeSnapshots = (overrides: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  snapshots: [
    {
      id: 'snapshot-1',
      taskId: 'task-1',
      createdAt: new Date().toISOString(),
      type: 'auto',
      label: 'Before install',
      canDelete: true,
    },
    {
      id: 'snapshot-2',
      taskId: 'task-2',
      createdAt: new Date().toISOString(),
      type: 'manual',
      label: 'Manual backup',
      canDelete: false,
    },
  ],
  maxSnapshots: 5,
  ...overrides,
})

afterEach(() => {
  cleanup()
})

describe('SnapshotPanel', () => {
  it('renders empty state when no snapshots', () => {
    render(
      <SnapshotPanel
        locale="en"
        onCreateSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onRollbackSnapshot={vi.fn()}
      />,
    )

    expect(screen.getByText('No snapshots yet.')).toBeInTheDocument()
  })

  it('renders snapshot entries with labels and types', () => {
    render(
      <SnapshotPanel
        locale="en"
        snapshots={makeSnapshots()}
        onCreateSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onRollbackSnapshot={vi.fn()}
      />,
    )

    expect(screen.getByText('Before install')).toBeInTheDocument()
    expect(screen.getByText('Manual backup')).toBeInTheDocument()
    expect(screen.getByText(/Before install/)).toBeInTheDocument()
    expect(screen.getByText(/Manual backup/)).toBeInTheDocument()
    expect(screen.getByText(/Task: task-1/)).toBeInTheDocument()
    expect(screen.getByText(/Task: task-2/)).toBeInTheDocument()
  })

  it('calls onCreateSnapshot when create button clicked', () => {
    const onCreateSnapshot = vi.fn()
    render(
      <SnapshotPanel
        locale="en"
        onCreateSnapshot={onCreateSnapshot}
        onDeleteSnapshot={vi.fn()}
        onRollbackSnapshot={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create Snapshot' }))
    expect(onCreateSnapshot).toHaveBeenCalledOnce()
  })

  it('shows delete button for deletable snapshots', () => {
    const onDeleteSnapshot = vi.fn()
    render(
      <SnapshotPanel
        locale="en"
        snapshots={makeSnapshots()}
        onCreateSnapshot={vi.fn()}
        onDeleteSnapshot={onDeleteSnapshot}
        onRollbackSnapshot={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDeleteSnapshot).toHaveBeenCalledWith('snapshot-1')
  })

  it('toggles snapshot details on Details button click', () => {
    render(
      <SnapshotPanel
        locale="en"
        snapshots={makeSnapshots()}
        onCreateSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onRollbackSnapshot={vi.fn()}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0])
    expect(screen.getByText(/ID:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText(/ID:/)).not.toBeInTheDocument()
  })

  it('disables buttons when busy', () => {
    render(
      <SnapshotPanel
        locale="en"
        snapshots={makeSnapshots()}
        busy={true}
        onCreateSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onRollbackSnapshot={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Create Snapshot' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
