/**
 * In-process TeachingSessionProtocol facade.
 *
 * Adapts existing conversation + agent-run machinery without inventing a
 * second agent product surface. compact/fork/steer/checkpoint are real seams
 * where the host can provide them; otherwise they return explicit not-wired
 * results so callers never confuse stubs with success.
 */

import type {
  TeachingSessionCancelInput,
  TeachingSessionCheckpointInput,
  TeachingSessionCheckpointResult,
  TeachingSessionCompactInput,
  TeachingSessionCompactResult,
  TeachingSessionCreateInput,
  TeachingSessionCreateResult,
  TeachingSessionForkInput,
  TeachingSessionForkResult,
  TeachingSessionId,
  TeachingSessionProtocol,
  TeachingSessionResumeInput,
  TeachingSessionSendInput,
  TeachingSessionSendResult,
  TeachingSessionSteerInput,
  TeachingSessionSteerResult,
  TeachingSessionUsage,
  TeachingSessionUsageInput,
  TeachingSessionUsageResult
} from '../../shared/teaching-types/teaching-session-protocol'
import { TEACHING_SESSION_PROTOCOL_VERSION } from '../../shared/teaching-types/teaching-session-protocol'
import type { AgentRunUsageAggregate } from '../../shared/teaching-types'

export type TeachingSessionRuntimeRecord = {
  sessionId: TeachingSessionId
  conversationId: string
  mode: 'temporary' | 'teaching'
  workspaceId: string | null
  createdAt: string
  lastRunId?: string
  lastStreamId?: string
  usage?: TeachingSessionUsage | null
}

export type TeachingSessionRuntimeDeps = {
  /** Create or allocate a durable conversation id for this session. */
  createConversation: (input: TeachingSessionCreateInput) => Promise<{
    conversationId: string
    sessionId?: string
    mode?: 'temporary' | 'teaching'
    workspaceId?: string | null
  }>
  /** Resolve an existing session / conversation for resume. */
  resumeConversation: (input: TeachingSessionResumeInput) => Promise<{
    conversationId: string
    sessionId?: string
    mode?: 'temporary' | 'teaching'
    workspaceId?: string | null
  }>
  /** Start a teaching/temporary conversation turn; returns stream/run ids. */
  sendTurn: (input: TeachingSessionSendInput & {
    conversationId: string
    mode: 'temporary' | 'teaching'
    workspaceId: string | null
  }) => Promise<{ runId: string; streamId: string; accepted: boolean; message?: string }>
  /** Abort a live stream/run. */
  cancelRun: (input: { sessionId: string; runId?: string; streamId?: string; reason?: string }) => Promise<boolean>
  /** Optional explicit context compact. */
  compactConversation?: (input: TeachingSessionCompactInput & { conversationId: string }) => Promise<TeachingSessionCompactResult>
  /** Optional conversation fork. */
  forkConversation?: (input: TeachingSessionForkInput & { conversationId: string }) => Promise<TeachingSessionForkResult>
  /** Optional live-run guidance inject (steer). */
  steerRun?: (input: TeachingSessionSteerInput) => Promise<TeachingSessionSteerResult>
  /** Optional durable checkpoint. */
  checkpointSession?: (input: TeachingSessionCheckpointInput & { conversationId: string }) => Promise<TeachingSessionCheckpointResult>
  /** Read usage for a run/session. */
  readUsage?: (input: TeachingSessionUsageInput) => Promise<TeachingSessionUsage | null | AgentRunUsageAggregate>
  now?: () => string
  createSessionId?: () => string
}

export function createTeachingSessionRuntime(deps: TeachingSessionRuntimeDeps): TeachingSessionProtocol {
  const sessions = new Map<string, TeachingSessionRuntimeRecord>()
  const now = deps.now ?? (() => new Date().toISOString())
  const createSessionId =
    deps.createSessionId ??
    (() => `tsess_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`)

  const remember = (record: TeachingSessionRuntimeRecord): TeachingSessionRuntimeRecord => {
    sessions.set(record.sessionId, record)
    return record
  }

  const requireSession = (sessionId: string): TeachingSessionRuntimeRecord => {
    const existing = sessions.get(sessionId)
    if (!existing) {
      throw new Error(`Unknown teaching session: ${sessionId}`)
    }
    return existing
  }

  return {
    protocolVersion: TEACHING_SESSION_PROTOCOL_VERSION,

    async create(input: TeachingSessionCreateInput): Promise<TeachingSessionCreateResult> {
      const created = await deps.createConversation(input)
      const mode = created.mode ?? input.mode ?? 'teaching'
      const workspaceId =
        created.workspaceId !== undefined ? created.workspaceId : (input.workspaceId ?? null)
      const sessionId = created.sessionId?.trim() || createSessionId()
      const record = remember({
        sessionId,
        conversationId: created.conversationId,
        mode,
        workspaceId: workspaceId ?? null,
        createdAt: now()
      })
      return {
        sessionId: record.sessionId,
        conversationId: record.conversationId,
        mode: record.mode,
        workspaceId: record.workspaceId,
        createdAt: record.createdAt
      }
    },

    async resume(input: TeachingSessionResumeInput): Promise<TeachingSessionCreateResult> {
      const resumed = await deps.resumeConversation(input)
      const existing = sessions.get(input.sessionId)
      const mode = resumed.mode ?? existing?.mode ?? 'teaching'
      const workspaceId =
        resumed.workspaceId !== undefined
          ? resumed.workspaceId
          : (input.workspaceId ?? existing?.workspaceId ?? null)
      const record = remember({
        sessionId: input.sessionId,
        conversationId: resumed.conversationId,
        mode,
        workspaceId: workspaceId ?? null,
        createdAt: existing?.createdAt ?? now(),
        lastRunId: existing?.lastRunId,
        lastStreamId: existing?.lastStreamId,
        usage: existing?.usage
      })
      return {
        sessionId: record.sessionId,
        conversationId: record.conversationId,
        mode: record.mode,
        workspaceId: record.workspaceId,
        createdAt: record.createdAt
      }
    },

    async send(input: TeachingSessionSendInput): Promise<TeachingSessionSendResult> {
      const session = requireSession(input.sessionId)
      const conversationId = input.conversationId?.trim() || session.conversationId
      const workspaceId =
        input.workspaceId !== undefined ? input.workspaceId : session.workspaceId
      const result = await deps.sendTurn({
        ...input,
        conversationId,
        mode: session.mode,
        workspaceId: workspaceId ?? null
      })
      session.conversationId = conversationId
      session.workspaceId = workspaceId ?? null
      session.lastRunId = result.runId
      session.lastStreamId = result.streamId
      remember(session)
      return {
        sessionId: session.sessionId,
        runId: result.runId,
        streamId: result.streamId,
        accepted: result.accepted,
        ...(result.message ? { message: result.message } : {})
      }
    },

    async cancel(input: TeachingSessionCancelInput) {
      const session = sessions.get(input.sessionId)
      const runId = input.runId ?? session?.lastRunId
      const streamId = input.streamId ?? session?.lastStreamId
      const canceled = await deps.cancelRun({
        sessionId: input.sessionId,
        runId,
        streamId,
        reason: input.reason
      })
      return { sessionId: input.sessionId, canceled }
    },

    async compact(input: TeachingSessionCompactInput): Promise<TeachingSessionCompactResult> {
      const session = requireSession(input.sessionId)
      const conversationId = input.conversationId?.trim() || session.conversationId
      if (!deps.compactConversation) {
        return {
          sessionId: input.sessionId,
          compacted: false,
          message: 'Context compact is not wired for this host.'
        }
      }
      return deps.compactConversation({ ...input, conversationId })
    },

    async fork(input: TeachingSessionForkInput): Promise<TeachingSessionForkResult> {
      const session = requireSession(input.sessionId)
      const conversationId = input.conversationId?.trim() || session.conversationId
      if (!deps.forkConversation) {
        throw new Error('Conversation fork is not wired for this host.')
      }
      return deps.forkConversation({ ...input, conversationId })
    },

    async steer(input: TeachingSessionSteerInput): Promise<TeachingSessionSteerResult> {
      if (!deps.steerRun) {
        return {
          sessionId: input.sessionId,
          accepted: false,
          message: 'Live-run steer is not wired for this host.'
        }
      }
      const session = sessions.get(input.sessionId)
      return deps.steerRun({
        ...input,
        runId: input.runId ?? session?.lastRunId,
        streamId: input.streamId ?? session?.lastStreamId
      })
    },

    async checkpoint(input: TeachingSessionCheckpointInput): Promise<TeachingSessionCheckpointResult> {
      const session = requireSession(input.sessionId)
      const conversationId = input.conversationId?.trim() || session.conversationId
      if (!deps.checkpointSession) {
        // Honest not-wired seam (matches compact/fork/steer): callers must never
        // mistake a synthesized checkpoint id for a durable checkpoint.
        throw new Error('Durable checkpoint is not wired for this host.')
      }
      return deps.checkpointSession({ ...input, conversationId })
    },

    async usage(input: TeachingSessionUsageInput): Promise<TeachingSessionUsageResult> {
      const session = sessions.get(input.sessionId)
      if (!deps.readUsage) {
        return {
          sessionId: input.sessionId,
          runId: input.runId ?? session?.lastRunId,
          usage: session?.usage ?? null
        }
      }
      const raw = await deps.readUsage({
        sessionId: input.sessionId,
        runId: input.runId ?? session?.lastRunId
      })
      const usage = normalizeUsage(raw)
      if (session) {
        session.usage = usage
        remember(session)
      }
      return {
        sessionId: input.sessionId,
        runId: input.runId ?? session?.lastRunId,
        usage
      }
    }
  }
}

function normalizeUsage(
  raw: TeachingSessionUsage | AgentRunUsageAggregate | null | undefined
): TeachingSessionUsage | null {
  if (!raw) return null
  return {
    providerCalls: Number(raw.providerCalls ?? 0),
    promptTokens: Number(raw.promptTokens ?? 0),
    completionTokens: Number(raw.completionTokens ?? 0),
    totalTokens: Number(raw.totalTokens ?? 0),
    toolCalls: Number(raw.toolCalls ?? 0),
    ...('durationMs' in raw && raw.durationMs != null ? { durationMs: Number(raw.durationMs) } : {}),
    ...('stopReason' in raw && raw.stopReason != null ? { stopReason: String(raw.stopReason) } : {})
  }
}
