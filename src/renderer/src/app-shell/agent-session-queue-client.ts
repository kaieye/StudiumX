/**
 * Thin renderer helper for the read-only agent session queue projection IPC
 * (ADR-0091 / ADR-0098). Never drains, steers, aborts, or requests free-text.
 */

import type { ProjectAgentSessionQueueResult } from '../../../shared/teaching-types/agent-session-queue'
import type { TeachingSystemApi } from '../../../shared/teaching-types'

export type ProjectAgentSessionQueueApi = Pick<TeachingSystemApi, 'projectAgentSessionQueue'>

/**
 * Project the main-process façade queue for a stream/conversation id.
 * Product UI must omit includeTextPreview (privacy default).
 */
export async function projectActiveAgentSessionQueue(
  api: Pick<TeachingSystemApi, 'projectAgentSessionQueue'> | null | undefined,
  streamId: string
): Promise<ProjectAgentSessionQueueResult> {
  const trimmed = typeof streamId === 'string' ? streamId.trim() : ''
  if (!trimmed) {
    return { ok: false, reason: 'missing_stream_id' }
  }
  if (!api || typeof api.projectAgentSessionQueue !== 'function') {
    return { ok: false, reason: 'api_unavailable' }
  }
  // Privacy: never pass includeTextPreview in product path.
  return api.projectAgentSessionQueue({ streamId: trimmed })
}
