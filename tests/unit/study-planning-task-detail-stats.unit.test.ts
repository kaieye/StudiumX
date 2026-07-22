import { describe, expect, it } from 'vitest'
import type { ScheduleBlock, TimerSessionRecord } from '../../src/shared/study-planning'
import {
  buildTaskDetailStatsModel,
  formatDetailMinutes,
  normalizeEstimateMinutesInput
} from '../../src/renderer/src/study-space/planning-task-detail-stats'
import { buildUpdateTaskPayloadFromV1 } from '../../src/renderer/src/study-space/planning-task-update-dual-write'

const NOW = Date.UTC(2026, 6, 22, 12, 0, 0) // Wed noon UTC-ish

function focusBlock(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'taskId' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    kind: 'focus',
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1,
    ...partial
  }
}

function session(
  partial: Partial<TimerSessionRecord> & Pick<TimerSessionRecord, 'id' | 'taskId'>
): TimerSessionRecord {
  return {
    scheduleBlockId: null,
    phase: 'focus',
    clockMode: 'countdown',
    state: 'completed',
    targetSeconds: 1500,
    startedAtMs: NOW - 3600_000,
    lastSampleWallMs: NOW - 1800_000,
    accumulatedActiveSeconds: 1500,
    accumulatedFocusSeconds: 1500,
    planSnapshot: null,
    attributionReason: 'explicit',
    focusRoundInPlan: 1,
    ...partial
  }
}

describe('task detail stats model (STC-304)', () => {
  it('never invents estimate from plan; empty shows null', () => {
    const model = buildTaskDetailStatsModel({
      taskId: 't1',
      scheduleBlocks: [
        focusBlock({
          id: 'b1',
          taskId: 't1',
          startAtMs: NOW + 3600_000,
          endAtMs: NOW + 7200_000
        })
      ],
      estimateMinutes: null,
      nowMs: NOW
    })
    expect(model.estimateMinutes).toBeNull()
    expect(model.plannedFocusMinutes).toBe(60)
    expect(model.actualFocusMinutes).toBe(0)
    expect(model.futureBlocks).toHaveLength(1)
    expect(model.historyBlocks).toHaveLength(0)
  })

  it('buckets future / current / history and sums actual focus from sessions', () => {
    const pastStart = NOW - 3 * 3600_000
    const pastEnd = NOW - 2 * 3600_000
    const curStart = NOW - 30 * 60_000
    const curEnd = NOW + 30 * 60_000
    const futStart = NOW + 2 * 3600_000
    const futEnd = NOW + 3 * 3600_000

    const model = buildTaskDetailStatsModel({
      taskId: 't1',
      estimateMinutes: 90,
      scheduleBlocks: [
        focusBlock({ id: 'hist', taskId: 't1', startAtMs: pastStart, endAtMs: pastEnd, status: 'completed' }),
        focusBlock({ id: 'cur', taskId: 't1', startAtMs: curStart, endAtMs: curEnd, status: 'running' }),
        focusBlock({ id: 'fut', taskId: 't1', startAtMs: futStart, endAtMs: futEnd }),
        focusBlock({
          id: 'other',
          taskId: 't2',
          startAtMs: futStart,
          endAtMs: futEnd
        })
      ],
      timerSessions: [
        session({ id: 's1', taskId: 't1', accumulatedFocusSeconds: 1800 }),
        session({ id: 's2', taskId: 't1', phase: 'short_break', accumulatedFocusSeconds: 0, accumulatedActiveSeconds: 300 }),
        session({ id: 's3', taskId: 't2', accumulatedFocusSeconds: 9999 })
      ],
      nowMs: NOW
    })

    expect(model.estimateMinutes).toBe(90)
    expect(model.historyBlocks.map((b) => b.blockId)).toEqual(['hist'])
    expect(model.currentBlocks.map((b) => b.blockId)).toEqual(['cur'])
    expect(model.futureBlocks.map((b) => b.blockId)).toEqual(['fut'])
    expect(model.actualFocusMinutes).toBe(30)
    expect(model.focusBlockCount).toBe(3)
  })

  it('puts cancelled blocks into history for review and excludes them from focus count', () => {
    const model = buildTaskDetailStatsModel({
      taskId: 't1',
      scheduleBlocks: [
        focusBlock({
          id: 'c1',
          taskId: 't1',
          startAtMs: NOW + 3600_000,
          endAtMs: NOW + 7200_000,
          status: 'cancelled'
        })
      ],
      nowMs: NOW
    })
    expect(model.futureBlocks).toHaveLength(0)
    expect(model.historyBlocks).toHaveLength(1)
    expect(model.historyBlocks[0]?.status).toBe('cancelled')
    expect(model.focusBlockCount).toBe(0)
    expect(model.plannedFocusMinutes).toBe(0)
  })

  it('normalizes estimate input without inventing defaults', () => {
    expect(normalizeEstimateMinutesInput('')).toBeNull()
    expect(normalizeEstimateMinutesInput('  ')).toBeNull()
    expect(normalizeEstimateMinutesInput(null)).toBeNull()
    expect(normalizeEstimateMinutesInput('45')).toBe(45)
    expect(normalizeEstimateMinutesInput(45.9)).toBe(45)
    expect(normalizeEstimateMinutesInput(-3)).toBe(0)
    expect(normalizeEstimateMinutesInput(9999)).toBe(24 * 60)
  })

  it('formats detail minutes compactly', () => {
    expect(formatDetailMinutes(null)).toBe('—')
    expect(formatDetailMinutes(45)).toBe('45m')
    expect(formatDetailMinutes(60)).toBe('1h')
    expect(formatDetailMinutes(90)).toBe('1h30m')
  })

  it('dual-write payload includes estimateMinutes and can be estimate-only', () => {
    expect(
      buildUpdateTaskPayloadFromV1('t1', { estimateMinutes: 50 })
    ).toEqual({ id: 't1', estimateMinutes: 50 })
    expect(
      buildUpdateTaskPayloadFromV1('t1', { estimateMinutes: null })
    ).toEqual({ id: 't1', estimateMinutes: null })
    expect(buildUpdateTaskPayloadFromV1('t1', {})).toBeNull()
  })
})
