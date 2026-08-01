import type {
  AgentSessionFacadeSnapshot,
  AgentSessionPromptResult
} from './agent-session-facade'

/**
 * IPC result for mid-run steer / follow-up on an active agent chat stream.
 * Pure mapper keeps Electron gateway thin and unit-testable without ipcMain.
 */
export type AgentChatSteerFollowUpIpcResult =
  | {
      ok: true
      disposition: 'accepted' | 'queued' | 'steered'
      reason: string
      depth?: number
      snapshot: AgentSessionFacadeSnapshot
    }
  | {
      ok: false
      disposition: 'rejected' | 'interrupt_pending' | 'no_active_session'
      reason: string
      depth?: number
      enqueueReason?: string
      snapshot?: AgentSessionFacadeSnapshot
    }

export function mapAgentSessionPromptResultToIpc(
  result: AgentSessionPromptResult,
  snapshot: AgentSessionFacadeSnapshot
): AgentChatSteerFollowUpIpcResult {
  if (result.ok) {
    return {
      ok: true,
      disposition: result.disposition,
      reason: result.reason,
      ...(result.depth !== undefined ? { depth: result.depth } : {}),
      snapshot
    }
  }
  return {
    ok: false,
    disposition: result.disposition,
    reason: result.reason,
    depth: result.depth,
    ...(result.enqueueReason !== undefined ? { enqueueReason: result.enqueueReason } : {}),
    snapshot
  }
}

export function noActiveAgentSessionIpcResult(): AgentChatSteerFollowUpIpcResult {
  return {
    ok: false,
    disposition: 'no_active_session',
    reason: 'no_active_session'
  }
}

/**
 * ADR-0168 intentionally limits first-release explicit Skill expansion to a
 * new turn. Never queue a `/skill:` payload as mid-run steer/follow-up: the
 * active session has no safe resolver/prompt-overlay transaction for it.
 */
export function rejectExplicitSkillInvocationSteerFollowUp(
  text: string,
  snapshot: AgentSessionFacadeSnapshot
): AgentChatSteerFollowUpIpcResult | null {
  if (!String(text ?? '').trimStart().startsWith('/skill:')) return null
  return {
    ok: false,
    disposition: 'rejected',
    reason: 'explicit_skill_invocation_not_supported_in_steer_or_follow_up',
    snapshot
  }
}
