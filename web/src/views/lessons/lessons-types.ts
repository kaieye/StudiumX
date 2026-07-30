/**
 * Server archive shapes for the Lessons view (server-contracts.md §4).
 *
 * These mirror `LessonArchiveSummary` / `LessonArchiveDownload` from
 * StudiumX-Server. They are defined locally because `TeachingSystemApi` has no
 * lesson-LISTING method (the desktop derives the list from local workspace
 * files via `getState`); the Web view fetches `GET /lessons` directly as a
 * documented pragmatic exception (see LessonsView.tsx).
 */

/** `GET /lessons` -> `{ lessons: LessonArchiveSummary[] }` (content omitted). */
export interface LessonArchiveSummary {
  id: string
  lessonId: string | null
  courseId: string | null
  sessionId: string | null
  relativePath: string | null
  contentType: string | null
  revision: number | null
  updatedAtMs: number | null
}

/** `GET /lessons` response envelope (NOT a bare array - server-contracts §4). */
export interface LessonListResponse {
  lessons: LessonArchiveSummary[]
}

/**
 * Whether a lesson's archived content is markdown (vs HTML). The server stores
 * `contentType` as a free-form string (e.g. "text/markdown", "text/html"); we
 * branch the renderer on this. Unknown / null is treated as HTML (the desktop
 * `readLesson` historically serves HTML lessons).
 */
export function isMarkdownContentType(contentType: string | null): boolean {
  return contentType != null && contentType.toLowerCase().includes('markdown')
}
