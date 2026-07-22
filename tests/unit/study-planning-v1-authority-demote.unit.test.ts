/**
 * V1 dual-authority demote pure helpers (ADR-0129 / 0130 §5.1 residual).
 * Fail-closed erase; backup-before-erase; no silent wipe on migration path.
 */

import { describe, expect, it } from 'vitest'
import {
  STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
  buildV1AuthorityArchivePayload,
  buildV1DemoteBannerModel,
  canExecuteV1Demote,
  canOfferV1Demote,
  demoteV1LocalStorageKeys,
  exportV1AuthorityArchiveDownload,
  isV1LocalAuthorityDemoted,
  readV1LocalAuthorityDemotedAtMs,
  shouldPersistV1TaskAuthority,
  stripTaskAuthorityFromSnapshot,
  writeV1LocalAuthorityDemotedMarker
} from '../../src/renderer/src/study-space/planning-v1-authority-demote'
import {
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY
} from '../../src/renderer/src/study-space/constants'
import { STUDY_TASK_CATEGORIES_STORAGE_KEY } from '../../src/renderer/src/study-space/taskCategories'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

function makeSnapshot(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    clientId: 'studiumx-test-client',
    nickname: 'Tester',
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
      { id: 't1', title: 'Task one', done: false, categoryId: 'study' },
      { id: 't2', title: 'Task two', done: true, categoryId: 'study' }
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

describe('study-planning v1 authority demote (sole-authority end-state)', () => {
  describe('canOfferV1Demote', () => {
    it('refuses when already demoted or no workspace', () => {
      expect(
        canOfferV1Demote({
          migrationCommitted: true,
          canonicalTaskCount: 3,
          hostTaskCount: 3,
          workspaceAvailable: true,
          alreadyDemoted: true
        })
      ).toBe(false)
      expect(
        canOfferV1Demote({
          migrationCommitted: true,
          canonicalTaskCount: 3,
          hostTaskCount: 3,
          workspaceAvailable: false
        })
      ).toBe(false)
    })

    it('offers after migrate even before hydrate re-count', () => {
      expect(
        canOfferV1Demote({
          migrationCommitted: true,
          hydrateApplied: false,
          canonicalTaskCount: 0,
          hostTaskCount: 2,
          workspaceAvailable: true
        })
      ).toBe(true)
    })

    it('offers after hydrate only when canonical has tasks', () => {
      expect(
        canOfferV1Demote({
          hydrateApplied: true,
          canonicalTaskCount: 0,
          hostTaskCount: 4,
          workspaceAvailable: true
        })
      ).toBe(false)
      expect(
        canOfferV1Demote({
          hydrateApplied: true,
          canonicalTaskCount: 2,
          hostTaskCount: 4,
          workspaceAvailable: true
        })
      ).toBe(true)
    })

    it('does not offer without migrate or hydrate signal', () => {
      expect(
        canOfferV1Demote({
          canonicalTaskCount: 5,
          hostTaskCount: 5,
          workspaceAvailable: true
        })
      ).toBe(false)
    })
  })

  describe('canExecuteV1Demote + demote defaults (no erase without confirm)', () => {
    it('execute gate requires confirm + backup', () => {
      expect(canExecuteV1Demote({})).toBe(false)
      expect(canExecuteV1Demote({ userConfirmed: true })).toBe(false)
      expect(canExecuteV1Demote({ lastBackupExportOk: true })).toBe(false)
      expect(
        canExecuteV1Demote({ userConfirmed: true, lastBackupExportOk: true })
      ).toBe(true)
      expect(
        canExecuteV1Demote({
          userConfirmed: true,
          lastBackupExportOk: true,
          alreadyDemoted: true
        })
      ).toBe(false)
    })

    it('demoteV1LocalStorageKeys defaults erase nothing (fail-closed)', () => {
      const store = memoryStorage({
        [STUDY_SPACE_STORAGE_KEY]: JSON.stringify({ tasks: [{ id: 'x', title: 'X' }] })
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

      const noFlags = demoteV1LocalStorageKeys({
        userConfirmed: true,
        backupExportOk: true,
        storage: store
      })
      expect(noFlags.ok).toBe(false)
      if (!noFlags.ok) expect(noFlags.code).toBe('no_erase_flags')
      expect(store.getItem(STUDY_SPACE_STORAGE_KEY)).not.toBeNull()
    })

    it('after confirm+backup rewrites presence shell and sets marker; keeps session client', () => {
      const snap = makeSnapshot()
      const store = memoryStorage({
        [STUDY_SPACE_STORAGE_KEY]: JSON.stringify(snap),
        [STUDY_TASK_CATEGORIES_STORAGE_KEY]: JSON.stringify([
          { id: 'study', name: '学习', color: '#8197aa', builtin: true }
        ]),
        [STUDY_SPACE_SESSION_CLIENT_KEY]: 'studiumx-session-keep'
      })
      const result = demoteV1LocalStorageKeys({
        userConfirmed: true,
        backupExportOk: true,
        eraseTasks: true,
        eraseCategories: true,
        keepPresenceKeys: true,
        rewritePresenceShell: true,
        presenceSource: snap,
        nowMs: 1_700_000_000_000,
        storage: store
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.erasedTasks).toBe(true)
      expect(result.erasedCategories).toBe(true)
      expect(result.rewrittenPresenceShell).toBe(true)
      expect(result.demotedAtMs).toBe(1_700_000_000_000)

      const rewritten = JSON.parse(store.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null') as StudySnapshot
      expect(rewritten).toBeTruthy()
      expect(rewritten.tasks).toEqual([])
      expect(rewritten.timerPlans).toEqual([])
      expect(rewritten.nickname).toBe('Tester')
      expect(rewritten.clientId).toBe('studiumx-test-client')
      expect(store.getItem(STUDY_TASK_CATEGORIES_STORAGE_KEY)).toBeNull()
      // session client key lives in sessionStorage product path; helper must not remove it from local map
      expect(store.getItem(STUDY_SPACE_SESSION_CLIENT_KEY)).toBe('studiumx-session-keep')
      expect(store.getItem(STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY)).toBe('1700000000000')
      expect(isV1LocalAuthorityDemoted(store)).toBe(true)
      expect(readV1LocalAuthorityDemotedAtMs(store)).toBe(1_700_000_000_000)
    })
  })

  describe('archive + banner model', () => {
    it('builds archive payload with task authority fields', () => {
      const snap = makeSnapshot()
      const archive = buildV1AuthorityArchivePayload({
        snapshot: snap,
        categories: [{ id: 'study', name: '学习', color: '#8197aa', builtin: true }],
        nowMs: 42
      })
      expect(archive.schema).toBe('studiumx.study-space.v1-authority-archive')
      expect(archive.schemaVersion).toBe(1)
      expect(archive.archivedAtMs).toBe(42)
      expect(archive.snapshot.tasks).toHaveLength(2)
      expect(archive.snapshot.timerPlans).toHaveLength(1)
      expect(archive.categories).toHaveLength(1)
    })

    it('builds demote banner distinct from migration copy', () => {
      const model = buildV1DemoteBannerModel({
        summary: {
          taskCount: 2,
          timerPlanCount: 1,
          categoryCount: 3,
          reason: 'post_hydrate'
        }
      })
      expect(model.canConfirm).toBe(true)
      expect(model.copy.eyebrow).toContain('本地')
      expect(model.copy.title).toContain('归档')
      expect(model.copy.confirmLabel).toContain('停止本地权威')
      expect(model.copy.backupHint.length).toBeGreaterThan(0)
      expect(model.copy.description).toContain('不会自动删除')
    })

    it('export fails closed without document APIs', () => {
      const archive = buildV1AuthorityArchivePayload({
        snapshot: makeSnapshot(),
        nowMs: 1
      })
      const result = exportV1AuthorityArchiveDownload(archive, {
        documentRef: undefined
      })
      // When document is undefined and global document may exist in jsdom —
      // force via null documentRef path: function uses options?.documentRef ?? document
      // So pass a stub missing createElement? Better: call when Blob missing is hard.
      // We assert the fail path by overriding with a broken document.
      const broken = {
        createElement: () => {
          throw new Error('no')
        },
        body: { appendChild() {}, removeChild() {} }
      } as unknown as Document
      const failed = exportV1AuthorityArchiveDownload(archive, { documentRef: broken })
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.code).toBe('download_unavailable')
      void result
    })
  })

  describe('persist gate helpers', () => {
    it('stripTaskAuthorityFromSnapshot clears tasks and timerPlans only', () => {
      const snap = makeSnapshot()
      const stripped = stripTaskAuthorityFromSnapshot(snap)
      expect(stripped.tasks).toEqual([])
      expect(stripped.timerPlans).toEqual([])
      expect(stripped.nickname).toBe(snap.nickname)
      expect(stripped.clientId).toBe(snap.clientId)
      expect(stripped.spaceCode).toBe(snap.spaceCode)
    })

    it('shouldPersistV1TaskAuthority stops only when demoted + workspace', () => {
      expect(shouldPersistV1TaskAuthority({ demoted: false, workspaceAvailable: true })).toBe(
        true
      )
      expect(shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: false })).toBe(
        true
      )
      expect(shouldPersistV1TaskAuthority({ demoted: true, workspaceAvailable: true })).toBe(
        false
      )
    })

    it('write/read demote marker round-trip', () => {
      const store = memoryStorage()
      expect(isV1LocalAuthorityDemoted(store)).toBe(false)
      expect(writeV1LocalAuthorityDemotedMarker(99, store)).toBe(true)
      expect(readV1LocalAuthorityDemotedAtMs(store)).toBe(99)
      expect(isV1LocalAuthorityDemoted(store)).toBe(true)
    })
  })
})
