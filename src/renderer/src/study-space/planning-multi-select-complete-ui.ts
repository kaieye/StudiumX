/**
 * Pure multi-select complete UI helpers (STC-408 remainder / product entry).
 *
 * Selection mode model for bulk-completing open tasks without prompt storm.
 * No I/O. Fail-closed: only explicit open task ids are completable.
 */

export type MultiSelectCompleteTask = {
  id: string
  done?: boolean
  title?: string
}

export type MultiSelectCompleteToolbarCopy = {
  enterLabel: string
  exitLabel: string
  completeLabel: string
  clearLabel: string
  selectAllVisibleLabel: string
  selectedCountLabel: string
  emptySelectionHint: string
}

export type MultiSelectCompleteToolbarModel = {
  selectedCount: number
  completableIds: string[]
  canComplete: boolean
  copy: MultiSelectCompleteToolbarCopy
}

function normalizeId(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Collect open (not done) task ids eligible for multi-select complete.
 *
 * - `selectedIds` omitted/null → all open (select-all base / inventory)
 * - `selectedIds: []` → empty (explicit no selection; fail-closed for complete)
 * - non-empty → intersect with open only
 */
export function collectOpenTaskIdsForMultiSelectComplete(input: {
  tasks: readonly MultiSelectCompleteTask[]
  selectedIds?: readonly string[] | null
}): string[] {
  const openIds = input.tasks
    .filter((t) => t && typeof t.id === 'string' && t.id.trim().length > 0 && !t.done)
    .map((t) => t.id.trim())

  if (input.selectedIds === undefined || input.selectedIds === null) {
    return openIds
  }

  if (input.selectedIds.length === 0) {
    return []
  }

  const selected = new Set(
    input.selectedIds
      .map((id) => normalizeId(id))
      .filter((id): id is string => id !== null)
  )
  return openIds.filter((id) => selected.has(id))
}

/**
 * Toggle one task id in the multi-select set.
 * Only open tasks may be selected; toggling a done/missing id is a no-op add.
 */
export function toggleMultiSelectTaskId(input: {
  selectedIds: readonly string[]
  taskId: string
  tasks: readonly MultiSelectCompleteTask[]
}): string[] {
  const taskId = normalizeId(input.taskId)
  if (!taskId) {
    return uniquePreserveOrder(input.selectedIds)
  }

  const open = input.tasks.some(
    (t) => typeof t.id === 'string' && t.id.trim() === taskId && !t.done
  )
  const current = uniquePreserveOrder(input.selectedIds)
  const has = current.includes(taskId)

  if (has) {
    return current.filter((id) => id !== taskId)
  }
  if (!open) {
    return current
  }
  return [...current, taskId]
}

/**
 * Keep only ids that still refer to open tasks (prune after complete/remove).
 */
export function pruneMultiSelectTaskIds(input: {
  selectedIds: readonly string[]
  tasks: readonly MultiSelectCompleteTask[]
}): string[] {
  const open = new Set(
    input.tasks
      .filter((t) => typeof t.id === 'string' && t.id.trim().length > 0 && !t.done)
      .map((t) => t.id.trim())
  )
  return uniquePreserveOrder(input.selectedIds).filter((id) => open.has(id))
}

/**
 * Select all currently visible open tasks.
 * Default replaces selection with visible open ids.
 */
export function selectAllVisibleOpenTaskIds(input: {
  visibleTasks: readonly MultiSelectCompleteTask[]
  selectedIds?: readonly string[] | null
  mode?: 'replace' | 'union'
}): string[] {
  const visibleOpen = collectOpenTaskIdsForMultiSelectComplete({
    tasks: input.visibleTasks
  })
  if (input.mode === 'union') {
    return uniquePreserveOrder([...(input.selectedIds ?? []), ...visibleOpen])
  }
  return visibleOpen
}

/**
 * Resolve payload for completeTasksBatch: open selected only, preserve order.
 * Empty selection → empty payload (never completes all open by accident).
 */
export function resolveMultiSelectCompletePayload(input: {
  tasks: readonly MultiSelectCompleteTask[]
  selectedIds: readonly string[]
}): string[] {
  return collectOpenTaskIdsForMultiSelectComplete({
    tasks: input.tasks,
    selectedIds: input.selectedIds
  })
}

/**
 * Presentation model for multi-select complete toolbar.
 */
export function buildMultiSelectCompleteToolbarModel(input: {
  tasks: readonly MultiSelectCompleteTask[]
  selectedIds: readonly string[]
}): MultiSelectCompleteToolbarModel {
  const completableIds = resolveMultiSelectCompletePayload({
    tasks: input.tasks,
    selectedIds: input.selectedIds
  })
  const n = completableIds.length
  return {
    selectedCount: n,
    completableIds,
    canComplete: n > 0,
    copy: {
      enterLabel: '多选',
      exitLabel: '取消多选',
      completeLabel: n > 0 ? `完成（${n}）` : '完成',
      clearLabel: '清空选择',
      selectAllVisibleLabel: '全选可见',
      selectedCountLabel: n > 0 ? `已选 ${n}` : '未选择',
      emptySelectionHint: '请先勾选待完成任务'
    }
  }
}

function uniquePreserveOrder(ids: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = normalizeId(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
