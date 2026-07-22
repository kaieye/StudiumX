/**
 * Batch classify sheet model (STC-408 product path).
 * One category for many inbox tasks; no per-task prompts / storm.
 */

import { resolveClassificationCategoryId, type ClassificationPromptCategory } from './classification-prompt-sheet'

export type BatchClassifySheetTask = {
  id: string
  title: string
}

export type BatchClassifySheetModel = {
  taskIds: string[]
  tasks: BatchClassifySheetTask[]
  categories: ClassificationPromptCategory[]
  selectedCount: number
  copy: {
    title: string
    description: string
    categoryListLabel: string
    emptyCategoriesHint: string
    emptyTasksHint: string
    confirmLabel: string
    cancelLabel: string
  }
}

/**
 * Collect inbox task ids eligible for batch classify.
 * Fail-closed: only explicit ids that exist and are inbox (no category).
 */
export function collectInboxTaskIdsForBatchClassify(input: {
  tasks: readonly { id: string; title?: string; categoryId?: string | null }[]
  selectedIds?: readonly string[] | null
}): string[] {
  const inboxIds = input.tasks
    .filter((t) => {
      const hasCat = typeof t.categoryId === 'string' && t.categoryId.trim().length > 0
      return !hasCat
    })
    .map((t) => t.id)

  if (!input.selectedIds || input.selectedIds.length === 0) {
    return inboxIds
  }
  const selected = new Set(
    input.selectedIds.filter((id) => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())
  )
  return inboxIds.filter((id) => selected.has(id))
}

/**
 * Whether a complete path should suppress per-task classification prompt
 * (batch complete / bulk op). Fail-closed: only suppress when flagged.
 */
export function shouldSuppressClassificationPromptStorm(input: {
  isBatchComplete?: boolean
  isImportMigration?: boolean
}): boolean {
  return input.isBatchComplete === true || input.isImportMigration === true
}

/**
 * Build presentation model for batch classify sheet.
 */
export function buildBatchClassifySheetModel(input: {
  tasks: readonly BatchClassifySheetTask[]
  taskIds: readonly string[]
  categories: readonly ClassificationPromptCategory[]
}): BatchClassifySheetModel {
  const idSet = new Set(
    input.taskIds.filter((id) => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())
  )
  const tasks = input.tasks
    .filter((t) => idSet.has(t.id))
    .map((t) => ({
      id: t.id,
      title: (t.title ?? '').trim() || '未命名任务'
    }))
  const categories = input.categories
    .filter((c) => typeof c.id === 'string' && c.id.trim().length > 0)
    .map((c) => ({
      id: c.id.trim(),
      name: (c.name ?? '').trim() || c.id.trim(),
      ...(c.color ? { color: c.color } : {})
    }))
  const n = tasks.length
  return {
    taskIds: tasks.map((t) => t.id),
    tasks,
    categories,
    selectedCount: n,
    copy: {
      title: n > 0 ? `批量归类（${n}）` : '批量归类',
      description:
        n > 0
          ? `为 ${n} 个待归类任务选择同一类别。不会弹出逐条提示。`
          : '当前没有可批量归类的待归类任务。',
      categoryListLabel: '选择类别',
      emptyCategoriesHint: '暂无可用类别。',
      emptyTasksHint: '没有选中的待归类任务。',
      confirmLabel: '确认归类',
      cancelLabel: '取消'
    }
  }
}

export { resolveClassificationCategoryId }
