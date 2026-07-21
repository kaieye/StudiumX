/**
 * Notification preference pure helpers + local review metrics (Phase 6 / STC-601..607 pure).
 * No OS notification APIs here — only decision policies for hosts to apply.
 */

import type { TimerPlanNotificationPolicy } from './timer-plan'
import type { TimerSessionRecord } from './timer-session-lifecycle'
import type { ScheduleBlock } from './schedule-block'

export type NotificationChannelDecision = {
  /** Always prefer in-app surface when true. */
  showInApp: boolean
  /** Attempt system notification only if permission granted and policy allows. */
  trySystemNotification: boolean
  playSound: boolean
  reason: string
}

/**
 * Decide channels for a focus/break end event (STC-601/602).
 * When system permission is denied, in-app still works.
 */
export function resolveNotificationChannels(input: {
  policy: TimerPlanNotificationPolicy
  event: 'focus_end' | 'break_end'
  systemPermission: 'granted' | 'denied' | 'default' | 'unsupported'
  /** Do-not-disturb / fullscreen respect (STC-605). */
  doNotDisturb?: boolean
  fullscreen?: boolean
}): NotificationChannelDecision {
  const eventAllowed =
    input.event === 'focus_end' ? input.policy.focusEnd !== false : input.policy.breakEnd !== false
  if (!eventAllowed) {
    return {
      showInApp: false,
      trySystemNotification: false,
      playSound: false,
      reason: 'event_disabled_in_policy'
    }
  }

  const dnd = input.doNotDisturb === true
  const fullscreen = input.fullscreen === true
  // Respect DND: suppress sound + system; keep quiet in-app badge.
  if (dnd) {
    return {
      showInApp: true,
      trySystemNotification: false,
      playSound: false,
      reason: 'do_not_disturb'
    }
  }

  const playSound = input.policy.sound !== false && !fullscreen
  const trySystem =
    input.policy.systemNotification !== false &&
    input.systemPermission === 'granted' &&
    !fullscreen

  return {
    showInApp: true,
    trySystemNotification: trySystem,
    playSound,
    reason: trySystem ? 'in_app_and_system' : 'in_app_only'
  }
}

export type PlanDeviationKind = 'early_finish' | 'overrun' | 'skipped_break'

export type PlanDeviation = {
  kind: PlanDeviationKind
  sessionId: string
  detail: string
}

/** STC-606 pure signals from sessions vs planned blocks. */
export function detectPlanDeviations(input: {
  sessions: readonly TimerSessionRecord[]
  scheduleBlocks: readonly ScheduleBlock[]
  earlyFinishSlackSeconds?: number
}): PlanDeviation[] {
  const slack = input.earlyFinishSlackSeconds ?? 120
  const out: PlanDeviation[] = []
  for (const session of input.sessions) {
    if (session.state !== 'completed' && session.state !== 'cancelled') continue
    if (session.phase === 'focus' && session.targetSeconds != null) {
      if (session.accumulatedActiveSeconds + slack < session.targetSeconds) {
        out.push({
          kind: 'early_finish',
          sessionId: session.id,
          detail: `finished ${session.targetSeconds - session.accumulatedActiveSeconds}s early`
        })
      }
      if (session.accumulatedActiveSeconds > session.targetSeconds + slack) {
        out.push({
          kind: 'overrun',
          sessionId: session.id,
          detail: `overran by ${session.accumulatedActiveSeconds - session.targetSeconds}s`
        })
      }
    }
    if (session.phase !== 'focus' && session.state === 'cancelled') {
      out.push({
        kind: 'skipped_break',
        sessionId: session.id,
        detail: 'break segment cancelled'
      })
    }
  }
  return out
}

/** STC-607 local review aggregates (not remote telemetry). */
export function projectLocalReviewStats(input: {
  scheduleBlocks: readonly ScheduleBlock[]
  timerSessions: readonly TimerSessionRecord[]
  rangeStartMs: number
  rangeEndMs: number
}): {
  plannedFocusSeconds: number
  actualFocusSeconds: number
  unattributedFocusSeconds: number
  breakCompletedSeconds: number
  breakScheduledSeconds: number
  breakCompletionRatio: number
} {
  let plannedFocusSeconds = 0
  let breakScheduledSeconds = 0
  for (const b of input.scheduleBlocks) {
    if (b.endAtMs <= input.rangeStartMs || b.startAtMs >= input.rangeEndMs) continue
    const sec = Math.max(0, Math.floor((b.endAtMs - b.startAtMs) / 1000))
    if (b.kind === 'focus') plannedFocusSeconds += sec
    if (b.kind === 'short_break' || b.kind === 'long_break') breakScheduledSeconds += sec
  }
  let actualFocusSeconds = 0
  let unattributedFocusSeconds = 0
  let breakCompletedSeconds = 0
  for (const s of input.timerSessions) {
    if (s.endedAtMs != null && s.endedAtMs < input.rangeStartMs) continue
    if (s.startedAtMs >= input.rangeEndMs) continue
    if (s.phase === 'focus') {
      if (s.taskId) actualFocusSeconds += s.accumulatedFocusSeconds
      else unattributedFocusSeconds += s.accumulatedFocusSeconds
    } else if (s.phase === 'short_break' || s.phase === 'long_break') {
      if (s.state === 'completed') breakCompletedSeconds += s.accumulatedActiveSeconds
    }
  }
  const breakCompletionRatio =
    breakScheduledSeconds > 0 ? Math.min(1, breakCompletedSeconds / breakScheduledSeconds) : 0
  return {
    plannedFocusSeconds,
    actualFocusSeconds,
    unattributedFocusSeconds,
    breakCompletedSeconds,
    breakScheduledSeconds,
    breakCompletionRatio
  }
}

/** A11y: static status text; never include ticking seconds for SR (STC-603). */
export function timerStatusAriaLabel(input: {
  state: string
  phase: string
  clockMode: string
  taskTitle?: string | null
}): string {
  const task = input.taskTitle?.trim() ? `，任务 ${input.taskTitle.trim()}` : ''
  return `计时 ${input.state}，阶段 ${input.phase}，模式 ${input.clockMode}${task}`
}
