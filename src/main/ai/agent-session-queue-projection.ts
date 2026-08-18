/**
 * Pure main-side projection of agent session queue state for future renderer sync.
 *
 * Ownership:
 * - Maps façade snapshot + queue entries → UI-safe DTO only.
 * - Does not mutate the queue, drain, abort, or open IPC.
 * - Product path keeps autoDrain false (reported as actual façade setting).
 *
 * Privacy: free-text is omitted by default; optional short preview is hard-capped
 * (see ADR-0004). Never project full user text by default.
 */

import type { AgentQueuedInput, AgentInputKind } from './agent-input-queue'
import type { BusyInputPhase } from './agent-busy-input-policy'

/** Hard cap for optional text preview when includeTextPreview is true. */
export const DEFAULT_QUEUE_TEXT_PREVIEW_MAX = 200

/**
 * Minimal snapshot shape accepted by the pure mapper.
 * Compatible with {@link AgentSessionFacadeSnapshot} without importing the façade.
 */
export type AgentSessionQueueProjectionSource = {
  busy: boolean
  phase: BusyInputPhase | string
  queueDepth: number
  queueCapacity: number
  streamId?: string
  conversationId?: string
}

export type AgentSessionQueueProjectionEntry = {
  id: string
  kind: 'follow_up' | 'steer'
  enqueuedAt: string
  conversationId?: string
  expectedRevision?: number
  /** Present only when options.includeTextPreview is true; hard-capped. */
  textPreview?: string
}

export type AgentSessionQueueProjection = {
  streamId?: string
  conversationId?: string
  busy: boolean
  phase: BusyInputPhase | string
  /** Actual façade setting; product gateway forces false (ADR-0004). */
  autoDrain: boolean
  queueDepth: number
  queueCapacity: number
  closed?: boolean
  entries: AgentSessionQueueProjectionEntry[]
}

export type ProjectAgentSessionQueueOptions = {
  /**
   * Report actual façade autoDrain flag. Product path remains false;
   * this helper never flips product policy — it only mirrors the value given.
   */
  autoDrain?: boolean
  /** When true, include hard-capped textPreview on each entry (privacy opt-in). */
  includeTextPreview?: boolean
  /** Max chars for textPreview; defaults to DEFAULT_QUEUE_TEXT_PREVIEW_MAX. */
  textPreviewMax?: number
  /** Queue closed state (clearOnCancel); optional for consumers that track it. */
  closed?: boolean
}

function isProjectedKind(kind: AgentInputKind | string): kind is 'follow_up' | 'steer' {
  return kind === 'follow_up' || kind === 'steer'
}

/**
 * Truncate free text for optional preview. Does not mutate the source string.
 * Uses code-unit length (consistent with existing IPC text limits elsewhere).
 */
export function truncateQueueTextPreview(
  text: string,
  max: number = DEFAULT_QUEUE_TEXT_PREVIEW_MAX
): string {
  const limit =
    Number.isSafeInteger(max) && max > 0 ? max : DEFAULT_QUEUE_TEXT_PREVIEW_MAX
  if (text.length <= limit) return text
  return text.slice(0, limit)
}

/**
 * Pure / deterministic mapper from façade snapshot + queue entries.
 * Does not mutate `queueEntries` or the snapshot source.
 */
export function projectAgentSessionQueue(
  snapshot: AgentSessionQueueProjectionSource,
  queueEntries: readonly AgentQueuedInput[],
  options: ProjectAgentSessionQueueOptions = {}
): AgentSessionQueueProjection {
  const includeTextPreview = options.includeTextPreview === true
  const textPreviewMax =
    options.textPreviewMax !== undefined &&
    Number.isSafeInteger(options.textPreviewMax) &&
    options.textPreviewMax > 0
      ? options.textPreviewMax
      : DEFAULT_QUEUE_TEXT_PREVIEW_MAX

  const entries: AgentSessionQueueProjectionEntry[] = []
  for (const entry of queueEntries) {
    if (!isProjectedKind(entry.kind)) {
      // Defensive: queue type only allows follow_up | steer; skip unknowns.
      continue
    }
    const projected: AgentSessionQueueProjectionEntry = {
      id: entry.id,
      kind: entry.kind,
      enqueuedAt: entry.enqueuedAt,
      ...(entry.conversationId !== undefined
        ? { conversationId: entry.conversationId }
        : {}),
      ...(entry.expectedRevision !== undefined
        ? { expectedRevision: entry.expectedRevision }
        : {})
    }
    if (includeTextPreview) {
      projected.textPreview = truncateQueueTextPreview(entry.text, textPreviewMax)
    }
    entries.push(projected)
  }

  const projection: AgentSessionQueueProjection = {
    busy: snapshot.busy,
    phase: snapshot.phase,
    // Default false: product path never enables autoDrain via this helper.
    autoDrain: options.autoDrain === true,
    queueDepth: snapshot.queueDepth,
    queueCapacity: snapshot.queueCapacity,
    entries
  }

  if (snapshot.streamId !== undefined) {
    projection.streamId = snapshot.streamId
  }
  if (snapshot.conversationId !== undefined) {
    projection.conversationId = snapshot.conversationId
  }
  if (options.closed !== undefined) {
    projection.closed = options.closed
  }

  return projection
}
