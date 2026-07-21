/**
 * Study planning pure domain — ScheduleBlock / PlanningTask (STC-108 model).
 *
 * Non-wire planning sketch aligned with roadmap §13. Not a frozen file schema.
 * No I/O, no path freeze, no store write.
 */

export type PlanningTaskStatus = 'open' | 'done' | 'cancelled'
export type PlanningTaskPriority = 'low' | 'normal' | 'high'

export type PlanningTask = {
  id: string
  title: string
  status: PlanningTaskStatus
  /** null + inbox:true is the inbox projection (product freeze #2). */
  categoryId: string | null
  inbox: boolean
  notes?: string
  /** Default empty/null — freeze #8; never invent from plan focus minutes. */
  estimateMinutes?: number | null
  remainingEstimateMinutes?: number | null
  priority?: PlanningTaskPriority
  dueAtMs?: number | null
  splittable: boolean
  minimumBlockMinutes?: number
  revision: number
  source: 'migrated_v1' | 'manual' | 'allocator' | 'quick_start'
}

export type ScheduleBlockKind = 'focus' | 'short_break' | 'long_break' | 'wrap_up'
export type ScheduleBlockSource = 'manual' | 'allocator' | 'quick_start' | 'migrated_v1'
export type ScheduleBlockStatus = 'planned' | 'running' | 'completed' | 'skipped' | 'cancelled'

/**
 * Confirmed plan block (after user accepts AllocationProposal, or migrated V1 schedule).
 * Task 1:N ScheduleBlock — a task may own many blocks; breaks/wrap-ups have taskId null.
 */
export type ScheduleBlock = {
  id: string
  taskId: string | null
  kind: ScheduleBlockKind
  /** Epoch ms (caller-local). */
  startAtMs: number
  endAtMs: number
  locked: boolean
  source: ScheduleBlockSource
  planId?: string
  planRevision?: number
  status: ScheduleBlockStatus
  revision: number
}

export type ScheduleBlockValidationIssue = {
  code: string
  message: string
  blockId?: string
}

export function isValidScheduleBlockInterval(block: Pick<ScheduleBlock, 'startAtMs' | 'endAtMs'>): boolean {
  return (
    Number.isFinite(block.startAtMs) &&
    Number.isFinite(block.endAtMs) &&
    block.endAtMs > block.startAtMs
  )
}

/** Fail-closed interval + kind checks. Does not write. */
export function validateScheduleBlocks(
  blocks: readonly ScheduleBlock[]
): { ok: boolean; issues: ScheduleBlockValidationIssue[] } {
  const issues: ScheduleBlockValidationIssue[] = []
  const KIND_SET = new Set<ScheduleBlockKind>(['focus', 'short_break', 'long_break', 'wrap_up'])

  for (const block of blocks) {
    if (!block.id?.trim()) {
      issues.push({ code: 'block_id_required', message: 'ScheduleBlock id is required', blockId: block.id })
    }
    if (!KIND_SET.has(block.kind)) {
      issues.push({
        code: 'block_kind_invalid',
        message: `Invalid kind ${String(block.kind)}`,
        blockId: block.id
      })
    }
    if (!isValidScheduleBlockInterval(block)) {
      issues.push({
        code: 'block_interval_invalid',
        message: 'endAtMs must be after startAtMs',
        blockId: block.id
      })
    }
  }

  const ordered = [...blocks].sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs)
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]
    const cur = ordered[i]
    // Locked blocks must not overlap each other (invariant §3.2 #2).
    if (prev.locked && cur.locked && prev.startAtMs < cur.endAtMs && cur.startAtMs < prev.endAtMs) {
      issues.push({
        code: 'locked_blocks_overlap',
        message: `Locked blocks overlap: ${prev.id} / ${cur.id}`,
        blockId: cur.id
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

/** Convert accepted proposal blocks into ScheduleBlock drafts (still pure; no store write). */
export function proposalBlocksToScheduleBlocks(input: {
  blocks: readonly {
    kind: 'focus' | 'short_break' | 'long_break' | 'wrap_up' | 'blank'
    startAtMs: number
    endAtMs: number
    taskId?: string | null
    locked?: boolean
  }[]
  planId?: string
  planRevision?: number
  idPrefix?: string
}): ScheduleBlock[] {
  const prefix = input.idPrefix?.trim() || 'sb'
  const out: ScheduleBlock[] = []
  let n = 0
  for (const block of input.blocks) {
    if (block.kind === 'blank') continue
    if (!Number.isFinite(block.startAtMs) || !Number.isFinite(block.endAtMs) || block.endAtMs <= block.startAtMs) {
      continue
    }
    n += 1
    out.push({
      id: `${prefix}-${n}`,
      taskId: block.taskId ?? null,
      kind: block.kind,
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      locked: Boolean(block.locked),
      source: block.locked ? 'manual' : 'allocator',
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.planRevision !== undefined ? { planRevision: input.planRevision } : {}),
      status: 'planned',
      revision: 1
    })
  }
  return out
}
