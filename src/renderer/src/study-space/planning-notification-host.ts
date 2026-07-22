/**
 * Notification host policy adapter (STC-601/602/605 product path).
 *
 * Pure decision: map V1 lifecycle notification intents through
 * `resolveNotificationChannels` so DND / event switches / system permission
 * gate system + sound. In-app surface remains the always-on fallback when
 * policy allows the event.
 *
 * No OS APIs here — host injects:
 * - policy / doNotDisturb / fullscreen / systemPermission (live context)
 * - showInApp / optional trySystem delivery
 *
 * Product wiring (OfficeWorkbench + useStudySession):
 * - fullscreen from immersive stage ownership
 * - doNotDisturb from pet quietUntil (quiet mode)
 * - notifications.enabled master switch → DND-like suppress sound/system
 * - systemPermission from Notification.permission when available
 */

import {
  resolveNotificationChannels,
  type NotificationChannelDecision
} from '../../../shared/study-planning'
import type { TimerPlanNotificationPolicy } from '../../../shared/study-planning'

export type LifecycleNotificationIntent = {
  kind: 'notification'
  title: string
  body: string
}

export type NotificationHostPolicyInput = {
  /** Defaults to classic: sound+system+focus/break end all on. */
  policy?: Partial<TimerPlanNotificationPolicy>
  systemPermission?: 'granted' | 'denied' | 'default' | 'unsupported'
  doNotDisturb?: boolean
  fullscreen?: boolean
  /**
   * Heuristic event class from title/body when lifecycle does not tag phase.
   * Defaults to focus_end.
   */
  event?: 'focus_end' | 'break_end'
}

/**
 * Live host signals for product-path notification decisions.
 * All fields optional; missing values fail closed to safe defaults
 * (permission default, no DND, not fullscreen, notifications on).
 */
export type NotificationHostLiveContext = {
  /** Immersive stage owns document fullscreen. */
  fullscreen?: boolean
  /**
   * Quiet / DND: pet quietUntil active, or host master notifications disabled.
   * When true: keep quiet in-app, suppress sound + system (STC-605).
   */
  doNotDisturb?: boolean
  /**
   * App-level notifications.enabled. When false, treated as DND for lifecycle
   * focus/break ends (still allow quiet in-app only if policy event on).
   */
  notificationsEnabled?: boolean
  /** Web Notification.permission mapped for resolveNotificationChannels. */
  systemPermission?: 'granted' | 'denied' | 'default' | 'unsupported'
  /** Optional plan-level policy overrides (TimerPlanV2.notificationPolicy). */
  policy?: Partial<TimerPlanNotificationPolicy>
  nowMs?: number
  /** Absolute quiet-until wall ms (pet notificationPreferences.quietUntil). */
  quietUntilMs?: number | null
}

export const DEFAULT_TIMER_NOTIFICATION_POLICY: TimerPlanNotificationPolicy = {
  sound: true,
  systemNotification: true,
  focusEnd: true,
  breakEnd: true
}

export function inferNotificationEvent(
  intent: Pick<LifecycleNotificationIntent, 'title' | 'body'>
): 'focus_end' | 'break_end' {
  const title = intent.title.toLowerCase()
  const body = intent.body.toLowerCase()
  const text = `${title} ${body}`
  // Explicit focus-end cues win (focus finished -> entering break is still focus_end).
  if (
    title.includes('专注') ||
    title.includes('focus') ||
    text.includes('进入休息') ||
    text.includes('start break') ||
    text.includes('start rest')
  ) {
    // "休息结束" title should still be break_end even if body mentions 专注
    if (
      (title.includes('休息') || title.includes('break') || title.includes('rest')) &&
      (
        title.includes('结束') ||
        title.includes('完成') ||
        title.includes('end') ||
        title.includes('done') ||
        title.includes('over')
      )
    ) {
      return 'break_end'
    }
    return 'focus_end'
  }
  // Break-end: rest/break + end/done cues
  if (text.includes('休息') || text.includes('break') || text.includes('rest')) {
    if (
      text.includes('结束') ||
      text.includes('完成') ||
      text.includes('end') ||
      text.includes('done') ||
      text.includes('over')
    ) {
      return 'break_end'
    }
  }
  return 'focus_end'
}

export function mapSystemNotificationPermission(
  raw: string | null | undefined
): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (raw == null || raw === '') return 'unsupported'
  if (raw === 'granted' || raw === 'denied' || raw === 'default') return raw
  return 'unsupported'
}

/**
 * Read live Notification.permission when available (browser / Electron).
 * Isolated for testability — hosts may inject instead.
 */
export function readBrowserNotificationPermission(
  globalNotification?: { permission?: string } | null
): 'granted' | 'denied' | 'default' | 'unsupported' {
  const source =
    globalNotification !== undefined
      ? globalNotification
      : typeof globalThis !== 'undefined' &&
          'Notification' in globalThis &&
          (globalThis as { Notification?: { permission?: string } }).Notification
        ? (globalThis as { Notification: { permission?: string } }).Notification
        : null
  if (!source || typeof source.permission !== 'string') {
    return 'unsupported'
  }
  return mapSystemNotificationPermission(source.permission)
}

/**
 * Collapse host live context into NotificationHostPolicyInput.
 * - quietUntilMs > now → DND
 * - notificationsEnabled === false → DND
 * - explicit doNotDisturb wins as OR with the above
 */
export function resolveNotificationHostPolicyInput(
  live: NotificationHostLiveContext = {}
): NotificationHostPolicyInput {
  const nowMs = live.nowMs ?? Date.now()
  const quietActive =
    typeof live.quietUntilMs === 'number' &&
    Number.isFinite(live.quietUntilMs) &&
    live.quietUntilMs > nowMs
  const masterOff = live.notificationsEnabled === false
  const doNotDisturb = live.doNotDisturb === true || quietActive || masterOff
  return {
    ...(live.policy ? { policy: live.policy } : {}),
    systemPermission: live.systemPermission ?? 'default',
    doNotDisturb,
    fullscreen: live.fullscreen === true
  }
}

export function decideLifecycleNotification(
  intent: LifecycleNotificationIntent,
  input: NotificationHostPolicyInput = {}
): NotificationChannelDecision & {
  event: 'focus_end' | 'break_end'
  shouldShowInApp: boolean
} {
  const event = input.event ?? inferNotificationEvent(intent)
  const policy: TimerPlanNotificationPolicy = {
    ...DEFAULT_TIMER_NOTIFICATION_POLICY,
    ...input.policy
  }
  const decision = resolveNotificationChannels({
    policy,
    event,
    systemPermission: input.systemPermission ?? 'default',
    doNotDisturb: input.doNotDisturb === true,
    fullscreen: input.fullscreen === true
  })
  return {
    ...decision,
    event,
    shouldShowInApp: decision.showInApp
  }
}

/**
 * Product-path one-shot: live context → decide → optionally deliver in-app.
 * System/sound remain reported; App showNotification is the unified delivery
 * path today (in-app + its own OS fallback).
 */
export function decideAndApplyLifecycleNotification(input: {
  intent: LifecycleNotificationIntent
  live?: NotificationHostLiveContext
  showInApp: (title: string, body: string) => void | Promise<void>
}): {
  decision: NotificationChannelDecision & {
    event: 'focus_end' | 'break_end'
    shouldShowInApp: boolean
  }
  deliveredInApp: boolean
} {
  const policyInput = resolveNotificationHostPolicyInput(input.live ?? {})
  const decision = decideLifecycleNotification(input.intent, policyInput)
  const delivered = applyLifecycleNotificationDecision({
    intent: input.intent,
    decision,
    showInApp: input.showInApp
  })
  return { decision, deliveredInApp: delivered.deliveredInApp }
}

/**
 * Apply channel decision: only call in-app when allowed.
 * System/sound are reported for host metrics; product currently uses App
 * showNotification as the unified in-app (+ OS fallback inside App).
 */
export function applyLifecycleNotificationDecision(input: {
  intent: LifecycleNotificationIntent
  decision: NotificationChannelDecision & { shouldShowInApp?: boolean }
  showInApp: (title: string, body: string) => void | Promise<void>
}): { deliveredInApp: boolean } {
  const allow =
    input.decision.shouldShowInApp !== undefined
      ? input.decision.shouldShowInApp
      : input.decision.showInApp
  if (!allow) {
    return { deliveredInApp: false }
  }
  void input.showInApp(input.intent.title, input.intent.body)
  return { deliveredInApp: true }
}
