/**
 * Content pane for a selected archived lesson (Lessons view).
 *
 * Fetches the lesson body via `window.teachingSystem.readLesson` (-> Web adapter
 * -> `GET /lessons/:id/content` -> `{ html, url }`). `url` is always `''` on
 * web (no `studiumx-preview://` protocol handler), so the body is rendered via
 * `srcDoc`:
 *  - HTML lessons -> a sandboxed `<iframe srcDoc=...>` (NEVER unsanitized
 *    `innerHTML` in the parent document). `sandbox="allow-scripts allow-popups"`
 *    WITHOUT `allow-same-origin` lets embedded lesson scripts/quizzes run in an
 *    isolated opaque origin that cannot touch the parent DOM, cookies, or
 *    localStorage (red line: read-only, contained rendering).
 *  - Markdown lessons -> the desktop `MarkdownPreview` (reused unchanged; its
 *    transitive closure is pure - markdown-it/katex/plugins/react only). The
 *    adapter returns raw markdown in the `html` field; we pass it as `source`.
 *    `workspaceId` is omitted so `rewriteLocalImages` is a no-op (no
 *    `studiumx-preview://` rewriting); `onOpenWorkspaceMarkdown` is a no-op to
 *    prevent broken relative-link navigation (inter-doc nav is not supported on
 *    the read-only web surface).
 *
 * The parent remounts this component per lesson (`key={lesson.id}`) so the
 * initial state is always `loading` for the freshly selected lesson - no stale
 * previous-lesson content flashes while the new body is fetched. Loading /
 * error / empty states are handled here. Read-only: no save/edit.
 */

import { useEffect, useState } from 'react'
import { MarkdownPreview } from '@renderer/markdown-preview'
import type { LessonArchiveSummary } from './lessons-types'
import { isMarkdownContentType } from './lessons-types'

interface LessonContentProps {
  lesson: LessonArchiveSummary | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; content: string }

export function LessonContent({ lesson }: LessonContentProps) {
  // Initial state is `loading` (the parent remounts per lesson via key, so this
  // always reflects a freshly selected lesson rather than stale content).
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!lesson) return
    let cancelled = false
    setState({ kind: 'loading' })

    void (async () => {
      try {
        const result = await window.teachingSystem.readLesson({
          workspaceId: '',
          lessonPath: lesson.id
        })
        if (cancelled) return
        setState({ kind: 'ready', content: result.html })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '读取讲义内容失败。'
        setState({ kind: 'error', message })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [lesson])

  if (!lesson) {
    return (
      <ContentPlaceholder
        title="选择一份讲义"
        hint="从左侧列表选择一份已归档的讲义以查看内容。"
      />
    )
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-sm text-neutral-400">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
          <span>正在加载讲义…</span>
        </div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-rose-600">加载失败</p>
          <p className="mt-2 break-words text-sm text-rose-500">{state.message}</p>
        </div>
      </div>
    )
  }

  const content = state.content
  if (content.length === 0) {
    return (
      <ContentPlaceholder title="该讲义没有可显示的正文" hint="归档内容为空。" />
    )
  }

  if (isMarkdownContentType(lesson.contentType)) {
    return (
      <div className="lessons-markdown-host h-full overflow-y-auto px-6 py-8">
        <MarkdownPreview
          source={content}
          documentRelativePath={lesson.relativePath ?? undefined}
          emptyTitle="该讲义没有可显示的正文"
          emptyHint="归档内容为空。"
          onOpenExternal={(href) =>
            window.open(href, '_blank', 'noopener,noreferrer')
          }
          onOpenWorkspaceMarkdown={() => {
            /* Inter-document markdown navigation is not supported on the
               read-only Web surface; suppress the click to avoid broken
               relative navigation in the parent document. */
          }}
        />
      </div>
    )
  }

  // HTML lesson -> sandboxed iframe (no allow-same-origin: isolated origin).
  return (
    <iframe
      title={lesson.relativePath ?? lesson.id}
      srcDoc={content}
      sandbox="allow-scripts allow-popups"
      className="h-full w-full border-0 bg-white"
    />
  )
}

function ContentPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <span className="text-sm font-medium text-neutral-500">{title}</span>
      <span className="text-sm text-neutral-400">{hint}</span>
    </div>
  )
}
