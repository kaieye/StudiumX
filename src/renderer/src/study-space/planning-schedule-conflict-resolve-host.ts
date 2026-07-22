/**
 * STC-707 host glue for week-plan conflict resolve on StudyTaskSchedulePage.
 *
 * - Pure preview selection (wraps projectScheduleConflictResolvePreview)
 * - Apply orchestration: sequential dual-write CAS + re-read refresh
 * - Never auto-invoked on detect/hydrate; host must call only after explicit confirm
 *
 * ADR-0130 §5.1: no silent auto-stagger default; never move locked (pure + dual-write refuse).
 */

import type { ProposedBlockMove, ScheduleBlock } from '../../../shared/study-planning'
import { readStudyPlanningSnapshot } from './planning-client'
import {
  dualWriteApplyConflictResolveMoves,
  type CanonicalPlanningContext
} from './planning-dual-write'
import {
  projectScheduleConflictResolvePreview,
  type ScheduleConflictResolvePreview
} from './planning-schedule-conflicts-ui'

/**
 * Build opt-in resolve preview when the banner has conflicts.
 * Pure: never writes. Returns null when host should stay list-only (no conflicts).
 */
export function buildConflictResolvePreviewModel(input: {
  scheduleBlocks?: readonly ScheduleBlock[] | null
  /** When false, host stays list-only (no CTA). */
  hasConflicts?: boolean
  window?: { startAtMs: number; endAtMs: number; hardEnd: boolean }
}): ScheduleConflictResolvePreview | null {
  if (input.hasConflicts === false) return null
  return projectScheduleConflictResolvePreview({
    scheduleBlocks: input.scheduleBlocks,
    window: input.window
  })
}

/**
 * Whether the host should pass resolve CTA props into the banner.
 * Requires canonical planning context so apply can CAS-write.
 * Default product path (no context) remains list/banner only.
 */
export function shouldWireConflictResolveCta(input: {
  hasPlanningContext: boolean
  hasConflicts: boolean
}): boolean {
  return Boolean(input.hasPlanningContext && input.hasConflicts)
}

export type ApplyConflictResolveHostResult =
  | {
      ok: true
      kind: 'canonical_ok'
      applied: number
      revision: number
      scheduleBlocks: ScheduleBlock[]
    }
  | {
      ok: false
      kind: 'canonical_skipped' | 'canonical_failed' | 'refresh_failed' | 'no_moves'
      applied: number
      code: string
      message: string
      /** Present only when write applied but re-read failed (caller may local-patch). */
      scheduleBlocks: ScheduleBlock[] | null
    }

/**
 * Explicit-confirm apply path: sequential unlocked upserts via dual-write, then re-read.
 * Never moves locked (dual-write refuse). Stops on first failure.
 */
export async function applyConflictResolveMovesAndRefresh(
  ctx: CanonicalPlanningContext,
  input: { moves: readonly ProposedBlockMove[] }
): Promise<ApplyConflictResolveHostResult> {
  if (!input.moves.length) {
    return {
      ok: false,
      kind: 'no_moves',
      applied: 0,
      code: 'no_moves',
      message: 'No moves to apply.',
      scheduleBlocks: null
    }
  }

  const result = await dualWriteApplyConflictResolveMoves(ctx, {
    moves: input.moves.map((m) => ({
      blockId: m.blockId,
      to: { startAtMs: m.to.startAtMs, endAtMs: m.to.endAtMs }
    }))
  })

  if (result.kind === 'canonical_skipped') {
    return {
      ok: false,
      kind: 'canonical_skipped',
      applied: 0,
      code: result.reason,
      message:
        result.reason === 'missing_workspace'
          ? '无法写入：缺少工作区'
          : '无法写入：规划 API 不可用',
      scheduleBlocks: null
    }
  }

  if (result.kind === 'canonical_failed') {
    const withCode = result as { code?: string; message?: string; applied: number; result?: { error?: { code?: string; message?: string } } }
    const code =
      typeof withCode.code === 'string' && withCode.code
        ? withCode.code
        : withCode.result?.error?.code ?? 'apply_failed'
    const message =
      typeof withCode.message === 'string' && withCode.message
        ? withCode.message
        : withCode.result?.error?.message ?? '错开写入失败'
    return {
      ok: false,
      kind: 'canonical_failed',
      applied: result.applied,
      code,
      message,
      scheduleBlocks: null
    }
  }

  const read = await readStudyPlanningSnapshot(ctx.api, ctx.workspaceRoot)
  if (!read.ok) {
    return {
      ok: false,
      kind: 'refresh_failed',
      applied: result.applied,
      code: read.code,
      message: read.message,
      scheduleBlocks: null
    }
  }

  return {
    ok: true,
    kind: 'canonical_ok',
    applied: result.applied,
    revision: read.snapshot.revision,
    scheduleBlocks: read.snapshot.scheduleBlocks.slice()
  }
}

/**
 * Pure local projection of confirmed moves onto a block list.
 * Used as fail-soft UI refresh when dual-write applied but re-read failed.
 * Never mutates locked blocks.
 */
export function applyMovesToLocalBlocks(
  blocks: readonly ScheduleBlock[],
  moves: readonly ProposedBlockMove[]
): ScheduleBlock[] {
  if (!moves.length) return blocks.slice()
  const byId = new Map(moves.map((m) => [m.blockId, m]))
  return blocks.map((b) => {
    const move = byId.get(b.id)
    if (!move) return b
    if (b.locked) return b
    return {
      ...b,
      startAtMs: move.to.startAtMs,
      endAtMs: move.to.endAtMs,
      revision: (Number.isFinite(b.revision) ? b.revision : 0) + 1
    }
  })
}

/**
 * When parent scheduleBlocks catch up to a local override (same start/end per id),
 * drop the override so sole parent prop remains source.
 */
export function shouldClearScheduleBlocksOverride(input: {
  override: readonly ScheduleBlock[] | null | undefined
  parent: readonly ScheduleBlock[] | null | undefined
}): boolean {
  const override = input.override
  const parent = input.parent
  if (!override || override.length === 0) return true
  if (!parent || parent.length === 0) return false
  const parentById = new Map(parent.map((b) => [b.id, b]))
  return override.every((ob) => {
    const pb = parentById.get(ob.id)
    if (!pb) return false
    return pb.startAtMs === ob.startAtMs && pb.endAtMs === ob.endAtMs
  })
}
