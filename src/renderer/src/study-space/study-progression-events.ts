import type { StudyAnalyticsFact } from '../../../shared/teaching-types/analytics'

/** Same-window bridge for rewards produced outside the Study session host (for example, review answers). */
export const STUDY_PROGRESSION_FACTS_EVENT = 'studiumx:study-progression-facts' as const

export type StudyProgressionFactsEventDetail = {
  facts: readonly StudyAnalyticsFact[]
  localToday: string
  /** The mounted Study-session host flips this before dispatch returns. */
  handled: boolean
}

function isDetail(value: unknown): value is StudyProgressionFactsEventDetail {
  if (!value || typeof value !== 'object') return false
  const detail = value as Partial<StudyProgressionFactsEventDetail>
  return Array.isArray(detail.facts) && typeof detail.localToday === 'string'
}

/**
 * Broadcasts immutable facts to the live Study-session host. The boolean result
 * says whether that host accepted responsibility for snapshot persistence.
 */
export function dispatchStudyProgressionFacts(
  facts: readonly StudyAnalyticsFact[],
  localToday: string
): boolean {
  if (
    typeof window === 'undefined'
    || typeof window.dispatchEvent !== 'function'
    || typeof CustomEvent === 'undefined'
  ) return false
  const detail: StudyProgressionFactsEventDetail = { facts: [...facts], localToday, handled: false }
  window.dispatchEvent(new CustomEvent<StudyProgressionFactsEventDetail>(STUDY_PROGRESSION_FACTS_EVENT, { detail }))
  return detail.handled
}

/** Reads and claims a progression event. This is intentionally only used by the Study-session host. */
export function claimStudyProgressionFactsEvent(event: Event): StudyProgressionFactsEventDetail | null {
  if (event.type !== STUDY_PROGRESSION_FACTS_EVENT) return null
  const detail = (event as CustomEvent<unknown>).detail
  if (!isDetail(detail)) return null
  detail.handled = true
  return detail
}
