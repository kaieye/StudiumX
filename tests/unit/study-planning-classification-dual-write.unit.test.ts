import { describe, expect, it, vi } from 'vitest'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  buildSetClassificationPromptOptOutCommand,
  dualWriteClassificationPromptAnswer,
  dualWriteClassifyTask,
  dualWriteSetClassificationPromptOptOut
} from '../../src/renderer/src/study-space/planning-classification-dual-write'

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let snapshot = {
    schemaVersion: 1 as const,
    revision,
    updatedAtMs: 0,
    tasks: [
      {
        id: 't1',
        title: 'Inbox task',
        status: 'done' as const,
        priority: 'normal' as const,
        categoryId: null,
        inbox: true,
        estimateMinutes: null,
        source: 'manual' as const,
        createdAtMs: 0,
        updatedAtMs: 0,
        completedAtMs: 1,
        splittable: true
      }
    ],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: { classificationPromptOptOut: false },
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
      revision += 1
      snapshot = { ...snapshot, revision }
      return {
        ok: true as const,
        revision,
        snapshot,
        effects: []
      }
    })
  }
}

describe('classification dual-write (STC-406/407)', () => {
  it('builds set_preferences opt-out envelope', () => {
    const cmd = buildSetClassificationPromptOptOutCommand(true, 'a1', 10)
    expect(cmd).toMatchObject({
      actionId: 'a1',
      type: 'set_preferences',
      payload: { classificationPromptOptOut: true },
      clientIssuedAtMs: 10
    })
  })

  it('skips without workspace', async () => {
    const r = await dualWriteSetClassificationPromptOptOut(
      { workspaceRoot: null, api: null },
      true
    )
    expect(r.kind).toBe('canonical_skipped')
  })

  it('dualWriteClassifyTask sends update_task with categoryId', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const r = await dualWriteClassifyTask(
      { workspaceRoot: 'D:/ws', api },
      { taskId: 't1', categoryId: 'study' }
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied.length).toBe(1)
    const payload = applied[0] as {
      command: { type: string; payload: { id: string; categoryId: string } }
    }
    expect(payload.command.type).toBe('update_task')
    expect(payload.command.payload).toMatchObject({ id: 't1', categoryId: 'study' })
  })

  it('answer later/keep_inbox write nothing; never_prompt sets opt-out', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const ctx = { workspaceRoot: 'D:/ws', api }

    expect(
      await dualWriteClassificationPromptAnswer(ctx, {
        taskId: 't1',
        action: 'later'
      })
    ).toBeNull()
    expect(
      await dualWriteClassificationPromptAnswer(ctx, {
        taskId: 't1',
        action: 'keep_inbox'
      })
    ).toBeNull()
    expect(applied).toHaveLength(0)

    const never = await dualWriteClassificationPromptAnswer(ctx, {
      taskId: 't1',
      action: 'never_prompt'
    })
    expect(never?.kind).toBe('canonical_ok')
    const payload = applied[0] as {
      command: { type: string; payload: { classificationPromptOptOut: boolean } }
    }
    expect(payload.command.type).toBe('set_preferences')
    expect(payload.command.payload.classificationPromptOptOut).toBe(true)
  })

  it('classify answer requires categoryId', async () => {
    const r = await dualWriteClassificationPromptAnswer(
      { workspaceRoot: 'D:/ws', api: mockApi() },
      { taskId: 't1', action: 'classify', selectedCategoryId: '  ' }
    )
    expect(r?.kind).toBe('canonical_failed')
  })
})
