/**
 * STC-707 conflict list UI pure model.
 *
 * Projects ScheduleBlock overlaps into a week-plan banner/list model.
 * Detection uses shared `findScheduleConflicts` (interval overlap).
 * No I/O. Does not mutate blocks or write commands.
 *
 * Scope (product week path):
 * - Non-cancelled focus blocks only (matches week chips).
 * - Locked blocks still count as conflicts (user must unlock / move).
 * - Titles resolve from task catalog; missing → fallback label.
 */

import {
  findScheduleConflicts,
  proposeScheduleConflictResolve,
  type ProposeScheduleConflictResolveResult,
  type ProposedBlockMove,
  type ScheduleBlock
} from '../../../shared/study-planning'
import { scheduleBlockToV1Schedule } from './planning-hydrate'

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** Max conflict pairs rendered in the banner list (remainder summarized). */
export const SCHEDULE_CONFLICTS_LIST_CAP = 8

export type ScheduleConflictTaskInput = {
  id: string
  title?: string | null
  done?: boolean
}

export type ScheduleConflictPairRow = {
  aId: string
  bId: string
  aTaskId: string | null
  bTaskId: string | null
  aTitle: string
  bTitle: string
  aTimeLabel: string
  bTimeLabel: string
  aLocked: boolean
  bLocked: boolean
  /** Stable key for list React keys / dismiss fingerprint. */
  pairKey: string
}

export type ScheduleConflictsBannerCopy = {
  eyebrow: string
  title: string
  description: string
  emptyHint: string
  dismissLabel: string
  moreLabel: string
  lockedHint: string
  /** Opt-in CTA labels (STC-707); never auto-applied. */
  previewResolveLabel: string
  applyResolveLabel: string
  cancelResolveLabel: string
  resolveUnavailableHint: string
}

export type ScheduleConflictsBannerModel = {
  kind: 'conflicts' | 'clear'
  conflictCount: number
  /** Pairs after cap (display list). */
  pairs: ScheduleConflictPairRow[]
  /** How many pairs were truncated past the list cap. */
  truncatedCount: number
  copy: ScheduleConflictsBannerCopy
  /**
   * Fingerprint of the full conflict set (not just displayed cap).
   * Host may dismiss until this key changes (new/resolved pairs).
   */
  dismissKey: string
}

function normalizeId(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatMinutesOfDay(minutes: number): string {
  if (!Number.isFinite(minutes)) return '--:--'
  const clamped = Math.max(0, Math.min(24 * 60, Math.floor(minutes)))
  if (clamped >= 24 * 60) return '24:00'
  const hour = Math.floor(clamped / 60)
  const minute = clamped % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Human-readable local wall-clock range for a block.
 * Prefers V1 reverse (Mon-first weekday + minutes); falls back to local Date HH:MM.
 */
export function formatScheduleBlockTimeLabel(
  block: Pick<ScheduleBlock, 'startAtMs' | 'endAtMs'>
): string {
  const v1 = scheduleBlockToV1Schedule(block)
  if (v1) {
    const day = WEEKDAY_LABELS[v1.weekday] ?? `日${v1.weekday}`
    return `${day} ${formatMinutesOfDay(v1.startMinutes)}–${formatMinutesOfDay(v1.endMinutes)}`
  }
  if (!Number.isFinite(block.startAtMs) || !Number.isFinite(block.endAtMs)) {
    return '时间未知'
  }
  const start = new Date(block.startAtMs)
  const end = new Date(block.endAtMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`
}

/**
 * Active focus blocks that participate in week-plan conflict detection.
 * Cancelled rows are excluded; other statuses still conflict when overlapping.
 */
export function selectFocusBlocksForConflictScan(
  blocks: readonly ScheduleBlock[] | null | undefined
): ScheduleBlock[] {
  if (!blocks || blocks.length === 0) return []
  return blocks.filter(
    (b) =>
      b
      && typeof b.id === 'string'
      && b.id.trim().length > 0
      && b.kind === 'focus'
      && b.status !== 'cancelled'
      && Number.isFinite(b.startAtMs)
      && Number.isFinite(b.endAtMs)
      && b.endAtMs > b.startAtMs
  )
}

function resolveTaskTitle(
  taskId: string | null | undefined,
  taskById: Map<string, ScheduleConflictTaskInput>
): string {
  const id = normalizeId(taskId)
  if (!id) return '未归属块'
  const task = taskById.get(id)
  const title = typeof task?.title === 'string' ? task.title.trim() : ''
  if (title) return title
  return `任务 ${id.slice(0, 8)}`
}

function pairKeyOf(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`
}

/**
 * Build dismiss fingerprint from full unordered conflict pair set.
 */
export function buildScheduleConflictsDismissKey(
  pairs: readonly { aId: string; bId: string }[]
): string {
  if (!pairs.length) return 'clear'
  const keys = pairs.map((p) => pairKeyOf(p.aId, p.bId)).sort()
  return keys.join(';')
}

/**
 * Whether the banner should show given host dismiss state.
 * Empty conflicts → never show. Dismiss only hides while dismissKey matches.
 */
export function shouldShowScheduleConflictsBanner(input: {
  model: ScheduleConflictsBannerModel | null | undefined
  dismissedKey?: string | null
}): boolean {
  const model = input.model
  if (!model || model.kind !== 'conflicts' || model.conflictCount <= 0) return false
  const dismissed = typeof input.dismissedKey === 'string' ? input.dismissedKey : null
  if (dismissed && dismissed === model.dismissKey) return false
  return true
}

/**
 * Project ScheduleBlock overlaps into a banner/list model for the week plan.
 */
export function projectScheduleConflictsBanner(input: {
  scheduleBlocks?: readonly ScheduleBlock[] | null
  tasks?: readonly ScheduleConflictTaskInput[] | null
  /** Override list cap (tests / dense UI). Default SCHEDULE_CONFLICTS_LIST_CAP. */
  listCap?: number
}): ScheduleConflictsBannerModel {
  const focusBlocks = selectFocusBlocksForConflictScan(input.scheduleBlocks)
  const rawPairs = findScheduleConflicts(focusBlocks)
  const blockById = new Map(focusBlocks.map((b) => [b.id, b]))
  const taskById = new Map<string, ScheduleConflictTaskInput>()
  for (const t of input.tasks ?? []) {
    const id = normalizeId(t?.id)
    if (id) taskById.set(id, t)
  }

  // Stable order: earlier start first, then pairKey
  const ordered = [...rawPairs].sort((left, right) => {
    const a = blockById.get(left.aId)
    const b = blockById.get(right.aId)
    const aStart = a?.startAtMs ?? 0
    const bStart = b?.startAtMs ?? 0
    if (aStart !== bStart) return aStart - bStart
    return pairKeyOf(left.aId, left.bId).localeCompare(pairKeyOf(right.aId, right.bId))
  })

  const dismissKey = buildScheduleConflictsDismissKey(ordered)
  const cap =
    typeof input.listCap === 'number' && Number.isFinite(input.listCap) && input.listCap >= 0
      ? Math.floor(input.listCap)
      : SCHEDULE_CONFLICTS_LIST_CAP

  const rows: ScheduleConflictPairRow[] = []
  for (const pair of ordered) {
    const a = blockById.get(pair.aId)
    const b = blockById.get(pair.bId)
    if (!a || !b) continue
    rows.push({
      aId: a.id,
      bId: b.id,
      aTaskId: a.taskId ?? null,
      bTaskId: b.taskId ?? null,
      aTitle: resolveTaskTitle(a.taskId, taskById),
      bTitle: resolveTaskTitle(b.taskId, taskById),
      aTimeLabel: formatScheduleBlockTimeLabel(a),
      bTimeLabel: formatScheduleBlockTimeLabel(b),
      aLocked: Boolean(a.locked),
      bLocked: Boolean(b.locked),
      pairKey: pairKeyOf(a.id, b.id)
    })
  }

  const conflictCount = rows.length
  const pairs = rows.slice(0, cap)
  const truncatedCount = Math.max(0, conflictCount - pairs.length)

  if (conflictCount === 0) {
    return {
      kind: 'clear',
      conflictCount: 0,
      pairs: [],
      truncatedCount: 0,
      dismissKey: 'clear',
      copy: {
        eyebrow: '日程冲突',
        title: '当前无重叠的专注块',
        description: '周视图中的专注日程块没有时间重叠。',
        emptyHint: '拖拽或编辑日程后会自动检测重叠。',
        dismissLabel: '知道了',
        moreLabel: '',
        lockedHint: '锁定块也会计入冲突；请解锁后再移动。',
        previewResolveLabel: '预览错开',
        applyResolveLabel: '确认应用',
        cancelResolveLabel: '取消',
        resolveUnavailableHint: '当前无法自动错开（例如双方均锁定）。'
      }
    }
  }

  const moreLabel =
    truncatedCount > 0 ? `另有 ${truncatedCount} 组重叠未列出` : ''

  return {
    kind: 'conflicts',
    conflictCount,
    pairs,
    truncatedCount,
    dismissKey,
    copy: {
      eyebrow: '日程冲突',
      title:
        conflictCount === 1
          ? '发现 1 组时间重叠'
          : `发现 ${conflictCount} 组时间重叠`,
      description:
        '以下专注日程块在时间上互相重叠。可点击一行打开任务编辑，或拖拽周视图上的芯片调整时间。',
      emptyHint: '',
      dismissLabel: '暂时隐藏',
      moreLabel,
      lockedHint: '含锁定标记的块需先解锁才能移动。',
      previewResolveLabel: '预览错开',
      applyResolveLabel: '确认应用',
      cancelResolveLabel: '取消',
      resolveUnavailableHint: '当前无法自动错开（例如双方均锁定）。'
    }
  }
}

// ---------------------------------------------------------------------------
// STC-707 opt-in auto-resolve propose (pure glue; no write)
// ---------------------------------------------------------------------------

export type ScheduleConflictResolvePreview = {
  kind: 'ready' | 'unavailable'
  /** When ready, pure proposal that clears conflicts by shifting unlocked blocks. */
  proposal: ProposeScheduleConflictResolveResult | null
  moves: ProposedBlockMove[]
  /** Human summary lines for confirm UI. */
  moveSummaries: string[]
  reasonCode: string | null
  reasonMessage: string
  previewLabel: string
  applyLabel: string
  cancelLabel: string
}

function formatMsClock(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--'
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Build opt-in resolve preview for the week conflict banner.
 * Pure: never writes. Host must require explicit confirm before upserts.
 * Default product path remains list-only when unavailable / no CTA used.
 */
export function projectScheduleConflictResolvePreview(input: {
  scheduleBlocks?: readonly ScheduleBlock[] | null
  /** Optional hard window; omit for unrestricted stagger within pure rules. */
  window?: { startAtMs: number; endAtMs: number; hardEnd: boolean }
}): ScheduleConflictResolvePreview {
  const focusBlocks = selectFocusBlocksForConflictScan(input.scheduleBlocks)
  const proposal = proposeScheduleConflictResolve({
    blocks: focusBlocks,
    window: input.window
  })

  if (!proposal.ok) {
    const messageByCode: Record<string, string> = {
      no_conflicts: '当前没有可错开的冲突。',
      both_locked: '冲突双方均为锁定块，请先解锁后再错开。',
      locked_would_move: '提案会移动锁定块，已拒绝。',
      hard_end_violation: '错开会超出硬结束窗口，已拒绝。',
      no_gap: '无法为当前冲突找到可写回的错开位置。',
      duration_invalid: '块时长无效，无法错开。',
      step_cap: '冲突过多，自动错开步数超限，请手动调整。'
    }
    return {
      kind: 'unavailable',
      proposal,
      moves: [],
      moveSummaries: [],
      reasonCode: proposal.code,
      reasonMessage: messageByCode[proposal.code] ?? proposal.message,
      previewLabel: '预览错开',
      applyLabel: '应用错开',
      cancelLabel: '取消'
    }
  }

  const blockById = new Map(focusBlocks.map((b) => [b.id, b]))
  const moveSummaries = proposal.moves.map((move) => {
    const block = blockById.get(move.blockId)
    const title =
      block?.taskId && block.taskId.trim()
        ? `块 ${move.blockId.slice(0, 8)}`
        : `块 ${move.blockId.slice(0, 8)}`
    return `${title}: ${formatMsClock(move.from.startAtMs)}–${formatMsClock(move.from.endAtMs)} → ${formatMsClock(move.to.startAtMs)}–${formatMsClock(move.to.endAtMs)}`
  })

  return {
    kind: 'ready',
    proposal,
    moves: proposal.moves,
    moveSummaries,
    reasonCode: null,
    reasonMessage:
      proposal.remainingConflicts.length > 0
        ? `可错开 ${proposal.moves.length} 个未锁定块；仍可能残留 ${proposal.remainingConflicts.length} 组重叠。`
        : `可错开 ${proposal.moves.length} 个未锁定块以清除重叠。`,
    previewLabel: '预览错开',
    applyLabel: '确认应用',
    cancelLabel: '取消'
  }
}

/**
 * Build sequential upsert payloads for confirmed unlocked moves.
 * Caller supplies current revision and applies via existing CAS path.
 * Never includes locked blocks (defensive filter).
 */
export function buildConflictResolveUpsertBlocks(input: {
  /** Full schedule block set (or at least the focus set used for proposal). */
  blocks: readonly ScheduleBlock[]
  moves: readonly ProposedBlockMove[]
}): { ok: true; blocks: ScheduleBlock[] } | { ok: false; code: string; message: string } {
  if (!input.moves.length) {
    return { ok: false, code: 'no_moves', message: 'No moves to apply.' }
  }
  const byId = new Map(input.blocks.map((b) => [b.id, b]))
  const out: ScheduleBlock[] = []
  for (const move of input.moves) {
    const existing = byId.get(move.blockId)
    if (!existing) {
      return {
        ok: false,
        code: 'block_missing',
        message: `Block ${move.blockId} not found for upsert.`
      }
    }
    if (existing.locked) {
      return {
        ok: false,
        code: 'locked_would_move',
        message: `Refusing upsert of locked block ${move.blockId}.`
      }
    }
    if (!Number.isFinite(move.to.startAtMs) || !Number.isFinite(move.to.endAtMs) || move.to.endAtMs <= move.to.startAtMs) {
      return {
        ok: false,
        code: 'duration_invalid',
        message: `Invalid target interval for ${move.blockId}.`
      }
    }
    out.push({
      ...existing,
      startAtMs: move.to.startAtMs,
      endAtMs: move.to.endAtMs,
      revision: existing.revision + 1
    })
  }
  return { ok: true, blocks: out }
}
