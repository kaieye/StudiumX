/**
 * STC-308 pure allocation proposal preview model + dual-write command.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createClassicPomodoroPlan,
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type ScheduleBlock,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import {
  buildAllocationProposalPreview,
  buildTimeWindowFromSimulation,
  parseHhMmToMinutes,
  proposalBlocksForApply,
  scheduleBlocksToLocked,
  studyTasksToAllocatorTasks
} from '../../src/renderer/src/study-space/planning-allocation-proposal-ui'
import {
  buildApplyAllocationProposalCommand,
  dualWriteApplyAllocationProposal
} from '../../src/renderer/src/study-space/planning-allocation-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { StudyTask } from '../../src/renderer/src/study-space/types'

const DAY = new Date(2026, 6, 21, 0, 0, 0, 0).getTime() // local midnight Tue
const NOW = new Date(2026, 6, 21, 8, 0, 0, 0).getTime()

function openTask(id: string, title: string): StudyTask {
  return {
    id,
    title,
    done: false,
    categoryId: 'study'
  }
}

function emptySnapshot(revision: number, blocks: ScheduleBlock[] = []): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: NOW,
    tasks: [
      {
        id: 't1',
        title: '线性代数',
        status: 'open',
        categoryId: 'study',
        inbox: false,
        splittable: true,
        revision: 1,
        source: 'manual'
      }
    ],
    scheduleBlocks: blocks,
    timerPlans: [createClassicPomodoroPlan()],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockApi(snapshot: StudyPlanningSnapshotV1) {
  const applied: unknown[] = []
  let current = snapshot
  const api: StudyPlanningApi = {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot: current,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      applied.push(payload)
      const cmd = payload.command as {
        type: string
        payload: { blocks?: Array<{ kind: string; startAtMs: number; endAtMs: number }> }
      }
      if (cmd.type === 'apply_allocation_proposal' && Array.isArray(cmd.payload.blocks)) {
        const drafts = cmd.payload.blocks.map((b, i) => ({
          id: `alloc-test-${i}`,
          kind: b.kind as ScheduleBlock['kind'],
          startAtMs: b.startAtMs,
          endAtMs: b.endAtMs,
          taskId: null,
          locked: false,
          source: 'allocator' as const,
          status: 'planned' as const,
          revision: 1
        }))
        current = {
          ...current,
          revision: current.revision + 1,
          scheduleBlocks: [...current.scheduleBlocks, ...drafts]
        }
      }
      return {
        ok: true as const,
        revision: current.revision,
        snapshot: current,
        effects: []
      }
    })
  }
  return { api, applied, getSnapshot: () => current }
}

describe('allocation proposal pure UI helpers (STC-308)', () => {
  it('parseHhMmToMinutes is fail-closed', () => {
    expect(parseHhMmToMinutes('09:00')).toBe(9 * 60)
    expect(parseHhMmToMinutes('9:30')).toBe(9 * 60 + 30)
    expect(parseHhMmToMinutes('24:00')).toBe(24 * 60)
    expect(parseHhMmToMinutes('24:01')).toBeNull()
    expect(parseHhMmToMinutes('9')).toBeNull()
    expect(parseHhMmToMinutes('')).toBeNull()
    expect(parseHhMmToMinutes(null)).toBeNull()
  })

  it('buildTimeWindowFromSimulation builds hard-end window on local day', () => {
    const w = buildTimeWindowFromSimulation({
      dayStartMs: DAY,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00'
    })
    expect(w).not.toBeNull()
    expect(w!.startAtMs).toBe(DAY + 9 * 60 * 60_000)
    expect(w!.endAtMs).toBe(DAY + 12 * 60 * 60_000)
    expect(w!.hardEnd).toBe(true)
    expect(
      buildTimeWindowFromSimulation({
        dayStartMs: DAY,
        simulationStartTime: '12:00',
        simulationEndTime: '09:00'
      })
    ).toBeNull()
  })

  it('studyTasksToAllocatorTasks skips done and maps open rows', () => {
    const rows = studyTasksToAllocatorTasks([
      openTask('a', 'A'),
      { ...openTask('b', 'B'), done: true },
      openTask('c', 'C')
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'c'])
    expect(rows[0]?.estimateMinutes).toBeNull()
  })

  it('scheduleBlocksToLocked keeps only locked non-cancelled', () => {
    const locked = scheduleBlocksToLocked([
      {
        id: 'l1',
        kind: 'focus',
        startAtMs: DAY + 9 * 60 * 60_000,
        endAtMs: DAY + 10 * 60 * 60_000,
        taskId: 't1',
        locked: true,
        source: 'manual',
        status: 'planned',
        revision: 1
      },
      {
        id: 'u1',
        kind: 'focus',
        startAtMs: DAY + 11 * 60 * 60_000,
        endAtMs: DAY + 12 * 60 * 60_000,
        taskId: 't1',
        locked: false,
        source: 'manual',
        status: 'planned',
        revision: 1
      }
    ])
    expect(locked).toHaveLength(1)
    expect(locked[0]?.id).toBe('l1')
  })

  it('proposalBlocksForApply strips blank and locked allocator rows', () => {
    const apply = proposalBlocksForApply([
      {
        kind: 'focus',
        startAtMs: 1,
        endAtMs: 2,
        taskId: 't1',
        locked: false,
        source: 'allocator'
      },
      {
        kind: 'blank',
        startAtMs: 2,
        endAtMs: 3,
        taskId: null,
        locked: false,
        source: 'allocator'
      },
      {
        kind: 'short_break',
        startAtMs: 3,
        endAtMs: 4,
        taskId: null,
        locked: true,
        source: 'locked'
      }
    ])
    expect(apply).toHaveLength(1)
    expect(apply[0]?.kind).toBe('focus')
  })

  it('buildAllocationProposalPreview allocates drafts and canConfirm when window fits', () => {
    const window = buildTimeWindowFromSimulation({
      dayStartMs: DAY,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00'
    })!
    const plan = createClassicPomodoroPlan({ id: 'classic_25_5', name: '经典番茄 25/5' })
    const model = buildAllocationProposalPreview({
      window,
      plan,
      tasks: [openTask('t1', '线性代数')],
      currentBlocks: [],
      nowMs: NOW,
      idPrefix: 'alloc-test'
    })
    expect(model.canConfirm).toBe(true)
    expect(model.applyBlocks.length).toBeGreaterThan(0)
    expect(model.applyBlocks.every((b) => b.kind !== 'blank')).toBe(true)
    expect(model.rows.some((r) => r.change === 'added')).toBe(true)
    expect(model.diff.added.length).toBe(model.proposedScheduleBlocks.length)
    expect(model.copy.title).toContain('排程提案')
    expect(model.copy.confirmLabel).toMatch(/确认写入/)
    expect(model.planId).toBe('classic_25_5')
  })

  it('buildAllocationProposalPreview canConfirm false for tiny window', () => {
    const window = buildTimeWindowFromSimulation({
      dayStartMs: DAY,
      simulationStartTime: '09:00',
      simulationEndTime: '09:04'
    })!
    const model = buildAllocationProposalPreview({
      window,
      plan: createClassicPomodoroPlan(),
      tasks: [openTask('t1', '线性代数')],
      currentBlocks: [],
      nowMs: NOW
    })
    expect(model.canConfirm).toBe(false)
    expect(model.applyBlocks).toEqual([])
  })
})

describe('allocation proposal dual-write (STC-308)', () => {
  it('buildApplyAllocationProposalCommand shapes envelope', () => {
    const cmd = buildApplyAllocationProposalCommand(
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: DAY + 9 * 60 * 60_000,
            endAtMs: DAY + (9 * 60 + 25) * 60_000,
            taskId: 't1',
            locked: false
          }
        ],
        planId: 'classic_25_5',
        planRevision: 1,
        idPrefix: 'alloc-x'
      },
      'aid-1',
      123
    )
    expect(cmd).toMatchObject({
      actionId: 'aid-1',
      type: 'apply_allocation_proposal',
      clientIssuedAtMs: 123
    })
    expect(cmd.payload).toMatchObject({
      planId: 'classic_25_5',
      planRevision: 1,
      idPrefix: 'alloc-x'
    })
    expect((cmd.payload as { blocks: unknown[] }).blocks).toHaveLength(1)
  })

  it('dualWriteApplyAllocationProposal CAS applies blocks and returns snapshot', async () => {
    const { api, applied, getSnapshot } = mockApi(emptySnapshot(3))
    const blocks = [
      {
        kind: 'focus' as const,
        startAtMs: DAY + 9 * 60 * 60_000,
        endAtMs: DAY + (9 * 60 + 25) * 60_000,
        taskId: 't1',
        locked: false
      },
      {
        kind: 'short_break' as const,
        startAtMs: DAY + (9 * 60 + 25) * 60_000,
        endAtMs: DAY + (9 * 60 + 30) * 60_000,
        taskId: null,
        locked: false
      }
    ]
    const result = await dualWriteApplyAllocationProposal(
      { api, workspaceRoot: 'D:/ws', nowMs: () => NOW },
      { blocks, planId: 'classic_25_5', planRevision: 1, idPrefix: 'alloc-unit' }
    )
    expect(result.kind).toBe('canonical_ok')
    if (result.kind !== 'canonical_ok') return
    expect(applied).toHaveLength(1)
    const payload = applied[0] as {
      expectedRevision: number
      command: { type: string; payload: { blocks: unknown[] } }
    }
    expect(payload.expectedRevision).toBe(3)
    expect(payload.command.type).toBe('apply_allocation_proposal')
    expect(payload.command.payload.blocks).toHaveLength(2)
    expect(getSnapshot().scheduleBlocks.length).toBe(2)
    expect(result.result.snapshot.scheduleBlocks.length).toBe(2)
  })

  it('dualWriteApplyAllocationProposal fails closed without workspace', async () => {
    const result = await dualWriteApplyAllocationProposal(
      { api: mockApi(emptySnapshot(1)).api, workspaceRoot: null },
      {
        blocks: [
          {
            kind: 'focus',
            startAtMs: 1,
            endAtMs: 2,
            taskId: null,
            locked: false
          }
        ]
      }
    )
    expect(result).toEqual({ kind: 'canonical_skipped', reason: 'missing_workspace' })
  })

  it('dualWriteApplyAllocationProposal rejects empty blocks', async () => {
    const result = await dualWriteApplyAllocationProposal(
      { api: mockApi(emptySnapshot(1)).api, workspaceRoot: 'D:/ws' },
      { blocks: [] }
    )
    expect(result.kind).toBe('canonical_failed')
    if (result.kind !== 'canonical_failed') return
    expect(result.result.error.code).toBe('invalid_command')
  })
})
