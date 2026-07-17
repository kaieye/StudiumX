import type { AgentChatMode } from '../shared/teaching-types'
import {
  resolveTeachingCapabilityPolicy,
  type TeachingCapabilityPolicy
} from './ai/agent-capability-policy'

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
  /**
   * The single capability boundary for tool selection in this turn. Its
   * explicit allow-list is projected after every tool registration.
   */
  capabilityPolicy: TeachingCapabilityPolicy
  /** Compatibility summary for non-workspace tools, including web, ask, and skills. */
  externalToolsEnabled: boolean
  /** Compatibility summary; runtime tool selection uses capabilityPolicy. */
  workspaceToolsEnabled: boolean
  /** Compatibility summary; runtime tool selection uses capabilityPolicy. */
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
  const capabilityPolicy = resolveTeachingCapabilityPolicy({
    mode,
    toolsEnabled: options.toolsEnabled,
    hasWorkspace: Boolean(options.workspace),
    hasLessonGenerator: options.hasLessonGenerator
  })

  return {
    mode,
    isTeachingConversation,
    workspaceRoot,
    memoryWorkspaceRoot,
    capabilityPolicy,
    // A temporary conversation is intentionally sandboxed from the teaching
    // workspace, but it can still use configured external tools.
    externalToolsEnabled: options.toolsEnabled,
    workspaceToolsEnabled: capabilityPolicy.workspaceToolsEnabled,
    lessonToolEnabled: capabilityPolicy.lessonToolEnabled
  }
}
