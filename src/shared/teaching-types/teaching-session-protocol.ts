/**
 * Stable internal teaching agent session protocol.
 *
 * Phase A borrows ZCode-style session operations as an in-process facade
 * over StudiumX conversation + agent run machinery. Renderer/IPC may keep
 * fine-grained teach:* commands; new callers should prefer this protocol.
 *
 * This is NOT a remote RPC surface and does not authorize process splits,
 * marketplace, or untrusted workspace MCP auto-connect.
 */

export const TEACHING_SESSION_PROTOCOL_VERSION = 1 as const

export type TeachingSessionProtocolVersion = typeof TEACHING_SESSION_PROTOCOL_VERSION

export type TeachingSessionId = string
export type TeachingSessionRunId = string

export type TeachingSessionMode = 'temporary' | 'teaching'

export type TeachingSessionUsage = Readonly<{
  providerCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  toolCalls: number
  durationMs?: number
  stopReason?: string
}>

export type TeachingSessionCreateInput = Readonly<{
  mode?: TeachingSessionMode
  workspaceId?: string | null
  conversationId?: string | null
  skillIds?: readonly string[]
  context?: string
}>

export type TeachingSessionCreateResult = Readonly<{
  sessionId: TeachingSessionId
  conversationId: string
  mode: TeachingSessionMode
  workspaceId: string | null
  createdAt: string
}>

export type TeachingSessionResumeInput = Readonly<{
  sessionId: TeachingSessionId
  conversationId?: string | null
  workspaceId?: string | null
}>

export type TeachingSessionSendInput = Readonly<{
  sessionId: TeachingSessionId
  userInput: string
  conversationId?: string | null
  workspaceId?: string | null
  expectedBranchRevision?: number
  skillIds?: readonly string[]
  context?: string
}>

export type TeachingSessionSendResult = Readonly<{
  sessionId: TeachingSessionId
  runId: TeachingSessionRunId
  streamId: string
  accepted: boolean
  message?: string
}>

export type TeachingSessionCancelInput = Readonly<{
  sessionId: TeachingSessionId
  runId?: TeachingSessionRunId
  streamId?: string
  reason?: string
}>

export type TeachingSessionCompactInput = Readonly<{
  sessionId: TeachingSessionId
  conversationId?: string | null
  reason?: 'manual' | 'soft_threshold' | 'hard_threshold'
}>

export type TeachingSessionCompactResult = Readonly<{
  sessionId: TeachingSessionId
  compacted: boolean
  message?: string
  replacedTokens?: number
  summaryTokens?: number
}>

export type TeachingSessionForkInput = Readonly<{
  sessionId: TeachingSessionId
  conversationId?: string | null
  fromTurnId?: string
  label?: string
}>

export type TeachingSessionForkResult = Readonly<{
  sessionId: TeachingSessionId
  forkedConversationId: string
  parentConversationId: string | null
}>

/** Inject guidance into a live run without restarting it (ZCode steer). */
export type TeachingSessionSteerInput = Readonly<{
  sessionId: TeachingSessionId
  runId?: TeachingSessionRunId
  streamId?: string
  guidance: string
}>

export type TeachingSessionSteerResult = Readonly<{
  sessionId: TeachingSessionId
  accepted: boolean
  message?: string
}>

export type TeachingSessionUsageInput = Readonly<{
  sessionId: TeachingSessionId
  runId?: TeachingSessionRunId
}>

export type TeachingSessionUsageResult = Readonly<{
  sessionId: TeachingSessionId
  runId?: TeachingSessionRunId
  usage: TeachingSessionUsage | null
}>

export type TeachingSessionCheckpointInput = Readonly<{
  sessionId: TeachingSessionId
  conversationId?: string | null
  label?: string
}>

export type TeachingSessionCheckpointResult = Readonly<{
  sessionId: TeachingSessionId
  checkpointId: string
  createdAt: string
}>

/**
 * Host-facing session operations. Implementations adapt existing
 * teaching-conversation-runtime / agent-run machinery; they must not invent
 * a second agent product surface.
 */
export interface TeachingSessionProtocol {
  readonly protocolVersion: TeachingSessionProtocolVersion
  create(input: TeachingSessionCreateInput): Promise<TeachingSessionCreateResult>
  resume(input: TeachingSessionResumeInput): Promise<TeachingSessionCreateResult>
  send(input: TeachingSessionSendInput): Promise<TeachingSessionSendResult>
  cancel(input: TeachingSessionCancelInput): Promise<{ sessionId: TeachingSessionId; canceled: boolean }>
  compact(input: TeachingSessionCompactInput): Promise<TeachingSessionCompactResult>
  fork(input: TeachingSessionForkInput): Promise<TeachingSessionForkResult>
  steer(input: TeachingSessionSteerInput): Promise<TeachingSessionSteerResult>
  checkpoint(input: TeachingSessionCheckpointInput): Promise<TeachingSessionCheckpointResult>
  usage(input: TeachingSessionUsageInput): Promise<TeachingSessionUsageResult>
}
