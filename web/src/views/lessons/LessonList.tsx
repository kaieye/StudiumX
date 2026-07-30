/**
 * Sidebar list of archived lessons for the Lessons view.
 *
 * Renders `LessonArchiveSummary[]` fetched via `GET /lessons`. The server
 * summary carries no title, so rows are labelled by the lesson's
 * `relativePath` basename (falling back to `lessonId` / `id`), with the course
 * id, update time, and a content-type badge. Read-only: no rename/pin/archive
 * actions (those are desktop mutators, dropped per plan §7.1).
 */

import type { LessonArchiveSummary } from './lessons-types'
import { isMarkdownContentType } from './lessons-types'

/** basename of a posix relativePath, e.g. "course/lec1.md" -> "lec1.md". */
function lessonLabel(lesson: LessonArchiveSummary): string {
  const path = lesson.relativePath
  if (path) {
    const base = path.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    if (base) return base
  }
  return lesson.lessonId ?? lesson.id
}

function formatUpdatedAt(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

interface LessonListProps {
  lessons: LessonArchiveSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
  error: string | null
}

export function LessonList({
  lessons,
  selectedId,
  onSelect,
  loading,
  error
}: LessonListProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-neutral-400">
        正在加载讲义列表…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-rose-600">
        <p className="font-medium">加载失败</p>
        <p className="mt-1 break-words text-rose-500">{error}</p>
      </div>
    )
  }

  if (lessons.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-neutral-400">
        <span className="font-medium text-neutral-500">暂无已归档讲义</span>
        <span>讲义在桌面端生成后会同步到这里。</span>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-0.5 overflow-y-auto p-2">
      {lessons.map((lesson) => {
        const selected = lesson.id === selectedId
        const markdown = isMarkdownContentType(lesson.contentType)
        return (
          <li key={lesson.id}>
            <button
              type="button"
              onClick={() => onSelect(lesson.id)}
              className={
                'w-full rounded-md px-3 py-2 text-left transition ' +
                (selected
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100')
              }
            >
              <span className="block truncate text-sm font-medium">
                {lessonLabel(lesson)}
              </span>
              <span
                className={
                  'mt-0.5 flex items-center gap-2 text-xs ' +
                  (selected ? 'text-neutral-300' : 'text-neutral-400')
                }
              >
                {lesson.courseId ? (
                  <span className="truncate">{lesson.courseId}</span>
                ) : (
                  <span>未归属课程</span>
                )}
                <span aria-hidden="true">·</span>
                <span>{formatUpdatedAt(lesson.updatedAtMs)}</span>
                <span
                  className={
                    'ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold ' +
                    (selected
                      ? 'bg-white/15 text-white'
                      : markdown
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-sky-100 text-sky-700')
                  }
                >
                  {markdown ? 'MD' : 'HTML'}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
