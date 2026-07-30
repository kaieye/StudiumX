/**
 * Lessons / 讲义 browse view (plan §8 Phase 6a / §7.1).
 *
 * A read-only web browser for archived lessons:
 *  - LIST: `GET /lessons` (-> `{ lessons: LessonArchiveSummary[] }`). The
 *    desktop derives the lesson list from local workspace files via `getState`,
 *    which is not supported on web. `TeachingSystemApi` has no lesson-LISTING
 *    method, so - per the feature brief - this view fetches `GET /lessons`
 *    directly via `apiGet` as a DOCUMENTED PRAGMATIC EXCEPTION. (Content
 *    fetching still goes through `window.teachingSystem.readLesson` -> the
 *    adapter seam; only the list, which has no API equivalent, bypasses it.)
 *  - CONTENT: selecting a lesson calls `window.teachingSystem.readLesson` (see
 *    `LessonContent`), branching HTML -> sandboxed iframe / markdown ->
 *    `MarkdownPreview`.
 *
 * Read-only: no lesson generation, no editing, no workspace writes (red lines).
 * No model keys / agent loop. No remote telemetry.
 */

import { useEffect, useState } from 'react'
import { apiGet, ApiError } from '../../api/http'
import { LessonList } from './LessonList'
import { LessonContent } from './LessonContent'
import type { LessonArchiveSummary, LessonListResponse } from './lessons-types'

// Markdown-prose styling for the reused desktop MarkdownPreview, plus KaTeX
// math CSS (side-effect imports; bundled by Vite, fonts URL-rewritten).
import './lessons.css'
import 'katex/dist/katex.min.css'

/** Most-recently-updated first; stable on equal/null timestamps. */
function byUpdatedAtDesc(a: LessonArchiveSummary, b: LessonArchiveSummary): number {
  const left = a.updatedAtMs ?? -1
  const right = b.updatedAtMs ?? -1
  return right - left
}

/** basename of a posix relativePath for the content header. */
function lessonLabel(lesson: LessonArchiveSummary): string {
  const path = lesson.relativePath
  if (path) {
    const base = path.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    if (base) return base
  }
  return lesson.lessonId ?? lesson.id
}

export function LessonsView() {
  const [lessons, setLessons] = useState<LessonArchiveSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    setListError(null)

    void (async () => {
      try {
        const response = await apiGet<LessonListResponse>('/lessons')
        if (cancelled) return
        const sorted = [...response.lessons].sort(byUpdatedAtDesc)
        setLessons(sorted)
        setSelectedId(sorted.length > 0 ? sorted[0]!.id : null)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '加载讲义列表失败。'
        setListError(message)
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const selected =
    selectedId != null ? lessons.find((l) => l.id === selectedId) ?? null : null

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">课程讲义</h1>
        {!listLoading && !listError && (
          <span className="text-sm text-neutral-400">
            共 {lessons.length} 份已归档讲义
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        浏览已归档的讲义（只读）。讲义在桌面端生成后会同步到此。
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-[300px_1fr] h-[calc(100dvh-11rem)] min-h-[24rem]">
        <aside className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="shrink-0 border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            讲义列表
          </div>
          <div className="min-h-0 flex-1">
            <LessonList
              lessons={lessons}
              selectedId={selectedId}
              onSelect={setSelectedId}
              loading={listLoading}
              error={listError}
            />
          </div>
        </aside>

        <section className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-2">
            <span className="truncate text-sm font-medium text-neutral-700">
              {selected ? lessonLabel(selected) : '未选择讲义'}
            </span>
            {selected?.courseId ? (
              <span className="truncate text-xs text-neutral-400">
                {selected.courseId}
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1">
            {/* key remounts per lesson so the content pane never flashes the
                previous lesson body while the new one loads. */}
            <LessonContent key={selected?.id ?? "none"} lesson={selected} />
          </div>
        </section>
      </div>
    </main>
  )
}
