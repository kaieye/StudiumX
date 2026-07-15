import MarkdownIt from 'markdown-it'
import katex from 'katex'
import markdownItMark from 'markdown-it-mark'
import markdownItTaskLists from 'markdown-it-task-lists'
import { useEffect, useMemo, useRef } from 'react'
import { PREVIEW_PROTOCOL, parseMarkdownLessonInteractionHref, type PreviewLessonInteractionIntent } from '../../shared/preview-markdown-bridge'

const COPY_DEFAULT_HTML = '<span class="markdown-copy-icon markdown-copy-icon--default">copy</span>'
const COPY_DONE_HTML = '<span class="markdown-copy-icon markdown-copy-icon--done">copied</span>'
const MAX_MERMAID_SOURCE_LENGTH = 12_000

type MermaidRenderer = typeof import('mermaid')['default']

type MarkdownItStateBlock = {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  line: number
  lineMax: number
  push: (type: string, tag: string, nesting: -1 | 0 | 1) => {
    block: boolean
    content: string
    map: [number, number] | null
    markup: string
  }
}

type MarkdownItStateInline = {
  src: string
  pos: number
  posMax: number
  push: (type: string, tag: string, nesting: -1 | 0 | 1) => {
    content: string
    markup: string
  }
}

let mermaidRendererPromise: Promise<MermaidRenderer> | null = null
let mermaidRenderCounter = 0

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

function getLine(state: MarkdownItStateBlock, line: number): string {
  const start = state.bMarks[line]! + state.tShift[line]!
  const end = state.eMarks[line]!
  return state.src.slice(start, end)
}

function isEscaped(src: string, pos: number): boolean {
  let slashCount = 0
  for (let index = pos - 1; index >= 0 && src[index] === '\\'; index -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function findClosingDollar(src: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (src[index] === '$' && !isEscaped(src, index)) return index
  }
  return -1
}

function findClosingInlineDelimiter(src: string, start: number, end: number, delimiter: string): number {
  for (let index = start; index < end - 1; index += 1) {
    if (src.startsWith(delimiter, index) && !isEscaped(src, index)) return index
  }
  return -1
}

function mathInlineRule(state: MarkdownItStateInline, silent: boolean): boolean {
  const start = state.pos
  const src = state.src

  if (src[start] === '$' && src[start + 1] !== '$' && !isEscaped(src, start)) {
    const end = findClosingDollar(src, start + 1, state.posMax)
    if (end < 0) return false
    const content = src.slice(start + 1, end)
    if (!content.trim() || /^\s|\s$/.test(content)) return false
    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = content
      token.markup = '$'
    }
    state.pos = end + 1
    return true
  }

  if (src.startsWith('\\(', start) && !isEscaped(src, start)) {
    const end = findClosingInlineDelimiter(src, start + 2, state.posMax, '\\)')
    if (end < 0) return false
    const content = src.slice(start + 2, end)
    if (!content.trim()) return false
    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = content
      token.markup = '\\('
    }
    state.pos = end + 2
    return true
  }

  return false
}

function mathBlockRule(
  state: MarkdownItStateBlock,
  startLine: number,
  endLine: number,
  silent: boolean
): boolean {
  const firstLine = getLine(state, startLine).trim()
  const opener = firstLine.startsWith('$$') ? '$$' : firstLine.startsWith('\\[') ? '\\[' : null
  if (!opener) return false

  const closer = opener === '$$' ? '$$' : '\\]'
  const firstContent = firstLine.slice(opener.length)
  const sameLineEnd = firstContent.indexOf(closer)
  const contentLines: string[] = []
  let lastLine = startLine

  if (sameLineEnd >= 0) {
    contentLines.push(firstContent.slice(0, sameLineEnd))
  } else {
    contentLines.push(firstContent)
    let found = false
    for (let line = startLine + 1; line < endLine; line += 1) {
      const current = getLine(state, line)
      const closeIndex = current.indexOf(closer)
      if (closeIndex >= 0) {
        contentLines.push(current.slice(0, closeIndex))
        lastLine = line
        found = true
        break
      }
      contentLines.push(current)
    }
    if (!found) return false
  }

  if (silent) return true

  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = contentLines.join('\n').trim()
  token.markup = opener
  token.map = [startLine, lastLine + 1]
  state.line = lastLine + 1
  return true
}

function renderKatex(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      output: 'html',
      strict: 'ignore',
      throwOnError: false,
      trust: false
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid math expression'
    return `<code class="markdown-math-fallback" title="${escapeAttribute(message)}">${escapeHtml(content)}</code>`
  }
}

function renderMermaidPlaceholder(source: string): string {
  const safeSource = escapeHtml(source)
  return `<div class="markdown-mermaid" data-mermaid-state="pending">
  <div class="markdown-mermaid-output" aria-live="polite"></div>
  <pre class="markdown-mermaid-source" data-language="mermaid"><code class="language-mermaid">${safeSource}</code></pre>
</div>`
}

function configureMermaid(mermaid: MermaidRenderer): void {
  const isDark = document.documentElement.getAttribute('data-resolved-theme') === 'dark'
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: true
    },
    sequence: {
      useMaxWidth: true
    },
    mindmap: {
      useMaxWidth: true
    }
  })
}

function getMermaidRenderer(): Promise<MermaidRenderer> {
  if (!mermaidRendererPromise) {
    mermaidRendererPromise = import('mermaid')
      .then((module) => module.default)
      .catch((error) => {
        mermaidRendererPromise = null
        throw error
      })
  }
  return mermaidRendererPromise
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
  md.block.ruler.before('fence', 'math_block', mathBlockRule)
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule)

  const defaultFence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]!
    const language = (token.info.trim().split(/\s+/)[0] || '').toLowerCase()
    if (language === 'mermaid') return renderMermaidPlaceholder(token.content)
    return defaultFence
      ? defaultFence(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options)
  }

  md.renderer.rules.math_inline = (tokens, index) => {
    return `<span class="markdown-math markdown-math--inline">${renderKatex(tokens[index]!.content, false)}</span>`
  }

  md.renderer.rules.math_block = (tokens, index) => {
    return `<div class="markdown-math markdown-math--block">${renderKatex(tokens[index]!.content, true)}</div>`
  }

  md.core.ruler.push('source_lines', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1) {
        token.attrSet('data-sline', String(token.map[0]))
        token.attrSet('data-eline', String(token.map[1]))
      }
    }
    return true
  })

  md.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
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

export function renderMarkdownPreviewHtml(source: string): string {
  return markdownRenderer.render(source)
}

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
    if (pre.closest('.markdown-mermaid')) continue

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

function setMermaidState(block: HTMLElement, state: 'loading' | 'rendered' | 'error'): void {
  block.dataset.mermaidState = state
  block.classList.toggle('is-loading', state === 'loading')
  block.classList.toggle('is-rendered', state === 'rendered')
  block.classList.toggle('is-error', state === 'error')
}

function setMermaidError(block: HTMLElement, message: string): void {
  const output = block.querySelector<HTMLElement>('.markdown-mermaid-output')
  if (!output) return
  output.replaceChildren()
  const error = document.createElement('p')
  error.className = 'markdown-mermaid-error'
  error.textContent = `Mermaid diagram could not render: ${message}`
  output.appendChild(error)
  setMermaidState(block, 'error')
}

function renderMermaidBlocks(root: HTMLElement): () => void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.markdown-mermaid'))
  if (blocks.length === 0) return () => {}

  let disposed = false
  void (async () => {
    let mermaid: MermaidRenderer
    try {
      mermaid = await getMermaidRenderer()
      if (disposed) return
      configureMermaid(mermaid)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'renderer unavailable'
      for (const block of blocks) {
        if (!disposed) setMermaidError(block, message)
      }
      return
    }

    for (const block of blocks) {
      if (disposed) return
      const source = block.querySelector('code')?.textContent ?? ''
      if (source.trim().length === 0) {
        setMermaidError(block, 'empty source')
        continue
      }
      if (source.length > MAX_MERMAID_SOURCE_LENGTH) {
        setMermaidError(block, 'source is too large for preview')
        continue
      }

      const output = block.querySelector<HTMLElement>('.markdown-mermaid-output')
      if (!output) continue

      setMermaidState(block, 'loading')
      try {
        const id = `studiumx-mermaid-${Date.now()}-${mermaidRenderCounter++}`
        const result = await mermaid.render(id, source)
        if (disposed) return
        output.innerHTML = result.svg
        setMermaidState(block, 'rendered')
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : 'invalid Mermaid syntax'
        setMermaidError(block, message)
      }
    }
  })()

  return () => {
    disposed = true
  }
}

export function MarkdownPreview({
  source,
  workspaceId,
  documentRelativePath,
  emptyTitle,
  emptyHint,
  onOpenExternal,
  onOpenWorkspaceMarkdown,
  lessonInteraction
}: {
  source: string
  workspaceId?: string | null
  documentRelativePath?: string
  emptyTitle: string
  emptyHint: string
  onOpenExternal: (href: string) => void
  onOpenWorkspaceMarkdown?: (relativePath: string) => void
  lessonInteraction?: { onIntent: (intent: PreviewLessonInteractionIntent) => void }
}) {
  const articleRef = useRef<HTMLElement | null>(null)
  const html = useMemo(() => renderMarkdownPreviewHtml(source), [source])

  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    article.innerHTML = html
    rewriteLocalImages(article, workspaceId, documentRelativePath)
    const cleanupCodeBlocks = decorateCodeBlocks(article)
    const cleanupMermaid = renderMermaidBlocks(article)
    return () => {
      cleanupCodeBlocks()
      cleanupMermaid()
    }
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
      if (lessonInteraction) {
        const intent = parseMarkdownLessonInteractionHref(href)
        if (intent) {
          event.preventDefault()
          lessonInteraction.onIntent(intent)
          return
        }
      }

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
  }, [documentRelativePath, lessonInteraction, onOpenExternal, onOpenWorkspaceMarkdown])

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
