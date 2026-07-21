import type { AgentRunBudgetStopReason } from '../../shared/teaching-types'

/**
 * Map a thrown value to a budget stop reason when the error object carries a
 * known `budgetStopReason` field. Pure; no I/O.
 *
 * Returns undefined for non-objects, missing field, or unknown reason strings.
 */
export function budgetStopReasonFromError(error: unknown): AgentRunBudgetStopReason | undefined {
  if (!error || typeof error !== 'object') return undefined
  const reason = (error as { budgetStopReason?: unknown }).budgetStopReason
  if (
    reason === 'duration' ||
    reason === 'provider_calls' ||
    reason === 'tool_calls' ||
    reason === 'total_tokens'
  ) {
    return reason
  }
  return undefined
}
