/**
 * Shared UI helpers + constants for the web planning view.
 *
 * Pure presentational utilities only - no `window.teachingSystem` access here
 * (that seam lives in `usePlanning.ts`). Category metadata mirrors the desktop
 * builtin catalog (`src/renderer/src/study-space/taskCategories.ts`) so task
 * chips render identically without importing the renderer closure.
 */

import type {
  ScheduleBlockKind,
  ScheduleBlockStatus,
  PlanningTaskPriority,
  PlanningTaskStatus,
  StudyPlanningCommandEnvelope,
  StudyPlanningCommandType
} from '@shared/study-planning'

/**
 * Stable web workspace key. The server keys study-planning on the authenticated
 * user (Bearer), so this value is accepted by the adapter but ignored for
 * transport (porting-features.md §0 "workspaceRoot plumbing"). Kept non-empty
 * to satisfy the desktop `normalizeWorkspaceRoot` contract used elsewhere.
 */
export const WEB_WORKSPACE_ROOT = 'web'

/** Builtin task categories (mirrors `builtinStudyTaskCategories`). */
export const BUILTIN_CATEGORIES: ReadonlyArray<{
  id: string
  name: string
  color: string
}> = [
  { id: 'study', name: '学习', color: '#8197aa' },
  { id: 'entertainment', name: '娱乐', color: '#9c8aa5' },
  { id: 'exercise', name: '锻炼', color: '#829d91' },
  { id: 'other', name: '其他', color: '#8a9096' }
]

export function categoryLabel(id: string | null | undefined): string {
  if (!id) return '收件箱'
  return BUILTIN_CATEGORIES.find((c) => c.id === id)?.name ?? id
}

export function categoryColor(id: string | null | undefined): string {
  return BUILTIN_CATEGORIES.find((c) => c.id === id)?.color ?? '#8a9096'
}

export const TASK_STATUS_LABEL: Record<PlanningTaskStatus, string> = {
  open: '进行中',
  done: '已完成',
  cancelled: '已取消'
}

export const TASK_PRIORITY_LABEL: Record<PlanningTaskPriority, string> = {
  low: '低',
  normal: '中',
  high: '高'
}

export const BLOCK_KIND_LABEL: Record<ScheduleBlockKind, string> = {
  focus: '专注',
  short_break: '短休息',
  long_break: '长休息',
  wrap_up: '收尾'
}

export const BLOCK_STATUS_LABEL: Record<ScheduleBlockStatus, string> = {
  planned: '已计划',
  running: '进行中',
  completed: '已完成',
  skipped: '已跳过',
  cancelled: '已取消'
}

/** Generate a unique id (task / block / actionId). Web Crypto where available. */
export function newId(prefix?: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}-${rand}` : rand
}

/** Build a command envelope with a fresh `actionId` (required by the reducer). */
export function makeCommand(
  type: StudyPlanningCommandType,
  payload: unknown,
  operationId?: string
): StudyPlanningCommandEnvelope {
  return {
    actionId: newId('action'),
    ...(operationId ? { operationId } : {}),
    type,
    payload,
    clientIssuedAtMs: Date.now()
  }
}

/** Format an epoch-ms timestamp as a local date-time string. */
export function formatTimestamp(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Format a duration in minutes as e.g. "1h 30m" / "45m". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h <= 0) return `${m}m`
  if (m <= 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Format a schedule block's [start, end) range as a local string. */
export function formatBlockRange(startAtMs: number, endAtMs: number): string {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) return '—'
  const start = new Date(startAtMs)
  const end = new Date(endAtMs)
  const sameDay = start.toDateString() === end.toDateString()
  const startStr = start.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
  const endStr = end.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
  return sameDay
    ? `${startStr} – ${end.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : `${startStr} – ${endStr}`
}

/**
 * Convert a `<input type="datetime-local">` value (local wall time,
 * "YYYY-MM-DDTHH:mm") to epoch ms. Returns null for empty/invalid input.
 */
export function datetimeLocalToMs(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Convert epoch ms to a value suitable for `<input type="datetime-local">`
 * (local wall time, "YYYY-MM-DDTHH:mm"). Returns '' for invalid input.
 */
export function msToDatetimeLocal(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

/** The user's IANA timezone (for stamping new schedule blocks). */
export function userTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
