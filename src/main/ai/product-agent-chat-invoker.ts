/**
 * Pure mapping helpers for product AgentSessionFacade → service.agentChatStream
 * (B-02 residual / ADR-0058).
 *
 * Keeps Electron IPC and TeachingWorkspaceService out of the façade module while
 * giving the gateway a testable payload/result adapter.
 */

import type {
  AgentChatStreamPayload,
  AgentChatStreamResult
} from '../../shared/teaching-types'
import type { AgentSessionRunResult } from './agent-session-facade'

export type ProductAgentChatInvokerInput = {
  text: string
  conversationId?: string
  expectedRevision?: number
  streamId?: string
  runId?: string
}

/**
 * Merge invoker turn fields onto the original IPC payload.
 * - `userInput` always comes from invoker `text` (prompt/follow-up/steer body)
 * - identity / CAS fields prefer invoker when provided
 * - all other payload fields (messages, workspace, skills, compaction, …) preserved
 */
export function mapProductAgentChatInvokerPayload(
  original: AgentChatStreamPayload,
  invokerInput: ProductAgentChatInvokerInput
): AgentChatStreamPayload {
  return {
    ...original,
    userInput: invokerInput.text,
    ...(invokerInput.streamId !== undefined ? { streamId: invokerInput.streamId } : {}),
    ...(invokerInput.conversationId !== undefined
      ? { conversationId: invokerInput.conversationId }
      : {}),
    ...(invokerInput.expectedRevision !== undefined
      ? { expectedBranchRevision: invokerInput.expectedRevision }
      : {})
  }
}

/**
 * Map the full product stream result into the thin façade run result surface.
 * Full `AgentChatStreamResult` stays owned by the gateway closed-over variable.
 */
export function mapAgentChatStreamResultToRunResult(
  streamId: string,
  result: AgentChatStreamResult
): AgentSessionRunResult {
  if ('canceled' in result && result.canceled === true) {
    return { streamId, canceled: true }
  }
  if ('error' in result && result.error === true) {
    return { streamId, error: result.message }
  }
  if ('finalText' in result) {
    return {
      streamId,
      finalText: result.finalText
    }
  }
  return { streamId }
}
