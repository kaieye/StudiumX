/**
 * STC-206 pure reconcile sheet model (stale gap / freeze #5).
 */

import { describe, expect, it } from 'vitest'
import {
  buildReconcileSheetModel,
  createClassicPomodoroPlan,
  formatReconcileGapLabel,
  normalizeReconcileSheetAction,
  reconcileDecisionFromAction,
  shouldOfferReconcileSheet,
  startTimerSession,
  advanceTimerSession,
  TIMER_SESSION_SEED,
  type TimerSessionRecord
} from '../../src/shared/study-planning'

function staleSession(gapMinutes = TIMER_SESSION_SEED.staleGapMinutesDefault + 5): TimerSessionRecord {
  const t0 = 1_000_000
  const started = startTimerSession({
    id: 's1',
    nowMs: t0,
    plan: createClassicPomodoroPlan(),
    taskId: 't1'
  }).session!
  const gapMs = gapMinutes * 60_000
  return advanceTimerSession(started, t0 + gapMs).session!
}

describe('reconcile-sheet pure model (STC-206)', () => {
  it('formatReconcileGapLabel covers seconds/minutes/hours', () => {
    expect(formatReconcileGapLabel(45)).toBe('45 秒')
    expect(formatReconcileGapLabel(90)).toBe('1 分钟')
    expect(formatReconcileGapLabel(125 * 60)).toMatch(/2 小时/)
  })

  it('shouldOfferReconcileSheet only for needs_reconcile', () => {
    const s = staleSession()
    expect(s.state).toBe('needs_reconcile')
    expect(shouldOfferReconcileSheet(s)).toBe(true)
    expect(shouldOfferReconcileSheet({ ...s, state: 'running' })).toBe(false)
    expect(shouldOfferReconcileSheet(null)).toBe(false)
  })

  it('buildReconcileSheetModel exposes three decisions + later', () => {
    const s = staleSession(130)
    const model = buildReconcileSheetModel({ session: s })
    expect(model.options).toEqual([
      'confirm_all',
      'truncate_to_target',
      'discard_gap',
      'later'
    ])
    expect(model.gapMinutes).toBeGreaterThanOrEqual(120)
    expect(model.truncateMeaningful).toBe(true)
    expect(model.copy.title).toMatch(/中断/)
    expect(model.copy.confirmAllLabel).toMatch(/全部计入/)
  })

  it('normalize + reconcileDecisionFromAction fail-closed', () => {
    expect(normalizeReconcileSheetAction('confirm')).toBe('confirm_all')
    expect(normalizeReconcileSheetAction('truncate')).toBe('truncate_to_target')
    expect(normalizeReconcileSheetAction('discard')).toBe('discard_gap')
    expect(normalizeReconcileSheetAction('dismiss')).toBe('later')
    expect(normalizeReconcileSheetAction('nope')).toBeNull()
    expect(reconcileDecisionFromAction('later')).toBeNull()
    expect(reconcileDecisionFromAction('confirm_all')).toBe('confirm_all')
  })
})
