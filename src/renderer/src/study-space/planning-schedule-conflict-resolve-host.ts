/**
 * STC-707 host glue for week-plan conflict resolve on StudyTaskSchedulePage.
 *
 * Product-signal freeze (IMPL-U):
 * - Opt-in preview → confirm writeback is a **shipped default capability** on the
 *   schedule page whenever conflicts are detected and planning context exists.
 * - Silent auto-stagger remains **forbidden** (never auto-apply on detect/hydrate).
 * - Locked blocks never move; hard ends respected by pure propose.
 *
 * - Pure preview selection (wraps projectScheduleConflictResolvePreview)
 * - Apply orchestration: sequential dual-write CAS + re-read refresh
 * - Never auto-invoked on detect/hydrate; host must call only after explicit confirm
 *
 * ADR-0130 §5.1 + roadmap STC-707: opt-in shipped; silent default banned.
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
 * STC-707 product-signal freeze (code-level contract).
 * Opt-in two-step writeback is the default shipped capability when conflicts exist;
 * silent automatic resolve on detect is never enabled.
 */
export const STC_707_PRODUCT_SIGNAL = {
  /** Opt-in preview→confirm is shipped whenever conflicts + planning context. */
  optInWritebackShippedDefault: true as const,
  /** Silent auto-stagger on detect/hydrate is forbidden. */
  silentAutoStaggerAllowed: false as const,
  /** Apply requires explicit 确认应用 after 预览错开. */
  requireExplicitConfirm: true as const,
  /** Pure + dual-write never move locked blocks. */
  respectLockedBlocks: true as const,
  /** Pure propose fails closed on hardEnd window violation. */
  respectHardEnd: true as const
} as const

/**
 * Product freeze: never auto-apply conflict resolve on detect/hydrate.
 * Hosts must only call apply after explicit 确认应用.
 */
export function shouldAutoApplyConflictResolveOnDetect(): false {
  return STC_707_PRODUCT_SIGNAL.silentAutoStaggerAllowed
}

/**
 * Whether the confirm-apply CTA may run (preview ready with at least one move).
 * Empty preview / all targets locked → false (apply disabled/hidden path).
 */
export function canConfirmConflictResolveApply(input: {
  preview: ScheduleConflictResolvePreview | null | undefined
}): boolean {
  const preview = input.preview
  if (!preview || preview.kind !== 'ready') return false
  return Array.isArray(preview.moves) && preview.moves.length > 0
}

/**
 * Build opt-in resolve preview when the banner has conflicts.
 * Pure: never writes. Returns null when host should stay list-only (no conflicts).
 */
export function buildConflictResolvePreviewModel(input: {
  scheduleBlocks?: readonly ScheduleBlock[] | null
  /**
   * UI-visible tasks for orphan-filter parity with projectScheduleConflictsBanner.
   * When omitted, resolve scans all focus blocks (legacy pure tests).
   */
  tasks?: readonly { id: string; title?: string | null; done?: boolean }[] | null
  /** When false, host stays list-only (no CTA). */
  hasConflicts?: boolean
  window?: { startAtMs: number; endAtMs: number; hardEnd: boolean }
}): ScheduleConflictResolvePreview | null {
  if (input.hasConflicts === false) return null
  return projectScheduleConflictResolvePreview({
    scheduleBlocks: input.scheduleBlocks,
    tasks: input.tasks,
    window: input.window
  })
}

/**
 * Whether the host should pass resolve CTA props into the banner.
 * Product-signal (shipped default): wire whenever planning context + conflicts.
 * Without context, stay list-only (cannot CAS-write). Never implies silent auto.
 */
export function shouldWireConflictResolveCta(input: {
  hasPlanningContext: boolean
  hasConflicts: boolean
}): boolean {
  if (!STC_707_PRODUCT_SIGNAL.optInWritebackShippedDefault) return false
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
 *
 * Also clear when the parent set is a *strict subset / re-sync* that no longer
 * carries every override id with matching intervals — e.g. soft-delete dropped
 * orphan blocks. Stale override would otherwise keep phantom conflict banners
 * after the host re-hydrated a cleaner canonical snapshot.
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
  const overrideById = new Map(override.map((b) => [b.id, b]))

  // Parent has every override id with identical interval → override is fully applied.
  const overrideCaughtUp = override.every((ob) => {
    const pb = parentById.get(ob.id)
    if (!pb) return false
    return pb.startAtMs === ob.startAtMs && pb.endAtMs === ob.endAtMs
  })
  if (overrideCaughtUp) return true

  // Parent re-sync dropped or rewrote blocks relative to override: keep override only
  // while parent still looks older (missing moved intervals). If parent has *extra*
  // authoritative rows or different times for shared ids, prefer parent (clear).
  // Clear when no shared id still needs the override (all shared ids already match
  // or parent has no shared ids left — override is pure stale ghost).
  let sharedNeedsOverride = false
  for (const [id, ob] of overrideById) {
    const pb = parentById.get(id)
    if (!pb) continue
    if (pb.startAtMs !== ob.startAtMs || pb.endAtMs !== ob.endAtMs) {
      sharedNeedsOverride = true
      break
    }
  }
  // No shared id still differs → parent either absorbed moves or dropped them.
  // Drop override so conflict scan / week chips sole-read parent again.
  return !sharedNeedsOverride
}
