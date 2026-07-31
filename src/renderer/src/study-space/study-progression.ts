import {
  awardDailyXp,
  clampStudyXp,
  xpForFocusCompletion,
  XP_SOURCE_REWARDS,
  type XpSource
} from '../../../shared/study-progression'
import type {
  StudyActivityFact,
  StudyAnalyticsFact,
  StudySessionFact
} from '../../../shared/teaching-types/analytics'
import type { StudySnapshot } from './types'

function awardInputForFact(fact: StudyAnalyticsFact): {
  source: XpSource
  requestedXp: number
  taskId?: string
} | null {
  if (
    fact.factKind === 'study_session'
    && fact.timerMode === 'focus'
    && fact.outcome === 'completed'
    && fact.completedFocusSessions === 1
  ) {
    return { source: 'focus_completion', requestedXp: xpForFocusCompletion(fact.plannedSeconds) }
  }
  if (fact.factKind !== 'study_activity') return null
  return awardInputForActivity(fact)
}

function awardInputForActivity(fact: StudyActivityFact): {
  source: XpSource
  requestedXp: number
  taskId?: string
} | null {
  if (fact.activity.kind === 'task_completed') {
    return {
      source: 'task_completion',
      requestedXp: XP_SOURCE_REWARDS.task_completion,
      taskId: fact.activity.after.taskId
    }
  }
  if (fact.activity.kind === 'review_answered' && fact.activity.correct) {
    return { source: 'review_correct', requestedXp: XP_SOURCE_REWARDS.review_correct }
  }
  return null
}

/**
 * Settles local progression only from immutable analytics facts. Facts remain
 * the analytics record; this merely applies the capped, idempotent game reward.
 */
export function applyStudyProgressionAwards(
  snapshot: StudySnapshot,
  facts: readonly StudyAnalyticsFact[],
  localToday: string
): StudySnapshot {
  let xp = clampStudyXp(snapshot.xp)
  let daily = snapshot.dailyXpProgress
  for (const fact of facts) {
    const input = awardInputForFact(fact)
    if (!input) continue
    const award = awardDailyXp({
      totalXp: xp,
      daily,
      localDate: localToday,
      source: input.source,
      sourceEventId: fact.id,
      requestedXp: input.requestedXp,
      ...(input.taskId ? { taskId: input.taskId } : {})
    })
    xp += award.awardedXp
    daily = award.daily
  }
  return xp === snapshot.xp && daily === snapshot.dailyXpProgress
    ? snapshot
    : { ...snapshot, xp, dailyXpProgress: daily }
}

export function applyStudyProgressionAwardForSession(
  snapshot: StudySnapshot,
  fact: StudySessionFact,
  localToday: string
): StudySnapshot {
  return applyStudyProgressionAwards(snapshot, [fact], localToday)
}
