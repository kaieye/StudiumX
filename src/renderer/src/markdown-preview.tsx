import MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import markdownItTaskLists from 'markdown-it-task-lists'
import { useEffect, useMemo, useRef } from 'react'
import { PREVIEW_PROTOCOL } from '../../shared/preview-markdown-bridge'

const COPY_DEFAULT_HTML = '<span class="markdown-copy-icon markdown-copy-icon--default">copy</span>'
const COPY_DONE_HTML = '<span class="markdown-copy-icon markdown-copy-icon--done">copied</span>'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (code, lang) => {
      const language = (lang?.trim() || 'text').replace(/[^\w#+.-]/g, '')
      const safeCode = escapeHtml(code)
      const safeLang = escapeAttribute(language)
      return `<pre class="markdown-codeblock-pre" data-language="${safeLang}"><code class="language-${safeLang}">${safeCode}</code></pre>`
    }
  })

  md.use(markdownItTaskLists, { enabled: false, label: true })
  md.use(markdownItMark)

  md.core.ruler.push('source_lines', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1) {
        token.attrSet('data-sline', String(token.map[0]))
        token.attrSet('data-eline', String(token.map[1]))
      }
    }
    return true
  })

  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const inline = tokens[index + 1]
    if (inline?.type === 'inline') {
      const id = slugifyHeading(inline.content)
      if (id) tokens[index].attrSet('id', id)
    }
    return self.renderToken(tokens, index, options)
  }

  return md
}

const markdownRenderer = createMarkdownRenderer()

function isSpecialHref(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value)
}

function stripHashAndQuery(value: string): string {
  const marker = value.search(/[?#]/)
  return marker === -1 ? value : value.slice(0, marker)
}

function resolveWorkspaceRelativePath(src: string, documentRelativePath?: string): string | null {
  if (!documentRelativePath || isSpecialHref(src)) return null
  const cleanSource = stripHashAndQuery(src).replace(/\\/g, '/')
  if (!cleanSource) return null
  const documentParts = documentRelativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  documentParts.pop()
  const resolvedParts: string[] = [...documentParts]
  for (const part of cleanSource.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      resolvedParts.pop()
      continue
    }
    resolvedParts.push(part)
  }
  return resolvedParts.join('/')
}

function isMarkdownPath(value: string): boolean {
  return /\.(?:md|markdown)$/i.test(stripHashAndQuery(value))
}

function buildPreviewResourceUrl(
  src: string,
  workspaceId?: string | null,
  documentRelativePath?: string
): string {
  if (!workspaceId) return src
  const relativePath = resolveWorkspaceRelativePath(src, documentRelativePath)
  if (!relativePath) return src

  const path = relativePath.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/')
  return `${PREVIEW_PROTOCOL}://${encodeURIComponent(workspaceId)}/${path}`
}

function rewriteLocalImages(
  root: HTMLElement,
  workspaceId?: string | null,
  documentRelativePath?: string
): void {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const src = image.getAttribute('src')
    if (!src) continue
    image.setAttribute('src', buildPreviewResourceUrl(src, workspaceId, documentRelativePath))
  }
}

function decorateCodeBlocks(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  const blocks = Array.from(root.querySelectorAll('pre')) as HTMLPreElement[]

  for (const pre of blocks) {
    if (pre.parentElement?.classList.contains('markdown-codeblock')) continue

    const wrapper = document.createElement('div')
    wrapper.className = 'markdown-codeblock'
    pre.parentNode?.insertBefore(wrapper, pre)
    wrapper.appendChild(pre)

    const language = pre.getAttribute('data-language') || pre.querySelector('code')?.className.replace(/^language-/, '') || ''
    if (language) {
      const label = document.createElement('span')
      label.className = 'markdown-codeblock-language'
      label.textContent = language
      wrapper.appendChild(label)
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'markdown-code-copy'
    button.setAttribute('aria-label', 'copy code')
    button.innerHTML = `${COPY_DEFAULT_HTML}${COPY_DONE_HTML}`
    wrapper.appendChild(button)

    const onClick = async (event: MouseEvent) => {
      event.preventDefault()
      const text = pre.textContent ?? ''
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        try {
          document.execCommand('copy')
        } catch {
          // Ignore clipboard fallback failures.
        }
        document.body.removeChild(textarea)
      }
      button.classList.add('is-done')
      window.setTimeout(() => button.classList.remove('is-done'), 1400)
    }

    button.addEventListener('click', onClick)
    cleanups.push(() => button.removeEventListener('click', onClick))
  }

  return () => cleanups.forEach((cleanup) => cleanup())
}

export function MarkdownPreview({
  source,
  workspaceId,
  documentRelativePath,
  emptyTitle,
  emptyHint,
  onOpenExternal,
  onOpenWorkspaceMarkdown
}: {
  source: string
  workspaceId?: string | null
  documentRelativePath?: string
  emptyTitle: string
  emptyHint: string
  onOpenExternal: (href: string) => void
  onOpenWorkspaceMarkdown?: (relativePath: string) => void
}) {
  const articleRef = useRef<HTMLElement | null>(null)
  const html = useMemo(() => markdownRenderer.render(source), [source])

  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    article.innerHTML = html
    rewriteLocalImages(article, workspaceId, documentRelativePath)
    return decorateCodeBlocks(article)
  }, [documentRelativePath, html, workspaceId])

  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return

      if (href.startsWith('#')) {
        event.preventDefault()
        const id = decodeURIComponent(href.slice(1))
        const heading = article.querySelector(`[id="${CSS.escape(id)}"]`)
        heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      if (/^https?:\/\//i.test(href)) {
        event.preventDefault()
        onOpenExternal(href)
        return
      }

      const relativePath = resolveWorkspaceRelativePath(href, documentRelativePath)
      if (relativePath && isMarkdownPath(relativePath) && onOpenWorkspaceMarkdown) {
        event.preventDefault()
        onOpenWorkspaceMarkdown(relativePath)
      }
    }

    article.addEventListener('click', handleClick)
    return () => article.removeEventListener('click', handleClick)
  }, [documentRelativePath, onOpenExternal, onOpenWorkspaceMarkdown])

  if (source.trim().length === 0) {
    return (
      <div className="markdown-document-empty">
        <strong>{emptyTitle}</strong>
        <span>{emptyHint}</span>
      </div>
    )
  }

  return <article className="markdown-prose" ref={articleRef} />
}
