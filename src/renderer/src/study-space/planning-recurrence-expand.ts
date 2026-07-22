/**
 * STC-703 recurrence expand preview + confirm-apply glue.
 *
 * Pure expand stays in shared/study-planning/recurrence.ts.
 * This module:
 * - builds a RecurrenceRule from a minimal form draft
 * - dry-runs expandRecurrenceToScheduleBlocks for a window
 * - sequential upsert_schedule_block dual-write with expectedRevision CAS
 *
 * Never clones Task. Never auto-expands. Locked overlaps are skipped by pure expand.
 */
import {
  expandRecurrenceToScheduleBlocks,
  validateRecurrenceRule,
  type ExpandRecurrenceResult,
  type ExpandRecurrenceWarning,
  type JsWeekday,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type ScheduleBlock
} from '../../../shared/study-planning'
import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
} from './planning-client'
import type { CanonicalPlanningContext, DualWriteResult } from './planning-dual-write'
import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'

const DAY_MS = 24 * 60 * 60_000
const MINUTE_MS = 60_000

/** Minimal form draft for the recurrence editor (not a store schema field). */
export type RecurrenceRuleFormDraft = {
  taskId: string
  frequency: RecurrenceFrequency
  /** Required when frequency is weekly (0=Sun … 6=Sat). */
  byWeekday: readonly JsWeekday[]
  startMinutes: number
  endMinutes: number
  /** Inclusive start of first occurrence (epoch ms). */
  dtStartMs: number
  /** Optional exclusive until bound. */
  untilMs?: number | null
  /** Optional max occurrence count. */
  count?: number | null
  /** When true (default), expanded blocks participate as locked. */
  expandAsLocked?: boolean
  /** Stable rule id; default recurrence:${taskId}. */
  ruleId?: string
}

export type RecurrenceExpandWindow = {
  windowStartMs: number
  windowEndMs: number
}

export type RecurrenceExpandPreviewModel = {
  rule: RecurrenceRule
  window: RecurrenceExpandWindow
  result: ExpandRecurrenceResult
  /** Blocks ready for confirm apply (same as result.blocks). */
  applyBlocks: ScheduleBlock[]
  canConfirm: boolean
  warnings: string[]
  summaryLine: string
  copy: {
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    emptyLabel: string
    previewLabel: string
  }
}

export type DualWriteExpandApplyResult = {
  kind: DualWriteResult['kind'] | 'partial'
  applied: number
  failed: number
  skipped: number
  lastRevision: number
  results: DualWriteResult[]
  /** Present when kind is canonical_skipped. */
  reason?: 'missing_workspace' | 'api_unavailable'
  error?: { code: string; message: string }
}

function hasCanonicalContext(ctx: CanonicalPlanningContext): boolean {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root) return false
  if (!ctx.api) return false
  if (typeof ctx.api.readStudyPlanning !== 'function') return false
  if (typeof ctx.api.applyStudyPlanning !== 'function') return false
  return true
}

function nowOf(ctx: CanonicalPlanningContext): number {
  return (ctx.nowMs ?? (() => Date.now()))()
}

/**
 * Build a RecurrenceRule from the editor draft. Fail-closed validate is separate.
 * Does not invent a Task id — taskId must already exist.
 */
export function buildRecurrenceRuleFromForm(draft: RecurrenceRuleFormDraft): RecurrenceRule {
  const taskId = draft.taskId.trim()
  const ruleId =
    typeof draft.ruleId === 'string' && draft.ruleId.trim()
      ? draft.ruleId.trim()
      : `recurrence:${taskId || 'task'}`

  const rule: RecurrenceRule = {
    id: ruleId,
    taskId: taskId || null,
    kind: 'focus',
    frequency: draft.frequency,
    dtStartMs: draft.dtStartMs,
    startMinutes: draft.startMinutes,
    endMinutes: draft.endMinutes,
    expandAsLocked: draft.expandAsLocked !== false
  }
  if (draft.frequency === 'weekly') {
    rule.byWeekday = [...draft.byWeekday]
  }
  if (draft.untilMs != null && Number.isFinite(draft.untilMs)) {
    rule.untilMs = draft.untilMs
  }
  if (draft.count != null && Number.isFinite(draft.count)) {
    rule.count = Math.trunc(draft.count)
  }
  return rule
}

/**
 * Default expansion window: local week [anchor, anchor+7d).
 */
export function defaultWeekExpandWindow(weekAnchorMidnightMs: number): RecurrenceExpandWindow {
  return {
    windowStartMs: weekAnchorMidnightMs,
    windowEndMs: weekAnchorMidnightMs + 7 * DAY_MS
  }
}

/**
 * Dry-run expand for preview UI. Pure — does not write store or clone Task.
 */
export function previewRecurrenceExpand(input: {
  draft: RecurrenceRuleFormDraft
  existingBlocks?: readonly ScheduleBlock[]
  window: RecurrenceExpandWindow
}): RecurrenceExpandPreviewModel {
  const rule = buildRecurrenceRuleFromForm(input.draft)
  const validation = validateRecurrenceRule(rule)
  const emptyResult: ExpandRecurrenceResult = {
    blocks: [],
    warnings: [],
    skippedExisting: 0,
    skippedLockedOverlap: 0
  }

  if (!validation.ok) {
    const warnings = validation.issues.map((i) => i.message)
    return {
      rule,
      window: input.window,
      result: emptyResult,
      applyBlocks: [],
      canConfirm: false,
      warnings,
      summaryLine: '规则无效，无法预览',
      copy: defaultCopy(0)
    }
  }

  const result = expandRecurrenceToScheduleBlocks({
    rules: [rule],
    window: input.window,
    existingBlocks: input.existingBlocks ?? []
  })

  const applyBlocks = result.blocks
  const warnings = formatExpandWarnings(result)
  const n = applyBlocks.length
  const canConfirm = n > 0
  const skipBits: string[] = []
  if (result.skippedExisting > 0) skipBits.push(`已存在 ${result.skippedExisting}`)
  if (result.skippedLockedOverlap > 0) skipBits.push(`锁定冲突跳过 ${result.skippedLockedOverlap}`)
  const summaryLine =
    n === 0
      ? skipBits.length > 0
        ? `无可写入块（${skipBits.join(' · ')}）`
        : '本窗口无可展开的时间块'
      : `将新增 ${n} 条时间块${skipBits.length ? `（${skipBits.join(' · ')}）` : ''}`

  return {
    rule,
    window: input.window,
    result,
    applyBlocks,
    canConfirm,
    warnings,
    summaryLine,
    copy: defaultCopy(n)
  }
}

function defaultCopy(n: number): RecurrenceExpandPreviewModel['copy'] {
  return {
    title: '重复规则展开预览',
    description: '确认后写入具体时间块；不会复制任务。锁定重叠已自动跳过。',
    confirmLabel: n > 0 ? `确认展开 ${n} 条` : '确认展开',
    cancelLabel: '取消',
    emptyLabel: '本窗口没有可展开的时间块',
    previewLabel: '预览展开'
  }
}

function formatExpandWarnings(result: ExpandRecurrenceResult): string[] {
  const out: string[] = []
  for (const w of result.warnings) {
    out.push(formatOneWarning(w))
  }
  return out
}

function formatOneWarning(w: ExpandRecurrenceWarning): string {
  if (w.code === 'locked_overlap') {
    return `锁定冲突：跳过 ${w.blockId ?? 'occurrence'}`
  }
  return w.message
}

/**
 * Build upsert_schedule_block command for one expanded draft.
 */
export function buildUpsertScheduleBlockCommand(
  block: ScheduleBlock,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'upsert_schedule_block',
    payload: { block },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

/**
 * Sequential dual-write of expanded ScheduleBlock drafts.
 * Each block: read snapshot → apply with expectedRevision; one revision_conflict retry per block.
 * Fail-closed without workspace/api. Empty list → no-op success (0 applied).
 * Never creates or clones Task rows.
 */
export async function dualWriteApplyExpandedRecurrenceBlocks(
  ctx: CanonicalPlanningContext,
  blocks: readonly ScheduleBlock[]
): Promise<DualWriteExpandApplyResult> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      applied: 0,
      failed: 0,
      skipped: blocks.length,
      lastRevision: 0,
      results: [],
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
    }
  }

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      kind: 'canonical_ok',
      applied: 0,
      failed: 0,
      skipped: 0,
      lastRevision: 0,
      results: []
    }
  }

  // Guard: never invent task identity — focus blocks must keep existing taskId.
  for (const b of blocks) {
    if (b.kind === 'focus' && (b.taskId == null || !String(b.taskId).trim())) {
      return {
        kind: 'canonical_failed',
        applied: 0,
        failed: blocks.length,
        skipped: 0,
        lastRevision: 0,
        results: [],
        error: {
          code: 'invalid_command',
          message: 'focus expand blocks require existing taskId (no silent task clone)'
        }
      }
    }
  }

  const nowMs = () => nowOf(ctx)
  const results: DualWriteResult[] = []
  let applied = 0
  let failed = 0
  let lastRevision = 0

  for (const block of blocks) {
    const one = await upsertOneBlockWithRetry(ctx, block, nowMs)
    results.push(one)
    if (one.kind === 'canonical_ok') {
      applied += 1
      lastRevision = one.result.revision
    } else if (one.kind === 'canonical_failed') {
      failed += 1
      lastRevision = one.result.revision || lastRevision
      // Fail-closed: stop on first hard failure (not skip).
      return {
        kind: applied > 0 ? 'partial' : 'canonical_failed',
        applied,
        failed,
        skipped: blocks.length - applied - failed,
        lastRevision,
        results,
        error: one.result.error
      }
    } else {
      // skipped mid-loop (api disappeared)
      return {
        kind: 'canonical_skipped',
        applied,
        failed,
        skipped: blocks.length - applied,
        lastRevision,
        results,
        reason: one.reason
      }
    }
  }

  return {
    kind: 'canonical_ok',
    applied,
    failed: 0,
    skipped: 0,
    lastRevision,
    results
  }
}

async function upsertOneBlockWithRetry(
  ctx: CanonicalPlanningContext,
  block: ScheduleBlock,
  nowMs: () => number
): Promise<DualWriteResult> {
  const first = await upsertOnce(ctx, block, nowMs, 0)
  if (first.kind === 'canonical_ok') return first
  if (first.kind === 'canonical_skipped') return first
  if (first.result.error.code !== 'revision_conflict') return first

  // One CAS retry after re-read.
  return upsertOnce(ctx, block, nowMs, 1)
}

async function upsertOnce(
  ctx: CanonicalPlanningContext,
  block: ScheduleBlock,
  nowMs: () => number,
  attempt: number
): Promise<DualWriteResult> {
  const read = await readStudyPlanningSnapshot(ctx.api, ctx.workspaceRoot)
  if (!read.ok) {
    return {
      kind: 'canonical_failed',
      result: { ok: false, revision: 0, error: { code: read.code, message: read.message } }
    }
  }

  const issued = nowMs()
  const result = await applyStudyPlanningCommand(
    ctx.api,
    ctx.workspaceRoot,
    read.snapshot.revision,
    buildUpsertScheduleBlockCommand(
      block,
      `expand_recurrence:${block.id}:${issued}:${attempt}`,
      issued
    )
  )
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/** Format minutes-from-midnight as HH:mm for preview rows. */
export function formatMinutesLabel(minutes: number): string {
  const m = Math.trunc(minutes)
  if (!Number.isFinite(m) || m < 0) return '--:--'
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Local wall-clock minutes of an epoch ms (for preview list labels).
 */
export function localMinutesFromEpoch(epochMs: number): number {
  const d = new Date(epochMs)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Local mon-first weekday 0=Mon..6=Sun for preview list labels.
 */
export function localMonFirstWeekdayFromEpoch(epochMs: number): number {
  const js = new Date(epochMs).getDay() // 0=Sun
  return js === 0 ? 6 : js - 1
}


/**
 * Pure list upsert: replace same id or append. Cap at max (default 32).
 * Does not clone Task; does not expand.
 */
export function upsertRecurrenceRuleInList(
  rules: readonly RecurrenceRule[],
  rule: RecurrenceRule,
  max = 32
): RecurrenceRule[] {
  const id = rule.id?.trim()
  if (!id) return [...rules]
  const next: RecurrenceRule[] = []
  let replaced = false
  for (const existing of rules) {
    if (existing.id === id) {
      next.push(rule)
      replaced = true
    } else {
      next.push(existing)
    }
  }
  if (!replaced) next.push(rule)
  if (next.length > max) return next.slice(0, max)
  return next
}

/**
 * Pure list delete by rule id. Unknown id → same list (no throw).
 */
export function deleteRecurrenceRuleFromList(
  rules: readonly RecurrenceRule[],
  ruleId: string
): RecurrenceRule[] {
  const id = ruleId.trim()
  if (!id) return [...rules]
  return rules.filter((r) => r.id !== id)
}

/**
 * Find rule for a task (first match). Focus rules bind existing taskId.
 */
export function findRecurrenceRuleForTask(
  rules: readonly RecurrenceRule[] | null | undefined,
  taskId: string
): RecurrenceRule | null {
  const tid = taskId.trim()
  if (!tid || !rules?.length) return null
  return rules.find((r) => r.taskId === tid) ?? null
}

/**
 * Seed form draft fields from a durable rule when present.
 */
export function draftFromRecurrenceRule(rule: RecurrenceRule): Pick<
  RecurrenceRuleFormDraft,
  'frequency' | 'byWeekday' | 'startMinutes' | 'endMinutes' | 'dtStartMs' | 'untilMs' | 'count' | 'expandAsLocked' | 'ruleId' | 'taskId'
> {
  return {
    taskId: rule.taskId ?? '',
    frequency: rule.frequency,
    byWeekday: rule.byWeekday ? [...rule.byWeekday] : [],
    startMinutes: rule.startMinutes,
    endMinutes: rule.endMinutes,
    dtStartMs: rule.dtStartMs,
    untilMs: rule.untilMs ?? null,
    count: rule.count ?? null,
    expandAsLocked: rule.expandAsLocked !== false,
    ruleId: rule.id
  }
}

export { DAY_MS, MINUTE_MS }
