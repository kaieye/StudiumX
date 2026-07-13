import type { AgentChatMode } from '../shared/teaching-types'

export type ConversationWorkspaceAccess = {
  rootPath: string
}

export type ConversationTurnContext = {
  mode: AgentChatMode
  isTeachingConversation: boolean
  /** Workspace tools are deliberately unavailable in temporary conversations. */
  workspaceRoot: string | undefined
  /** Learner memory remains scoped to the selected workspace in either mode. */
  memoryWorkspaceRoot: string | undefined
  workspaceToolsEnabled: boolean
  lessonToolEnabled: boolean
}

/**
 * Captures the mode-dependent policy for one conversation turn. Callers cross
 * this seam once, while the implementation owns the distinction between
 * temporary context, teaching workspace access, and lesson availability.
 */
export function deriveConversationTurnContext(options: {
  mode: AgentChatMode | undefined
  workspace: ConversationWorkspaceAccess | null
  toolsEnabled: boolean
  hasLessonGenerator: boolean
}): ConversationTurnContext {
  const isTeachingConversation = (options.mode ?? 'teaching') === 'teaching'
  const mode: AgentChatMode = isTeachingConversation ? 'teaching' : 'temporary'
  const workspaceRoot = isTeachingConversation ? options.workspace?.rootPath : undefined
  const memoryWorkspaceRoot = options.workspace?.rootPath
  const workspaceToolsEnabled = options.toolsEnabled && isTeachingConversation
  const lessonToolEnabled = workspaceToolsEnabled && Boolean(options.workspace) && options.hasLessonGenerator

  return {
    mode,
    isTeachingConversation,
    workspaceRoot,
    memoryWorkspaceRoot,
    workspaceToolsEnabled,
    lessonToolEnabled
  }
}
