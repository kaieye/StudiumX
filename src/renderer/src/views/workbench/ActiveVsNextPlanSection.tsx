/**
 * STC-503: active session planSnapshot vs next-segment plan strip.
 * Thin UI — pure model from planning-active-vs-next-plan-ui.
 */

import { useMemo } from 'react'
import {
  buildActiveVsNextPlanUiModel,
  type ActiveVsNextPlanSideModel
} from '../../study-space/planning-active-vs-next-plan-ui'
import type { StudyTimerPlan } from '../../study-space/types'
import type { TimerSessionRecord } from '../../../../shared/study-planning'

export type ActiveVsNextPlanSectionProps = {
  activeSession?: TimerSessionRecord | null
  timerSessions?: readonly TimerSessionRecord[] | null
  nextPlanId?: string | null
  userPlans?: readonly StudyTimerPlan[] | null
}

function PlanSideCard({
  label,
  side,
  emptyText,
  emphasize
}: {
  label: string
  side: ActiveVsNextPlanSideModel | null
  emptyText: string
  emphasize?: boolean
}) {
  return (
    <div
      className={`workbench-active-vs-next-plan__side${emphasize ? ' is-diverged' : ''}${side ? '' : ' is-empty'}`}
    >
      <span className="workbench-active-vs-next-plan__side-label">{label}</span>
      {side ? (
        <>
          <strong className="workbench-active-vs-next-plan__name">{side.name}</strong>
          <small className="workbench-active-vs-next-plan__summary">{side.summary}</small>
        </>
      ) : (
        <p className="workbench-active-vs-next-plan__empty">{emptyText}</p>
      )}
    </div>
  )
}

export function ActiveVsNextPlanSection({
  activeSession = null,
  timerSessions = null,
  nextPlanId = null,
  userPlans = null
}: ActiveVsNextPlanSectionProps) {
  const model = useMemo(
    () =>
      buildActiveVsNextPlanUiModel({
        activeSession,
        timerSessions,
        nextPlanId,
        userPlans
      }),
    [activeSession, timerSessions, nextPlanId, userPlans]
  )

  if (!model.visible) return null

  return (
    <section
      className={`workbench-active-vs-next-plan${model.diverges ? ' is-diverged' : ''}`}
      aria-label={model.copy.title}
      data-diverges={model.diverges ? 'true' : 'false'}
    >
      <header className="workbench-active-vs-next-plan__header">
        <strong>{model.copy.title}</strong>
        {model.diverges ? (
          <p role="status" className="workbench-active-vs-next-plan__hint is-diverged">
            {model.copy.divergesHint}
          </p>
        ) : !model.hasActiveSession ? (
          <p className="workbench-active-vs-next-plan__hint">{model.copy.idleHint}</p>
        ) : null}
      </header>

      <div className="workbench-active-vs-next-plan__grid">
        <PlanSideCard
          label={model.copy.activeLabel}
          side={model.active}
          emptyText={model.copy.idleHint}
          emphasize={model.diverges}
        />
        <PlanSideCard
          label={model.copy.nextLabel}
          side={model.next}
          emptyText={model.copy.missingNextHint}
          emphasize={model.diverges}
        />
      </div>
    </section>
  )
}
