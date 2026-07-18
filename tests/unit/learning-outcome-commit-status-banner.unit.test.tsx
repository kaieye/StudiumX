import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LearningOutcomeCommitUiStatus } from '../../src/renderer/src/teaching/learning-outcome-commit-client'
import {
  LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME,
  LearningOutcomeCommitStatusBanner
} from '../../src/renderer/src/teaching/learning-outcome-commit-status-banner'

function retryable(reason: 'api_reject' | 'reconciliation_required' | 'temporarily_unavailable' = 'api_reject'): LearningOutcomeCommitUiStatus {
  return {
    kind: 'retryable',
    sessionId: 'session-1',
    operationId: 'outcome-seq-4',
    reason,
    canRetry: true,
    announcement: null
  }
}

describe('LearningOutcomeCommitStatusBanner', () => {
  it('renders learner-safe status for markdown and html surfaces and hides idle', () => {
    const { rerender, container } = render(
      <div data-reading-surface="markdown">
        <LearningOutcomeCommitStatusBanner
          status={{
            kind: 'needs_practice',
            sessionId: 'session-1',
            operationId: 'outcome-seq-2',
            recordSaved: false,
            announcement: null
          }}
        />
      </div>
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-learning-outcome-commit', 'needs_practice')
    expect(screen.getByRole('status')).toHaveAttribute('data-severity', 'info')
    expect(screen.getByText(/继续练习/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME })).toBeNull()

    rerender(
      <div data-reading-surface="html">
        <LearningOutcomeCommitStatusBanner
          status={{
            kind: 'saved',
            sessionId: 'session-1',
            operationId: 'outcome-seq-3',
            outcomeKind: 'misconception_corrected',
            recordSaved: true,
            announcement: { id: 'saved:outcome-seq-3', message: '本次学习进展已保存。你可以继续下一步。' }
          }}
        />
      </div>
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-learning-outcome-commit', 'saved')
    expect(screen.getByText(/已保存/)).toBeTruthy()

    rerender(<LearningOutcomeCommitStatusBanner status={{ kind: 'idle' }} />)
    expect(container.querySelector('[data-learning-outcome-commit]')).toBeNull()
  })

  it('wires accessible same-operationId retry: keyboard button, loading/disabled, disappears after success', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(
      <LearningOutcomeCommitStatusBanner status={retryable('reconciliation_required')} onRetry={onRetry} />
    )

    const button = screen.getByRole('button', { name: LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME })
    expect(button).toHaveAttribute('name', LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME)
    expect(button).not.toBeDisabled()
    expect(screen.getByRole('status')).toHaveAttribute('data-severity', 'warning')

    button.focus()
    expect(document.activeElement).toBe(button)
    await user.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <LearningOutcomeCommitStatusBanner
        status={{ kind: 'committing', sessionId: 'session-1', operationId: 'outcome-seq-4' }}
        onRetry={onRetry}
        retryPending
      />
    )
    const busy = screen.getByRole('button', { name: LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    rerender(
      <LearningOutcomeCommitStatusBanner
        status={{
          kind: 'saved',
          sessionId: 'session-1',
          operationId: 'outcome-seq-4',
          outcomeKind: 'misconception_corrected',
          recordSaved: true,
          announcement: null
        }}
        onRetry={onRetry}
      />
    )
    expect(screen.queryByRole('button', { name: LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME })).toBeNull()
    expect(screen.getByRole('status')).toHaveAttribute('data-learning-outcome-commit', 'saved')
  })

  it('does not invent mastery claims for retryable api_reject banner copy', () => {
    render(<LearningOutcomeCommitStatusBanner status={retryable('api_reject')} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/重试同一提交|暂时不可用/)
    expect(status.textContent).not.toMatch(/^已掌握/)
    expect(status.textContent).not.toMatch(/learning-records/)
  })
})
