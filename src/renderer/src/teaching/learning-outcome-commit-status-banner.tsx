import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react'
import type { LearningOutcomeCommitUiStatus } from './learning-outcome-commit-client'
import {
  learnerSafeCommitStatusLabel,
  learnerSafeCommitStatusSeverity
} from './learning-outcome-commit-client'

/** Accessible name for same-operationId retry from the production App banner. */
export const LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME = '重试同一提交'

export type LearningOutcomeCommitStatusBannerProps = {
  status: LearningOutcomeCommitUiStatus
  /** Production wiring: client.retry() for the last retryable operationId. */
  onRetry?: () => void
  /** True while a same-op retry commit is in flight (status may also be committing). */
  retryPending?: boolean
}

/**
 * Shared learner-safe commit banner for HTML lesson iframe and Markdown preview.
 * Surfaces honest status and an accessible keyboard retry for retryable outcomes.
 */
export function LearningOutcomeCommitStatusBanner({
  status,
  onRetry,
  retryPending = false
}: LearningOutcomeCommitStatusBannerProps) {
  const label = learnerSafeCommitStatusLabel(status)
  if (!label) return null

  const severity = learnerSafeCommitStatusSeverity(status) ?? 'info'
  const canRetry = status.kind === 'retryable' && status.canRetry === true
  const isBusy = retryPending || status.kind === 'committing'
  const showRetryControl = canRetry || (retryPending && status.kind === 'committing')

  return (
    <div
      className="inline-alert"
      role="status"
      aria-live="polite"
      data-learning-outcome-commit={status.kind}
      data-severity={severity}
    >
      {severity === 'warning' ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
      <div style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <strong>{label}</strong>
        {showRetryControl ? (
          <button
            type="button"
            className="ghost-button"
            name={LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME}
            aria-label={LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME}
            disabled={isBusy || !canRetry}
            aria-busy={isBusy || undefined}
            onClick={() => {
              if (!canRetry || isBusy) return
              onRetry?.()
            }}
          >
            {isBusy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
            {LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME}
          </button>
        ) : null}
      </div>
    </div>
  )
}
