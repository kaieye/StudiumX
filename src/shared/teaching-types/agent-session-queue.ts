/**
 * Shared DTO + product IPC payload/result for agent session queue projection
 * The projection and pure mapper follow ADR-0004.
 *
 * Renderer types against this module only — never import main façade / queue
 * modules. Free-text is omitted by default; optional preview is opt-in.
 */

/** UI-safe queue entry; free-text omitted unless includeTextPreview was true. */
export type AgentSessionQueueProjectionEntry = {
  id: string
  kind: 'follow_up' | 'steer'
  enqueuedAt: string
  conversationId?: string
  expectedRevision?: number
  /** Present only when includeTextPreview is true; hard-capped. */
  textPreview?: string
}

/**
 * Read-only queue snapshot for renderer sync.
 * autoDrain reports actual façade setting; product gateway keeps it false.
 */
export type AgentSessionQueueProjection = {
  streamId?: string
  conversationId?: string
  busy: boolean
  phase: string
  autoDrain: boolean
  queueDepth: number
  queueCapacity: number
  closed?: boolean
  entries: AgentSessionQueueProjectionEntry[]
}

/** projectAgentSessionQueue IPC payload (fail-closed exact keys). */
export type ProjectAgentSessionQueuePayload = {
  streamId: string
  /** Privacy opt-in; default false → no textPreview fields. */
  includeTextPreview?: boolean
  /** Only meaningful when includeTextPreview is true; safe integer ≥ 0. */
  textPreviewMax?: number
}

export type ProjectAgentSessionQueueResult =
  | { ok: true; projection: AgentSessionQueueProjection }
  | { ok: false; reason: 'no_active_session' | string }
