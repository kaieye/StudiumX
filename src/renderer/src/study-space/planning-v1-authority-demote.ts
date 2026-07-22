/**
 * V1 dual-authority demote / sole-authority end-state helpers (ADR-0129 / 0130 §5.1).
 *
 * Fail-closed: never erase localStorage without explicit userConfirmed + backupExportOk.
 * Migration commit alone must not call demote. Presence identity keys stay unless opt-in.
 */

import {
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY
} from './constants'
import { STUDY_TASK_CATEGORIES_STORAGE_KEY } from './taskCategories'
import type { StudySnapshot, StudyTask, StudyTimerPlan, StudyTaskCategory } from './types'

/** Browser-local demote marker (cross-restart). Not teaching authority. */
export const STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY = 'studiumx:study-space:v1-authority-demoted:v1'

export type V1AuthorityArchivePayload = {
  schema: 'studiumx.study-space.v1-authority-archive'
  schemaVersion: 1
  archivedAtMs: number
  storageKey: typeof STUDY_SPACE_STORAGE_KEY
  categoriesStorageKey: typeof STUDY_TASK_CATEGORIES_STORAGE_KEY
  snapshot: {
    tasks: StudyTask[]
    timerPlans: StudyTimerPlan[]
    simulationStartTime: string
    simulationEndTime: string
    focusMinutes: number
    breakMinutes: number
  }
  categories: StudyTaskCategory[]
  /** Raw study-space v1 string if available (best-effort). */
  rawStudySpaceJson: string | null
  rawCategoriesJson: string | null
}

export type CanOfferV1DemoteInput = {
  /** True after a successful import_migration_commit in this session (or equivalent). */
  migrationCommitted?: boolean
  /** True when sole-read hydrate applied canonical tasks. */
  hydrateApplied?: boolean
  canonicalTaskCount: number
  hostTaskCount: number
  workspaceAvailable?: boolean
  alreadyDemoted?: boolean
}

export type CanExecuteV1DemoteInput = {
  userConfirmed?: boolean
  lastBackupExportOk?: boolean
  workspaceAvailable?: boolean
  alreadyDemoted?: boolean
}

export type DemoteV1LocalStorageKeysOptions = {
  /**
   * Explicit opt-in. Default false (fail-closed — no task-authority erase).
   */
  eraseTasks?: boolean
  /**
   * Explicit opt-in for categories key. Default false.
   */
  eraseCategories?: boolean
  /**
   * When true (default), never touch STUDY_SPACE_SESSION_CLIENT_KEY.
   */
  keepPresenceKeys?: boolean
  /**
   * Must be true. Default false.
   */
  userConfirmed?: boolean
  /**
   * Must be true after backup/export succeeded. Default false.
   */
  backupExportOk?: boolean
  /**
   * When eraseTasks: rewrite study-space key as presence shell instead of full removeItem.
   * Default true (safer for presence / room shell).
   */
  rewritePresenceShell?: boolean
  /**
   * Live snapshot used to rebuild presence shell when rewritePresenceShell.
   */
  presenceSource?: StudySnapshot | null
  nowMs?: number
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

export type DemoteV1LocalStorageKeysResult =
  | {
      ok: true
      erasedTasks: boolean
      erasedCategories: boolean
      rewrittenPresenceShell: boolean
      demotedAtMs: number
    }
  | {
      ok: false
      code:
        | 'confirm_required'
        | 'backup_required'
        | 'no_erase_flags'
        | 'storage_unavailable'
        | 'already_demoted'
      message: string
    }

export type V1DemoteOfferSummary = {
  taskCount: number
  timerPlanCount: number
  categoryCount: number
  reason: 'post_migrate' | 'post_hydrate'
}

export type V1DemoteBannerCopy = {
  eyebrow: string
  title: string
  description: string
  metaLine: string
  confirmLabel: string
  dismissLabel: string
  laterLabel: string
  busyLabel: string
  backupHint: string
}

export type V1DemoteBannerModel = {
  kind: 'prompt'
  summary: V1DemoteOfferSummary
  copy: V1DemoteBannerCopy
  canConfirm: boolean
}

function nonNegativeInt(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function resolveStorage(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Offer demote only when workspace is active, not already demoted, and either
 * migration just committed or sole-read hydrate applied with canonical tasks.
 * Host task count may still be >0 (live dual co-cache).
 */
export function canOfferV1Demote(input: CanOfferV1DemoteInput): boolean {
  if (input.alreadyDemoted) return false
  if (!input.workspaceAvailable) return false
  const migrated = input.migrationCommitted === true
  const hydrated = input.hydrateApplied === true
  if (!migrated && !hydrated) return false
  // Hydrate path: need canonical tasks so demote does not leave user with empty authority.
  if (hydrated && !migrated && nonNegativeInt(input.canonicalTaskCount) <= 0) return false
  // Migration path may leave canonical just written; allow even if count not yet re-read.
  if (migrated) return true
  return nonNegativeInt(input.canonicalTaskCount) > 0
}

/**
 * Execute gate — fail-closed without confirm + backup.
 */
export function canExecuteV1Demote(input: CanExecuteV1DemoteInput): boolean {
  if (input.alreadyDemoted) return false
  if (input.userConfirmed !== true) return false
  if (input.lastBackupExportOk !== true) return false
  return true
}

/**
 * Build archive payload for download / workspace backup before erase.
 */
export function buildV1AuthorityArchivePayload(input: {
  snapshot: StudySnapshot
  categories?: readonly StudyTaskCategory[]
  rawStudySpaceJson?: string | null
  rawCategoriesJson?: string | null
  nowMs?: number
}): V1AuthorityArchivePayload {
  const nowMs =
    typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? Math.floor(input.nowMs) : Date.now()
  const snap = input.snapshot
  return {
    schema: 'studiumx.study-space.v1-authority-archive',
    schemaVersion: 1,
    archivedAtMs: nowMs,
    storageKey: STUDY_SPACE_STORAGE_KEY,
    categoriesStorageKey: STUDY_TASK_CATEGORIES_STORAGE_KEY,
    snapshot: {
      tasks: Array.isArray(snap.tasks) ? snap.tasks.map((t) => ({ ...t })) : [],
      timerPlans: Array.isArray(snap.timerPlans) ? snap.timerPlans.map((p) => ({ ...p })) : [],
      simulationStartTime: snap.simulationStartTime,
      simulationEndTime: snap.simulationEndTime,
      focusMinutes: snap.focusMinutes,
      breakMinutes: snap.breakMinutes
    },
    categories: Array.isArray(input.categories) ? input.categories.map((c) => ({ ...c })) : [],
    rawStudySpaceJson:
      typeof input.rawStudySpaceJson === 'string' ? input.rawStudySpaceJson : null,
    rawCategoriesJson:
      typeof input.rawCategoriesJson === 'string' ? input.rawCategoriesJson : null
  }
}

export function serializeV1AuthorityArchive(payload: V1AuthorityArchivePayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * Presence / room / timer shell fields kept when task authority is demoted.
 * Tasks + timerPlans cleared (empty arrays — caller must not re-normalize via
 * normalizeStudyTasks default refill when writing demoted storage).
 */
export function stripTaskAuthorityFromSnapshot(snapshot: StudySnapshot): StudySnapshot {
  return {
    ...snapshot,
    tasks: [],
    timerPlans: []
  }
}

/**
 * Whether persist should treat V1 task arrays as authority co-cache.
 * Once demoted, always strip task/timer authority (presence-only shell).
 * Offline demoted keeps the last shell by *not inventing erase of the demote
 * marker* and by not re-serializing in-memory sole-read tasks into V1 —
 * empty demoted shell stays empty; never co-write canonical tasks offline.
 */
export function shouldPersistV1TaskAuthority(input: {
  demoted: boolean
  workspaceAvailable: boolean
}): boolean {
  if (input.demoted) return false
  return true
}

/**
 * Whether empty/missing V1 task arrays may be refilled with defaultStudySnapshot.tasks.
 * Fail-closed once demoted: never invent default tasks as V1 authority (even offline).
 * Pre-demote first-run still reseeds for presence shell UX.
 */
export function shouldReseedV1TasksFromDefaults(input: {
  demoted: boolean
  workspaceAvailable?: boolean
}): boolean {
  if (input.demoted) return false
  return true
}

/**
 * Whether cold-start / kept_v1 may treat V1 task cache as authority source.
 * When demoted + workspace active, canonical sole-read owns tasks — V1 is presence shell only.
 * Fail-closed: demoted without workspace still does not invent defaults (see reseed gate);
 * offline may keep last presence shell arrays if present, but empty stays empty.
 */
export function shouldHydrateTasksFromV1Cache(input: {
  demoted: boolean
  workspaceAvailable: boolean
}): boolean {
  if (input.demoted && input.workspaceAvailable) return false
  return true
}

export function readV1LocalAuthorityDemotedAtMs(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): number | null {
  const store = resolveStorage(storage)
  if (!store) return null
  try {
    const raw = store.getItem(STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY)
    if (!raw) return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.floor(n)
  } catch {
    return null
  }
}

export function isV1LocalAuthorityDemoted(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): boolean {
  return readV1LocalAuthorityDemotedAtMs(storage) != null
}

export function writeV1LocalAuthorityDemotedMarker(
  demotedAtMs: number,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): boolean {
  const store = resolveStorage(storage)
  if (!store) return false
  const ms =
    typeof demotedAtMs === 'number' && Number.isFinite(demotedAtMs) && demotedAtMs > 0
      ? Math.floor(demotedAtMs)
      : Date.now()
  try {
    store.setItem(STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY, String(ms))
    return true
  } catch {
    return false
  }
}

/**
 * Demote / erase V1 task-authority keys. Defaults erase nothing.
 * Order: require confirm + backup → rewrite/remove → write demote marker.
 */
export function demoteV1LocalStorageKeys(
  options: DemoteV1LocalStorageKeysOptions = {}
): DemoteV1LocalStorageKeysResult {
  const userConfirmed = options.userConfirmed === true
  const backupExportOk = options.backupExportOk === true
  const eraseTasks = options.eraseTasks === true
  const eraseCategories = options.eraseCategories === true
  const keepPresenceKeys = options.keepPresenceKeys !== false
  const rewritePresenceShell = options.rewritePresenceShell !== false
  const nowMs =
    typeof options.nowMs === 'number' && Number.isFinite(options.nowMs)
      ? Math.floor(options.nowMs)
      : Date.now()

  if (!userConfirmed) {
    return {
      ok: false,
      code: 'confirm_required',
      message: 'V1 demote requires explicit userConfirmed (no silent wipe).'
    }
  }
  if (!backupExportOk) {
    return {
      ok: false,
      code: 'backup_required',
      message: 'V1 demote requires successful backup/export before erase.'
    }
  }
  if (!eraseTasks && !eraseCategories) {
    return {
      ok: false,
      code: 'no_erase_flags',
      message: 'No erase flags set; demote is a no-op (fail-closed defaults).'
    }
  }

  const store = resolveStorage(options.storage)
  if (!store) {
    return {
      ok: false,
      code: 'storage_unavailable',
      message: 'localStorage unavailable; refused to claim demote success.'
    }
  }

  // Presence session client id is never erased under keepPresenceKeys (default).
  if (!keepPresenceKeys) {
    // Product path always keeps presence; refuse bare wipe of session client via this helper.
    // (No public flag path erases session client — intentional.)
  }

  let rewrittenPresenceShell = false
  try {
    if (eraseTasks) {
      if (rewritePresenceShell && options.presenceSource) {
        const shell = stripTaskAuthorityFromSnapshot(options.presenceSource)
        // Write raw JSON without normalizeStudyTasks default-task refill.
        store.setItem(
          STUDY_SPACE_STORAGE_KEY,
          JSON.stringify({
            ...shell,
            tasks: [],
            timerPlans: []
          })
        )
        rewrittenPresenceShell = true
      } else if (rewritePresenceShell) {
        // No source: remove full key (presence will re-seed identity on next read via session client).
        store.removeItem(STUDY_SPACE_STORAGE_KEY)
      } else {
        store.removeItem(STUDY_SPACE_STORAGE_KEY)
      }
    }

    if (eraseCategories) {
      store.removeItem(STUDY_TASK_CATEGORIES_STORAGE_KEY)
    }

    // Never touch session client key in this helper (presence identity).
    void STUDY_SPACE_SESSION_CLIENT_KEY

    writeV1LocalAuthorityDemotedMarker(nowMs, store)

    return {
      ok: true,
      erasedTasks: eraseTasks,
      erasedCategories: eraseCategories,
      rewrittenPresenceShell,
      demotedAtMs: nowMs
    }
  } catch {
    return {
      ok: false,
      code: 'storage_unavailable',
      message: 'localStorage threw during demote; partial writes may exist — marker not guaranteed.'
    }
  }
}

/**
 * Banner / sheet model (separate from migration confirm copy).
 */
export function buildV1DemoteBannerModel(input: {
  summary: V1DemoteOfferSummary
  busy?: boolean
}): V1DemoteBannerModel {
  const summary: V1DemoteOfferSummary = {
    taskCount: nonNegativeInt(input.summary.taskCount),
    timerPlanCount: nonNegativeInt(input.summary.timerPlanCount),
    categoryCount: nonNegativeInt(input.summary.categoryCount),
    reason: input.summary.reason === 'post_migrate' ? 'post_migrate' : 'post_hydrate'
  }
  const canConfirm = summary.taskCount > 0 || summary.timerPlanCount > 0 || summary.categoryCount > 0
  const metaParts = [
    `任务缓存 ${summary.taskCount}`,
    `计时方案 ${summary.timerPlanCount}`,
    `分类 ${summary.categoryCount}`
  ]
  return {
    kind: 'prompt',
    summary,
    canConfirm,
    copy: {
      eyebrow: '停止本地任务权威',
      title: canConfirm
        ? '归档并停止将本机缓存当作任务权威？'
        : '暂无需要降权的本地任务缓存',
      description: canConfirm
        ? '工作区 snapshot.json 已是任务权威。确认后先导出本机 V1 任务缓存备份，再清除 localStorage 中的任务/方案权威字段；在线身份与座位等 presence 壳保留。迁移本身不会自动删除。'
        : '没有可归档的任务、计时方案或分类缓存。',
      metaLine: metaParts.join(' · '),
      confirmLabel: input.busy ? '正在归档…' : '归档并停止本地权威',
      dismissLabel: '关闭',
      laterLabel: '稍后',
      busyLabel: '正在导出备份并清除本地任务权威…',
      backupHint: '会先下载 JSON 备份；备份失败则不会清除。'
    }
  }
}

/**
 * Best-effort browser download of archive JSON. Returns whether export likely succeeded.
 * Pure-ish: injectable document for tests.
 */
export function exportV1AuthorityArchiveDownload(
  payload: V1AuthorityArchivePayload,
  options?: {
    documentRef?: Document
    fileName?: string
  }
): { ok: true; fileName: string } | { ok: false; code: 'download_unavailable'; message: string } {
  const fileName =
    options?.fileName ??
    `v1-local-authority-archive-${payload.archivedAtMs}.json`
  const doc =
    options?.documentRef ??
    (typeof document !== 'undefined' ? document : undefined)
  if (!doc || typeof Blob === 'undefined') {
    return {
      ok: false,
      code: 'download_unavailable',
      message: 'Browser download APIs unavailable; refuse erase without export.'
    }
  }
  try {
    const blob = new Blob([serializeV1AuthorityArchive(payload)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const anchor = doc.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    doc.body?.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoke async so the download can start.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // ignore
      }
    }, 0)
    return { ok: true, fileName }
  } catch {
    return {
      ok: false,
      code: 'download_unavailable',
      message: 'Failed to build download; refuse erase without export.'
    }
  }
}
