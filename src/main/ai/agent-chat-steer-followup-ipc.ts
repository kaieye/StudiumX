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
