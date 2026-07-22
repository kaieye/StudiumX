/**
 * Classification prompt sheet model (STC-406/407 product path).
 * Pure presentation after complete of an inbox task.
 * Closing / later / keep_inbox never rolls back completion.
 */

import type { ClassificationPromptAction } from './empty-start-and-classification'

export type ClassificationPromptCategory = {
  id: string
  name: string
  color?: string
}

export type ClassificationPromptSheetModel = {
  taskId: string
  taskTitle: string
  categories: ClassificationPromptCategory[]
  options: ClassificationPromptAction[]
  copy: {
    title: string
    description: string
    classifyLabel: string
    keepInboxLabel: string
    laterLabel: string
    neverPromptLabel: string
    categoryListLabel: string
    emptyCategoriesHint: string
    confirmClassifyLabel: string
    backLabel: string
  }
}

/**
 * Build presentation model for the non-blocking classification prompt.
 */
export function buildClassificationPromptSheetModel(input: {
  taskId: string
  taskTitle: string
  categories: readonly ClassificationPromptCategory[]
}): ClassificationPromptSheetModel {
  const title = (input.taskTitle ?? '').trim() || '未命名任务'
  const categories = input.categories
    .filter((c) => typeof c.id === 'string' && c.id.trim().length > 0)
    .map((c) => ({
      id: c.id.trim(),
      name: (c.name ?? '').trim() || c.id.trim(),
      ...(c.color ? { color: c.color } : {})
    }))

  return {
    taskId: input.taskId,
    taskTitle: title,
    categories,
    options: ['classify', 'keep_inbox', 'later', 'never_prompt'],
    copy: {
      title: '任务已完成 — 归类？',
      description: `「${title}」目前在收件箱。可选择类别、保持待归类，或稍后处理。关闭不会撤销完成。`,
      classifyLabel: '选择类别',
      keepInboxLabel: '保持待归类',
      laterLabel: '稍后',
      neverPromptLabel: '不再提示',
      categoryListLabel: '选择类别',
      emptyCategoriesHint: '暂无可用类别。',
      confirmClassifyLabel: '确认归类',
      backLabel: '返回'
    }
  }
}

/**
 * Validate selected category against the list (fail-closed: never invent first category).
 */
export function resolveClassificationCategoryId(
  categories: readonly ClassificationPromptCategory[],
  selectedCategoryId: string | null | undefined
): string | null {
  if (typeof selectedCategoryId !== 'string' || !selectedCategoryId.trim()) return null
  const id = selectedCategoryId.trim()
  return categories.some((c) => c.id === id) ? id : null
}

/**
 * Map sheet / host answers onto ClassificationPromptAction.
 * Unknown → null (fail-closed).
 */
export function normalizeClassificationPromptAction(
  raw: string | null | undefined
): ClassificationPromptAction | null {
  if (raw == null || raw === '') return null
  if (raw === 'classify') return 'classify'
  if (raw === 'keep_inbox' || raw === 'keep') return 'keep_inbox'
  if (raw === 'later' || raw === 'dismiss') return 'later'
  if (raw === 'never_prompt' || raw === 'never') return 'never_prompt'
  return null
}
