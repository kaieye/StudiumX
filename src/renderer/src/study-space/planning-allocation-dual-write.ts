/**
 * STC-308 dual-write: apply AllocationProposal blocks to StudyPlanningStore.
 *
 * Pure command builder + CAS dual-write. Never invents tasks.
 * Blank blocks must be stripped before apply (caller / pure UI).
 */
import type {
  ProposedBlockKind,
  StudyPlanningCommandEnvelope
} from '../../../shared/study-planning'
import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type { CanonicalPlanningContext, DualWriteResult } from './planning-dual-write'

export type AllocationApplyBlock = {
  kind: Exclude<ProposedBlockKind, 'blank'>
  startAtMs: number
  endAtMs: number
  taskId?: string | null
  locked?: boolean
}

function hasCanonicalContext(ctx: CanonicalPlanningContext): boolean {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root) return false
  if (!ctx.api) return false
  if (typeof ctx.api.readStudyPlanning !== 'function') return false
  if (typeof ctx.api.applyStudyPlanning !== 'function') return false
  return true
}

function skipped(ctx: CanonicalPlanningContext): DualWriteResult {
  return {
    kind: 'canonical_skipped',
    reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
  }
}

function nowOf(ctx: CanonicalPlanningContext): number {
  return (ctx.nowMs ?? (() => Date.now()))()
}

export function buildApplyAllocationProposalCommand(
  input: {
    blocks: readonly AllocationApplyBlock[]
    planId?: string | null
    planRevision?: number
    idPrefix?: string
    /**
     * Optional host IANA zone stamped onto NEW blocks only (STC-704).
     * Never rewrites existing block zones (store append-only for this command).
     */
    hostTimeZone?: string | null
    /** Alias for hostTimeZone. */
    timeZone?: string | null
  },
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const zoneRaw =
    typeof input.hostTimeZone === 'string'
      ? input.hostTimeZone.trim()
      : typeof input.timeZone === 'string'
        ? input.timeZone.trim()
        : ''
  return {
    actionId,
    type: 'apply_allocation_proposal',
    payload: {
      blocks: input.blocks.map((b) => ({
        kind: b.kind,
        startAtMs: b.startAtMs,
        endAtMs: b.endAtMs,
        taskId: b.taskId ?? null,
        locked: Boolean(b.locked)
      })),
      ...(input.planId ? { planId: input.planId } : {}),
      ...(typeof input.planRevision === 'number' ? { planRevision: input.planRevision } : {}),
      ...(input.idPrefix ? { idPrefix: input.idPrefix } : {}),
      ...(zoneRaw ? { hostTimeZone: zoneRaw } : {})
    },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

async function applyWithRevisionRetry(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  build: (actionId: string, issuedAt: number) => StudyPlanningCommandEnvelope,
  nowMs: () => number,
  actionPrefix: string
): Promise<PlanningClientApplyResult> {
  const read = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!read.ok) {
    return { ok: false, revision: 0, error: { code: read.code, message: read.message } }
  }
  const issued = nowMs()
  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    read.snapshot.revision,
    build(`${actionPrefix}:${issued}:0`, issued)
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  const retryIssued = nowMs()
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    build(`${actionPrefix}:${retryIssued}:retry`, retryIssued)
  )
}

function toDualWrite(result: PlanningClientApplyResult): DualWriteResult {
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/**
 * Apply confirmed allocation blocks via apply_allocation_proposal (CAS + one retry).
 * Fail-closed without workspace/api. Empty blocks → invalid_command.
 * Optional hostTimeZone stamps NEW drafts only (STC-704; no silent rezone).
 */
export async function dualWriteApplyAllocationProposal(
  ctx: CanonicalPlanningContext,
  input: {
    blocks: readonly AllocationApplyBlock[]
    planId?: string | null
    planRevision?: number
    idPrefix?: string
    hostTimeZone?: string | null
    timeZone?: string | null
  }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'apply_allocation_proposal.blocks required' }
      }
    }
  }

  const nowMs = () => nowOf(ctx)
  const prefix = input.idPrefix?.trim() || `alloc-${nowMs()}`
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) =>
      buildApplyAllocationProposalCommand(
        {
          blocks: input.blocks,
          planId: input.planId,
          planRevision: input.planRevision,
          idPrefix: prefix,
          hostTimeZone: input.hostTimeZone,
          timeZone: input.timeZone
        },
        actionId,
        issued
      ),
    nowMs,
    `apply_allocation:${prefix}`
  )
  return toDualWrite(result)
}
