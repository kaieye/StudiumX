import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationInterruptionDock } from '../../src/renderer/src/views/agent-conversation/ConversationInterruptionDock'

describe('ConversationInterruptionDock', () => {
  it('keeps the composer mounted and retains the interruption during its exit transition', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <ConversationInterruptionDock
        active
        interruption={<div>需要批准</div>}
      >
        <form aria-label="composer">composer</form>
      </ConversationInterruptionDock>
    )

    expect(screen.getByRole('form', { name: 'composer', hidden: true })).toBeInTheDocument()
    expect(screen.getByText('需要批准')).toBeInTheDocument()

    rerender(
      <ConversationInterruptionDock active={false} interruption={null}>
        <form aria-label="composer">composer</form>
      </ConversationInterruptionDock>
    )

    expect(screen.getByRole('form', { name: 'composer', hidden: true })).toBeInTheDocument()
    expect(screen.getByText('需要批准')).toBeInTheDocument()
    expect(screen.getByTestId('conversation-interruption-overlay')).toHaveClass('is-exiting')

    act(() => vi.advanceTimersByTime(220))
    expect(screen.queryByText('需要批准')).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'composer', hidden: true })).toBeInTheDocument()
    vi.useRealTimers()
  })
})

