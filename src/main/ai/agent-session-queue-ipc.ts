/**
 * Pure main-side mapper for read-only agent session queue projection IPC
 * (ADOPTION B-02 residual / ADR-0004).
 *
 * Delegates to AgentSessionFacade.projectQueue (ADR-0004). Never drains,
 * steers, prompts, aborts, or flips autoDrain.
 */

import type { AgentSessionFacade } from './agent-session-facade'
import type {
  ProjectAgentSessionQueuePayload,
  ProjectAgentSessionQueueResult
} from '../../shared/teaching-types/agent-session-queue'

/**
 * Project the active façade queue to a UI-safe DTO.
 * Missing façade → structured no_active_session (same spirit as steer IPC).
 */
export function runProjectAgentSessionQueueIpc(
  payload: ProjectAgentSessionQueuePayload,
  facade: AgentSessionFacade | null | undefined
): ProjectAgentSessionQueueResult {
  if (!facade) {
    return { ok: false, reason: 'no_active_session' }
  }
  const projection = facade.projectQueue({
    ...(payload.includeTextPreview !== undefined
      ? { includeTextPreview: payload.includeTextPreview }
      : {}),
    ...(payload.textPreviewMax !== undefined
      ? { textPreviewMax: payload.textPreviewMax }
      : {})
  })
  // Structural identity map: main pure projection fields match shared DTO.
  return { ok: true, projection }
}
