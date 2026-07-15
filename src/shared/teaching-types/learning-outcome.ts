import type { LearningOutcomeKind } from './learning-session'

export type LearningOutcomeCommitRequest = {
  sessionId: string
  operationId: string
}

export type LearnerSafeLearningOutcome = {
  kind: Exclude<LearningOutcomeKind, 'not_evidenced'>
}

export type LearningOutcomeCommitSuccess =
  | {
      status: 'committed'
      outcome: LearnerSafeLearningOutcome
      recordSaved: boolean
    }
  | {
      status: 'already_committed'
      outcome: LearnerSafeLearningOutcome
      recordSaved: boolean
    }

export type LearningOutcomeCommitResult =
  | LearningOutcomeCommitSuccess
  | {
      status: 'insufficient_evidence'
      reason: 'not_evidenced'
    }
  | {
      status: 'conflict'
      reason: 'review_required'
    }
  | {
      status: 'retryable_failure'
      reason: 'reconciliation_required' | 'temporarily_unavailable'
    }
  | {
      status: 'non_retryable_failure'
      reason: 'invalid_session' | 'invalid_request' | 'read_only' | 'not_found'
    }