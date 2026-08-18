/**
 * Study planning pure domain — repeating tasks / schedule blocks (STC-703).
 *
 * Models recurrence as a separate rule attached to one Task (or break template),
 * then expands to concrete ScheduleBlock drafts for a given window.
 *
 * Pure + deterministic for fixed inputs. Does not write store, mutate historical
 * TimerSession, or invent task identity (roadmap §3.2 / §7.3).
 *
 * Non-wire sketch: not a frozen ADR-0011 snapshot field; callers may persist
 * RecurrenceRule alongside planning data later.
 */

import type { ScheduleBlock, ScheduleBlockKind } from './schedule-block'
import { isValidScheduleBlockInterval, validateScheduleBlocks } from './schedule-block'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** JS Date weekday: 0=Sunday … 6=Saturday (same as migrate-v1 interval math). */
export type JsWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type RecurrenceFrequency = 'daily' | 'weekly'

/**
 * Repeating plan template. Identity stays on Task; this is not a Task clone.
 * Breaks/wrap-ups may set taskId null (same as ScheduleBlock).
 */
export type RecurrenceRule = {
  id: string
  /** Owning task for focus blocks; null for break/wrap templates. */
  taskId: string | null
  kind: ScheduleBlockKind
  frequency: RecurrenceFrequency
  /**
   * When frequency is weekly: which JS weekdays fire (0=Sun … 6=Sat).
   * Empty or omitted for daily.
   */
  byWeekday?: readonly JsWeekday[]
  /** Inclusive epoch ms; first occurrence must start at or after this instant. */
  dtStartMs: number
  /** Optional exclusive upper bound for expansion (epoch ms). */
  untilMs?: number | null
  /** Optional max occurrence count from dtStart (positive). */
  count?: number | null
  /** Minutes from midnight (UTC arithmetic base, same as v1ScheduleToIntervalMs). */
  startMinutes: number
  endMinutes: number
  locked?: boolean
  planId?: string
  planRevision?: number
  /**
   * When true (default), expanded blocks are locked so they participate in the
   * §3.2 #2 locked-no-overlap invariant once materialised.
   */
  expandAsLocked?: boolean
}

export type RecurrenceValidationIssue = {
  code: string
  message: string
  ruleId?: string
}

export type ExpandRecurrenceWindow = {
  /** Inclusive lower bound of expansion window (epoch ms). */
  windowStartMs: number
  /** Exclusive upper bound of expansion window (epoch ms). */
  windowEndMs: number
}

export type ExpandRecurrenceInput = {
  rules: readonly RecurrenceRule[]
  window: ExpandRecurrenceWindow
  /**
   * Existing concrete blocks (plans). Used to skip already-materialised
   * occurrence slots and to detect locked overlaps. Never mutated.
   */
  existingBlocks?: readonly ScheduleBlock[]
  /**
   * Deterministic id builder. Default: `${ruleId}@${startAtMs}`.
   * Must not invent new task ids — only block ids.
   */
  idForOccurrence?: (input: {
    rule: RecurrenceRule
    startAtMs: number
    endAtMs: number
    occurrenceIndex: number
  }) => string
}

export type ExpandRecurrenceWarning = {
  code: string
  message: string
  ruleId?: string
  blockId?: string
  startAtMs?: number
  endAtMs?: number
}

export type ExpandRecurrenceResult = {
  /** Newly proposed ScheduleBlock drafts (not yet in store). */
  blocks: ScheduleBlock[]
  warnings: ExpandRecurrenceWarning[]
  /** Occurrences skipped because a matching concrete block already exists. */
  skippedExisting: number
  /** Occurrences skipped due to locked overlap fail-closed. */
  skippedLockedOverlap: number
}

function asInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.trunc(value)
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function utcWeekday(epochMs: number): number {
  return new Date(epochMs).getUTCDay()
}

function startOfUtcDay(epochMs: number): number {
  const d = new Date(epochMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function minutesValid(startMinutes: number, endMinutes: number): boolean {
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return false
  if (startMinutes < 0 || startMinutes >= 24 * 60) return false
  if (endMinutes <= startMinutes || endMinutes > 24 * 60) return false
  return true
}

const KIND_SET = new Set<ScheduleBlockKind>(['focus', 'short_break', 'long_break', 'wrap_up'])

/**
 * Fail-closed rule validation. Does not expand or write.
 */
export function validateRecurrenceRule(rule: RecurrenceRule): {
  ok: boolean
  issues: RecurrenceValidationIssue[]
} {
  const issues: RecurrenceValidationIssue[] = []
  if (!rule.id?.trim()) {
    issues.push({ code: 'rule_id_required', message: 'RecurrenceRule id is required', ruleId: rule.id })
  }
  if (!KIND_SET.has(rule.kind)) {
    issues.push({
      code: 'rule_kind_invalid',
      message: `Invalid kind ${String(rule.kind)}`,
      ruleId: rule.id
    })
  }
  if (rule.frequency !== 'daily' && rule.frequency !== 'weekly') {
    issues.push({
      code: 'rule_frequency_invalid',
      message: `Invalid frequency ${String(rule.frequency)}`,
      ruleId: rule.id
    })
  }
  if (!Number.isFinite(rule.dtStartMs)) {
    issues.push({
      code: 'rule_dtstart_invalid',
      message: 'dtStartMs must be finite',
      ruleId: rule.id
    })
  }
  if (!minutesValid(rule.startMinutes, rule.endMinutes)) {
    issues.push({
      code: 'rule_minutes_invalid',
      message: 'startMinutes/endMinutes must form a same-day interval',
      ruleId: rule.id
    })
  }
  if (rule.untilMs != null && rule.untilMs !== undefined) {
    if (!Number.isFinite(rule.untilMs)) {
      issues.push({
        code: 'rule_until_invalid',
        message: 'untilMs must be finite when set',
        ruleId: rule.id
      })
    } else if (Number.isFinite(rule.dtStartMs) && rule.untilMs <= rule.dtStartMs) {
      issues.push({
        code: 'rule_until_before_dtstart',
        message: 'untilMs must be after dtStartMs',
        ruleId: rule.id
      })
    }
  }
  if (rule.count != null && rule.count !== undefined) {
    const c = asInt(rule.count)
    if (c == null || c < 1) {
      issues.push({
        code: 'rule_count_invalid',
        message: 'count must be a positive integer when set',
        ruleId: rule.id
      })
    }
  }
  if (rule.frequency === 'weekly') {
    const days = rule.byWeekday ?? []
    if (days.length === 0) {
      issues.push({
        code: 'rule_weekly_days_required',
        message: 'weekly recurrence requires non-empty byWeekday',
        ruleId: rule.id
      })
    } else {
      for (const d of days) {
        const w = asInt(d)
        if (w == null || w < 0 || w > 6) {
          issues.push({
            code: 'rule_weekday_invalid',
            message: `Invalid weekday ${String(d)}`,
            ruleId: rule.id
          })
          break
        }
      }
    }
  }
  // Focus templates should keep a taskId so expansion does not orphan blocks as "new tasks".
  if (rule.kind === 'focus') {
    if (rule.taskId == null || !String(rule.taskId).trim()) {
      issues.push({
        code: 'rule_focus_task_required',
        message: 'focus recurrence must reference an existing taskId (null only for breaks)',
        ruleId: rule.id
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

export function validateRecurrenceRules(rules: readonly RecurrenceRule[]): {
  ok: boolean
  issues: RecurrenceValidationIssue[]
} {
  const issues: RecurrenceValidationIssue[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    const one = validateRecurrenceRule(rule)
    issues.push(...one.issues)
    if (rule.id?.trim()) {
      if (seen.has(rule.id)) {
        issues.push({
          code: 'rule_id_duplicate',
          message: `Duplicate RecurrenceRule id ${rule.id}`,
          ruleId: rule.id
        })
      }
      seen.add(rule.id)
    }
  }
  return { ok: issues.length === 0, issues }
}

function dayMatchesRule(dayStartMs: number, rule: RecurrenceRule): boolean {
  const ruleDay0 = startOfUtcDay(rule.dtStartMs)
  if (dayStartMs < ruleDay0) return false
  if (rule.untilMs != null && Number.isFinite(rule.untilMs) && dayStartMs >= rule.untilMs) {
    return false
  }
  if (rule.frequency === 'daily') return true
  const wanted = new Set(
    (rule.byWeekday ?? []).map((d) => asInt(d)).filter((d): d is number => d != null)
  )
  return wanted.has(utcWeekday(dayStartMs))
}

function occurrenceInterval(
  dayStartMs: number,
  rule: RecurrenceRule
): { startAtMs: number; endAtMs: number } | null {
  if (!minutesValid(rule.startMinutes, rule.endMinutes)) return null
  const startAtMs = dayStartMs + rule.startMinutes * MINUTE_MS
  const endAtMs = dayStartMs + rule.endMinutes * MINUTE_MS
  if (!isValidScheduleBlockInterval({ startAtMs, endAtMs })) return null
  // Occurrence must start on/after dtStart (no mid-block clamp — keeps duration fixed).
  if (startAtMs < rule.dtStartMs) return null
  if (rule.untilMs != null && Number.isFinite(rule.untilMs) && startAtMs >= rule.untilMs) return null
  return { startAtMs, endAtMs }
}

function defaultIdForOccurrence(input: {
  rule: RecurrenceRule
  startAtMs: number
  endAtMs: number
  occurrenceIndex: number
}): string {
  return `${input.rule.id}@${input.startAtMs}`
}

function sameOccurrenceSlot(
  existing: Pick<ScheduleBlock, 'taskId' | 'kind' | 'startAtMs' | 'endAtMs'>,
  candidate: Pick<ScheduleBlock, 'taskId' | 'kind' | 'startAtMs' | 'endAtMs'>
): boolean {
  return (
    existing.taskId === candidate.taskId &&
    existing.kind === candidate.kind &&
    existing.startAtMs === candidate.startAtMs &&
    existing.endAtMs === candidate.endAtMs
  )
}

/**
 * Expand recurrence rules into concrete ScheduleBlock drafts for a window.
 *
 * Deterministic for the same rules + window + existingBlocks + idForOccurrence.
 * Fail-closed on locked overlaps: skips the new occurrence and records a warning
 * (does not drop or rewrite existing locked blocks; does not touch TimerSession).
 */
export function expandRecurrenceToScheduleBlocks(input: ExpandRecurrenceInput): ExpandRecurrenceResult {
  const warnings: ExpandRecurrenceWarning[] = []
  const blocks: ScheduleBlock[] = []
  let skippedExisting = 0
  let skippedLockedOverlap = 0

  const window = input.window
  if (
    !Number.isFinite(window.windowStartMs) ||
    !Number.isFinite(window.windowEndMs) ||
    window.windowEndMs <= window.windowStartMs
  ) {
    warnings.push({
      code: 'window_invalid',
      message: 'windowEndMs must be after windowStartMs'
    })
    return { blocks, warnings, skippedExisting, skippedLockedOverlap }
  }

  const existing = input.existingBlocks ?? []
  const idFor = input.idForOccurrence ?? defaultIdForOccurrence

  // Working set for overlap checks: existing + newly accepted drafts (pure local).
  const accepted: ScheduleBlock[] = []

  // Sort rules by id for deterministic multi-rule expansion order.
  const rules = [...input.rules].sort((a, b) => a.id.localeCompare(b.id))

  for (const rule of rules) {
    const validation = validateRecurrenceRule(rule)
    if (!validation.ok) {
      for (const issue of validation.issues) {
        warnings.push({
          code: issue.code,
          message: issue.message,
          ruleId: rule.id
        })
      }
      continue
    }

    const expandLocked = rule.expandAsLocked !== false
    const ruleDay0 = startOfUtcDay(rule.dtStartMs)
    const lastDayStart = startOfUtcDay(window.windowEndMs - 1)

    const maxCount = rule.count != null && Number.isFinite(rule.count) ? Math.trunc(rule.count) : null

    // Count occurrences from dtStart (not only window) so `count` is stable.
    // We still only emit those that intersect the window.
    let globalIndex = 0
    let cursor = ruleDay0
    const hardStop = Math.max(lastDayStart, ruleDay0) + DAY_MS * 400 // safety cap (~13 months)

    while (cursor <= lastDayStart && cursor < hardStop) {
      if (maxCount != null && globalIndex >= maxCount) break
      if (rule.untilMs != null && Number.isFinite(rule.untilMs) && cursor >= rule.untilMs) break

      if (!dayMatchesRule(cursor, rule)) {
        cursor += DAY_MS
        continue
      }

      const interval = occurrenceInterval(cursor, rule)
      if (!interval) {
        cursor += DAY_MS
        continue
      }

      // Global occurrence index advances for any valid occurrence on/after dtStart,
      // even outside the expansion window (keeps count deterministic).
      const occurrenceIndex = globalIndex
      globalIndex += 1

      // Window filter: keep if interval intersects [windowStart, windowEnd).
      if (interval.endAtMs <= window.windowStartMs || interval.startAtMs >= window.windowEndMs) {
        cursor += DAY_MS
        continue
      }

      const draft: ScheduleBlock = {
        id: idFor({
          rule,
          startAtMs: interval.startAtMs,
          endAtMs: interval.endAtMs,
          occurrenceIndex
        }),
        taskId: rule.taskId,
        kind: rule.kind,
        startAtMs: interval.startAtMs,
        endAtMs: interval.endAtMs,
        locked: expandLocked || Boolean(rule.locked),
        source: 'manual',
        ...(rule.planId ? { planId: rule.planId } : {}),
        ...(rule.planRevision !== undefined ? { planRevision: rule.planRevision } : {}),
        status: 'planned',
        revision: 1
      }

      // Already materialised → skip (idempotent re-expand).
      const already = existing.some((b) => sameOccurrenceSlot(b, draft) || b.id === draft.id)
      if (already) {
        skippedExisting += 1
        cursor += DAY_MS
        continue
      }

      // Locked-overlap fail-closed against existing + accepted drafts.
      const lockedPeers = [...existing, ...accepted].filter((b) => b.locked)
      const hitsLocked = lockedPeers.find(
        (peer) =>
          peer.id !== draft.id &&
          overlaps(peer.startAtMs, peer.endAtMs, draft.startAtMs, draft.endAtMs)
      )
      if (hitsLocked) {
        skippedLockedOverlap += 1
        warnings.push({
          code: 'locked_overlap',
          message: `Skipped occurrence overlapping locked block ${hitsLocked.id}`,
          ruleId: rule.id,
          blockId: draft.id,
          startAtMs: draft.startAtMs,
          endAtMs: draft.endAtMs
        })
        cursor += DAY_MS
        continue
      }

      accepted.push(draft)
      blocks.push(draft)
      cursor += DAY_MS
    }
  }

  // Stable order for consumers / tests.
  blocks.sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs || a.id.localeCompare(b.id))

  // Surface validation issues if accepted set would violate locked invariant among themselves.
  const selfCheck = validateScheduleBlocks([...existing, ...blocks])
  for (const issue of selfCheck.issues) {
    if (issue.code === 'locked_blocks_overlap') {
      warnings.push({
        code: issue.code,
        message: issue.message,
        blockId: issue.blockId
      })
    }
  }

  return { blocks, warnings, skippedExisting, skippedLockedOverlap }
}

/**
 * Pure helper: attach expanded drafts onto an existing plan list without mutating
 * inputs or historical sessions. Still does not write the store.
 */
export function mergeExpandedScheduleBlocks(input: {
  existingBlocks: readonly ScheduleBlock[]
  expanded: readonly ScheduleBlock[]
}): { blocks: ScheduleBlock[]; warnings: ExpandRecurrenceWarning[] } {
  const warnings: ExpandRecurrenceWarning[] = []
  const byId = new Map<string, ScheduleBlock>()
  for (const b of input.existingBlocks) byId.set(b.id, b)
  for (const draft of input.expanded) {
    if (byId.has(draft.id)) {
      warnings.push({
        code: 'block_id_exists',
        message: `Block id already present: ${draft.id}`,
        blockId: draft.id
      })
      continue
    }
    byId.set(draft.id, draft)
  }
  const blocks = [...byId.values()].sort(
    (a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs || a.id.localeCompare(b.id)
  )
  const validation = validateScheduleBlocks(blocks)
  if (!validation.ok) {
    for (const issue of validation.issues) {
      warnings.push({
        code: issue.code,
        message: issue.message,
        blockId: issue.blockId
      })
    }
  }
  return { blocks, warnings }
}
