/**
 * Pure presentation for study planning preferences (STC-404 restore).
 * emptyStartPolicy retained for legacy dual-write compatibility.
 * Product UI: empty-start category row (default 「其他」).
 */

import type { EmptyStartPolicy } from '../../../shared/study-planning'
import { normalizeStudyTaskCategoryId } from './taskCategories'

export type EmptyStartPolicyOption = {
  value: EmptyStartPolicy
  label: string
  description: string
}

export type StudyPlanningPrefsModel = {
  emptyStartPolicy: EmptyStartPolicy
  emptyStartCategoryId: string
  classificationPromptOptOut: boolean
  options: EmptyStartPolicyOption[]
  copy: {
    title: string
    description: string
    emptyStartLabel: string
    classificationOptOutLabel: string
    classificationOptOutDetail: string
  }
}

export type EmptyStartCategoryOption = {
  value: string
  label: string
}

const EMPTY_START_OPTIONS: EmptyStartPolicyOption[] = [
  {
    value: 'remember_quick_start',
    label: '归入类别',
    description: '无选中任务时创建临时任务并按空启动归类开始（默认）。'
  },
  {
    value: 'ask_every_time',
    label: '每次询问',
    description: '无选中任务时弹出选择（选任务 / 临时任务 / 无任务计时）。'
  },
  {
    value: 'remember_unattributed',
    label: '记住无任务计时',
    description: '无选中任务时以无任务计时开始（时间不计入任务占比）。'
  }
]

export const DEFAULT_EMPTY_START_CATEGORY_ID = 'other'

export function normalizeEmptyStartPolicy(
  raw: string | null | undefined
): EmptyStartPolicy {
  if (raw === 'ask_every_time' || raw === 'remember_unattributed') return raw
  // Default product path: empty-start → quick temp task under emptyStartCategoryId.
  if (raw === 'remember_quick_start' || raw == null || raw === '') return 'remember_quick_start'
  return 'remember_quick_start'
}

/**
 * Project preferences.emptyStartPolicy for UI sole-read (default remember_quick_start).
 */
export function projectEmptyStartPolicyFromPreferences(
  preferences: { emptyStartPolicy?: string | null } | null | undefined
): EmptyStartPolicy {
  return normalizeEmptyStartPolicy(preferences?.emptyStartPolicy ?? null)
}

/**
 * Normalize empty-start category id. Unknown / missing → other.
 * When knownIds is provided, rejects ids not present in the catalog.
 */
export function normalizeEmptyStartCategoryId(
  raw: string | null | undefined,
  knownIds?: readonly string[] | null
): string {
  const id = normalizeStudyTaskCategoryId(raw)
  if (!id) return DEFAULT_EMPTY_START_CATEGORY_ID
  if (knownIds && knownIds.length > 0 && !knownIds.includes(id)) {
    return DEFAULT_EMPTY_START_CATEGORY_ID
  }
  return id
}

/**
 * Project preferences.emptyStartCategoryId for UI sole-read (default other).
 */
export function projectEmptyStartCategoryIdFromPreferences(
  preferences: { emptyStartCategoryId?: string | null } | null | undefined,
  knownIds?: readonly string[] | null
): string {
  return normalizeEmptyStartCategoryId(preferences?.emptyStartCategoryId ?? null, knownIds)
}

/**
 * Project classificationPromptOptOut for UI sole-read.
 */
export function projectClassificationPromptOptOutFromPreferences(
  preferences: { classificationPromptOptOut?: boolean | null } | null | undefined
): boolean {
  return preferences?.classificationPromptOptOut === true
}

export function buildStudyPlanningPrefsModel(input: {
  emptyStartPolicy?: EmptyStartPolicy | null
  emptyStartCategoryId?: string | null
  classificationPromptOptOut?: boolean
  categoryOptions?: readonly EmptyStartCategoryOption[] | null
}): StudyPlanningPrefsModel {
  const emptyStartPolicy = normalizeEmptyStartPolicy(input.emptyStartPolicy)
  const knownIds = input.categoryOptions?.map((o) => o.value) ?? null
  const emptyStartCategoryId = normalizeEmptyStartCategoryId(
    input.emptyStartCategoryId,
    knownIds
  )
  const classificationPromptOptOut = input.classificationPromptOptOut === true
  return {
    emptyStartPolicy,
    emptyStartCategoryId,
    classificationPromptOptOut,
    options: EMPTY_START_OPTIONS,
    copy: {
      title: '空启动归类',
      description: '无选中任务时归因到哪个任务类别；默认「其他」。',
      emptyStartLabel: '空启动归类',
      classificationOptOutLabel: '完成后不再提示归类',
      classificationOptOutDetail:
        '关闭后完成收件箱任务不再弹出归类；取消勾选即可恢复提示。'
    }
  }
}
