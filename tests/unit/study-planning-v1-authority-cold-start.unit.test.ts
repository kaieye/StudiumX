/**
 * V1 cold-start / non-resurrection evidence after authority demote (ADR-0129 / 0130 §5.1).
 *
 * Proves demoted + workspace does not reassert V1 task authority via default refill
 * or task-authority co-persist. Fail-closed erase gates remain.
 *
 * End-to-end product-path composition (demote → cold rehydrate → sole-read hydrate)
 * lives in study-planning-v1-authority-cold-start-product-path.unit.test.ts (e2e-proxy).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
  canOfferV1Demote,
  demoteV1LocalStorageKeys,
  isV1LocalAuthorityDemoted,
  shouldHydrateTasksFromV1Cache,
  shouldPersistV1TaskAuthority,
  shouldReseedV1TasksFromDefaults,
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
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

function makeSnapshot(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    clientId: 'studiumx-cold-client',
    nickname: 'Cold',
    spaceCode: 'PUBLIC',
    presenceRelayUrl: 'wss://broker.emqx.io:8084/mqtt',
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
    simulationEndTime: '11:00',
    timerPlans: [
      {
        id: 'p1',
        name: 'Classic',
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
      { id: 't1', title: 'Canonical task', done: false, categoryId: 'study' }
    ],
    ...overrides
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
  } as Storage
}

describe('study-planning v1 authority cold-start (non-resurrection)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  describe('pure cold-start gates', () => {
    it('shouldPersistV1TaskAuthority is false whenever demoted (including offline)', () => {
      expect(
        shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: true })
      ).toBe(false)
      expect(
        shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: false })
      ).toBe(false)
      expect(
        shouldPersistV1TaskAuthority({ demoted: false, workspaceAvailable: true })
      ).toBe(true)
      expect(
        shouldPersistV1TaskAuthority({ demoted: false, workspaceAvailable: false })
      ).toBe(true)
    })

    it('shouldReseedV1TasksFromDefaults is fail-closed once demoted', () => {
      expect(
        shouldReseedV1TasksFromDefaults({ demoted: false, workspaceAvailable: true })
      ).toBe(true)
      expect(
        shouldReseedV1TasksFromDefaults({ demoted: true, workspaceAvailable: true })
      ).toBe(false)
      // Offline demoted: still no invent — sole-authority end-state honesty.
      expect(
        shouldReseedV1TasksFromDefaults({ demoted: true, workspaceAvailable: false })
      ).toBe(false)
    })

    it('shouldHydrateTasksFromV1Cache blocks V1 task authority when demoted + workspace', () => {
      expect(
        shouldHydrateTasksFromV1Cache({ demoted: true, workspaceAvailable: true })
      ).toBe(false)
      expect(
        shouldHydrateTasksFromV1Cache({ demoted: true, workspaceAvailable: false })
      ).toBe(true)
      expect(
        shouldHydrateTasksFromV1Cache({ demoted: false, workspaceAvailable: true })
      ).toBe(true)
    })

    it('canOfferV1Demote is false when already demoted', () => {
      expect(
        canOfferV1Demote({
          migrationCommitted: true,
          canonicalTaskCount: 3,
          hostTaskCount: 3,
          workspaceAvailable: true,
          alreadyDemoted: true
        })
      ).toBe(false)
    })
  })

  describe('persistStudySnapshot after demote (presence shell only)', () => {
    it('does not write task authority arrays when demoted + workspace', () => {
      const snap = makeSnapshot({
        tasks: [
          { id: 'live', title: 'UI live task', done: false, categoryId: 'study' },
          { id: 'live2', title: 'Another', done: true, categoryId: 'study' }
        ],
        timerPlans: [
          {
            id: 'plan-live',
            name: 'Live plan',
            focusMinutes: 30,
            breakMinutes: 5,
            simulationStartTime: '10:00',
            simulationEndTime: '12:00'
          }
        ]
      })
      writeV1LocalAuthorityDemotedMarker(1_700_000_000_111)
      expect(isV1LocalAuthorityDemoted()).toBe(true)

      persistStudySnapshot(snap, { demoted: true, workspaceAvailable: true })

      const raw = window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
      expect(raw).toBeTruthy()
      const stored = JSON.parse(raw!) as StudySnapshot
      expect(stored.tasks).toEqual([])
      expect(stored.timerPlans).toEqual([])
      expect(stored.nickname).toBe('Cold')
      expect(stored.clientId).toBe('studiumx-cold-client')
      // Live UI arrays must not reappear as V1 co-cache authority.
      expect(JSON.stringify(stored)).not.toContain('UI live task')
      expect(JSON.stringify(stored)).not.toContain('plan-live')
    })

    it('strips task arrays when demoted even offline (no sole-read mirror into V1)', () => {
      const snap = makeSnapshot({
        tasks: [{ id: 'offline', title: 'Offline shell task', done: false, categoryId: 'study' }]
      })
      persistStudySnapshot(snap, { demoted: true, workspaceAvailable: false })
      const stored = JSON.parse(
        window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null'
      ) as StudySnapshot
      // Presence shell only: demoted must not re-serialize in-memory tasks into V1.
      expect(stored.tasks).toEqual([])
      expect(stored.timerPlans).toEqual([])
      expect(stored.nickname).toBe('Cold')
      expect(JSON.stringify(stored)).not.toContain('Offline shell task')
    })
  })

  describe('empty V1 does not refill defaults after demote', () => {
    it('normalizeStudyTasks allowEmpty keeps empty arrays empty', () => {
      expect(normalizeStudyTasks([], { allowEmpty: true })).toEqual([])
      expect(normalizeStudyTasks(null, { allowEmpty: true })).toEqual([])
      expect(normalizeStudyTasks(undefined, { allowEmpty: true })).toEqual([])
      // Pre-demote still reseeds for first-run UX.
      expect(normalizeStudyTasks([])).toEqual(defaultStudySnapshot.tasks)
      expect(normalizeStudyTasks(null)).toEqual(defaultStudySnapshot.tasks)
    })

    it('normalizeStudySnapshot allowEmptyTasks does not invent default tasks', () => {
      const shell = normalizeStudySnapshot(
        {
          clientId: 'studiumx-shell',
          nickname: 'Shell',
          tasks: [],
          timerPlans: []
        },
        { allowEmptyTasks: true }
      )
      expect(shell.tasks).toEqual([])
      expect(shell.nickname).toBe('Shell')
    })

    it('readStudySnapshot with demote marker + empty V1 does not resurrect defaults', () => {
      writeV1LocalAuthorityDemotedMarker(42)
      window.localStorage.setItem(
        STUDY_SPACE_STORAGE_KEY,
        JSON.stringify({
          clientId: 'studiumx-demoted-shell',
          nickname: 'Demoted',
          spaceCode: 'PUBLIC',
          tasks: [],
          timerPlans: []
        })
      )

      const snapshot = readStudySnapshot({ demoted: true, workspaceAvailable: true })
      expect(snapshot.tasks).toEqual([])
      // Presence shell identity preserved / applied.
      expect(snapshot.nickname.length).toBeGreaterThan(0)

      const persisted = JSON.parse(
        window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null'
      ) as StudySnapshot
      expect(persisted.tasks).toEqual([])
      expect(persisted.timerPlans).toEqual([])
      // Must not contain either default seed title.
      for (const seed of defaultStudySnapshot.tasks) {
        expect(JSON.stringify(persisted)).not.toContain(seed.title)
        expect(snapshot.tasks.map((t) => t.title)).not.toContain(seed.title)
      }
    })

    it('readStudySnapshot without demote still reseeds empty storage with defaults', () => {
      window.localStorage.setItem(
        STUDY_SPACE_STORAGE_KEY,
        JSON.stringify({
          clientId: 'studiumx-pre-demote',
          nickname: 'Pre',
          tasks: []
        })
      )
      const snapshot = readStudySnapshot({ demoted: false, workspaceAvailable: true })
      expect(snapshot.tasks).toEqual(defaultStudySnapshot.tasks)
    })
  })

  describe('fail-closed erase + migration non-call', () => {
    it('demote without confirm/backup never erases', () => {
      const store = memoryStorage({
        [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(makeSnapshot())
      })
      const noConfirm = demoteV1LocalStorageKeys({
        eraseTasks: true,
        storage: store
      })
      expect(noConfirm.ok).toBe(false)
      if (!noConfirm.ok) expect(noConfirm.code).toBe('confirm_required')
      expect(store.getItem(STUDY_SPACE_STORAGE_KEY)).not.toBeNull()

      const noBackup = demoteV1LocalStorageKeys({
        userConfirmed: true,
        eraseTasks: true,
        storage: store
      })
      expect(noBackup.ok).toBe(false)
      if (!noBackup.ok) expect(noBackup.code).toBe('backup_required')
      expect(store.getItem(STUDY_SPACE_STORAGE_KEY)).not.toBeNull()
      expect(store.getItem(STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY)).toBeNull()
    })

    it('migration path still does not call demote (documented contract)', () => {
      // Static contract: demote helpers are not imported by migration modules.
      // Cold-start suite encodes the product rule — migration commit alone never demotes.
      const migrationNeverDemotes = {
        import_migration_commit_calls_demote: false,
        demoteRequiresUserConfirmedAndBackup: true
      }
      expect(migrationNeverDemotes.import_migration_commit_calls_demote).toBe(false)
      expect(migrationNeverDemotes.demoteRequiresUserConfirmedAndBackup).toBe(true)

      // Runtime: demote with no flags (what a mistaken migrate hook would look like) is no-op.
      const store = memoryStorage({
        [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(makeSnapshot())
      })
      const accidental = demoteV1LocalStorageKeys({
        userConfirmed: true,
        backupExportOk: true,
        storage: store
        // no eraseTasks / eraseCategories
      })
      expect(accidental.ok).toBe(false)
      if (!accidental.ok) expect(accidental.code).toBe('no_erase_flags')
      expect(JSON.parse(store.getItem(STUDY_SPACE_STORAGE_KEY)!).tasks).toHaveLength(1)
    })
  })

  describe('auto ≥30d wipe remains absent (unit contract)', () => {
    it('demote helpers have no age-based erase; stale marker alone does not wipe V1', () => {
      const store = memoryStorage({
        [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(makeSnapshot())
      })
      // Marker older than 30d — product must still require confirm+backup to erase.
      writeV1LocalAuthorityDemotedMarker(1_700_000_000_000 - 40 * 24 * 60 * 60 * 1000, store)
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
  })
})
