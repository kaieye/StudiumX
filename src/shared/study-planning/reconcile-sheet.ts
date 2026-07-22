/**
 * Stale-session reconcile sheet model (STC-206 product path / freeze #5).
 * Pure presentation when TimerSession enters needs_reconcile (gap > 120 min default).
 *
 * Decisions map 1:1 to lifecycle ReconcileDecision:
 * - confirm_all: credit full pending gap (may complete countdown)
 * - truncate_to_target: add only remaining countdown room; open countup ≈ discard
 * - discard_gap: resume without crediting gap
 * - later: dismiss sheet; keep needs_reconcile (no silent credit)
 */

import { TIMER_SESSION_SEED, type ReconcileDecision, type TimerSessionRecord } from './timer-session-lifecycle'

export type ReconcileSheetAction = ReconcileDecision | 'later'

export type ReconcileSheetModel = {
  sessionId: string
  phase: TimerSessionRecord['phase']
  clockMode: TimerSessionRecord['clockMode']
  gapSeconds: number
  gapMinutes: number
  staleGapMinutesDefault: number
  accumulatedActiveSeconds: number
  targetSeconds: number | null
  remainingToTargetSeconds: number | null
  /** Whether truncate_to_target differs from discard (countdown with room). */
  truncateMeaningful: boolean
  options: ReconcileSheetAction[]
  copy: {
    title: string
    description: string
    confirmAllLabel: string
    confirmAllDetail: string
    truncateLabel: string
    truncateDetail: string
    discardLabel: string
    discardDetail: string
    laterLabel: string
  }
}

/** Format a non-negative second gap for sheet copy (e.g. "2 小时 5 分钟"). */
export function formatReconcileGapLabel(gapSeconds: number): string {
  const sec = Math.max(0, Math.floor(gapSeconds))
  if (sec < 60) return `${sec} 秒`
  const totalMin = Math.floor(sec / 60)
  if (totalMin < 60) return `${totalMin} 分钟`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (mins === 0) return `${hours} 小时`
  return `${hours} 小时 ${mins} 分钟`
}

export function gapMinutesRounded(gapSeconds: number): number {
  return Math.max(0, Math.round(Math.max(0, gapSeconds) / 60))
}

/**
 * Fail-closed: only sessions already in needs_reconcile with a finite gap offer the sheet.
 */
export function shouldOfferReconcileSheet(
  session: Pick<TimerSessionRecord, 'state' | 'pendingReconcileSeconds'> | null | undefined
): boolean {
  if (!session) return false
  if (session.state !== 'needs_reconcile') return false
  const gap = session.pendingReconcileSeconds
  return typeof gap === 'number' && Number.isFinite(gap) && gap >= 0
}

/**
 * Build presentation model for stale gap reconcile (freeze #5).
 */
export function buildReconcileSheetModel(input: {
  session: Pick<
    TimerSessionRecord,
    | 'id'
    | 'state'
    | 'phase'
    | 'clockMode'
    | 'pendingReconcileSeconds'
    | 'accumulatedActiveSeconds'
    | 'targetSeconds'
  >
  /** Override gap (tests); defaults to pendingReconcileSeconds. */
  gapSeconds?: number
  staleGapMinutesDefault?: number
}): ReconcileSheetModel {
  const gapSeconds = Math.max(
    0,
    Math.floor(
      input.gapSeconds ??
        (typeof input.session.pendingReconcileSeconds === 'number'
          ? input.session.pendingReconcileSeconds
          : 0)
    )
  )
  const gapMinutes = gapMinutesRounded(gapSeconds)
  const targetSeconds = input.session.targetSeconds
  const accumulated = Math.max(0, Math.floor(input.session.accumulatedActiveSeconds ?? 0))
  const remainingToTargetSeconds =
    input.session.clockMode === 'countdown' && targetSeconds != null
      ? Math.max(0, targetSeconds - accumulated)
      : null
  const truncateMeaningful =
    remainingToTargetSeconds != null && remainingToTargetSeconds > 0 && gapSeconds > remainingToTargetSeconds

  const phaseLabel =
    input.session.phase === 'focus'
      ? '专注'
      : input.session.phase === 'long_break'
        ? '长休息'
        : input.session.phase === 'short_break'
          ? '短休息'
          : '收尾'
  const gapLabel = formatReconcileGapLabel(gapSeconds)
  const staleDefault = input.staleGapMinutesDefault ?? TIMER_SESSION_SEED.staleGapMinutesDefault

  return {
    sessionId: input.session.id,
    phase: input.session.phase,
    clockMode: input.session.clockMode,
    gapSeconds,
    gapMinutes,
    staleGapMinutesDefault: staleDefault,
    accumulatedActiveSeconds: accumulated,
    targetSeconds,
    remainingToTargetSeconds,
    truncateMeaningful,
    options: ['confirm_all', 'truncate_to_target', 'discard_gap', 'later'],
    copy: {
      title: '检测到长时间中断',
      description: `当前${phaseLabel}段与上次采样间隔约 ${gapLabel}（阈值 ${staleDefault} 分钟）。请确认是否计入学习/休息时间；不会静默把睡眠或离开算作专注。`,
      confirmAllLabel: '全部计入',
      confirmAllDetail: `将约 ${gapLabel} 全部记入本段累计（倒计时可能直接到点）。`,
      truncateLabel: '只补到目标',
      truncateDetail:
        remainingToTargetSeconds != null && remainingToTargetSeconds > 0
          ? `最多再计 ${formatReconcileGapLabel(remainingToTargetSeconds)}，补满本段目标后结束；多余间隔丢弃。`
          : '无剩余目标（正计时或已满）：等同于不计入间隔。',
      discardLabel: '不计入间隔',
      discardDetail: '丢弃这段间隔，从现在继续计时；不增加专注/休息累计。',
      laterLabel: '稍后'
    }
  }
}

/**
 * Map sheet / host answers onto ReconcileSheetAction (fail-closed).
 */
export function normalizeReconcileSheetAction(
  raw: string | null | undefined
): ReconcileSheetAction | null {
  if (raw == null || raw === '') return null
  if (raw === 'confirm_all' || raw === 'confirm' || raw === 'all') return 'confirm_all'
  if (raw === 'truncate_to_target' || raw === 'truncate' || raw === 'cap') return 'truncate_to_target'
  if (raw === 'discard_gap' || raw === 'discard' || raw === 'skip') return 'discard_gap'
  if (raw === 'later' || raw === 'dismiss' || raw === 'cancel') return 'later'
  return null
}

/** Decision payload for store command (excludes later). */
export function reconcileDecisionFromAction(
  action: ReconcileSheetAction
): ReconcileDecision | null {
  if (action === 'later') return null
  if (action === 'confirm_all' || action === 'truncate_to_target' || action === 'discard_gap') {
    return action
  }
  return null
}
