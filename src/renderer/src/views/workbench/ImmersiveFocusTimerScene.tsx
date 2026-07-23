import { useMemo, type CSSProperties, type ReactElement } from 'react'
import { projectTimerFacePresentation } from '../../study-space/planning-timer-face-clock-ui'
import { resolveTimerPlanShellForCatalog } from '../../study-space/planning-timer-plan-catalog-ui'
import type { TimerSessionRecord } from '../../../../shared/study-planning'
import type { StudyTimerPlan } from '../../study-space/types'

export type ImmersiveFocusTimerFaceModel = {
  remainingTime: string
  timeParts: { primary: string; seconds: string }
  ringStyle: CSSProperties
  secondAngleDeg: number
  timerState: string
}

type TimerSnapshotSlice = {
  timerPlans?: readonly StudyTimerPlan[] | null
  timerState?: string | null
  timerMode?: string | null
  remainingSeconds?: number | null
  focusMinutes?: number | null
  breakMinutes?: number | null
  simulationStartTime?: string | null
  simulationEndTime?: string | null
}

export function buildImmersiveFocusTimerFace(input: {
  snapshot: TimerSnapshotSlice
  defaultTimerPlanId: string | null | undefined
  activeTimerSession: TimerSessionRecord | null | undefined
  timerProgress: number | null | undefined
}): ImmersiveFocusTimerFaceModel {
  const { snapshot, defaultTimerPlanId, activeTimerSession, timerProgress } = input
  const timerPlans = snapshot.timerPlans ?? []
  const planId = defaultTimerPlanId ?? timerPlans[0]?.id ?? null
  const appliedPlan = planId ? resolveTimerPlanShellForCatalog(planId, timerPlans) : null
  const timerState = snapshot.timerState ?? 'idle'
  const timerMode = snapshot.timerMode === 'break' ? 'break' : 'focus'
  const remainingSeconds =
    typeof snapshot.remainingSeconds === 'number' ? snapshot.remainingSeconds : 0
  const focusMinutes = typeof snapshot.focusMinutes === 'number' ? snapshot.focusMinutes : 25
  const breakMinutes = typeof snapshot.breakMinutes === 'number' ? snapshot.breakMinutes : 5
  const presentation = projectTimerFacePresentation({
    timerState,
    timerMode,
    selectedMode: timerMode,
    remainingSeconds,
    focusMinutes,
    breakMinutes,
    simulationStartTime: snapshot.simulationStartTime,
    simulationEndTime: snapshot.simulationEndTime,
    appliedPlan,
    activeSessionClockMode: activeTimerSession?.clockMode ?? null,
    timerProgress
  })
  const secondValue = Number.parseInt(presentation.timeParts.seconds, 10)
  const secondAngleDeg = (Number.isFinite(secondValue) ? secondValue : 0) * 6
  return {
    remainingTime: presentation.remainingTime,
    timeParts: presentation.timeParts,
    ringStyle: presentation.ringStyle as CSSProperties,
    secondAngleDeg,
    timerState
  }
}

export function useImmersiveFocusTimerFace(input: {
  snapshot: TimerSnapshotSlice
  defaultTimerPlanId: string | null | undefined
  activeTimerSession: TimerSessionRecord | null | undefined
  timerProgress: number | null | undefined
}): ImmersiveFocusTimerFaceModel {
  const { snapshot, defaultTimerPlanId, activeTimerSession, timerProgress } = input
  return useMemo(
    () =>
      buildImmersiveFocusTimerFace({
        snapshot,
        defaultTimerPlanId,
        activeTimerSession,
        timerProgress
      }),
    [
      activeTimerSession?.clockMode,
      defaultTimerPlanId,
      snapshot.breakMinutes,
      snapshot.focusMinutes,
      snapshot.remainingSeconds,
      snapshot.simulationEndTime,
      snapshot.simulationStartTime,
      snapshot.timerMode,
      snapshot.timerPlans,
      snapshot.timerState,
      timerProgress
    ]
  )
}

const SECOND_TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const

export function ImmersiveFocusTimerScene(props: {
  face: ImmersiveFocusTimerFaceModel
  timerMode: string | null | undefined
}): ReactElement {
  const { face, timerMode } = props
  return (
    <div
      className="workbench-immersive-focus-timer-scene"
      data-timer-state={face.timerState}
      data-timer-mode={timerMode}
      aria-label={`\u4e13\u6ce8\u8ba1\u65f6 ${face.remainingTime}`}
    >
      <div className="workbench-immersive-focus-timer-scene__glow" aria-hidden="true" />
      <div className="workbench-immersive-focus-timer-scene__face">
        <div
          className="workbench-timer-ring workbench-immersive-focus-timer-scene__ring"
          style={
            {
              ...face.ringStyle,
              '--second-hand-angle': `${face.secondAngleDeg}deg`
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <svg className="workbench-timer-ring__dial" viewBox="0 0 120 120" focusable="false">
            <circle className="workbench-timer-ring__track" cx="60" cy="60" r="56" pathLength="100" />
            <circle
              className="workbench-timer-ring__progress"
              cx="60"
              cy="60"
              r="56"
              pathLength="100"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="workbench-pomodoro-time workbench-immersive-focus-timer-scene__time">
            <strong className="workbench-pomodoro-time__primary">{face.timeParts.primary}</strong>
            <span className="visually-hidden">{face.remainingTime}</span>
          </div>
          <div
            className={`workbench-immersive-focus-timer-scene__seconds-clock${
              face.timerState === 'running' ? ' is-running' : ''
            }`}
            aria-hidden="true"
          >
            <span className="workbench-immersive-focus-timer-scene__seconds-clock-face">
              {SECOND_TICKS.map((tick) => (
                <span
                  key={tick}
                  className="workbench-immersive-focus-timer-scene__seconds-clock-tick"
                  data-tick={tick}
                />
              ))}
              <span className="workbench-immersive-focus-timer-scene__seconds-hand" />
              <span className="workbench-immersive-focus-timer-scene__seconds-hub" />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ImmersiveFocusTimerPickerPreview(props: {
  face: ImmersiveFocusTimerFaceModel
}): ReactElement {
  const { face } = props
  return (
    <div className="workbench-scene-picker__focus-timer-preview" aria-hidden="true">
      <div className="workbench-timer-ring workbench-scene-picker__focus-timer-ring" style={face.ringStyle}>
        <svg className="workbench-timer-ring__dial" viewBox="0 0 120 120" focusable="false">
          <circle className="workbench-timer-ring__track" cx="60" cy="60" r="56" pathLength="100" />
          <circle
            className="workbench-timer-ring__progress"
            cx="60"
            cy="60"
            r="56"
            pathLength="100"
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="workbench-pomodoro-time">
          <strong className="workbench-pomodoro-time__primary">{face.timeParts.primary}</strong>
        </div>
      </div>
    </div>
  )
}
