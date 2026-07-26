/**
 * Pure spaced-review scheduler projection (ADR-0154).
 *
 * Deterministic, dependency-free, and rebuildable: same inputs always produce
 * the same schedule. This module never reads the filesystem, never writes the
 * LearningSessionLedger, and never settles outcomes — it only projects review
 * timing facts from caller-supplied evidence history. Callers own all I/O and
 * pass `now` explicitly (no Date.now() inside the projection).
 */

export const REVIEW_SCHEDULE_SCHEMA_VERSION = 1 as const

/**
 * Fixed interval ladder (days) for v1. Deterministic and parameter-free by
 * design; adaptive parameters (FSRS-style) require a new ADR with reproducible
 * failure evidence, mirroring the ADR-0050 signal-triggered upgrade pattern.
 */
export const REVIEW_INTERVAL_LADDER_DAYS: readonly number[] = [1, 3, 7, 21, 60]

/** Due items surfaced per derivation by default — a study nudge, not a debt wall. */
export const DEFAULT_REVIEW_DUE_LIMIT = 5

const DAY_MS = 24 * 60 * 60 * 1000

export type ReviewItemKind = 'quiz' | 'flashcard'

export type ReviewScheduleState = 'new' | 'scheduled' | 'due' | 'lapsed'

/** One observed attempt for an item. `correct` folds flashcard self-ratings (again → false). */
export type ReviewHistoryEntry = {
  observedAt: string
  correct: boolean
}

export type ReviewScheduleItemInput = {
  /** Stable item identity (e.g. `quiz-1`, flashcard artifact card id). */
  itemId: string
  lessonId: string
  kind: ReviewItemKind
  /**
   * Anchor for items with no history yet (e.g. lesson createdAt). New items
   * become due one ladder-base interval after the anchor.
   */
  anchorAt: string
  history: readonly ReviewHistoryEntry[]
}

export type ReviewScheduleItem = {
  itemId: string
  lessonId: string
  kind: ReviewItemKind
  state: ReviewScheduleState
  /** Consecutive correct attempts counted from the latest entry backwards. */
  successStreak: number
  /** Index into REVIEW_INTERVAL_LADDER_DAYS used for nextDueAt (0-based). */
  intervalIndex: number
  lastObservedAt: string | null
  nextDueAt: string
  /** True when nextDueAt <= now and the item made it under the due limit. */
  dueNow: boolean
}

export type ReviewSchedule = {
  schemaVersion: typeof REVIEW_SCHEDULE_SCHEMA_VERSION
  /** Items due at `now` after applying the due limit, most overdue first. */
  dueNow: ReviewScheduleItem[]
  /** Total items whose nextDueAt <= now before applying the due limit. */
  dueCount: number
  /** Every derived item, sorted by nextDueAt then itemId (stable). */
  items: ReviewScheduleItem[]
}

export type DeriveReviewScheduleInput = {
  items: readonly ReviewScheduleItemInput[]
  /** ISO timestamp supplied by the caller — determinism requires explicit time. */
  now: string
  /** Max dueNow entries (default DEFAULT_REVIEW_DUE_LIMIT; 0 allowed for count-only use). */
  dueLimit?: number
}

/**
 * Rules (v1, documented in ADR-0154):
 * - successStreak = consecutive `correct: true` entries from the latest attempt
 *   backwards; any incorrect attempt resets the streak below it.
 * - After a correct latest attempt: nextDueAt = lastObservedAt +
 *   ladder[min(successStreak - 1, ladder.length - 1)] days, state `scheduled`
 *   (or `due` once reached).
 * - After an incorrect latest attempt: state `lapsed`, nextDueAt =
 *   lastObservedAt + ladder[0] days (fall back to the base interval).
 * - No history: state `new`, nextDueAt = anchorAt + ladder[0] days.
 * - Invalid timestamps exclude the entry (fail-soft, never invent time facts).
 */
export function deriveReviewSchedule(input: DeriveReviewScheduleInput): ReviewSchedule {
  const nowMs = parseIsoMs(input.now)
  const items: ReviewScheduleItem[] = []
  if (nowMs === null) {
    return { schemaVersion: REVIEW_SCHEDULE_SCHEMA_VERSION, dueNow: [], dueCount: 0, items }
  }

  for (const raw of input.items) {
    const derived = deriveItem(raw, nowMs)
    if (derived) items.push(derived)
  }

  items.sort(compareByDueThenId)
  const due = items.filter((item) => parseIsoMs(item.nextDueAt)! <= nowMs)
  const limit = normalizeDueLimit(input.dueLimit)
  const dueNow = due.slice(0, limit)
  const dueNowIds = new Set(dueNow.map((item) => scheduleItemKey(item)))
  const finalized = items.map((item) => ({ ...item, dueNow: dueNowIds.has(scheduleItemKey(item)) }))

  return {
    schemaVersion: REVIEW_SCHEDULE_SCHEMA_VERSION,
    dueNow: finalized.filter((item) => item.dueNow),
    dueCount: due.length,
    items: finalized
  }
}

function deriveItem(raw: ReviewScheduleItemInput, nowMs: number): ReviewScheduleItem | null {
  const itemId = String(raw.itemId ?? '').trim()
  const lessonId = String(raw.lessonId ?? '').trim()
  if (!itemId || !lessonId) return null
  if (raw.kind !== 'quiz' && raw.kind !== 'flashcard') return null

  const history = [...(raw.history ?? [])]
    .map((entry) => ({ observedAtMs: parseIsoMs(entry.observedAt), correct: entry.correct === true }))
    .filter((entry): entry is { observedAtMs: number; correct: boolean } => entry.observedAtMs !== null)
    .sort((left, right) => left.observedAtMs - right.observedAtMs)

  if (history.length === 0) {
    const anchorMs = parseIsoMs(raw.anchorAt)
    if (anchorMs === null) return null
    const dueMs = anchorMs + ladderDays(0) * DAY_MS
    return {
      itemId,
      lessonId,
      kind: raw.kind,
      state: dueMs <= nowMs ? 'due' : 'new',
      successStreak: 0,
      intervalIndex: 0,
      lastObservedAt: null,
      nextDueAt: toIso(dueMs),
      dueNow: false
    }
  }

  const latest = history[history.length - 1]!
  let successStreak = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!history[index]!.correct) break
    successStreak += 1
  }

  if (!latest.correct) {
    const dueMs = latest.observedAtMs + ladderDays(0) * DAY_MS
    return {
      itemId,
      lessonId,
      kind: raw.kind,
      state: 'lapsed',
      successStreak: 0,
      intervalIndex: 0,
      lastObservedAt: toIso(latest.observedAtMs),
      nextDueAt: toIso(dueMs),
      dueNow: false
    }
  }

  const intervalIndex = Math.min(successStreak - 1, REVIEW_INTERVAL_LADDER_DAYS.length - 1)
  const dueMs = latest.observedAtMs + ladderDays(intervalIndex) * DAY_MS
  return {
    itemId,
    lessonId,
    kind: raw.kind,
    state: dueMs <= nowMs ? 'due' : 'scheduled',
    successStreak,
    intervalIndex,
    lastObservedAt: toIso(latest.observedAtMs),
    nextDueAt: toIso(dueMs),
    dueNow: false
  }
}

function ladderDays(index: number): number {
  const clamped = Math.max(0, Math.min(index, REVIEW_INTERVAL_LADDER_DAYS.length - 1))
  return REVIEW_INTERVAL_LADDER_DAYS[clamped]!
}

function normalizeDueLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_REVIEW_DUE_LIMIT
  if (!Number.isInteger(value) || value < 0) return DEFAULT_REVIEW_DUE_LIMIT
  return value
}

function compareByDueThenId(left: ReviewScheduleItem, right: ReviewScheduleItem): number {
  const leftMs = parseIsoMs(left.nextDueAt) ?? 0
  const rightMs = parseIsoMs(right.nextDueAt) ?? 0
  if (leftMs !== rightMs) return leftMs - rightMs
  if (left.lessonId !== right.lessonId) return left.lessonId.localeCompare(right.lessonId)
  return left.itemId.localeCompare(right.itemId)
}

function scheduleItemKey(item: ReviewScheduleItem): string {
  return `${item.lessonId}${item.itemId}`
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Map a flashcard self-rating onto the shared correct/incorrect history axis. */
export function flashcardRatingToCorrect(rating: 'again' | 'hard' | 'good' | 'easy'): boolean {
  return rating !== 'again'
}
