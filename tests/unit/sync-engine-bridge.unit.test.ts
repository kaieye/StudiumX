import { describe, expect, it, vi } from 'vitest'
import type { StudyPlanningSnapshotV1 } from '../../src/shared/study-planning/study-planning-store'
import type { SyncApiClient } from '../../src/renderer/src/sync/sync-api-client'
import {
  createStudyPlanningSyncBridge,
  STUDY_PLANNING_SYNC_COLLECTION
} from '../../src/renderer/src/sync/sync-engine-bridge'

function snapshot(revision: number): StudyPlanningSnapshotV1 {
  return {
    schema: 'studiumx.study-planning',
    schemaVersion: 1,
    revision,
    updatedAtMs: 1_700_000_000_000 + revision,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  } as StudyPlanningSnapshotV1
}

function apiClient(overrides: Partial<SyncApiClient>): SyncApiClient {
  return {
    push: vi.fn(),
    getStudyPlanning: vi.fn(),
    ...overrides
  } as unknown as SyncApiClient
}

describe('study-planning sync bridge', () => {
  it('maps an accepted push to a completed sync result', async () => {
    const push = vi.fn().mockResolvedValue({
      results: [
        {
          collection: STUDY_PLANNING_SYNC_COLLECTION,
          id: '.studiumx/study-planning/snapshot.json',
          status: 'accepted',
          serverRevision: 4
        }
      ]
    })
    const bridge = createStudyPlanningSyncBridge({ apiClient: apiClient({ push }), deviceId: 'device-1' })

    await expect(bridge.pushStudyPlanning(snapshot(4))).resolves.toEqual({
      ok: true,
      status: 'accepted',
      serverRevision: 4
    })
    expect(push).toHaveBeenCalledWith(
      'device-1',
      expect.arrayContaining([
        expect.objectContaining({
          collection: STUDY_PLANNING_SYNC_COLLECTION,
          revision: 4
        })
      ])
    )
  })

  it('maps an equal-revision server no-op to an up-to-date result', async () => {
    const bridge = createStudyPlanningSyncBridge({
      apiClient: apiClient({
        push: vi.fn().mockResolvedValue({
          results: [
            {
              collection: STUDY_PLANNING_SYNC_COLLECTION,
              id: '.studiumx/study-planning/snapshot.json',
              status: 'skipped_duplicate',
              serverRevision: 4
            }
          ]
        })
      }),
      deviceId: 'device-1'
    })

    await expect(bridge.pushStudyPlanning(snapshot(4))).resolves.toEqual({
      ok: true,
      status: 'up_to_date',
      serverRevision: 4
    })
  })

  it('returns conflict metadata as a failed sync instead of a completed sync', async () => {
    const bridge = createStudyPlanningSyncBridge({
      apiClient: apiClient({
        push: vi.fn().mockResolvedValue({
          results: [
            {
              collection: STUDY_PLANNING_SYNC_COLLECTION,
              id: '.studiumx/study-planning/snapshot.json',
              status: 'conflict',
              conflict: {
                serverRevision: 5,
                serverUpdatedAtMs: 1_700_000_000_005
              }
            }
          ]
        })
      }),
      deviceId: 'device-1'
    })

    await expect(bridge.pushStudyPlanning(snapshot(4))).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverRevision: 5,
      serverUpdatedAtMs: 1_700_000_000_005
    })
  })

  it('reads the current study-planning snapshot directly when checking the server version', async () => {
    const getStudyPlanning = vi.fn().mockResolvedValue(snapshot(6))
    const bridge = createStudyPlanningSyncBridge({
      apiClient: apiClient({ getStudyPlanning }),
      deviceId: 'device-1'
    })

    await expect(bridge.pullStudyPlanning(4)).resolves.toMatchObject({
      ok: true,
      status: 'server_newer',
      serverRevision: 6
    })
    expect(getStudyPlanning).toHaveBeenCalledTimes(1)
  })
})
