import { useMemo, useState, type ReactNode } from 'react'
import { sanitizeAgentPresentationText } from '../../../../shared/agent-conversation-turns'
import { sanitizeFileTouchDisplayPath } from '../../../../shared/context-file-touch-projection'
import { classifyExternalDestination } from '../../../../shared/external-destination'
import { useAppStore } from '../../app-shell/appStore'
import type {
  AgentConversationToolContent,
  AgentToolDiffContent,
  AgentToolLessonContent,
  AgentToolMemoryContent,
  AgentToolReadContent,
  AgentToolSearchContent,
  AgentToolTerminalContent,
  AgentToolWebFetchContent,
  AgentToolWebSearchContent,
  AgentToolWebSearchSource
} from '../../agent-tool-content-presentation'

/**
 * Result rows shown before the height cap collapses the middle. Matches the
 * reference conversation's tool-output budget (16 rows, head 8 / tail 8) so a
 * long card cuts its body at the same place as deepseek-harness.
 */
const TOOL_CARD_VISIBLE_LINES = 16

export type AgentToolContentProps = {
  content?: AgentConversationToolContent
  inputText?: string
  outputText?: string
  infoText?: string
  error?: boolean
  label: string
}

export function AgentToolContent({
  content,
  inputText,
  outputText,
  infoText,
  error = false,
  label
}: AgentToolContentProps) {
  const safeContent = useMemo(() => sanitizeToolContent(content), [content])
  if (safeContent) {
    switch (safeContent.kind) {
      case 'terminal': return <TerminalToolContent content={safeContent} />
      case 'read': return <ReadToolContent content={safeContent} />
      case 'diff': return <DiffToolContent content={safeContent} />
      case 'search': return <SearchToolContent content={safeContent} />
      case 'web-search': return <WebSearchToolContent content={safeContent} />
      case 'web-fetch': return <WebFetchToolContent content={safeContent} />
      case 'memory': return <MemoryToolContent content={safeContent} />
      case 'lesson': return <LessonToolContent content={safeContent} />
    }
  }
  return (
    <GenericToolContent
      inputText={inputText}
      outputText={outputText}
      infoText={infoText}
      error={error}
      label={label}
    />
  )
}

/**
 * Terminal surface mirroring the reference TerminalBlock: a prompt banner with
 * the run-state dot in its own gutter column, the shortened cwd as the prompt
 * label, an exit-status pill and a text copy control, over a `pre` output body
 * that scrolls horizontally instead of folding.
 */
function TerminalToolContent({ content }: { content: AgentToolTerminalContent }) {
  const output = content.output ?? ''
  const lines = terminalLines(output)
  const status = terminalStatus(content)
  const cwd = content.cwd ? shortPathLabel(content.cwd) : undefined
  return (
    <div className="agent-tool-card agent-tool-terminal" data-running={content.running || undefined}>
      <div className="agent-tool-card-banner agent-tool-terminal-banner">
        <span className="agent-process-visually-hidden">{status.accessibleLabel}</span>
        <div className="agent-tool-terminal-prompt">
          {content.command.split('\n').map((line, index) => (
            <div className="agent-tool-terminal-command-line" key={`${index}:${line}`}>
              {index === 0 && (
                <span className="agent-tool-state-dot" data-state={status.state} aria-hidden="true" />
              )}
              {/* The cwd labels the call, so only its first row carries it; later
                  rows keep a bare `$` to stay aligned as prompts. */}
              <span className="agent-tool-terminal-prefix">{index === 0 && cwd ? cwd : '$'}</span>
              <code>{line}</code>
            </div>
          ))}
        </div>
        {status.badge ? <span className="agent-tool-status-badge">{status.badge}</span> : null}
        {output ? <CopyToolButton text={output} label="复制终端输出" /> : null}
      </div>
      {!content.running ? (
        <CappedRows
          rows={lines}
          renderRow={(line, index) => (
            <div className="agent-tool-terminal-output-line" key={`${index}:${line}`}>{line || ' '}</div>
          )}
          empty={<div className="agent-tool-card-empty">无输出</div>}
          truncated={content.truncated}
          expandLabel="终端输出"
          className="agent-tool-terminal-output"
        />
      ) : null}
    </div>
  )
}

/**
 * File surface mirroring the reference ReadBlock: a banner (path label + a
 * "showing N of M" note for a windowed read + language + copy control) over
 * line-numbered rows that keep the file's own numbering in a fixed gutter.
 */
function ReadToolContent({ content }: { content: AgentToolReadContent }) {
  const raw = content.lines.map((line) => line.text).join('\n')
  const language = fileLanguage(content.path)
  const windowed = content.lines.length < content.totalLines
  return (
    <div className="agent-tool-card agent-tool-read">
      <div className="agent-tool-card-banner">
        <code className="agent-tool-card-title">{content.path}</code>
        <div className="agent-tool-card-actions">
          {(windowed || content.truncated) ? (
            <span>{`显示 ${content.lines.length} / ${content.totalLines} 行`}</span>
          ) : null}
          {language ? <span className="agent-tool-card-lang">{language}</span> : null}
          {raw ? <CopyToolButton text={raw} label="复制文件内容" /> : null}
        </div>
      </div>
      <CappedRows
        rows={content.lines}
        renderRow={(line) => (
          <div className="agent-tool-read-line" key={line.number}>
            <span className="agent-tool-read-gutter" aria-hidden="true">{line.number}</span>
            <code>{line.text || ' '}</code>
          </div>
        )}
        empty={<div className="agent-tool-card-empty">空文件</div>}
        truncated={content.truncated}
        expandLabel="文件内容"
        className="agent-tool-read-body"
      />
    </div>
  )
}

type DiffRow = { kind: 'removed' | 'added' | 'path'; text: string }

/**
 * Inline-diff surface mirroring the reference DiffBlock: no banner — the copy
 * control floats over the body's top-right corner, a bold path header opens
 * the hunk, the removed block draws `-` in the error tone and the added block
 * `+` in the success tone, and a dim `└ +A -R · N file(s)` footer closes it.
 */
function DiffToolContent({ content }: { content: AgentToolDiffContent }) {
  const rows = useMemo<DiffRow[]>(() => [
    { kind: 'path', text: content.path },
    ...(content.oldText === null ? [] : splitDisplayLines(content.oldText).map((text) => ({ kind: 'removed' as const, text }))),
    ...splitDisplayLines(content.newText).map((text) => ({ kind: 'added' as const, text }))
  ], [content])
  const added = rows.filter((row) => row.kind === 'added').length
  const removed = rows.filter((row) => row.kind === 'removed').length
  const copyText = rows.map((row) => {
    if (row.kind === 'removed') return `- ${row.text}`
    if (row.kind === 'added') return `+ ${row.text}`
    return row.text
  }).join('\n')
  return (
    <div className="agent-tool-card agent-tool-diff">
      <CopyToolButton text={copyText} label="复制文件差异" className="agent-tool-diff-copy" />
      <CappedRows
        rows={rows}
        renderRow={(row, index) => {
          if (row.kind === 'path') {
            return (
              <div className="agent-tool-diff-line" data-kind="path" key={`path:${row.text}:${index}`}>
                <code>{row.text}</code>
              </div>
            )
          }
          return (
            <div className="agent-tool-diff-line" data-kind={row.kind} key={`${index}:${row.text}`}>
              <span aria-hidden="true">{row.kind === 'added' ? '+' : '-'}</span>
              <code>{row.text || ' '}</code>
            </div>
          )
        }}
        empty={<div className="agent-tool-card-empty">没有文本变化</div>}
        expandLabel="文件差异"
        className="agent-tool-diff-body"
      />
      {content.truncated ? <div className="agent-tool-truncated-note">内容较大，已截断显示</div> : null}
      <div className="agent-tool-diff-footer">└ +{added} -{removed} · 1 个文件</div>
    </div>
  )
}

type SearchRow =
  | { kind: 'file'; path: string; count: number; index: number; collapsed: boolean }
  | { kind: 'match'; path: string; lineNumber: number; text: string }
  | { kind: 'path'; path: string }

/**
 * Search surface mirroring the reference SearchBlock: a banner (result summary
 * that folds the pre-cap total in when the tool capped the result, plus a copy
 * control) over grep matches grouped by file (each file a bold path header with
 * its match count, the group collapsible) or a flat glob path list.
 */
function SearchToolContent({ content }: { content: AgentToolSearchContent }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const rows = useMemo<SearchRow[]>(() => {
    if (content.resultKind === 'paths') {
      return content.paths.map((path) => ({ kind: 'path' as const, path }))
    }
    const result: SearchRow[] = []
    content.files.forEach((file, index) => {
      result.push({
        kind: 'file' as const,
        path: file.path,
        count: file.matches.length,
        index,
        collapsed: collapsed.has(index)
      })
      if (collapsed.has(index)) return
      for (const match of file.matches) {
        result.push({
          kind: 'match' as const,
          path: file.path,
          lineNumber: match.lineNumber,
          text: match.text
        })
      }
    })
    return result
  }, [content, collapsed])
  const shown = content.resultKind === 'paths'
    ? content.paths.length
    : content.files.reduce((count, file) => count + file.matches.length, 0)
  const summary = (content.truncated ? `显示 ${shown} / 共 ${content.total}` : `${shown}`)
    + (content.resultKind === 'paths' ? ' 个路径' : ` 处匹配 · ${content.files.length} 个文件`)
  const copyText = content.resultKind === 'paths'
    ? content.paths.join('\n')
    : content.files.map((file) => [
        file.path,
        ...file.matches.map((match) => `${match.lineNumber}: ${match.text}`)
      ].join('\n')).join('\n\n')
  const toggleFile = (index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  return (
    <div className="agent-tool-card agent-tool-search">
      <div className="agent-tool-card-banner">
        <div className="agent-tool-search-heading">
          <span>{content.resultKind === 'paths' ? '路径结果' : '搜索结果'}</span>
          {content.query ? <code>{content.query}</code> : null}
        </div>
        <div className="agent-tool-card-actions">
          <span>{summary}</span>
          {copyText ? <CopyToolButton text={copyText} label="复制搜索结果" /> : null}
        </div>
      </div>
      <CappedRows
        rows={rows}
        renderRow={(row, index) => {
          if (row.kind === 'file') {
            return (
              <button
                type="button"
                className="agent-tool-search-file"
                aria-expanded={!row.collapsed}
                aria-label={row.collapsed ? `展开${row.path}` : `收起${row.path}`}
                onClick={() => toggleFile(row.index)}
                key={`file:${row.index}:${index}`}
              >
                <code>{row.path}</code><span>{row.count}</span>
              </button>
            )
          }
          if (row.kind === 'path') {
            return <code className="agent-tool-search-path" key={`path:${row.path}:${index}`}>{row.path}</code>
          }
          return (
            <div className="agent-tool-search-match" key={`match:${row.path}:${row.lineNumber}:${index}`}>
              <span className="agent-tool-search-match-line">{row.lineNumber}: </span>
              <code>{row.text || ' '}</code>
            </div>
          )
        }}
        empty={<div className="agent-tool-card-empty">没有找到结果</div>}
        truncated={content.truncated}
        expandLabel="搜索结果"
        className="agent-tool-search-body"
      />
    </div>
  )
}

/**
 * Web-search surface mirroring the reference WebSearchBlock: a banner (result
 * summary that folds the pre-cap total in, plus a copy control) over the
 * citation list. Each source is a safe external link labelled by its title (or
 * its hostname when the provider gave none), with the snippet and publication
 * date below it.
 */
function WebSearchToolContent({ content }: { content: AgentToolWebSearchContent }) {
  const openExternal = useAppStore((state) => state.openExternal)
  const shown = content.sources.length
  const summary = (content.truncated ? `显示 ${shown} / 共 ${content.total}` : `${shown}`) + ' 个来源'
  const copyText = content.sources.map((source) => [
    source.title ?? source.url,
    source.url,
    source.snippet
  ].filter(Boolean).join('\n')).join('\n\n')
  return (
    <div className="agent-tool-card agent-tool-web-search">
      <div className="agent-tool-card-banner">
        <div className="agent-tool-search-heading">
          <span>网络搜索</span>
          {content.query ? <code>{content.query}</code> : null}
        </div>
        <div className="agent-tool-card-actions">
          <span>{summary}</span>
          {copyText ? <CopyToolButton text={copyText} label="复制搜索结果" /> : null}
        </div>
      </div>
      {content.sources.length === 0 ? (
        <div className="agent-tool-card-empty">没有找到结果</div>
      ) : (
        <ol className="agent-tool-web-sources">
          {content.sources.map((source, index) => (
            <li className="agent-tool-web-source" key={`${source.url}:${index}`} value={index + 1}>
              <WebSourceLink source={source} openExternal={openExternal} />
              {source.snippet ? <div className="agent-tool-web-snippet">{source.snippet}</div> : null}
              {source.publishedAt ? <div className="agent-tool-web-published">{source.publishedAt}</div> : null}
            </li>
          ))}
        </ol>
      )}
      {content.truncated ? <div className="agent-tool-truncated-note">来源列表已截断</div> : null}
    </div>
  )
}

/** One source row's safe link: http(s) URLs route through the host opener;
 *  anything else renders as plain text. The label is the title, else the
 *  hostname, else the URL itself (never blank). */
function WebSourceLink({ source, openExternal }: {
  source: AgentToolWebSearchSource
  openExternal: (url: string) => Promise<void>
}) {
  const target = classifyExternalDestination(source.url)
  const label = webLinkLabel(source.url, source.title)
  if (target.kind !== 'browser') {
    return <span className="agent-tool-web-source-link is-plain">{label}</span>
  }
  return (
    <a
      className="agent-tool-web-source-link"
      href={target.url}
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault()
        void openExternal(target.url)
      }}
    >
      {label}
    </a>
  )
}

function webLinkLabel(url: string, title: string | undefined): string {
  if (title && title.trim()) return title
  try {
    const hostname = new URL(url).hostname
    return hostname === '' ? url : hostname
  } catch {
    return url
  }
}

/**
 * Web-fetch surface mirroring the reference WebFetchBlock: the linked final
 * URL and its HTTP status, with a truncated note when the provider cut the
 * content.
 */
function WebFetchToolContent({ content }: { content: AgentToolWebFetchContent }) {
  const openExternal = useAppStore((state) => state.openExternal)
  const target = classifyExternalDestination(content.url)
  return (
    <div className="agent-tool-card agent-tool-web-fetch">
      <div className="agent-tool-web-fetch-body">
        {target.kind === 'browser' ? (
          <a
            className="agent-tool-web-fetch-url"
            href={target.url}
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault()
              void openExternal(target.url)
            }}
          >
            {content.url}
          </a>
        ) : (
          <span className="agent-tool-web-fetch-url is-plain">{content.url}</span>
        )}
        <div className="agent-tool-web-fetch-meta">
          {content.statusCode !== undefined ? <span className="agent-tool-web-fetch-status">HTTP {content.statusCode}</span> : null}
          {content.truncated ? <span className="agent-tool-web-fetch-truncated">内容已截断</span> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Memory surface for the `memory_search` tool: a banner (query + count) over
 * the hits, each a title (when present) over its snippet.
 */
function MemoryToolContent({ content }: { content: AgentToolMemoryContent }) {
  const summary = `${content.total} 条记忆`
  const copyText = content.hits.map((hit) => hit.title ? `${hit.title}\n${hit.snippet}` : hit.snippet).join('\n\n')
  return (
    <div className="agent-tool-card agent-tool-memory">
      <div className="agent-tool-card-banner">
        <div className="agent-tool-search-heading">
          <span>记忆检索</span>
          {content.query ? <code>{content.query}</code> : null}
        </div>
        <div className="agent-tool-card-actions">
          <span>{summary}</span>
          {copyText ? <CopyToolButton text={copyText} label="复制记忆检索结果" /> : null}
        </div>
      </div>
      {content.hits.length === 0 ? (
        <div className="agent-tool-card-empty">没有找到结果</div>
      ) : (
        <div className="agent-tool-memory-body">
          {content.hits.map((hit, index) => (
            <div className="agent-tool-memory-hit" key={`${hit.snippet}:${index}`}>
              {hit.title ? <div className="agent-tool-memory-hit-title">{hit.title}</div> : null}
              <div className="agent-tool-memory-hit-snippet">{hit.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Lesson surface for the `generate_lesson` tool: the generated course's title
 * (banner) over its saved path and the tool's ok message — the core teaching
 * write stays out of the raw-JSON IN/OUT fallback.
 */
function LessonToolContent({ content }: { content: AgentToolLessonContent }) {
  const heading = content.title ?? content.topic ?? '课程已生成'
  const copyText = [content.message, content.path].filter(Boolean).join('\n')
  return (
    <div className="agent-tool-card agent-tool-lesson">
      <div className="agent-tool-card-banner">
        <span className="agent-tool-lesson-heading">{heading}</span>
        <div className="agent-tool-card-actions">
          {content.path ? <span className="agent-tool-lesson-path">{content.path}</span> : null}
          {copyText ? <CopyToolButton text={copyText} label="复制课程信息" /> : null}
        </div>
      </div>
      {content.message ? <div className="agent-tool-lesson-message">{content.message}</div> : null}
    </div>
  )
}

function GenericToolContent({
  inputText,
  outputText,
  infoText,
  error,
  label
}: Omit<AgentToolContentProps, 'content'>) {
  const showsInput = Boolean(inputText)
  const showsOutput = Boolean(outputText)
  const showsInfo = Boolean(infoText)
  return (
    <div className="agent-process-tool-io-card" aria-label={`${label}工具内容`}>
      {showsInput ? <GenericSection label="IN" text={inputText ?? ''} /> : null}
      {showsInput && (showsOutput || showsInfo) ? <GenericDivider /> : null}
      {showsOutput ? <GenericSection label="OUT" text={outputText ?? ''} error={error} /> : null}
      {showsOutput && showsInfo ? <GenericDivider /> : null}
      {showsInfo ? <GenericSection label="INFO" text={infoText ?? ''} notice /> : null}
    </div>
  )
}

function GenericSection({ label, text, error, notice }: { label: string; text: string; error?: boolean; notice?: boolean }) {
  return (
    <div className={`agent-process-tool-io-section${notice ? ' agent-process-tool-io-section--notice' : ''}`}>
      <span className="agent-process-tool-io-label">{label}</span>
      <span className="agent-process-tool-io-text" data-error={error || undefined}>{text}</span>
    </div>
  )
}

function GenericDivider() {
  return <div className="agent-process-tool-io-divider" aria-hidden="true" />
}

/**
 * Height cap shared by the card bodies: head/tail slices around a hidden
 * middle, the same split arithmetic the reference TerminalBlock/ReadBlock/
 * DiffBlock/SearchBlock use.
 */
function CappedRows<T>({
  rows,
  renderRow,
  empty,
  truncated = false,
  expandLabel,
  className
}: {
  rows: readonly T[]
  renderRow: (row: T, index: number) => ReactNode
  empty: ReactNode
  truncated?: boolean
  expandLabel: string
  className: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hidden = Math.max(0, rows.length - TOOL_CARD_VISIBLE_LINES)
  const visibleRows = expanded || hidden === 0
    ? rows
    : [
        ...rows.slice(0, Math.ceil(TOOL_CARD_VISIBLE_LINES / 2)),
        ...rows.slice(rows.length - Math.floor(TOOL_CARD_VISIBLE_LINES / 2))
      ]
  return (
    <div className={className}>
      {rows.length === 0 ? empty : visibleRows.map(renderRow)}
      {hidden > 0 ? (
        <button
          type="button"
          className="agent-tool-expand-button"
          aria-expanded={expanded}
          aria-label={expanded ? `收起${expandLabel}` : `展开其余 ${hidden} 行${expandLabel}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : `… 其余 ${hidden} 行`}
        </button>
      ) : truncated ? <div className="agent-tool-truncated-note">结果已截断</div> : null}
    </div>
  )
}

/**
 * Quiet text copy control (the reference's copy button): "复制" at rest,
 * "复制成功" for a second after writing the clipboard. The descriptive label
 * still feeds the accessible name and title.
 */
function CopyToolButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_000)
    } catch {
      setCopied(false)
    }
  }
  const accessibleLabel = copied ? '复制成功' : label
  return (
    <button
      type="button"
      className={`agent-tool-copy-button${className ? ` ${className}` : ''}`}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onClick={() => void onCopy()}
    >
      {copied ? '复制成功' : '复制'}
    </button>
  )
}

function terminalStatus(content: AgentToolTerminalContent): {
  state: 'running' | 'done' | 'error'
  accessibleLabel: string
  badge?: string
} {
  if (content.running) return { state: 'running', accessibleLabel: '命令正在运行' }
  if (content.signal) return { state: 'error', accessibleLabel: '命令执行失败', badge: `信号 ${content.signal}` }
  if (content.exitCode !== undefined && content.exitCode !== 0) {
    return { state: 'error', accessibleLabel: '命令执行失败', badge: `退出码 ${content.exitCode}` }
  }
  if (content.failed) return { state: 'error', accessibleLabel: '命令执行失败', badge: '执行失败' }
  return { state: 'done', accessibleLabel: '命令执行完成' }
}

function terminalLines(value: string): string[] {
  if (!value) return []
  const lines = value.split(/\r?\n/)
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

function splitDisplayLines(value: string): string[] {
  if (value === '') return []
  const lines = value.split(/\r?\n/)
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

function shortPathLabel(path: string): string {
  if (path === '.') return '.'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function fileLanguage(path: string): string | undefined {
  const file = path.split('/').pop() ?? ''
  const extension = file.includes('.') ? file.split('.').pop()?.trim() : undefined
  return extension ? extension.toUpperCase().slice(0, 8) : undefined
}

function sanitizeToolContent(content: AgentConversationToolContent | undefined): AgentConversationToolContent | undefined {
  if (!content) return undefined
  switch (content.kind) {
    case 'terminal': {
      const command = safeRenderableText(content.command)
      const cwd = content.cwd === '.' ? '.' : sanitizeFileTouchDisplayPath(content.cwd)
      const output = content.output === undefined ? undefined : safeRenderableText(content.output, true)
      const signal = content.signal === undefined ? undefined : safeRenderableText(content.signal)
      if (!command || (content.cwd !== undefined && !cwd) || (content.output !== undefined && output === undefined) || (content.signal !== undefined && !signal)) return undefined
      return { ...content, command, ...(cwd ? { cwd } : {}), ...(output !== undefined ? { output } : {}), ...(signal ? { signal } : {}) }
    }
    case 'read': {
      const path = sanitizeFileTouchDisplayPath(content.path)
      if (!path || !Number.isSafeInteger(content.totalLines) || content.totalLines < 0) return undefined
      const lines = content.lines.map((line) => ({ number: line.number, text: safeRenderableText(line.text, true) }))
      if (lines.some((line) => !Number.isSafeInteger(line.number) || line.number < 1 || line.text === undefined)) return undefined
      return { ...content, path, lines: lines as AgentToolReadContent['lines'] }
    }
    case 'diff': {
      const path = sanitizeFileTouchDisplayPath(content.path)
      const oldText = content.oldText === null ? null : safeRenderableText(content.oldText, true)
      const newText = safeRenderableText(content.newText, true)
      if (!path || oldText === undefined || newText === undefined) return undefined
      return { ...content, path, oldText, newText, truncated: content.truncated === true }
    }
    case 'search': {
      const query = content.query === undefined ? undefined : safeRenderableText(content.query)
      const paths = content.paths.map((path) => sanitizeFileTouchDisplayPath(path))
      if ((content.query !== undefined && !query) || paths.some((path) => !path)) return undefined
      const files = content.files.map((file) => ({
        path: sanitizeFileTouchDisplayPath(file.path),
        matches: file.matches.map((match) => ({
          lineNumber: match.lineNumber,
          text: safeRenderableText(match.text, true)
        }))
      }))
      if (files.some((file) => !file.path || file.matches.some((match) => !Number.isSafeInteger(match.lineNumber) || match.lineNumber < 1 || match.text === undefined))) return undefined
      return {
        ...content,
        ...(query ? { query } : {}),
        paths: paths as string[],
        files: files as AgentToolSearchContent['files']
      }
    }
    case 'web-search': {
      const query = content.query === undefined ? undefined : safeRenderableText(content.query)
      if (content.query !== undefined && !query) return undefined
      const sources = content.sources.map((source) => {
        const url = safeRenderableText(source.url)
        const title = source.title === undefined ? undefined : safeRenderableText(source.title)
        const snippet = source.snippet === undefined ? undefined : safeRenderableText(source.snippet, true)
        const publishedAt = source.publishedAt === undefined ? undefined : safeRenderableText(source.publishedAt)
        if (!url || (source.title !== undefined && title === undefined) || (source.snippet !== undefined && snippet === undefined) || (source.publishedAt !== undefined && publishedAt === undefined)) return undefined
        return {
          url,
          ...(title ? { title } : {}),
          ...(snippet !== undefined ? { snippet } : {}),
          ...(publishedAt ? { publishedAt } : {})
        }
      })
      if (sources.some((source) => !source)) return undefined
      return {
        ...content,
        ...(query ? { query } : {}),
        sources: sources as AgentToolWebSearchContent['sources']
      }
    }
    case 'web-fetch': {
      const url = safeRenderableText(content.url)
      if (!url || (content.statusCode !== undefined && !Number.isSafeInteger(content.statusCode))) return undefined
      return { ...content, url }
    }
    case 'memory': {
      const query = content.query === undefined ? undefined : safeRenderableText(content.query)
      if (content.query !== undefined && !query) return undefined
      const hits = content.hits.map((hit) => {
        const title = hit.title === undefined ? undefined : safeRenderableText(hit.title)
        const snippet = safeRenderableText(hit.snippet, true)
        if ((hit.title !== undefined && title === undefined) || snippet === undefined) return undefined
        return { ...(title ? { title } : {}), snippet }
      })
      if (hits.some((hit) => !hit)) return undefined
      return {
        ...content,
        ...(query ? { query } : {}),
        hits: hits as AgentToolMemoryContent['hits']
      }
    }
    case 'lesson': {
      const topic = content.topic === undefined ? undefined : safeRenderableText(content.topic)
      const title = content.title === undefined ? undefined : safeRenderableText(content.title)
      const path = content.path === undefined ? undefined : sanitizeFileTouchDisplayPath(content.path)
      const message = content.message === undefined ? undefined : safeRenderableText(content.message, true)
      if ((content.topic !== undefined && !topic) || (content.title !== undefined && !title) || (content.path !== undefined && !path) || (content.message !== undefined && message === undefined)) return undefined
      return {
        ...content,
        ...(topic ? { topic } : {}),
        ...(title ? { title } : {}),
        ...(path ? { path } : {}),
        ...(message !== undefined ? { message } : {})
      }
    }
  }
}

function safeRenderableText(value: string, allowEmpty = false): string | undefined {
  const safe = sanitizeAgentPresentationText(value)
  if (safe !== value) return undefined
  return allowEmpty || safe.trim() ? safe : undefined
}
