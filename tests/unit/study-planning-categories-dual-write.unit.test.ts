/**
 * Dual-write tests for study planning categories (sole-authority demotion).
 */
import { describe, expect, it, vi } from 'vitest'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  buildSetCategoriesCommand,
  dualWriteSetCategories
} from '../../src/renderer/src/study-space/planning-categories-dual-write'
import type { StudyTaskCategory } from '../../src/renderer/src/study-space/types'

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
  conflictOnce?: boolean
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let conflictRemaining = options?.conflictOnce ? 1 : 0
  let snapshot: {
    schemaVersion: 1
    revision: number
    updatedAtMs: number
    tasks: unknown[]
    scheduleBlocks: unknown[]
    timerPlans: unknown[]
    timerSessions: unknown[]
    preferences: Record<string, unknown>
    categories?: unknown[]
    localAnalyticsHints: Record<string, unknown>
  } = {
    schemaVersion: 1,
    revision,
    updatedAtMs: 0,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot: snapshot as never,
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
      const command = (payload as { command?: { payload?: { categories?: unknown[] } } }).command
      snapshot = {
        ...snapshot,
        revision,
        categories: command?.payload?.categories ?? snapshot.categories
      }
      return {
        ok: true as const,
        revision,
        snapshot: snapshot as never,
        effects: []
      }
    })
  }
}

const sampleCats: StudyTaskCategory[] = [
  { id: 'study', name: '学习', color: '#8197aa', builtin: true },
  { id: 'entertainment', name: '娱乐', color: '#9c8aa5', builtin: true },
  { id: 'exercise', name: '锻炼', color: '#829d91', builtin: true },
  { id: 'custom-lab', name: '实验', color: '#112233', builtin: false }
]

describe('buildSetCategoriesCommand', () => {
  it('builds set_categories envelope with normalized payload', () => {
    const cmd = buildSetCategoriesCommand(sampleCats, 'a1', 42)
    expect(cmd).toMatchObject({
      actionId: 'a1',
      type: 'set_categories',
      clientIssuedAtMs: 42
    })
    const payload = cmd.payload as { categories: Array<{ id: string }> }
    expect(Array.isArray(payload.categories)).toBe(true)
    expect(payload.categories.some((c) => c.id === 'custom-lab')).toBe(true)
  })
})

describe('dualWriteSetCategories', () => {
  it('skips without workspace or api', async () => {
    const r = await dualWriteSetCategories({ workspaceRoot: null, api: null }, sampleCats)
    expect(r.kind).toBe('canonical_skipped')
  })

  it('writes set_categories via CAS', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const r = await dualWriteSetCategories(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 1000 },
      sampleCats
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(1)
    const payload = applied[0] as {
      expectedRevision: number
      command: { type: string; actionId: string }
    }
    expect(payload.expectedRevision).toBe(1)
    expect(payload.command.type).toBe('set_categories')
    expect(payload.command.actionId).toContain('set_categories')
  })

  it('retries once on revision_conflict', async () => {
    const applied: unknown[] = []
    const api = mockApi({ conflictOnce: true, onApply: (p) => applied.push(p) })
    const r = await dualWriteSetCategories(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 3000 },
      sampleCats
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(2)
    const second = applied[1] as { command: { actionId: string } }
    expect(second.command.actionId).toMatch(/:1$/)
  })
})
