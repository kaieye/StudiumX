/**
 * Pure presentation for study planning preferences (STC-404 restore).
 * emptyStartPolicy + classification prompt opt-out.
 */

import type { EmptyStartPolicy } from '../../../shared/study-planning'

export type EmptyStartPolicyOption = {
  value: EmptyStartPolicy
  label: string
  description: string
}

export type StudyPlanningPrefsModel = {
  emptyStartPolicy: EmptyStartPolicy
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

const EMPTY_START_OPTIONS: EmptyStartPolicyOption[] = [
  {
    value: 'ask_every_time',
    label: '每次询问',
    description: '无选中任务时弹出选择（推荐默认）。'
  },
  {
    value: 'remember_quick_start',
    label: '记住快速创建',
    description: '无选中任务时直接创建临时任务并开始。'
  },
  {
    value: 'remember_unattributed',
    label: '记住无任务计时',
    description: '无选中任务时以无任务计时开始。'
  }
]

export function normalizeEmptyStartPolicy(
  raw: string | null | undefined
): EmptyStartPolicy {
  if (raw === 'remember_quick_start' || raw === 'remember_unattributed') return raw
  return 'ask_every_time'
}

/**
 * Project preferences.emptyStartPolicy for UI sole-read (fail-closed default ask).
 */
export function projectEmptyStartPolicyFromPreferences(
  preferences: { emptyStartPolicy?: string | null } | null | undefined
): EmptyStartPolicy {
  return normalizeEmptyStartPolicy(preferences?.emptyStartPolicy ?? null)
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
  classificationPromptOptOut?: boolean
}): StudyPlanningPrefsModel {
  const emptyStartPolicy = normalizeEmptyStartPolicy(input.emptyStartPolicy)
  const classificationPromptOptOut = input.classificationPromptOptOut === true
  return {
    emptyStartPolicy,
    classificationPromptOptOut,
    options: EMPTY_START_OPTIONS,
    copy: {
      title: '启动与归类偏好',
      description: '写入工作区 canonical 偏好；可随时恢复默认。',
      emptyStartLabel: '无任务启动',
      classificationOptOutLabel: '完成后不再提示归类',
      classificationOptOutDetail:
        '关闭后完成收件箱任务不再弹出归类；取消勾选即可恢复提示。'
    }
  }
}
