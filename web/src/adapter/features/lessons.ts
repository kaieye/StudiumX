/**
 * Web adapter for Lessons / 讲义 browse (plan §8 Phase 6a / §7.1).
 *
 * Implements `readLesson` against the StudiumX-Server `/lessons/:id/content`
 * archive endpoint (server-contracts.md §4).
 *
 * Authority remap (porting-teaching.md §2a, difficulty MEDIUM): the desktop
 * `readLesson(workspace, lessonPath)` reads a file from the local teaching
 * worktree and returns `{ html, url }` where `url` is an Electron
 * `studiumx-preview://<workspaceId>/<relativePath>` custom-protocol URL (served
 * by the main process) and `html` is the file content passed through
 * `bridgePreviewHtml` (which injects a `<base href="studiumx-preview://...">`
 * so relative assets resolve through that protocol).
 *
 * The Web app has no filesystem and no `studiumx-preview://` protocol handler.
 * The server stores LOCAL-WINS distribution archives keyed by the archive PK
 * `id` (== `lessonId`), not by workspace path. The Web adapter therefore:
 *  - repurposes `payload.lessonPath` to carry the lesson archive `id` (the view
 *    obtains `id` from `GET /lessons`; `workspaceId` has no web meaning - the
 *    server keys on the authenticated user, so it is accepted but ignored);
 *  - sets `url = ''` so the view renders via `<iframe srcDoc>` (no protocol
 *    handler / `src` available on web); and
 *  - returns the raw archived `content` as `html` WITHOUT the Electron
 *    base-href bridge. For `contentType === "text/markdown"` the `html` field
 *    therefore carries raw markdown text; the view reinterprets it as the
 *    `source` for `MarkdownPreview` (it knows `contentType` from the list).
 *
 * Red lines honoured: no model keys / agent loop / workspace file writes; this
 * is a read-only fetch of a server-owned archive. Tokens are never touched
 * directly - all HTTP goes through `../../api/http` (auth + 401 refresh/retry).
 */

import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { apiGet } from '../../api/http'

/**
 * `GET /lessons/:id/content` success body (`LessonArchiveDownload`,
 * server-contracts.md §4). `content` is the raw artifact body (HTML/markdown
 * text); `contentType` / `relativePath` echo the archive metadata.
 */
interface LessonArchiveDownload {
  content: string | null
  contentType: string | null
  relativePath: string | null
}

export const feature: Partial<TeachingSystemApi> = {
  /**
   * readLesson({ workspaceId, lessonPath }) -> GET /lessons/:id/content.
   *
   * `lessonPath` carries the lesson archive `id` on web (see file header).
   * Returns `{ html, url }`: `html` = raw archived content (HTML as-is, or raw
   * markdown which the view routes to `MarkdownPreview`); `url = ''` forces
   * `srcDoc` rendering (no `studiumx-preview://` protocol on web).
   */
  async readLesson(payload) {
    const id = payload.lessonPath
    const row = await apiGet<LessonArchiveDownload>(
      `/lessons/${encodeURIComponent(id)}/content`
    )
    return { html: row.content ?? '', url: '' }
  }
}
