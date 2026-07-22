/**
 * IMPL-Z + IMPL-AK: §18 product-path honesty suite.
 *
 * IMPL-Z: bullets 1–7 product-path freeze.
 * IMPL-AK: bullets 8–9 honesty freeze (Wave7–10 thrash/demote/kill-9 evidence).
 *
 * Inventory + assertions for landed product-path behaviors without claiming
 * full §18 close (ADR-0130 §5). Overall residual remains **not_satisfied**.
 *
 * Evidence style:
 * - #1–7: deterministic product-path composition of pure + presentation helpers
 * - #8–9: importable pure/unit contracts + **file path anchors** for e2e evidence
 *   already landed (AE/AF/W/AA). Does **not** invent multi-window product UI.
 *
 * Bullet map (honest residual):
 * 1 terminology partial — task-detail + empty-start + active-vs-next copy
 *    (allocation proposal product removed 2026-07-22)
 * 2 09:00–12:00 partial (weaker after product removal) — morning TimeWindow template
 *    remains; allocateTimeWindow / confirm-gated allocation preview product path removed
 * 3 timer recovery partial — countup/countdown start + pause/resume planSnapshot freeze
 * 4 empty-start partial — ask_every_time + never silent first-open bind
 * 5 multi-block partial (stronger) — 1 Task : N blocks + planned vs actual
 * 6 classification partial (stronger) — classify / skip / never / restore prefs
 * 7 plan edit freeze partial (stronger) — planSnapshot frozen; catalog edit ≠ active
 * 8 sleep/crash/thrash open/improved partial — recovery matrix + thrash CAS pure + e2e path anchors
 * 9 V1 demote partial (closer) — demote pure + cold-start non-resurrection + e2e path anchors; auto ≥30d banned
 *
 * Does NOT claim §18 product complete. Does NOT flip any bullet to satisfied.
 */

import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TIME_WINDOW_TEMPLATES,
  StudyPlanningStore,
  applyClassificationAction,
  buildClassificationPromptSheetModel,
  buildEmptyStartSheetModel,
  createClassicPomodoroPlan,
  createContinuousCountupPlan,
  materializeTimeWindowTemplate,
  pauseTimerSession,
  projectActiveVsNextTimerPlan,
  resolveEmptyStart,
  resolveFocusStartAttribution,
  resumeTimerSession,
  shouldShowClassificationPrompt,
  startTimerSession,
  type ScheduleBlock,
  type TimerSessionRecord
} from '../../src/shared/study-planning'
import {
  buildActiveVsNextPlanUiModel
} from '../../src/renderer/src/study-space/planning-active-vs-next-plan-ui'
import {
  listTaskBlockEditorRows
} from '../../src/renderer/src/study-space/planning-multi-block-editor'
import {
  buildTaskDetailStatsModel
} from '../../src/renderer/src/study-space/planning-task-detail-stats'
import {
  buildStudyPlanningPrefsModel,
  projectClassificationPromptOptOutFromPreferences
} from '../../src/renderer/src/study-space/planning-study-prefs-ui'
import { mapSystemPowerToTimerWakeSignal } from '../../src/renderer/src/study-space/planning-timer-os-power'
import {
  projectRehydrateActiveTimerSession,
  projectTimerSessionAfterWake,
  shouldHandleTimerWakeSignal
} from '../../src/renderer/src/study-space/planning-timer-sleep-hooks'
import { buildAdvanceTimerSessionCommand } from '../../src/renderer/src/study-space/planning-timer-dual-write'
import {
  STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
  canExecuteV1Demote,
  canOfferV1Demote,
  demoteV1LocalStorageKeys,
  isV1LocalAuthorityDemoted,
  shouldHydrateTasksFromV1Cache,
  shouldPersistV1TaskAuthority,
  shouldReseedV1TasksFromDefaults,
  stripTaskAuthorityFromSnapshot,
  writeV1LocalAuthorityDemotedMarker
} from '../../src/renderer/src/study-space/planning-v1-authority-demote'
import { STUDY_SPACE_STORAGE_KEY } from '../../src/renderer/src/study-space/constants'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

const DAY_LOCAL = new Date(2026, 6, 21, 0, 0, 0, 0).getTime()
const t0 = Date.UTC(2026, 6, 21, 1, 0, 0) // stable wall for timer math

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

function finishedFocusSession(input: {
  id: string
  taskId: string
  focusSeconds: number
  startedAtMs: number
}): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({
    id: input.id,
    nowMs: input.startedAtMs,
    plan,
    taskId: input.taskId
  })
  if (!started.session) throw new Error('expected session')
  return {
    ...started.session,
    state: 'completed',
    endedAtMs: input.startedAtMs + input.focusSeconds * 1000,
    accumulatedActiveSeconds: input.focusSeconds,
    accumulatedFocusSeconds: input.focusSeconds,
    lastSampleWallMs: input.startedAtMs + input.focusSeconds * 1000
  }
}

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    }
  }
}

function presenceSnapshot(): StudySnapshot {
  return {
    clientId: 'studiumx-s18-client',
    nickname: 'S18',
    spaceCode: 'PUBLIC',
    presenceRelayUrl: 'wss://example.test/mqtt',
    signalId: 'reading',
    modeId: 'free',
    contractText: '',
    contractLocked: false,
    roomId: 'silent',
    seatIndex: 1,
    seatClaimedAt: 1,
    timerMode: 'focus',
    timerState: 'idle',
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '09:00',
    simulationEndTime: '12:00',
    timerPlans: [],
    remainingSeconds: 1500,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: '',
    tasks: [{ id: 't-v1', title: 'V1 task', done: false, categoryId: 'study' }]
  }
}
// ---------------------------------------------------------------------------
// Bullet 1 — terminology (task / block / plan / actual)
// ---------------------------------------------------------------------------
describe('§18 #1 product-path: terminology surfaces (partial)', () => {
  it('empty-start / active-vs-next / task-detail expose distinct labels (allocation product removed)', () => {
    const empty = buildEmptyStartSheetModel({
      openTasks: [{ id: 't1', title: '线性代数' }],
      now: new Date(2026, 6, 21, 9, 0, 0)
    })
    expect(empty.copy.title).toMatch(/任务/)
    expect(empty.copy.description).toMatch(/不会静默绑定/)
    expect(empty.copy.unattributedLabel).toMatch(/无任务/)

    const plan = createClassicPomodoroPlan()
    const session = startTimerSession({
      id: 's-term',
      nowMs: t0,
      plan: createClassicPomodoroPlan({ focusMinutes: 25 }),
      taskId: 't1'
    }).session!
    const activeVsNext = buildActiveVsNextPlanUiModel({
      activeSession: session,
      nextPlanId: plan.id,
      userPlans: [
        {
          id: plan.id,
          name: plan.name,
          focusMinutes: 50,
          breakMinutes: 10,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00'
        }
      ]
    })
    expect(activeVsNext.copy.activeLabel).toMatch(/会话|快照/)
    expect(activeVsNext.copy.nextLabel).toMatch(/下一段|方案/)
    expect(activeVsNext.copy.divergesHint).toMatch(/冻结|下一段/)

    const stats = buildTaskDetailStatsModel({
      taskId: 't1',
      scheduleBlocks: [
        focusBlock({
          id: 'b1',
          taskId: 't1',
          startAtMs: DAY_LOCAL + 9 * 60 * 60_000,
          endAtMs: DAY_LOCAL + 10 * 60 * 60_000
        })
      ],
      timerSessions: [],
      nowMs: DAY_LOCAL + 8 * 60 * 60_000
    })
    expect(stats.copy.plannedLabel).toBe('计划专注')
    expect(stats.copy.actualLabel).toBe('实际专注')
    expect(stats.copy.futureHeading).toBe('未来时间块')

    // Residual honesty: these surfaces exist; full product teaching UX still partial.
    expect(true).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bullet 2 — 09:00–12:00 explainable / confirmable arrangement
// Product decision 2026-07-22: allocateTimeWindow + confirm-gated allocation
// proposal preview product path **removed**. Residual: TimeWindow templates only.
// ---------------------------------------------------------------------------
describe('§18 #2 product-path: 09:00–12:00 (partial, weaker — allocation product removed)', () => {
  it('morning TimeWindow template still materializes 09:00–12:00 window (no auto-allocate)', () => {
    const morning = BUILTIN_TIME_WINDOW_TEMPLATES.find((t) => t.id === 'morning_0900_1200')
    expect(morning).toBeDefined()
    expect(morning!.startMinutes).toBe(9 * 60)
    expect(morning!.endMinutes).toBe(12 * 60)

    const material = materializeTimeWindowTemplate({
      template: morning!,
      dayEpochMs: DAY_LOCAL
    })
    expect(material.label).toMatch(/09:00|上午/)
    expect(material.endAtMs - material.startAtMs).toBe(3 * 60 * 60_000)
    expect(material.hardEnd).toBe(true)

    // Residual honesty: templates are NOT an allocation proposal product.
    // Manual schedule blocks + timer plans remain; no allocateTimeWindow path.
    expect(true).toBe(true)
  })

  it('documents product removal of allocate-from-plan path (not satisfied)', () => {
    const productPath: 'removed_2026_07_22' = 'removed_2026_07_22'
    expect(productPath).toBe('removed_2026_07_22')
    const bullet2Status: 'partial_weaker' = 'partial_weaker'
    expect(bullet2Status).not.toBe('satisfied' as typeof bullet2Status)
  })
})

// ---------------------------------------------------------------------------
// Bullet 3 — countup / countdown / continuous recoverability (product-path partial)
// ---------------------------------------------------------------------------
describe('§18 #3 product-path: timer modes + planSnapshot continuity (partial)', () => {
  it('pomodoro countdown starts with frozen planSnapshot and survives pause/resume', () => {
    const plan = createClassicPomodoroPlan({ focusMinutes: 25 })
    const started = startTimerSession({
      id: 's-cd',
      nowMs: t0,
      plan,
      taskId: 't1'
    })
    expect(started.session).not.toBeNull()
    expect(started.session!.clockMode).toBe('countdown')
    expect(started.session!.targetSeconds).toBe(25 * 60)
    expect(started.session!.planSnapshot?.id).toBe(plan.id)
    expect(started.session!.planSnapshot?.focusMinutes).toBe(25)

    // Mutate catalog-shaped input after start — snapshot must stay independent clone.
    plan.focusMinutes = 99
    expect(started.session!.planSnapshot?.focusMinutes).toBe(25)

    const paused = pauseTimerSession(started.session!, t0 + 60_000)
    expect(paused.session!.state).toBe('paused')
    expect(paused.session!.planSnapshot?.focusMinutes).toBe(25)

    const resumed = resumeTimerSession(paused.session!, t0 + 120_000)
    expect(resumed.session!.state).toBe('running')
    expect(resumed.session!.planSnapshot?.focusMinutes).toBe(25)
  })

  it('continuous open countup starts with null target and frozen continuous plan', () => {
    const plan = createContinuousCountupPlan()
    expect(plan.kind).toBe('continuous')
    expect(plan.clockMode).toBe('countup')
    const started = startTimerSession({
      id: 's-cu',
      nowMs: t0,
      plan,
      taskId: null,
      attributionReason: 'unattributed'
    })
    expect(started.session).not.toBeNull()
    expect(started.session!.clockMode).toBe('countup')
    expect(started.session!.targetSeconds).toBeNull()
    expect(started.session!.planSnapshot?.kind).toBe('continuous')
    expect(started.session!.attributionReason).toBe('unattributed')
  })

  it('continuous countdown target freezes focusMinutes into targetSeconds', () => {
    const plan = createContinuousCountupPlan({
      clockMode: 'countdown',
      focusMinutes: 45
    })
    const started = startTimerSession({
      id: 's-cc',
      nowMs: t0,
      plan,
      taskId: 't2'
    })
    expect(started.session!.clockMode).toBe('countdown')
    expect(started.session!.targetSeconds).toBe(45 * 60)
    expect(started.session!.planSnapshot?.focusMinutes).toBe(45)
  })
})
// ---------------------------------------------------------------------------
// Bullet 4 — empty-start no surprise attribution
// ---------------------------------------------------------------------------
describe('§18 #4 product-path: empty-start no silent first-open bind (partial)', () => {
  it('ask_every_time without choice → ask; never auto-picks first open task', () => {
    const res = resolveEmptyStart({ policy: 'ask_every_time' })
    expect(res).toEqual({ action: 'ask', policy: 'ask_every_time' })

    const pickMissing = resolveEmptyStart({
      policy: 'ask_every_time',
      userChoice: 'pick_task'
    })
    expect(pickMissing).toEqual({ action: 'ask', policy: 'ask_every_time' })

    const pickOk = resolveEmptyStart({
      policy: 'ask_every_time',
      userChoice: 'pick_task',
      selectedTaskId: 't-explicit'
    })
    expect(pickOk).toEqual({ action: 'pick_task', taskId: 't-explicit' })
  })

  it('resolveFocusStartAttribution never binds first open id without explicit selection', () => {
    const open = ['open-a', 'open-b']
    expect(
      resolveFocusStartAttribution({
        openTaskIds: open,
        emptyStartPolicy: 'ask_every_time'
      })
    ).toEqual({ kind: 'ask', policy: 'ask_every_time' })

    expect(
      resolveFocusStartAttribution({
        openTaskIds: open,
        emptyStartPolicy: 'ask_every_time',
        explicitTaskId: 'open-b'
      })
    ).toEqual({ kind: 'task', taskId: 'open-b' })

    expect(
      resolveFocusStartAttribution({
        openTaskIds: open,
        emptyStartPolicy: 'ask_every_time',
        userChoice: 'unattributed'
      })
    ).toEqual({ kind: 'unattributed' })

    expect(
      resolveFocusStartAttribution({
        openTaskIds: open,
        emptyStartPolicy: 'ask_every_time',
        userChoice: 'quick_start'
      })
    ).toEqual({ kind: 'quick_start' })
  })

  it('empty-start sheet does not invent first-open binding copy', () => {
    const model = buildEmptyStartSheetModel({
      openTasks: [
        { id: 'a', title: '第一' },
        { id: 'b', title: '第二' }
      ]
    })
    expect(model.recommended).toBe('pick_task')
    expect(model.options).toContain('pick_task')
    expect(model.options).toContain('unattributed')
    expect(model.copy.description).toMatch(/不会静默绑定/)
  })
})

// ---------------------------------------------------------------------------
// Bullet 5 — multi-block + plan vs actual
// ---------------------------------------------------------------------------
describe('§18 #5 product-path: multi-block + planned vs actual (partial, stronger)', () => {
  it('one task can own multiple focus blocks; editor lists all without cloning task', () => {
    const blocks: ScheduleBlock[] = [
      focusBlock({
        id: 'b-mon',
        taskId: 't1',
        startAtMs: DAY_LOCAL + 9 * 60 * 60_000,
        endAtMs: DAY_LOCAL + 10 * 60 * 60_000
      }),
      focusBlock({
        id: 'b-tue',
        taskId: 't1',
        startAtMs: DAY_LOCAL + 24 * 60 * 60_000 + 14 * 60 * 60_000,
        endAtMs: DAY_LOCAL + 24 * 60 * 60_000 + 15 * 60 * 60_000
      }),
      focusBlock({
        id: 'b-other',
        taskId: 't2',
        startAtMs: DAY_LOCAL + 11 * 60 * 60_000,
        endAtMs: DAY_LOCAL + 12 * 60 * 60_000
      })
    ]
    const rows = listTaskBlockEditorRows({
      taskId: 't1',
      scheduleBlocks: blocks,
      nowMs: DAY_LOCAL
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.blockId).sort()).toEqual(['b-mon', 'b-tue'])
    // Primary is one of them; no second Task invented.
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1)
  })

  it('task-detail planned minutes from blocks; actual from TimerSession only', () => {
    const blocks: ScheduleBlock[] = [
      focusBlock({
        id: 'b1',
        taskId: 't1',
        startAtMs: DAY_LOCAL + 9 * 60 * 60_000,
        endAtMs: DAY_LOCAL + 10 * 60 * 60_000 // 60m planned
      }),
      focusBlock({
        id: 'b2',
        taskId: 't1',
        startAtMs: DAY_LOCAL + 14 * 60 * 60_000,
        endAtMs: DAY_LOCAL + 14 * 60 * 60_000 + 30 * 60_000 // 30m planned
      })
    ]
    const sessions = [
      finishedFocusSession({
        id: 'ts1',
        taskId: 't1',
        focusSeconds: 40 * 60,
        startedAtMs: DAY_LOCAL + 9 * 60 * 60_000
      })
    ]
    const stats = buildTaskDetailStatsModel({
      taskId: 't1',
      scheduleBlocks: blocks,
      timerSessions: sessions,
      estimateMinutes: null, // freeze #8: never invent
      nowMs: DAY_LOCAL + 8 * 60 * 60_000
    })
    expect(stats.plannedFocusMinutes).toBe(90)
    expect(stats.actualFocusMinutes).toBe(40)
    expect(stats.focusBlockCount).toBe(2)
    expect(stats.estimateMinutes).toBeNull()
    expect(stats.copy.plannedLabel).toBe('计划专注')
    expect(stats.copy.actualLabel).toBe('实际专注')
  })
})

// ---------------------------------------------------------------------------
// Bullet 6 — classification skip / never / restore
// ---------------------------------------------------------------------------
describe('§18 #6 product-path: classification classify/skip/never/restore (partial, stronger)', () => {
  it('prompt shows only for completed inbox when not opted out', () => {
    expect(
      shouldShowClassificationPrompt({
        taskInbox: true,
        taskStatus: 'done',
        classificationPromptOptOut: false
      })
    ).toEqual({ showPrompt: true, reason: 'inbox_task_completed' })

    expect(
      shouldShowClassificationPrompt({
        taskInbox: true,
        taskStatus: 'done',
        classificationPromptOptOut: true
      }).showPrompt
    ).toBe(false)

    expect(
      shouldShowClassificationPrompt({
        taskInbox: false,
        taskStatus: 'done',
        classificationPromptOptOut: false
      }).showPrompt
    ).toBe(false)
  })

  it('sheet options include classify / keep / later / never; dismiss does not rollback', () => {
    const model = buildClassificationPromptSheetModel({
      taskId: 't1',
      taskTitle: '论文',
      categories: [{ id: 'study', name: '学习' }]
    })
    expect(model.options).toEqual(['classify', 'keep_inbox', 'later', 'never_prompt'])
    expect(model.copy.description).toMatch(/关闭不会撤销完成/)

    const later = applyClassificationAction({
      categoryId: null,
      inbox: true,
      action: 'later',
      preferences: { classificationPromptOptOut: false }
    })
    expect(later.inbox).toBe(true)
    expect(later.categoryId).toBeNull()
    expect(later.preferences.classificationPromptOptOut).toBe(false)

    const keep = applyClassificationAction({
      categoryId: null,
      inbox: true,
      action: 'keep_inbox',
      preferences: { classificationPromptOptOut: false }
    })
    expect(keep.inbox).toBe(true)

    const never = applyClassificationAction({
      categoryId: null,
      inbox: true,
      action: 'never_prompt',
      preferences: { classificationPromptOptOut: false }
    })
    expect(never.preferences.classificationPromptOptOut).toBe(true)
    expect(never.inbox).toBe(true) // still inbox; complete not rolled back

    const classified = applyClassificationAction({
      categoryId: null,
      inbox: true,
      action: 'classify',
      selectedCategoryId: 'study',
      preferences: { classificationPromptOptOut: false }
    })
    expect(classified.categoryId).toBe('study')
    expect(classified.inbox).toBe(false)
  })

  it('prefs model can restore never-prompt opt-out (sole-read projection)', () => {
    expect(projectClassificationPromptOptOutFromPreferences({ classificationPromptOptOut: true })).toBe(
      true
    )
    expect(projectClassificationPromptOptOutFromPreferences({ classificationPromptOptOut: false })).toBe(
      false
    )
    expect(projectClassificationPromptOptOutFromPreferences({})).toBe(false)

    const restored = buildStudyPlanningPrefsModel({
      emptyStartPolicy: 'ask_every_time',
      classificationPromptOptOut: false
    })
    expect(restored.classificationPromptOptOut).toBe(false)
    expect(restored.copy.classificationOptOutDetail).toMatch(/取消勾选即可恢复/)
  })
})

// ---------------------------------------------------------------------------
// Bullet 7 — plan edit does not rewrite active/history planSnapshot
// ---------------------------------------------------------------------------
describe('§18 #7 product-path: plan edit does not rewrite active session (partial, stronger)', () => {
  it('active planSnapshot stays frozen when next catalog diverges', () => {
    const frozen = createClassicPomodoroPlan({ focusMinutes: 25, revision: 1 })
    const session = startTimerSession({
      id: 's-freeze',
      nowMs: t0,
      plan: frozen,
      taskId: 't1'
    }).session!

    // Catalog "edited" to 50m / new revision for same id.
    const catalogEdited = createClassicPomodoroPlan({
      focusMinutes: 50,
      revision: 2,
      breakPolicy: 'automatic'
    })
    const projection = projectActiveVsNextTimerPlan({
      activeSession: session,
      nextPlanId: frozen.id,
      catalog: [catalogEdited]
    })
    expect(projection.activeSnapshot?.focusMinutes).toBe(25)
    expect(projection.activeSnapshot?.revision).toBe(1)
    expect(projection.nextPlan?.focusMinutes).toBe(50)
    expect(projection.diverges).toBe(true)

    const ui = buildActiveVsNextPlanUiModel({
      activeSession: session,
      nextPlanId: frozen.id,
      userPlans: [
        {
          id: frozen.id,
          name: frozen.name,
          focusMinutes: 50,
          breakMinutes: 10,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00',
          breakPolicy: 'automatic'
        }
      ]
    })
    expect(ui.diverges).toBe(true)
    expect(ui.active?.focusMinutes).toBe(25)
    expect(ui.copy.divergesHint).toMatch(/冻结|下一段/)
  })

  it('history TimerSession planSnapshot is immutable after finish (product path)', () => {
    const plan = createClassicPomodoroPlan({ focusMinutes: 25, revision: 3 })
    const started = startTimerSession({
      id: 'hist-1',
      nowMs: t0,
      plan,
      taskId: 't1'
    }).session!
    const history: TimerSessionRecord = {
      ...started,
      state: 'completed',
      endedAtMs: t0 + 25 * 60_000,
      accumulatedFocusSeconds: 25 * 60,
      accumulatedActiveSeconds: 25 * 60
    }
    const snapBefore = { ...history.planSnapshot! }
    // "Edit catalog" must not touch history object identity fields used for review.
    plan.focusMinutes = 99
    plan.revision = 99
    expect(history.planSnapshot?.focusMinutes).toBe(snapBefore.focusMinutes)
    expect(history.planSnapshot?.revision).toBe(snapBefore.revision)
    expect(history.state).toBe('completed')
  })
})
// ---------------------------------------------------------------------------
// Bullet 8 — sleep / crash / thrash (open / improved partial) — IMPL-AK honesty
// ---------------------------------------------------------------------------
describe('§18 #8 product-path: recovery + thrash CAS pure contracts (open / improved partial)', () => {
  it('power suspend/resume maps to pagehide pin + visibility_resume (kill-9 recovery unit anchor)', () => {
    const pin = mapSystemPowerToTimerWakeSignal({ kind: 'suspend', atMs: t0 + 500 })
    expect(pin).toEqual({ kind: 'pagehide', nowMs: t0 + 500 })
    expect(shouldHandleTimerWakeSignal(pin!)).toBe(true)

    const resume = mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs: t0 + 30_000 })
    expect(resume).toEqual({
      kind: 'visibility_resume',
      nowMs: t0 + 30_000,
      visibilityState: 'visible'
    })
    expect(shouldHandleTimerWakeSignal(resume!)).toBe(true)
  })

  it('cold reattach fail-closed when no open pin / no durable session (kill-9 recovery pure)', () => {
    const empty = projectRehydrateActiveTimerSession({
      timerSessions: [],
      nowMs: t0
    })
    expect(empty.kind).toBe('none')

    const completedOnly = projectRehydrateActiveTimerSession({
      timerSessions: [
        finishedFocusSession({
          id: 'done-only',
          taskId: 't1',
          focusSeconds: 60,
          startedAtMs: t0 - 120_000
        })
      ],
      nowMs: t0
    })
    expect(completedOnly.kind).toBe('none')
  })

  it('wake after long gap projects needs_reconcile without inventing finish', () => {
    const started = startTimerSession({
      id: 's-gap',
      nowMs: t0,
      plan: createClassicPomodoroPlan({ focusMinutes: 25 }),
      taskId: 't1'
    })
    expect(started.session).toBeTruthy()
    if (!started.session) return
    // Pin a short sample, then wake after ≥120min wall gap (staleGap default).
    const stale: TimerSessionRecord = {
      ...started.session,
      state: 'running',
      lastSampleWallMs: t0,
      accumulatedFocusSeconds: 10
    }
    const wake = projectTimerSessionAfterWake({
      session: stale,
      signal: { kind: 'visibility_resume', nowMs: t0 + 130 * 60_000, visibilityState: 'visible' }
    })
    expect(wake.type).toBe('advance_ok')
    if (wake.type !== 'advance_ok') return
    expect(wake.needsReconcile).toBe(true)
    expect(wake.session.state).toBe('needs_reconcile')
    expect(wake.completed).toBe(false)
    // No silent multi-hour focus credit — frozen at last sample (or zero if seed rules wipe).
    expect(wake.session.accumulatedFocusSeconds).toBeLessThanOrEqual(10)
    expect(wake.session.state).not.toBe('completed')
  })

  it('thrash CAS pure: same expectedRevision → one ok / one revision_conflict; retry with fresh rev ok', () => {
    let clock = t0
    const store = new StudyPlanningStore({ nowMs: () => clock })
    const rev0 = store.readSnapshot().revision

    const start = store.applyCommand(
      {
        actionId: 's18-start-1',
        type: 'start_timer_session',
        payload: {
          id: 'ts-s18-1',
          planId: 'classic_25_5',
          taskId: 'task-s18',
          targetSeconds: 25 * 60,
          phase: 'focus'
        },
        clientIssuedAtMs: clock
      },
      rev0
    )
    expect(start.ok).toBe(true)
    if (!start.ok) return
    const revAfterStart = start.revision

    clock = t0 + 30_000
    const pinA = store.applyCommand(
      buildAdvanceTimerSessionCommand('ts-s18-1', 's18-pin-a', clock, clock),
      revAfterStart
    )
    expect(pinA.ok).toBe(true)
    if (!pinA.ok) return
    const revAfterPinA = pinA.revision

    // Stale concurrent writer (thrash Path A pure contract)
    clock = t0 + 31_000
    const pinB = store.applyCommand(
      buildAdvanceTimerSessionCommand('ts-s18-1', 's18-pin-b', clock, clock),
      revAfterStart
    )
    expect(pinB.ok).toBe(false)
    if (pinB.ok) return
    expect(pinB.error.code).toBe('revision_conflict')
    expect(pinB.revision).toBe(revAfterPinA)

    const pinBRetry = store.applyCommand(
      buildAdvanceTimerSessionCommand('ts-s18-1', 's18-pin-b-retry', clock + 1, clock + 1),
      revAfterPinA
    )
    expect(pinBRetry.ok).toBe(true)
  })

  it('documents e2e path anchors for kill-9 / thrash without inventing dual-window product surface', () => {
    // File path anchors only — evidence landed by IMPL-W / AA / AE / Q (not re-executed here).
    const anchors = {
      recoveryUnit: 'tests/unit/study-planning-timer-recovery-matrix.unit.test.ts',
      recoveryProductPath: 'tests/unit/study-planning-timer-recovery-product-path.unit.test.ts',
      kill9E2e: 'tests/e2e/study-planning-timer-recovery.e2e.spec.ts',
      thrashPathA: 'tests/e2e/study-planning-timer-thrash.e2e.spec.ts',
      thrashPathB: 'tests/e2e/study-planning-timer-thrash-dual-process.e2e.spec.ts',
      dualWindowProductSurface: 'N/A' as const
    }
    expect(anchors.kill9E2e).toMatch(/timer-recovery\.e2e/)
    expect(anchors.thrashPathA).toMatch(/timer-thrash\.e2e/)
    expect(anchors.thrashPathB).toMatch(/dual-process/)
    expect(anchors.dualWindowProductSurface).toBe('N/A')
    // Honesty: thrash pack ≠ bullet 8 full close; dual-window product surface does not exist.
    const bullet8Status: 'open_improved_partial' = 'open_improved_partial'
    expect(bullet8Status).not.toBe('satisfied' as typeof bullet8Status)
  })
})

// ---------------------------------------------------------------------------
// Bullet 9 — V1 demote / cold-start non-resurrection (partial closer) — IMPL-AK
// ---------------------------------------------------------------------------
describe('§18 #9 product-path: demote pure + cold-start non-resurrection (partial closer)', () => {
  it('execute demote requires confirm + backup; defaults never silent erase', () => {
    expect(
      canExecuteV1Demote({
        alreadyDemoted: false,
        userConfirmed: false,
        lastBackupExportOk: true
      })
    ).toBe(false)
    expect(
      canExecuteV1Demote({
        alreadyDemoted: false,
        userConfirmed: true,
        lastBackupExportOk: false
      })
    ).toBe(false)
    expect(
      canExecuteV1Demote({
        alreadyDemoted: false,
        userConfirmed: true,
        lastBackupExportOk: true
      })
    ).toBe(true)
    expect(
      canExecuteV1Demote({
        alreadyDemoted: true,
        userConfirmed: true,
        lastBackupExportOk: true
      })
    ).toBe(false)

    const store = memoryStorage({
      [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(presenceSnapshot())
    })
    const refused = demoteV1LocalStorageKeys({
      eraseTasks: true,
      backupExportOk: true,
      storage: store
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.code).toBe('confirm_required')
    expect(JSON.parse(store.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(1)
  })

  it('after confirm+backup: presence-only shell + demote marker; strip task authority', () => {
    const source = presenceSnapshot()
    const store = memoryStorage({
      [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(source)
    })
    const ok = demoteV1LocalStorageKeys({
      eraseTasks: true,
      userConfirmed: true,
      backupExportOk: true,
      presenceSource: source,
      storage: store,
      nowMs: t0
    })
    expect(ok.ok).toBe(true)
    expect(isV1LocalAuthorityDemoted(store)).toBe(true)
    expect(store.getItem(STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY)).toBeTruthy()
    const shell = JSON.parse(store.getItem(STUDY_SPACE_STORAGE_KEY)!)
    expect(shell.tasks).toEqual([])
    expect(shell.timerPlans).toEqual([])
    expect(shell.nickname).toBe('S18')

    const stripped = stripTaskAuthorityFromSnapshot(source)
    expect(stripped.tasks).toEqual([])
    expect(stripped.timerPlans).toEqual([])
    expect(stripped.nickname).toBe(source.nickname)
  })

  it('cold-start non-resurrection gates: demoted blocks reseed / co-persist / V1 hydrate', () => {
    expect(shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: true })).toBe(false)
    expect(shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: false })).toBe(false)
    expect(shouldReseedV1TasksFromDefaults({ demoted: true })).toBe(false)
    expect(
      shouldHydrateTasksFromV1Cache({ demoted: true, workspaceAvailable: true })
    ).toBe(false)
    expect(
      canOfferV1Demote({
        alreadyDemoted: true,
        workspaceAvailable: true,
        migrationCommitted: true,
        hydrateApplied: true,
        canonicalTaskCount: 3
      })
    ).toBe(false)
  })

  it('auto ≥30d silent wipe remains banned (stale marker alone does not erase)', () => {
    const store = memoryStorage({
      [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(presenceSnapshot())
    })
    // Marker older than 30d — product must still require confirm+backup to erase.
    writeV1LocalAuthorityDemotedMarker(t0 - 40 * 24 * 60 * 60 * 1000, store)
    expect(isV1LocalAuthorityDemoted(store)).toBe(true)
    expect(JSON.parse(store.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(1)

    const refused = demoteV1LocalStorageKeys({
      eraseTasks: true,
      backupExportOk: true,
      storage: store
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.code).toBe('confirm_required')
    expect(JSON.parse(store.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(1)
  })

  it('documents e2e path anchors for demote UX + cold-start; #9 not satisfied', () => {
    const anchors = {
      demoteUnit: 'tests/unit/study-planning-v1-authority-demote.unit.test.ts',
      coldStartUnit: 'tests/unit/study-planning-v1-authority-cold-start.unit.test.ts',
      coldStartProductPath:
        'tests/unit/study-planning-v1-authority-cold-start-product-path.unit.test.ts',
      coldStartE2e: 'tests/e2e/study-planning-v1-cold-start.e2e.spec.ts',
      demoteUxE2e: 'tests/e2e/study-planning-v1-demote-ux.e2e.spec.ts',
      auto30dWipe: 'banned' as const
    }
    expect(anchors.demoteUxE2e).toMatch(/v1-demote-ux\.e2e/)
    expect(anchors.coldStartE2e).toMatch(/v1-cold-start\.e2e/)
    expect(anchors.auto30dWipe).toBe('banned')
    const bullet9Status: 'partial_closer' = 'partial_closer'
    expect(bullet9Status).not.toBe('satisfied' as typeof bullet9Status)
  })
})

// ---------------------------------------------------------------------------
// Honesty gate — suite documents residual, never claims §18 closed
// ---------------------------------------------------------------------------
describe('§18 bullets 1–7 honesty gate (IMPL-Z)', () => {
  it('documents residual status: all 1–7 remain partial; overall not satisfied', () => {
    const residual: Array<{ bullet: number; status: 'partial' | 'partial_stronger'; note: string }> = [
      {
        bullet: 1,
        status: 'partial',
        note: 'Terminology copy present across empty-start/active-vs-next/task-detail; allocation proposal product removed 2026-07-22; full teaching UX residual'
      },
      {
        bullet: 2,
        status: 'partial',
        note: '09:00–12:00 TimeWindow template remains; allocateTimeWindow + confirm-gated allocation preview product path removed 2026-07-22; manual schedule residual; not satisfied'
      },
      {
        bullet: 3,
        status: 'partial',
        note: 'countup/countdown/continuous start + planSnapshot freeze; full sleep/crash e2e is bullet 8 residual'
      },
      {
        bullet: 4,
        status: 'partial',
        note: 'empty-start ask + no silent first-open; V1 path anti-regression residual remains'
      },
      {
        bullet: 5,
        status: 'partial_stronger',
        note: 'multi-block editor + planned/actual stats; V1 shell coexistence residual'
      },
      {
        bullet: 6,
        status: 'partial_stronger',
        note: 'classify/skip/never/restore prefs path; product polish residual'
      },
      {
        bullet: 7,
        status: 'partial_stronger',
        note: 'planSnapshot freeze + active-vs-next diverge; invariant tests must stay green'
      }
    ]
    expect(residual).toHaveLength(7)
    expect(residual.every((r) => r.status === 'partial' || r.status === 'partial_stronger')).toBe(true)
    // Explicit non-claim: none are "satisfied".
    expect(residual.some((r) => (r as { status: string }).status === 'satisfied')).toBe(false)
    const overall: 'not_satisfied' = 'not_satisfied'
    expect(overall).toBe('not_satisfied')
  })
})

describe('§18 bullets 8–9 + overall honesty gate (IMPL-AK)', () => {
  it('documents residual status: #8 open/improved partial, #9 partial closer; none satisfied; overall not_satisfied', () => {
    const residual: Array<{
      bullet: number
      status: 'open_improved_partial' | 'partial_closer' | 'partial' | 'partial_stronger'
      note: string
    }> = [
      {
        bullet: 8,
        status: 'open_improved_partial',
        note:
          'recovery matrix unit + thrash CAS pure + kill-9 e2e + Path A thrash + Path B dual-process thrash e2e landed; dual-window product surface N/A; ≠ bullet 8 full close'
      },
      {
        bullet: 9,
        status: 'partial_closer',
        note:
          'demote pure + cold-start non-resurrection + cold-start e2e + demote UX click-path e2e landed; auto ≥30d wipe banned; ≠ sole-authority end-state / §18'
      }
    ]
    expect(residual).toHaveLength(2)
    expect(residual.every((r) => r.status !== ('satisfied' as typeof r.status))).toBe(true)
    expect(residual.some((r) => (r as { status: string }).status === 'satisfied')).toBe(false)

    // Overall §18 remains not satisfied (bullets 1–11; #10 discipline alone ≠ close).
    const overall: 'not_satisfied' = 'not_satisfied'
    expect(overall).toBe('not_satisfied')

    // Explicit non-claim constants (freeze against accidental flip).
    const bullet8: 'open_improved_partial' = 'open_improved_partial'
    const bullet9: 'partial_closer' = 'partial_closer'
    expect(bullet8).not.toBe('satisfied' as typeof bullet8)
    expect(bullet9).not.toBe('satisfied' as typeof bullet9)
  })
})