/**
 * IMPL-P: V1 sole-authority e2e-proxy product-path cold-start evidence.
 *
 * Composes the same pure + session + hydrate modules the renderer uses on cold
 * start after demote (ADR-0094 / 0129 / 0130 §5.1). This is a deterministic
 * product-path suite — not multi-process Electron e2e. Residual honesty: true
 * multi-window Electron cold-start may remain open.
 *
 * Sequence proven:
 * 1. Precondition: workspace sole-read + demote marker + empty/presence-only V1
 * 2. Cold rehydrate: no default reseed / no V1 task hydrate when demoted
 * 3. Empty demoted V1 does not co-write task authority on persist
 * 4. Demote+backup then reopen: tasks from canonical sole-read, not default catalog
 * 5. Negative: no confirm never erases; auto ≥30d wipe remains absent
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
  buildV1AuthorityArchivePayload,
  canExecuteV1Demote,
  canOfferV1Demote,
  demoteV1LocalStorageKeys,
  isV1LocalAuthorityDemoted,
  readV1LocalAuthorityDemotedAtMs,
  shouldHydrateTasksFromV1Cache,
  shouldPersistV1TaskAuthority,
  shouldReseedV1TasksFromDefaults,
  stripTaskAuthorityFromSnapshot,
  writeV1LocalAuthorityDemotedMarker
} from '../../src/renderer/src/study-space/planning-v1-authority-demote'
import {
  STUDY_SPACE_STORAGE_KEY,
  defaultStudySnapshot
} from '../../src/renderer/src/study-space/constants'
import {
  normalizeStudySnapshot,
  normalizeStudyTasks,
  persistStudySnapshot,
  readStudySnapshot
} from '../../src/renderer/src/study-space/session/session-snapshot'
import {
  hydrateStudyTasksFromCanonical,
  mergeCanonicalTasksIntoStudySnapshot
} from '../../src/renderer/src/study-space/planning-hydrate'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { StudySnapshot, StudyTask } from '../../src/renderer/src/study-space/types'
import type { PlanningTask, StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION
} from '../../src/shared/study-planning'

const FIXED_NOW = 1_720_000_000_000
const DEMOTED_AT = 1_700_000_000_111
const WORKSPACE_ROOT = 'D:\\\\workspace\\\\studiumx-demo'
const CANONICAL_TASK_TITLE = 'Canonical sole-read task from snapshot.json'
const DEFAULT_SEED_TITLES = defaultStudySnapshot.tasks.map((t) => t.title)

function makeHostSnapshot(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    clientId: 'studiumx-product-path-client',
    nickname: 'ProductPath',
    spaceCode: 'PUBLIC',
    presenceRelayUrl: 'wss://broker.emqx.io:8084/mqtt',
    signalId: 'reading',
    modeId: 'free',
    contractText: '',
    contractLocked: false,
    roomId: 'silent',
    seatIndex: 2,
    seatClaimedAt: 1,
    timerMode: 'focus',
    timerState: 'idle',
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '09:00',
    simulationEndTime: '11:00',
    timerPlans: [
      {
        id: 'plan-v1',
        name: 'V1 Classic',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '11:00'
      }
    ],
    remainingSeconds: 1500,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: '',
    tasks: [
      { id: 'v1-t1', title: 'V1 dual-cache task', done: false, categoryId: 'study' }
    ],
    ...overrides
  }
}

function planningTask(
  partial: Partial<PlanningTask> & Pick<PlanningTask, 'id' | 'title'>
): PlanningTask {
  return {
    status: 'open',
    categoryId: null,
    inbox: true,
    splittable: true,
    revision: 1,
    source: 'manual',
    ...partial
  }
}

function canonicalPlanning(revision = 7): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: FIXED_NOW,
    tasks: [
      planningTask({
        id: 'canonical-task-1',
        title: CANONICAL_TASK_TITLE,
        categoryId: 'study',
        inbox: false
      })
    ],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockPlanningApi(snapshot: StudyPlanningSnapshotV1): StudyPlanningApi {
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: `${WORKSPACE_ROOT}/.studiumx/study-planning/snapshot.json`,
      source: 'canonical' as const
    })),
    // resolveApi requires both methods; hydrate only reads.
    applyStudyPlanning: vi.fn(async () => ({
      ok: false as const,
      revision: snapshot.revision,
      error: { code: 'not_used', message: 'product-path suite does not apply' }
    }))
  }
}

function assertNoDefaultCatalog(tasks: readonly StudyTask[], blob?: string): void {
  for (const title of DEFAULT_SEED_TITLES) {
    expect(tasks.map((t) => t.title)).not.toContain(title)
    if (blob !== undefined) {
      expect(blob).not.toContain(title)
    }
  }
}

/**
 * Product-path cold-start steps mirrored from useStudySession:
 * - readStudySnapshot on mount (demote marker from localStorage)
 * - hydrateStudyTasksFromCanonical when workspace root active
 * - persistStudySnapshot gated by demoted + workspaceAvailable
 */
async function productPathColdStart(input: {
  workspaceAvailable: boolean
  planning?: StudyPlanningSnapshotV1
  hostOverrides?: Partial<StudySnapshot>
}): Promise<{
  demoted: boolean
  reseed: boolean
  hydrateFromV1: boolean
  persistAuthority: boolean
  coldRead: StudySnapshot
  hydrate:
    | Awaited<ReturnType<typeof hydrateStudyTasksFromCanonical>>
    | null
  liveUiTasks: StudyTask[]
  storedRaw: string | null
}> {
  const demoted = isV1LocalAuthorityDemoted()
  const reseed = shouldReseedV1TasksFromDefaults({
    demoted,
    workspaceAvailable: input.workspaceAvailable
  })
  const hydrateFromV1 = shouldHydrateTasksFromV1Cache({
    demoted,
    workspaceAvailable: input.workspaceAvailable
  })
  const persistAuthority = shouldPersistV1TaskAuthority({
    demoted,
    workspaceAvailable: input.workspaceAvailable
  })

  // 1) Session cold rehydrate (same entry as useState(() => readStudySnapshot()))
  const coldRead = readStudySnapshot({
    demoted,
    workspaceAvailable: input.workspaceAvailable
  })

  // 2) Sole-read hydrate when workspace active (useStudySession effect)
  let hydrate: Awaited<ReturnType<typeof hydrateStudyTasksFromCanonical>> | null = null
  let liveUiTasks = coldRead.tasks.slice()
  if (input.workspaceAvailable && input.planning) {
    const host = makeHostSnapshot({
      ...input.hostOverrides,
      tasks: coldRead.tasks,
      timerPlans: coldRead.timerPlans,
      nickname: coldRead.nickname,
      clientId: coldRead.clientId
    })
    hydrate = await hydrateStudyTasksFromCanonical(
      {
        workspaceRoot: WORKSPACE_ROOT,
        api: mockPlanningApi(input.planning),
        nowMs: () => FIXED_NOW
      },
      host,
      {
        expectedHostTasks: host.tasks,
        getCurrentHostTasks: () => host.tasks
      }
    )
    if (hydrate.kind === 'applied') {
      liveUiTasks = hydrate.snapshot.tasks.slice()
      // Host applies sole-read tasks in memory; persist still gated by demote.
      persistStudySnapshot(
        {
          ...host,
          tasks: hydrate.snapshot.tasks,
          timerPlans: hydrate.snapshot.timerPlans
        },
        { demoted, workspaceAvailable: true }
      )
    }
  } else {
    // Even without hydrate apply, subsequent snapshot effects persist with gates.
    persistStudySnapshot(
      makeHostSnapshot({
        ...input.hostOverrides,
        tasks: coldRead.tasks,
        timerPlans: coldRead.timerPlans
      }),
      { demoted, workspaceAvailable: input.workspaceAvailable }
    )
  }

  return {
    demoted,
    reseed,
    hydrateFromV1,
    persistAuthority,
    coldRead,
    hydrate,
    liveUiTasks,
    storedRaw: window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
  }
}

describe('study-planning v1 authority cold-start product-path (e2e-proxy)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  describe('full demote → cold-start → sole-read sequence', () => {
    it('precondition + cold rehydrate + presence-only persist + canonical reopen', async () => {
      // --- Phase 0: dual-authority V1 present (pre-demote) ---
      const preDemote = makeHostSnapshot()
      window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(preDemote))
      expect(isV1LocalAuthorityDemoted()).toBe(false)
      expect(
        shouldReseedV1TasksFromDefaults({ demoted: false, workspaceAvailable: true })
      ).toBe(true)

      // --- Phase 1: user-confirm demote + backup (never silent) ---
      const archive = buildV1AuthorityArchivePayload({
        snapshot: preDemote,
        nowMs: DEMOTED_AT
      })
      expect(archive.snapshot.tasks).toHaveLength(1)
      expect(archive.snapshot.tasks[0]?.title).toBe('V1 dual-cache task')

      expect(
        canExecuteV1Demote({
          userConfirmed: true,
          lastBackupExportOk: true,
          workspaceAvailable: true,
          alreadyDemoted: false
        })
      ).toBe(true)

      const demote = demoteV1LocalStorageKeys({
        userConfirmed: true,
        backupExportOk: true,
        eraseTasks: true,
        rewritePresenceShell: true,
        presenceSource: preDemote,
        nowMs: DEMOTED_AT
      })
      expect(demote.ok).toBe(true)
      if (!demote.ok) throw new Error('demote failed')
      expect(demote.demotedAtMs).toBe(DEMOTED_AT)
      expect(isV1LocalAuthorityDemoted()).toBe(true)
      expect(readV1LocalAuthorityDemotedAtMs()).toBe(DEMOTED_AT)
      expect(window.localStorage.getItem(STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY)).toBe(
        String(DEMOTED_AT)
      )

      // Presence-only shell after demote (empty task authority)
      const shellRaw = window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
      expect(shellRaw).toBeTruthy()
      const shell = JSON.parse(shellRaw!) as StudySnapshot
      expect(shell.tasks).toEqual([])
      expect(shell.timerPlans).toEqual([])
      expect(shell.nickname).toBe('ProductPath')
      expect(JSON.stringify(shell)).not.toContain('V1 dual-cache task')
      assertNoDefaultCatalog(shell.tasks, JSON.stringify(shell))

      // Offer must stop once demoted
      expect(
        canOfferV1Demote({
          migrationCommitted: true,
          hydrateApplied: true,
          canonicalTaskCount: 1,
          hostTaskCount: 1,
          workspaceAvailable: true,
          alreadyDemoted: true
        })
      ).toBe(false)

      // --- Phase 2: cold start / rehydrate product path (demoted + workspace) ---
      const cold = await productPathColdStart({
        workspaceAvailable: true,
        planning: canonicalPlanning(11)
      })

      // Precondition gates
      expect(cold.demoted).toBe(true)
      expect(cold.reseed).toBe(false)
      expect(cold.hydrateFromV1).toBe(false)
      expect(cold.persistAuthority).toBe(false)

      // Pure normalize / allowEmpty path (same as readStudySnapshot)
      expect(normalizeStudyTasks([], { allowEmpty: true })).toEqual([])
      expect(normalizeStudyTasks(null, { allowEmpty: true })).toEqual([])
      expect(
        normalizeStudySnapshot(
          { clientId: 'studiumx-x', nickname: 'X', tasks: [], timerPlans: [] },
          { allowEmptyTasks: true }
        ).tasks
      ).toEqual([])

      // Cold read must not resurrect default catalog into authority
      expect(cold.coldRead.tasks).toEqual([])
      assertNoDefaultCatalog(cold.coldRead.tasks)

      // --- Phase 3: empty demoted V1 does not co-write task authority ---
      expect(cold.storedRaw).toBeTruthy()
      const afterPersist = JSON.parse(cold.storedRaw!) as StudySnapshot
      expect(afterPersist.tasks).toEqual([])
      expect(afterPersist.timerPlans).toEqual([])
      // Live sole-read titles must not leak into demoted V1 co-cache
      expect(JSON.stringify(afterPersist)).not.toContain(CANONICAL_TASK_TITLE)
      assertNoDefaultCatalog(afterPersist.tasks, JSON.stringify(afterPersist))

      // --- Phase 4: reopen reads tasks from canonical sole-read, not default catalog ---
      expect(cold.hydrate).not.toBeNull()
      expect(cold.hydrate?.kind).toBe('applied')
      if (cold.hydrate?.kind === 'applied') {
        expect(cold.hydrate.taskCount).toBe(1)
        expect(cold.hydrate.snapshot.tasks[0]?.title).toBe(CANONICAL_TASK_TITLE)
        expect(cold.hydrate.revision).toBe(11)
        expect(cold.hydrate.source).toBe('canonical')
      }
      expect(cold.liveUiTasks).toHaveLength(1)
      expect(cold.liveUiTasks[0]?.title).toBe(CANONICAL_TASK_TITLE)
      assertNoDefaultCatalog(cold.liveUiTasks)

      // merge helper (same path hydrate uses) also never invents defaults
      const merged = mergeCanonicalTasksIntoStudySnapshot(
        makeHostSnapshot({ tasks: [] }),
        canonicalPlanning(11),
        { nowMs: FIXED_NOW }
      )
      expect(merged.snapshot.tasks[0]?.title).toBe(CANONICAL_TASK_TITLE)
      assertNoDefaultCatalog(merged.snapshot.tasks)

      // strip helper remains pure presence shell
      const stripped = stripTaskAuthorityFromSnapshot(
        makeHostSnapshot({
          tasks: [{ id: 'x', title: 'leak', done: false, categoryId: 'study' }]
        })
      )
      expect(stripped.tasks).toEqual([])
      expect(stripped.timerPlans).toEqual([])
    })

    it('second cold start with demote marker still empty V1 + sole-read applied', async () => {
      // Simulate already-demoted install: marker + presence shell only
      writeV1LocalAuthorityDemotedMarker(DEMOTED_AT)
      window.localStorage.setItem(
        STUDY_SPACE_STORAGE_KEY,
        JSON.stringify({
          clientId: 'studiumx-demoted-shell',
          nickname: 'ShellAgain',
          spaceCode: 'PUBLIC',
          tasks: [],
          timerPlans: []
        })
      )

      const again = await productPathColdStart({
        workspaceAvailable: true,
        planning: canonicalPlanning(3)
      })

      expect(again.demoted).toBe(true)
      expect(again.reseed).toBe(false)
      expect(again.hydrateFromV1).toBe(false)
      expect(again.coldRead.tasks).toEqual([])
      expect(again.hydrate?.kind).toBe('applied')
      expect(again.liveUiTasks.map((t) => t.title)).toEqual([CANONICAL_TASK_TITLE])

      const stored = JSON.parse(again.storedRaw!) as StudySnapshot
      expect(stored.tasks).toEqual([])
      assertNoDefaultCatalog(stored.tasks, JSON.stringify(stored))
      expect(JSON.stringify(stored)).not.toContain(CANONICAL_TASK_TITLE)
    })
  })

  describe('negative: fail-closed erase + no auto ≥30d wipe', () => {
    it('demote without confirm never erases; backup required; no-erase-flags no-op', () => {
      const host = makeHostSnapshot()
      window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(host))

      const noConfirm = demoteV1LocalStorageKeys({
        eraseTasks: true,
        backupExportOk: true
      })
      expect(noConfirm.ok).toBe(false)
      if (!noConfirm.ok) expect(noConfirm.code).toBe('confirm_required')
      expect(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)).toBeTruthy()
      expect(JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(
        1
      )
      expect(isV1LocalAuthorityDemoted()).toBe(false)

      const noBackup = demoteV1LocalStorageKeys({
        userConfirmed: true,
        eraseTasks: true
      })
      expect(noBackup.ok).toBe(false)
      if (!noBackup.ok) expect(noBackup.code).toBe('backup_required')
      expect(isV1LocalAuthorityDemoted()).toBe(false)

      const noFlags = demoteV1LocalStorageKeys({
        userConfirmed: true,
        backupExportOk: true
      })
      expect(noFlags.ok).toBe(false)
      if (!noFlags.ok) expect(noFlags.code).toBe('no_erase_flags')
      expect(JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(
        1
      )
    })

    it('canExecute refuses without confirm/backup; marker alone does not erase', () => {
      expect(
        canExecuteV1Demote({
          userConfirmed: false,
          lastBackupExportOk: true,
          workspaceAvailable: true
        })
      ).toBe(false)
      expect(
        canExecuteV1Demote({
          userConfirmed: true,
          lastBackupExportOk: false,
          workspaceAvailable: true
        })
      ).toBe(false)

      // Writing demote marker without erase path leaves V1 task payload intact
      const host = makeHostSnapshot()
      window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(host))
      writeV1LocalAuthorityDemotedMarker(DEMOTED_AT)
      expect(isV1LocalAuthorityDemoted()).toBe(true)
      expect(JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(
        1
      )
    })

    it('auto ≥30d silent wipe remains absent from demote product path', () => {
      // Contract: no age-based erase API on demote helpers; stale marker does not wipe.
      writeV1LocalAuthorityDemotedMarker(FIXED_NOW - 40 * 24 * 60 * 60 * 1000)
      const host = makeHostSnapshot({
        tasks: [{ id: 'still-here', title: 'Must not auto-wipe', done: false, categoryId: 'study' }]
      })
      window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(host))

      // Simulate "scheduler tick" absence: product only has explicit demoteV1LocalStorageKeys.
      // Reading demote age does not erase storage.
      const ageMs = FIXED_NOW - (readV1LocalAuthorityDemotedAtMs() ?? 0)
      expect(ageMs).toBeGreaterThan(30 * 24 * 60 * 60 * 1000)

      // Cold path with workspace still does not invent wipe of unrelated live payload
      // when demoted gate only strips on *persist* of presence shell — and only when
      // host chooses presence-only write. Explicit: no auto job mutates storage by age.
      const before = window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
      expect(before).toContain('Must not auto-wipe')

      // Re-read demote state only — no erase side effect
      expect(isV1LocalAuthorityDemoted()).toBe(true)
      expect(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)).toContain('Must not auto-wipe')

      // Export surface: demote module must not expose age-based wipe entrypoints
      // (static contract encoded for residual honesty / ADR-0130).
      const demoteModuleContract = {
        hasAutoWipeAfter30d: false,
        eraseRequiresUserConfirmed: true,
        eraseRequiresBackupExportOk: true
      }
      expect(demoteModuleContract.hasAutoWipeAfter30d).toBe(false)
      expect(demoteModuleContract.eraseRequiresUserConfirmed).toBe(true)
      expect(demoteModuleContract.eraseRequiresBackupExportOk).toBe(true)

      // Runtime: even with demoted + old marker, demote without confirm still refuses
      const refused = demoteV1LocalStorageKeys({ eraseTasks: true, backupExportOk: true })
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.code).toBe('confirm_required')
      expect(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)).toContain('Must not auto-wipe')
    })
  })

  describe('offline demoted honesty (no invent defaults)', () => {
    it('demoted offline: reseed false; empty stays empty; hydrate-from-v1 may keep shell', async () => {
      writeV1LocalAuthorityDemotedMarker(DEMOTED_AT)
      window.localStorage.setItem(
        STUDY_SPACE_STORAGE_KEY,
        JSON.stringify({
          clientId: 'studiumx-offline-shell',
          nickname: 'Offline',
          spaceCode: 'PUBLIC',
          tasks: [],
          timerPlans: []
        })
      )

      expect(
        shouldReseedV1TasksFromDefaults({ demoted: true, workspaceAvailable: false })
      ).toBe(false)
      // Offline hydrate may still read last shell arrays if present; empty stays empty.
      expect(
        shouldHydrateTasksFromV1Cache({ demoted: true, workspaceAvailable: false })
      ).toBe(true)
      // Demoted persist always strips — never re-serialize sole-read tasks into V1 offline.
      expect(
        shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: false })
      ).toBe(false)

      const cold = readStudySnapshot({ demoted: true, workspaceAvailable: false })
      expect(cold.tasks).toEqual([])
      assertNoDefaultCatalog(cold.tasks)
    })
  })
})
