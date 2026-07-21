/**
 * Focus-start attribution without silent first-open-task bind (STC-401 / freeze #1).
 */

import { resolveEmptyStart, type EmptyStartChoice, type EmptyStartPolicy } from './empty-start-and-classification'

export type FocusStartAttribution =
  | { kind: 'task'; taskId: string }
  | { kind: 'unattributed' }
  | { kind: 'quick_start' }
  | { kind: 'ask'; policy: EmptyStartPolicy }

export type ResolveFocusStartInput = {
  /** Explicit start-button task id when provided. */
  explicitTaskId?: string | null
  selectedTaskId?: string | null
  openTaskIds: readonly string[]
  emptyStartPolicy?: EmptyStartPolicy
  /** User dialog choice when policy is ask_every_time (or when pick_task needs confirmation). */
  userChoice?: EmptyStartChoice
}

/**
 * Resolve which task (if any) a timer start should attribute to.
 * Never auto-picks the first open checklist item.
 */
export function resolveFocusStartAttribution(input: ResolveFocusStartInput): FocusStartAttribution {
  const open = new Set(input.openTaskIds)
  const explicit = input.explicitTaskId
  if (explicit != null && explicit !== '' && open.has(explicit)) {
    return { kind: 'task', taskId: explicit }
  }

  const selected = input.selectedTaskId
  if (selected != null && selected !== '' && open.has(selected)) {
    return { kind: 'task', taskId: selected }
  }

  const policy = input.emptyStartPolicy ?? 'ask_every_time'
  const empty = resolveEmptyStart({
    policy,
    ...(input.userChoice ? { userChoice: input.userChoice } : {}),
    selectedTaskId: selected ?? null
  })

  if (empty.action === 'ask') return { kind: 'ask', policy: empty.policy }
  if (empty.action === 'pick_task') return { kind: 'task', taskId: empty.taskId }
  if (empty.action === 'quick_start') return { kind: 'quick_start' }
  return { kind: 'unattributed' }
}
