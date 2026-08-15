import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../app-shell/appStore'

export type MarkdownMessageTone = 'user' | 'assistant'

type MarkdownMessageProps = {
  content: string
  tone: MarkdownMessageTone
  compact?: boolean
}

/**
 * The renderer used for chat turns throughout the app.
 *
 * Keep link handling in the renderer process: external URLs must go through
 * the app's explicit `openExternal` bridge rather than browser navigation.
 */
export function MarkdownMessage({
  content,
  tone,
  compact = false
}: MarkdownMessageProps) {
  const openExternal = useAppStore((state) => state.openExternal)
  const markdownComponents = useMemo<Components>(() => ({
    a: ({ node: _node, href, children, ...props }) => (
      <a
        {...props}
        href={href}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => {
          if (!href) return
          event.preventDefault()
          void openExternal(href)
        }}
      >
        {children}
      </a>
    ),
    code: ({ node: _node, className, children, ...props }) => (
      <code {...props} className={className}>
        {children}
      </code>
    )
  }), [openExternal])

  return (
    <div className={`markdown-message markdown-message--${tone}${compact ? ' is-compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
