/**
 * Empty-start and classification policies (Phase 4 pure / STC-401..407).
 * Default empty-start: ask_every_time (product freeze #1).
 */

export type EmptyStartPolicy = 'ask_every_time' | 'remember_quick_start' | 'remember_unattributed'

export type EmptyStartChoice = 'pick_task' | 'quick_start' | 'unattributed'

export type EmptyStartResolution =
  | { action: 'ask'; policy: EmptyStartPolicy }
  | { action: 'pick_task'; taskId: string }
  | { action: 'quick_start' }
  | { action: 'unattributed' }

/**
 * Resolve empty-start without silently binding first open task.
 */
export function resolveEmptyStart(input: {
  policy: EmptyStartPolicy
  /** Explicit user choice from dialog; required when policy is ask_every_time. */
  userChoice?: EmptyStartChoice
  selectedTaskId?: string | null
}): EmptyStartResolution {
  const policy = input.policy ?? 'ask_every_time'

  if (policy === 'ask_every_time') {
    if (!input.userChoice) return { action: 'ask', policy }
    if (input.userChoice === 'pick_task') {
      if (input.selectedTaskId) return { action: 'pick_task', taskId: input.selectedTaskId }
      return { action: 'ask', policy }
    }
    if (input.userChoice === 'quick_start') return { action: 'quick_start' }
    return { action: 'unattributed' }
  }

  if (policy === 'remember_quick_start') return { action: 'quick_start' }
  return { action: 'unattributed' }
}

export type ClassificationPromptAction =
  | 'classify'
  | 'keep_inbox'
  | 'later'
  | 'never_prompt'

export type ClassificationPromptDecision = {
  showPrompt: boolean
  reason?: 'inbox_task_completed' | 'opted_out' | 'not_inbox' | 'not_completed'
}

export function shouldShowClassificationPrompt(input: {
  taskInbox: boolean
  taskStatus: 'open' | 'done' | 'cancelled'
  classificationPromptOptOut: boolean
}): ClassificationPromptDecision {
  if (input.classificationPromptOptOut) {
    return { showPrompt: false, reason: 'opted_out' }
  }
  if (input.taskStatus !== 'done') {
    return { showPrompt: false, reason: 'not_completed' }
  }
  if (!input.taskInbox) {
    return { showPrompt: false, reason: 'not_inbox' }
  }
  return { showPrompt: true, reason: 'inbox_task_completed' }
}

/**
 * Apply classification action. Completing task is never rolled back by closing prompt.
 */
export function applyClassificationAction(input: {
  categoryId: string | null
  inbox: boolean
  action: ClassificationPromptAction
  selectedCategoryId?: string | null
  preferences: { classificationPromptOptOut: boolean }
}): {
  categoryId: string | null
  inbox: boolean
  preferences: { classificationPromptOptOut: boolean }
} {
  if (input.action === 'never_prompt') {
    return {
      categoryId: input.categoryId,
      inbox: input.inbox,
      preferences: { classificationPromptOptOut: true }
    }
  }
  if (input.action === 'keep_inbox' || input.action === 'later') {
    return {
      categoryId: null,
      inbox: true,
      preferences: input.preferences
    }
  }
  // classify
  const cat = input.selectedCategoryId?.trim() || null
  return {
    categoryId: cat,
    inbox: cat == null,
    preferences: input.preferences
  }
}

/**
 * Batch classify many inbox tasks with one category (STC-408).
 * Does not open per-task prompts; returns updated task patches only.
 */
export function batchClassifyTasks(input: {
  tasks: readonly { id: string; categoryId: string | null; inbox: boolean }[]
  taskIds: readonly string[]
  categoryId: string
}): Array<{ id: string; categoryId: string; inbox: false }> {
  const cat = input.categoryId.trim()
  if (!cat) return []
  const set = new Set(input.taskIds)
  const out: Array<{ id: string; categoryId: string; inbox: false }> = []
  for (const t of input.tasks) {
    if (!set.has(t.id)) continue
    out.push({ id: t.id, categoryId: cat, inbox: false })
  }
  return out
}
