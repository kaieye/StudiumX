/**
 * STC-308 pure presentation model: AllocationProposal preview + diff rows.
 *
 * Builds allocateTimeWindow output into confirm UI rows without writing store.
 * Blank blocks are preview-only (never applied). Locked blocks stay put.
 */
import {
  allocateTimeWindow,
  proposalBlocksToScheduleBlocks,
  diffScheduleBlocks,
  type AllocationProposal,
  type AllocatorTask,
  type LockedScheduleBlock,
  type ProposedBlock,
  type ScheduleBlock,
  type TimeWindow,
  type TimerPlanV2
} from '../../../shared/study-planning'
import type { StudyTask } from './types'

export type AllocationPreviewChange = 'added' | 'removed' | 'unchanged'

export type AllocationPreviewRow = {
  /** Stable list key (draft id or current block id). */
  key: string
  change: AllocationPreviewChange
  kind: ProposedBlock['kind']
  startAtMs: number
  endAtMs: number
  taskId: string | null
  taskTitle: string | null
  locked: boolean
  kindLabel: string
  timeLabel: string
}

export type AllocationProposalPreviewModel = {
  proposal: AllocationProposal
  /** Materialized non-blank drafts ready for apply_allocation_proposal. */
  applyBlocks: Array<{
    kind: Exclude<ProposedBlock['kind'], 'blank'>
    startAtMs: number
    endAtMs: number
    taskId: string | null
    locked: boolean
  }>
  proposedScheduleBlocks: ScheduleBlock[]
  diff: {
    added: ScheduleBlock[]
    removed: ScheduleBlock[]
    unchanged: ScheduleBlock[]
  }
  rows: AllocationPreviewRow[]
  canConfirm: boolean
  planId: string
  planRevision: number
  warnings: string[]
  copy: {
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    emptyLabel: string
    warningsTitle: string
    metaLine: string
  }
}

const KIND_LABEL: Record<ProposedBlock['kind'], string> = {
  focus: '专注',
  short_break: '短休息',
  long_break: '长休息',
  wrap_up: '收尾',
  blank: '空档'
}

const MINUTE_MS = 60_000

/**
 * Parse "HH:mm" / "H:mm" into minutes from midnight. Fail-closed.
 */
export function parseHhMmToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!match) return null
  const hour = Number.parseInt(match[1]!, 10)
  const minute = Number.parseInt(match[2]!, 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null
  if (hour === 24 && minute !== 0) return null
  const total = hour * 60 + minute
  if (total < 0 || total > 24 * 60) return null
  return total
}

/**
 * Build a hard-end TimeWindow from V1 simulation HH:mm strings on a local day.
 */
export function buildTimeWindowFromSimulation(input: {
  dayStartMs: number
  simulationStartTime: string
  simulationEndTime: string
  hardEnd?: boolean
  label?: string
}): TimeWindow | null {
  if (!Number.isFinite(input.dayStartMs)) return null
  const startMinutes = parseHhMmToMinutes(input.simulationStartTime)
  const endMinutes = parseHhMmToMinutes(input.simulationEndTime)
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null
  return {
    startAtMs: input.dayStartMs + startMinutes * MINUTE_MS,
    endAtMs: input.dayStartMs + endMinutes * MINUTE_MS,
    hardEnd: input.hardEnd !== false,
    ...(input.label ? { label: input.label } : { label: `${input.simulationStartTime}–${input.simulationEndTime}` })
  }
}

export function formatMsClock(ms: number): string {
  const d = new Date(ms)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export function formatBlockTimeRangeMs(startAtMs: number, endAtMs: number): string {
  return `${formatMsClock(startAtMs)}–${formatMsClock(endAtMs)}`
}

export function kindLabelForProposed(kind: ProposedBlock['kind']): string {
  return KIND_LABEL[kind] ?? String(kind)
}

/**
 * Open StudyTask rows → AllocatorTask (no invented estimates; freeze #8).
 */
export function studyTasksToAllocatorTasks(tasks: readonly StudyTask[]): AllocatorTask[] {
  return tasks
    .filter((t) => !t.done && typeof t.id === 'string' && t.id.trim().length > 0)
    .map((t, index) => ({
      id: t.id,
      estimateMinutes: null,
      remainingEstimateMinutes: null,
      splittable: true,
      priority: 'normal' as const,
      manualOrder: index
    }))
}

/**
 * Locked ScheduleBlocks only — unlocked existing blocks are not passed as locks
 * so the allocator may still propose into free gaps (apply still appends).
 */
export function scheduleBlocksToLocked(
  blocks: readonly ScheduleBlock[]
): LockedScheduleBlock[] {
  return blocks
    .filter((b) => b.locked && b.status !== 'cancelled')
    .map((b) => ({
      id: b.id,
      taskId: b.taskId,
      kind: b.kind,
      startAtMs: b.startAtMs,
      endAtMs: b.endAtMs
    }))
}

/**
 * Blocks that apply_allocation_proposal should receive (allocator non-blank only).
 */
export function proposalBlocksForApply(
  blocks: readonly ProposedBlock[]
): Array<{
  kind: Exclude<ProposedBlock['kind'], 'blank'>
  startAtMs: number
  endAtMs: number
  taskId: string | null
  locked: boolean
}> {
  const out: Array<{
    kind: Exclude<ProposedBlock['kind'], 'blank'>
    startAtMs: number
    endAtMs: number
    taskId: string | null
    locked: boolean
  }> = []
  for (const block of blocks) {
    if (block.kind === 'blank') continue
    if (block.locked) continue
    if (block.source === 'locked') continue
    if (!Number.isFinite(block.startAtMs) || !Number.isFinite(block.endAtMs)) continue
    if (block.endAtMs <= block.startAtMs) continue
    out.push({
      kind: block.kind,
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      taskId: block.taskId ?? null,
      locked: false
    })
  }
  return out
}

function titleMap(tasks: readonly StudyTask[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const task of tasks) {
    map.set(task.id, (task.title ?? '').trim() || '未命名任务')
  }
  return map
}

/**
 * Build full preview model: allocate → materialize drafts → diff → rows + copy.
 * Pure; never writes.
 */
export function buildAllocationProposalPreview(input: {
  window: TimeWindow
  plan: TimerPlanV2
  tasks: readonly StudyTask[]
  currentBlocks: readonly ScheduleBlock[]
  nowMs?: number
  idPrefix?: string
}): AllocationProposalPreviewModel {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : input.window.startAtMs
  const titles = titleMap(input.tasks)
  const proposal = allocateTimeWindow({
    window: input.window,
    plan: input.plan,
    tasks: studyTasksToAllocatorTasks(input.tasks),
    lockedBlocks: scheduleBlocksToLocked(input.currentBlocks),
    nowMs
  })

  const applyBlocks = proposalBlocksForApply(proposal.blocks)
  const idPrefix = input.idPrefix?.trim() || `alloc-${nowMs}`
  const proposedScheduleBlocks = proposalBlocksToScheduleBlocks({
    blocks: applyBlocks,
    planId: input.plan.id,
    planRevision: input.plan.revision,
    idPrefix
  })

  const diff = diffScheduleBlocks(input.currentBlocks, [
    ...input.currentBlocks,
    ...proposedScheduleBlocks
  ])

  const rows: AllocationPreviewRow[] = []
  for (const block of proposedScheduleBlocks) {
    rows.push({
      key: `add:${block.id}`,
      change: 'added',
      kind: block.kind,
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      taskId: block.taskId,
      taskTitle: block.taskId ? titles.get(block.taskId) ?? null : null,
      locked: block.locked,
      kindLabel: kindLabelForProposed(block.kind),
      timeLabel: formatBlockTimeRangeMs(block.startAtMs, block.endAtMs)
    })
  }
  // Surface blank / warning-only remainder as non-apply preview rows
  for (const block of proposal.blocks) {
    if (block.kind !== 'blank') continue
    rows.push({
      key: `blank:${block.startAtMs}:${block.endAtMs}`,
      change: 'unchanged',
      kind: 'blank',
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      taskId: null,
      taskTitle: null,
      locked: false,
      kindLabel: kindLabelForProposed('blank'),
      timeLabel: formatBlockTimeRangeMs(block.startAtMs, block.endAtMs)
    })
  }
  rows.sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs)

  const addedCount = applyBlocks.length
  const canConfirm = addedCount > 0
  const utilPct = Math.round((proposal.meta.utilizationRatio || 0) * 100)
  const windowLabel = proposal.window.label ?? formatBlockTimeRangeMs(proposal.window.startAtMs, proposal.window.endAtMs)

  return {
    proposal,
    applyBlocks,
    proposedScheduleBlocks,
    diff: {
      added: proposedScheduleBlocks,
      removed: diff.removed,
      unchanged: input.currentBlocks.slice()
    },
    rows,
    canConfirm,
    planId: input.plan.id,
    planRevision: input.plan.revision,
    warnings: proposal.warnings.slice(),
    copy: {
      title: '排程提案预览',
      description: canConfirm
        ? `将在「${windowLabel}」按方案「${input.plan.name}」新增 ${addedCount} 个时间块。锁定块不会移动；确认后才写入清单。`
        : `窗口「${windowLabel}」未产生可写入的时间块（可能过短、全被锁定，或任务无法装入）。`,
      confirmLabel: canConfirm ? `确认写入 ${addedCount} 个时间块` : '无可写入块',
      cancelLabel: '取消',
      emptyLabel: '暂无新增时间块',
      warningsTitle: '提示',
      metaLine: `利用率 ${utilPct}% · 专注 ${proposal.meta.focusMinutesTotal} 分 · 休息 ${proposal.meta.breakMinutesTotal} 分 · 窗口 ${proposal.meta.windowMinutes} 分`
    }
  }
}
