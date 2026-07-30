/**
 * Web adapter for Conversations / 对话历史 browse (plan §8 Phase 6b / §7.1).
 *
 * Implements two read-only `TeachingSystemApi` methods against StudiumX-Server
 * conversation-archive endpoints (server-contracts.md §5):
 *   - projectAgentConversationSummaries -> GET /conversations
 *   - readAgentConversation              -> GET /conversations/:id/content
 *
 * Authority remap (porting-teaching.md Component 3, difficulty HARD):
 *
 * The desktop `projectAgentConversationSummaries` GENERATES markdown summary
 * projections for a given set of `conversationIds` and returns `outcomes`; it is
 * NOT a conversation-list endpoint (the desktop list comes from
 * `getState().activeWorkspace.conversations`). The server `GET /conversations`
 * returns a flat LOCAL-WINS archive list (`ConversationArchiveSummary`). The Web
 * view uses this method as its list source (contract: views reach the server via
 * `window.teachingSystem.*` only). The EXACT return type
 * `ProjectAgentConversationSummariesResult = { outcomes }` is sparse
 * (`conversationId` + `status` only); the server's richer summary metadata
 * (`updatedAtMs`, `courseRelativePath`, `contentType`) CANNOT traverse it, so the
 * Web list is necessarily sparse - see report TODO.
 *
 * The desktop `readAgentConversation` returns a structured `AgentConversationRecord`
 * with `turns: AgentChatTurn[]` consumed by the `AgentConversationReader`
 * presentation pipeline. The server returns a single opaque archived `content`
 * blob (markdown/HTML) with NO structured turns and NO summary metadata. The
 * adapter therefore synthesizes a minimal `AgentConversationRecord` whose single
 * turn carries the raw blob; the view renders the blob directly (markdown-it ->
 * sandboxed iframe), bypassing the structured reader (porting-teaching.md
 * "practical path"). `contentType` is not carried (`AgentChatTurn` has no such
 * field); the view renders through markdown-it (`html:true`) which handles both
 * markdown and HTML pass-through.
 *
 * Red lines honoured: no agent chat / streaming / fork / replay / rename / pin;
 * no model keys; no workspace file writes; read-only fetch of server-owned
 * archives. Tokens are never touched directly - all HTTP goes through
 * `../../api/http` (auth + 401 refresh/retry).
 */

import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { apiGet } from '../../api/http'

/**
 * `GET /conversations` response envelope (server-contracts.md §5). The server
 * returns `{ conversations: [...] }` (NOT a bare array - the desktop sync client
 * mis-casts this; the Web adapter follows the actual server shape).
 */
interface ConversationListResponse {
  conversations: ConversationArchiveSummary[]
}

/**
 * `ConversationArchiveSummary` - sparse server list row (content omitted).
 * `id` is the archive PK; `conversationId` is nullable but, when present, equals
 * `id` (server-contracts.md §5: "archive PK `id` = `conversationId`").
 */
interface ConversationArchiveSummary {
  id: string
  conversationId: string | null
  courseRelativePath: string | null
  contentType: string | null
  updatedAtMs: number | null
}

/**
 * `GET /conversations/:id/content` success body (`ConversationArchiveDownload`,
 * server-contracts.md §5). `content` is the archived body (markdown/HTML text);
 * `contentType` echoes the archive metadata. A missing archive -> HTTP 404
 * (`{ error: { code: 'NOT_FOUND' } }`), which propagates as an `ApiError`.
 */
interface ConversationArchiveDownload {
  content: string | null
  contentType: string | null
}

export const feature: Partial<TeachingSystemApi> = {
  /**
   * projectAgentConversationSummaries({ workspaceId, conversationIds }) ->
   * GET /conversations.
   *
   * Web convention: when `conversationIds` is EMPTY the adapter lists ALL
   * archived conversations (one `generated` outcome each) - this is the list
   * bootstrap used by the view; when non-empty it reports per-requested-id
   * `generated` (found) / `not_found`. `workspaceId` has no web meaning (the
   * server keys on the authenticated user) and is ignored.
   */
  async projectAgentConversationSummaries(payload) {
    const response = await apiGet<ConversationListResponse>('/conversations')
    const requested = payload.conversationIds

    if (requested.length > 0) {
      // Index every known identifier (archive PK `id` + nullable `conversationId`).
      const knownIds = new Set<string>()
      for (const row of response.conversations) {
        knownIds.add(row.id)
        if (row.conversationId) knownIds.add(row.conversationId)
      }
      return {
        outcomes: requested.map((conversationId) => ({
          conversationId,
          status: knownIds.has(conversationId)
            ? ('generated' as const)
            : ('not_found' as const)
        }))
      }
    }

    // Empty request -> list ALL archived conversations (web list bootstrap).
    return {
      outcomes: response.conversations.map((row) => ({
        conversationId: row.conversationId ?? row.id,
        status: 'generated' as const
      }))
    }
  },

  /**
   * readAgentConversation({ workspaceId, conversationId }) ->
   * GET /conversations/:id/content.
   *
   * Synthesizes a minimal `AgentConversationRecord`: summary fields are
   * synthesized (title <- conversationId, dates <- '', paths <- '',
   * messageCount <- 0/1, pinned false, no branch) and `turns` holds a SINGLE
   * turn whose `content` carries the raw archived blob. `workspaceId` is
   * ignored. A 404 (archive not found) propagates as an `ApiError` to the view.
   */
  async readAgentConversation(payload) {
    const conversationId = payload.conversationId
    const download = await apiGet<ConversationArchiveDownload>(
      `/conversations/${encodeURIComponent(conversationId)}/content`
    )
    const content = download.content ?? ''
    return {
      id: conversationId,
      title: conversationId,
      createdAt: '',
      updatedAt: '',
      relativePath: '',
      absolutePath: '',
      messageCount: content.length > 0 ? 1 : 0,
      pinned: false,
      turns: [
        {
          id: 'archived-content',
          role: 'assistant',
          content,
          createdAt: ''
        }
      ]
    }
  }
}
