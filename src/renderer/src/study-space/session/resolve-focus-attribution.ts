/**
 * Renderer peel for empty-start attribution (STC-401).
 * Thin adapter over shared resolveFocusStartAttribution — no first-open silent bind.
 */

import {
  resolveFocusStartAttribution,
  type EmptyStartChoice,
  type EmptyStartPolicy,
  type FocusStartAttribution
} from '../../../../shared/study-planning'

export type { EmptyStartChoice, EmptyStartPolicy, FocusStartAttribution }

export function resolveStudyFocusAttribution(input: {
  explicitTaskId?: string | null
  selectedTaskId?: string | null
  tasks: readonly { id: string; done: boolean }[]
  emptyStartPolicy?: EmptyStartPolicy
  userChoice?: EmptyStartChoice
}): FocusStartAttribution {
  const openTaskIds = input.tasks.filter((t) => !t.done).map((t) => t.id)
  return resolveFocusStartAttribution({
    openTaskIds,
    ...(input.explicitTaskId !== undefined ? { explicitTaskId: input.explicitTaskId } : {}),
    ...(input.selectedTaskId !== undefined ? { selectedTaskId: input.selectedTaskId } : {}),
    ...(input.emptyStartPolicy ? { emptyStartPolicy: input.emptyStartPolicy } : {}),
    ...(input.userChoice ? { userChoice: input.userChoice } : {})
  })
}

/** Map attribution to lifecycle taskId (null = unattributed). quick_start/ask handled by caller. */
export function attributionToTaskId(attr: FocusStartAttribution): string | null | 'ask' | 'quick_start' {
  if (attr.kind === 'task') return attr.taskId
  if (attr.kind === 'unattributed') return null
  if (attr.kind === 'quick_start') return 'quick_start'
  return 'ask'
}
