/**
 * Assistant import dual-write (sole-authority demotion for STUDY_TASKS_CHANGED).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  collectAssistantImportAddedTasks,
  dualWriteAssistantImportTasks
} from '../../src/renderer/src/study-space/planning-assistant-import-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { StudyTask } from '../../src/renderer/src/study-space/types'
import type { StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION
} from '../../src/shared/study-planning'

function emptySnapshot(revision = 1): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: 1_000,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockApi(options?: {
  onApply?: (payload: unknown) => void
  applyImpl?: StudyPlanningApi['applyStudyPlanning']
}): StudyPlanningApi {
  let revision = 1
  let snapshot = emptySnapshot(revision)
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'empty' as const
    })),
    applyStudyPlanning: options?.applyImpl
      ? options.applyImpl
      : vi.fn(async (payload) => {
          options?.onApply?.(payload)
          const body = payload.command.payload as { id: string; title: string }
          const next = {
            ...snapshot,
            revision: revision + 1,
            tasks: [
              ...snapshot.tasks,
              {
                id: body.id,
                title: body.title,
                status: 'open' as const,
                categoryId: null,
                inbox: true,
                splittable: true,
                revision: 1,
                source: 'manual' as const
              }
            ]
          }
          revision = next.revision
          snapshot = next
          return {
            ok: true as const,
            revision,
            snapshot,
            effects: [{ type: 'task_created' as const, taskId: body.id }],
            path: '/ws/.studiumx/study-planning/snapshot.json'
          }
        })
  }
}

const t = (
  id: string,
  title: string,
  extra?: Partial<StudyTask>
): StudyTask => ({
  id,
  title,
  done: false,
  categoryId: 'study',
  ...extra
})

describe('collectAssistantImportAddedTasks', () => {
  it('returns only ids present in next but not previous', () => {
    const previous = [t('a', 'A'), t('b', 'B')]
    const next = [t('c', 'C'), t('a', 'A'), t('d', 'D')]
    expect(collectAssistantImportAddedTasks(previous, next)).toEqual([
      { id: 'c', title: 'C', categoryId: 'study' },
      { id: 'd', title: 'D', categoryId: 'study' }
    ])
  })

  it('skips done tasks and empty titles', () => {
    const previous: StudyTask[] = []
    const next = [
      t('done-1', 'Done', { done: true }),
      t('empty', '   '),
      t('ok', '  整理笔记  ', { categoryId: undefined })
    ]
    expect(collectAssistantImportAddedTasks(previous, next)).toEqual([
      { id: 'ok', title: '整理笔记', categoryId: null }
    ])
  })

  it('dedupes repeated ids in next', () => {
    const next = [t('x', 'One'), t('x', 'Two')]
    expect(collectAssistantImportAddedTasks([], next)).toEqual([
      { id: 'x', title: 'One', categoryId: 'study' }
    ])
  })
})

describe('dualWriteAssistantImportTasks', () => {
  it('no-ops without IPC when nothing added', async () => {
    const api = mockApi()
    const previous = [t('a', 'A')]
    const result = await dualWriteAssistantImportTasks(
      { api, workspaceRoot: '/ws' },
      previous,
      previous
    )
    expect(result.added).toEqual([])
    expect(result.writes).toEqual([])
    expect(result.allOk).toBe(true)
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })

  it('skips when workspace missing (fail-closed)', async () => {
    const api = mockApi()
    const result = await dualWriteAssistantImportTasks(
      { api, workspaceRoot: null },
      [],
      [t('ai-1', '整理笔记')]
    )
    expect(result.added).toHaveLength(1)
    expect(result.anySkipped).toBe(true)
    expect(result.allOk).toBe(false)
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })

  it('publishes create_task for each added id with shared id + manual source', async () => {
    const payloads: unknown[] = []
    const api = mockApi({ onApply: (p) => payloads.push(p) })
    const result = await dualWriteAssistantImportTasks(
      { api, workspaceRoot: 'D:/project/ws' },
      [t('old', '旧')],
      [t('ai-1', '整理笔记'), t('old', '旧'), t('ai-2', '复盘')]
    )
    expect(result.added.map((a) => a.id)).toEqual(['ai-1', 'ai-2'])
    expect(result.allOk).toBe(true)
    expect(result.anyFailed).toBe(false)
    expect(api.applyStudyPlanning).toHaveBeenCalledTimes(2)
    expect(payloads[0]).toMatchObject({
      command: {
        type: 'create_task',
        payload: { id: 'ai-1', title: '整理笔记', source: 'manual' }
      }
    })
    expect(payloads[1]).toMatchObject({
      command: {
        type: 'create_task',
        payload: { id: 'ai-2', title: '复盘', source: 'manual' }
      }
    })
  })

  it('surfaces canonical_failed without rolling back other successes', async () => {
    let calls = 0
    const api = mockApi({
      applyImpl: vi.fn(async (payload) => {
        calls += 1
        if (calls === 1) {
          return {
            ok: false as const,
            revision: 1,
            error: { code: 'io_failed' as const, message: 'disk full' }
          }
        }
        const body = payload.command.payload as { id: string; title: string }
        return {
          ok: true as const,
          revision: 2,
          snapshot: emptySnapshot(2),
          effects: [{ type: 'task_created' as const, taskId: body.id }],
          path: '/ws/.studiumx/study-planning/snapshot.json'
        }
      })
    })
    const result = await dualWriteAssistantImportTasks(
      { api, workspaceRoot: '/ws' },
      [],
      [t('a', 'A'), t('b', 'B')]
    )
    expect(result.writes).toHaveLength(2)
    expect(result.writes[0]?.kind).toBe('canonical_failed')
    expect(result.writes[1]?.kind).toBe('canonical_ok')
    expect(result.anyFailed).toBe(true)
    expect(result.allOk).toBe(false)
  })
})
