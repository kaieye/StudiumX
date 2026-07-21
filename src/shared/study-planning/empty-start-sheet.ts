/**
 * Empty-start sheet model (STC-401 UI cutover / product §8.1).
 * Pure: default titles, recommended actions, open-task presentation.
 * Never auto-binds first open task.
 */

import type { EmptyStartChoice, EmptyStartPolicy } from './empty-start-and-classification'

export type EmptyStartSheetTask = {
  id: string
  title: string
}

export type EmptyStartSheetOption = EmptyStartChoice | 'cancel'

export type EmptyStartSheetModel = {
  policy: EmptyStartPolicy
  hasOpenTasks: boolean
  openTasks: EmptyStartSheetTask[]
  defaultQuickStartTitle: string
  /**
   * Product §8.1: with open tasks, pick is available; without, recommend quick_start.
   * Never recommends silent first-open bind.
   */
  recommended: EmptyStartChoice
  options: EmptyStartSheetOption[]
  copy: {
    title: string
    description: string
    pickTaskLabel: string
    quickStartLabel: string
    unattributedLabel: string
    cancelLabel: string
    quickStartTitleLabel: string
    emptyTasksHint: string
  }
}

/**
 * Prefill title for temporary focus task: "临时专注 · HH:mm" (local wall clock).
 */
export function buildDefaultQuickStartTitle(now: Date = new Date()): string {
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `临时专注 · ${hours}:${minutes}`
}

/**
 * Build presentation model for the empty-start chooser sheet.
 */
export function buildEmptyStartSheetModel(input: {
  policy?: EmptyStartPolicy
  openTasks: readonly EmptyStartSheetTask[]
  now?: Date
}): EmptyStartSheetModel {
  const policy = input.policy ?? 'ask_every_time'
  const openTasks = input.openTasks
    .filter((task) => typeof task.id === 'string' && task.id.trim().length > 0)
    .map((task) => ({
      id: task.id,
      title: (task.title ?? '').trim() || '未命名任务'
    }))
  const hasOpenTasks = openTasks.length > 0
  const defaultQuickStartTitle = buildDefaultQuickStartTitle(input.now ?? new Date())

  // Recommended CTA: create temp task when no open tasks; otherwise leave pick as primary path.
  const recommended: EmptyStartChoice = hasOpenTasks ? 'pick_task' : 'quick_start'

  const options: EmptyStartSheetOption[] = hasOpenTasks
    ? ['pick_task', 'quick_start', 'unattributed', 'cancel']
    : ['quick_start', 'unattributed', 'cancel']

  return {
    policy,
    hasOpenTasks,
    openTasks,
    defaultQuickStartTitle,
    recommended,
    options,
    copy: {
      title: hasOpenTasks ? '开始专注前选择任务' : '开始专注',
      description: hasOpenTasks
        ? '当前没有选中任务。请选择清单中的任务、快速创建临时任务，或以「无任务」计时。不会静默绑定第一条开放任务。'
        : '清单暂无开放任务。可快速创建「临时专注」并开始，或以「无任务」计时（时间不计入任务占比）。',
      pickTaskLabel: '选择任务',
      quickStartLabel: hasOpenTasks ? '新建临时任务并开始' : '创建「临时专注」并开始',
      unattributedLabel: '无任务计时开始',
      cancelLabel: '取消',
      quickStartTitleLabel: '临时任务标题',
      emptyTasksHint: '暂无开放任务，请创建临时任务或无任务计时。'
    }
  }
}

/**
 * Normalize a user-edited quick-start title (trim + max 80). Falls back to default.
 */
export function normalizeQuickStartTitle(
  titleInput: string | null | undefined,
  now: Date = new Date()
): string {
  const trimmed = typeof titleInput === 'string' ? titleInput.trim() : ''
  if (!trimmed) return buildDefaultQuickStartTitle(now)
  return trimmed.slice(0, 80)
}

/**
 * Validate a pick_task answer against open tasks (never invent first open).
 */
export function resolvePickedTaskId(
  openTaskIds: readonly string[],
  pickedTaskId: string | null | undefined
): string | null {
  if (typeof pickedTaskId !== 'string' || !pickedTaskId.trim()) return null
  return openTaskIds.includes(pickedTaskId) ? pickedTaskId : null
}
