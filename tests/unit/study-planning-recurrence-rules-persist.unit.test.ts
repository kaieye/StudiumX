/**
 * STC-703 durable recurrenceRules via optional preferences (IMPL-L).
 * Store normalize + set_preferences CAS dual-write glue.
 * Never clones Task; never auto-expands.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  STUDY_PLANNING_RECURRENCE_RULES_CAP,
  StudyPlanningStore,
  normalizePreferencesRecurrenceRules,
  type RecurrenceRule
} from '../../src/shared/study-planning'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  buildSetPreferencesCommand,
  dualWriteSetPreferences
} from '../../src/renderer/src/study-space/planning-preferences-dual-write'
import {
  buildRecurrenceRuleFromForm,
  deleteRecurrenceRuleFromList,
  findRecurrenceRuleForTask,
  upsertRecurrenceRuleInList
} from '../../src/renderer/src/study-space/planning-recurrence-expand'

const baseRule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'recurrence:task-a',
  taskId: 'task-a',
  kind: 'focus',
  frequency: 'weekly',
  byWeekday: [1, 3],
  dtStartMs: Date.UTC(2026, 0, 5),
  startMinutes: 9 * 60,
  endMinutes: 10 * 60,
  expandAsLocked: true,
  ...over
})

describe('normalizePreferencesRecurrenceRules', () => {
  it('returns empty for non-array / empty', () => {
    expect(normalizePreferencesRecurrenceRules(undefined)).toEqual([])
    expect(normalizePreferencesRecurrenceRules(null)).toEqual([])
    expect(normalizePreferencesRecurrenceRules({})).toEqual([])
    expect(normalizePreferencesRecurrenceRules([])).toEqual([])
  })

  it('keeps valid rules and drops invalid / duplicates', () => {
    const good = baseRule()
    const badFocusNoTask = baseRule({ id: 'bad', taskId: null })
    const badMinutes = baseRule({ id: 'bad-m', startMinutes: 100, endMinutes: 50 })
    const dup = baseRule({ startMinutes: 11 * 60, endMinutes: 12 * 60 }) // same id
    const out = normalizePreferencesRecurrenceRules([
      good,
      badFocusNoTask,
      badMinutes,
      dup,
      { not: 'a rule' },
      null
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('recurrence:task-a')
    expect(out[0]?.startMinutes).toBe(9 * 60)
  })

  it('caps at STUDY_PLANNING_RECURRENCE_RULES_CAP', () => {
    const many = Array.from({ length: STUDY_PLANNING_RECURRENCE_RULES_CAP + 5 }, (_, i) =>
      baseRule({
        id: `recurrence:t${i}`,
        taskId: `t${i}`
      })
    )
    const out = normalizePreferencesRecurrenceRules(many)
    expect(out).toHaveLength(STUDY_PLANNING_RECURRENCE_RULES_CAP)
  })

  it('allows break templates with null taskId', () => {
    const br = baseRule({
      id: 'recurrence:break',
      taskId: null,
      kind: 'short_break',
      frequency: 'daily',
      byWeekday: undefined
    })
    const out = normalizePreferencesRecurrenceRules([br])
    expect(out).toHaveLength(1)
    expect(out[0]?.taskId).toBeNull()
  })
})

describe('StudyPlanningStore set_preferences.recurrenceRules', () => {
  it('full-replaces when array provided; omits when not in payload', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1_000 })
    const rev1 = store.readSnapshot().revision
    const rule = baseRule()
    const r1 = store.applyCommand(
      {
        actionId: 'set-rr-1',
        type: 'set_preferences',
        payload: { recurrenceRules: [rule] }
      },
      rev1
    )
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.snapshot.preferences.recurrenceRules).toEqual([
      expect.objectContaining({ id: rule.id, taskId: 'task-a' })
    ])

    // Other preference patch without recurrenceRules must not wipe list.
    const rev2 = r1.revision
    const r2 = store.applyCommand(
      {
        actionId: 'set-other',
        type: 'set_preferences',
        payload: { classificationPromptOptOut: true }
      },
      rev2
    )
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.snapshot.preferences.recurrenceRules).toHaveLength(1)
    expect(r2.snapshot.preferences.classificationPromptOptOut).toBe(true)

    // null clears to empty
    const r3 = store.applyCommand(
      {
        actionId: 'set-rr-clear',
        type: 'set_preferences',
        payload: { recurrenceRules: null }
      },
      r2.revision
    )
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    expect(r3.snapshot.preferences.recurrenceRules).toEqual([])
  })

  it('fails closed when recurrenceRules is non-array object', () => {
    const store = new StudyPlanningStore({ nowMs: () => 2_000 })
    const rev = store.readSnapshot().revision
    const bad = store.applyCommand(
      {
        actionId: 'set-rr-bad',
        type: 'set_preferences',
        payload: { recurrenceRules: { id: 'x' } }
      },
      rev
    )
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error.code).toBe('invalid_command')
    expect(store.readSnapshot().revision).toBe(rev)
  })

  it('drops invalid items but accepts partial valid list (no schema bump)', () => {
    const store = new StudyPlanningStore({ nowMs: () => 3_000 })
    const rev = store.readSnapshot().revision
    const ok = store.applyCommand(
      {
        actionId: 'set-rr-partial',
        type: 'set_preferences',
        payload: {
          recurrenceRules: [
            baseRule({ id: 'good' }),
            baseRule({ id: 'focus-orphan', taskId: null }),
            baseRule({ id: 'good-2', taskId: 'task-b' })
          ]
        }
      },
      rev
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.snapshot.schemaVersion).toBe(1)
    expect(ok.snapshot.preferences.recurrenceRules?.map((r) => r.id)).toEqual(['good', 'good-2'])
  })
})

describe('buildSetPreferencesCommand + dualWrite recurrenceRules', () => {
  it('includes recurrenceRules in payload only when provided', () => {
    const rules = [baseRule()]
    const cmd = buildSetPreferencesCommand({ recurrenceRules: rules }, 'a-rr', 9)
    expect(cmd).toMatchObject({
      actionId: 'a-rr',
      type: 'set_preferences',
      clientIssuedAtMs: 9
    })
    expect(cmd.payload).toEqual({ recurrenceRules: rules })

    const empty = buildSetPreferencesCommand({ emptyStartPolicy: 'ask_every_time' }, 'a2')
    expect(empty.payload).not.toHaveProperty('recurrenceRules')
  })

  function mockApi(options?: {
    revision?: number
    conflictOnce?: boolean
    onApply?: (payload: unknown) => void
  }): StudyPlanningApi {
    let revision = options?.revision ?? 1
    let conflictRemaining = options?.conflictOnce ? 1 : 0
    let snapshot = {
      schemaVersion: 1 as const,
      revision,
      updatedAtMs: 0,
      tasks: [],
      scheduleBlocks: [],
      timerPlans: [],
      timerSessions: [],
      preferences: {
        emptyStartPolicy: 'ask_every_time' as const,
        classificationPromptOptOut: false,
        recurrenceRules: [] as RecurrenceRule[]
      },
      localAnalyticsHints: {}
    }
    return {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot,
        path: '/ws/.studiumx/study-planning/snapshot.json',
        source: 'canonical' as const
      })),
      applyStudyPlanning: vi.fn(async (payload) => {
        options?.onApply?.(payload)
        if (conflictRemaining > 0) {
          conflictRemaining -= 1
          return {
            ok: false as const,
            revision,
            error: { code: 'revision_conflict' as const, message: 'stale' }
          }
        }
        revision += 1
        const command = (payload as { command?: { payload?: Record<string, unknown> } }).command
        const patch = command?.payload ?? {}
        snapshot = {
          ...snapshot,
          revision,
          preferences: {
            ...snapshot.preferences,
            ...(Array.isArray(patch.recurrenceRules)
              ? {
                  recurrenceRules: normalizePreferencesRecurrenceRules(patch.recurrenceRules)
                }
              : {})
          }
        }
        return {
          ok: true as const,
          revision,
          snapshot,
          effects: []
        }
      })
    }
  }

  it('dualWriteSetPreferences CAS writes recurrenceRules and retries once on conflict', async () => {
    const applied: unknown[] = []
    const api = mockApi({ conflictOnce: true, onApply: (p) => applied.push(p) })
    const rule = baseRule()
    const result = await dualWriteSetPreferences(
      { api, workspaceRoot: 'D:/ws', nowMs: () => 42_000 },
      { recurrenceRules: [rule] }
    )
    expect(result.kind).toBe('canonical_ok')
    expect(applied.length).toBe(2)
    const last = applied[1] as { command: { type: string; payload: { recurrenceRules: RecurrenceRule[] } } }
    expect(last.command.type).toBe('set_preferences')
    expect(last.command.payload.recurrenceRules[0]?.id).toBe(rule.id)
  })

  it('dualWrite rejects empty patch still', async () => {
    const api = mockApi()
    const result = await dualWriteSetPreferences(
      { api, workspaceRoot: 'D:/ws', nowMs: () => 1 },
      {}
    )
    expect(result.kind).toBe('canonical_failed')
  })

  it('skips without workspace', async () => {
    const api = mockApi()
    const result = await dualWriteSetPreferences(
      { api, workspaceRoot: '', nowMs: () => 1 },
      { recurrenceRules: [baseRule()] }
    )
    expect(result.kind).toBe('canonical_skipped')
  })
})

describe('pure recurrence rule list helpers', () => {
  it('upsert / delete / find without cloning Task', () => {
    const a = baseRule({ id: 'r1', taskId: 't1' })
    const b = baseRule({ id: 'r2', taskId: 't2' })
    let list = upsertRecurrenceRuleInList([], a)
    list = upsertRecurrenceRuleInList(list, b)
    expect(list).toHaveLength(2)

    const updated = baseRule({ id: 'r1', taskId: 't1', startMinutes: 14 * 60, endMinutes: 15 * 60 })
    list = upsertRecurrenceRuleInList(list, updated)
    expect(list).toHaveLength(2)
    expect(list.find((r) => r.id === 'r1')?.startMinutes).toBe(14 * 60)
    expect(findRecurrenceRuleForTask(list, 't2')?.id).toBe('r2')
    expect(findRecurrenceRuleForTask(list, 'missing')).toBeNull()

    list = deleteRecurrenceRuleFromList(list, 'r1')
    expect(list.map((r) => r.id)).toEqual(['r2'])

    const fromForm = buildRecurrenceRuleFromForm({
      taskId: 't1',
      frequency: 'daily',
      byWeekday: [],
      startMinutes: 8 * 60,
      endMinutes: 9 * 60,
      dtStartMs: 0,
      ruleId: 'recurrence:t1'
    })
    expect(fromForm.taskId).toBe('t1')
    expect(fromForm.id).toBe('recurrence:t1')
  })
})
