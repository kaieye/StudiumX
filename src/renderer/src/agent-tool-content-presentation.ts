import { sanitizeAgentPresentationText } from '../../shared/agent-conversation-turns'
import { sanitizeFileTouchDisplayPath } from '../../shared/context-file-touch-projection'

const TOOL_CARD_PAYLOAD_LIMIT = 200_000
const TOOL_CARD_DIFF_PAYLOAD_LIMIT = 1_500_000
const TOOL_CARD_TEXT_LIMIT = 50_000
const TOOL_CARD_ROWS_LIMIT = 160

export type AgentToolTerminalContent = Readonly<{
  kind: 'terminal'
  command: string
  cwd?: string
  output?: string
  exitCode?: number
  signal?: string
  running: boolean
  failed: boolean
  truncated: boolean
}>

export type AgentToolReadLine = Readonly<{
  number: number
  text: string
}>

export type AgentToolReadContent = Readonly<{
  kind: 'read'
  path: string
  lines: readonly AgentToolReadLine[]
  totalLines: number
  truncated: boolean
}>

export type AgentToolDiffContent = Readonly<{
  kind: 'diff'
  path: string
  oldText: string | null
  newText: string
  /** True when a side was sliced to the display budget; the card shows a note. */
  truncated: boolean
}>

export type AgentToolSearchFile = Readonly<{
  path: string
  matches: ReadonlyArray<Readonly<{ lineNumber: number; text: string }>>
}>

export type AgentToolSearchContent = Readonly<{
  kind: 'search'
  query?: string
  resultKind: 'matches' | 'paths'
  files: readonly AgentToolSearchFile[]
  paths: readonly string[]
  total: number
  truncated: boolean
}>

export type AgentToolWebSearchSource = Readonly<{
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}>

export type AgentToolWebSearchContent = Readonly<{
  kind: 'web-search'
  query?: string
  sources: readonly AgentToolWebSearchSource[]
  total: number
  truncated: boolean
}>

export type AgentToolWebFetchContent = Readonly<{
  kind: 'web-fetch'
  url: string
  statusCode?: number
  truncated: boolean
}>

export type AgentToolMemoryHit = Readonly<{
  title?: string
  snippet: string
}>

export type AgentToolMemoryContent = Readonly<{
  kind: 'memory'
  query?: string
  hits: readonly AgentToolMemoryHit[]
  total: number
}>

export type AgentToolLessonContent = Readonly<{
  kind: 'lesson'
  topic?: string
  title?: string
  path?: string
  message?: string
}>

export type AgentConversationToolContent =
  | AgentToolTerminalContent
  | AgentToolReadContent
  | AgentToolDiffContent
  | AgentToolSearchContent
  | AgentToolWebSearchContent
  | AgentToolWebFetchContent
  | AgentToolMemoryContent
  | AgentToolLessonContent

export function presentAgentToolContent(input: {
  toolName: string | undefined
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentConversationToolContent | undefined {
  const name = (input.toolName ?? '').trim().toLowerCase()
  if (isTerminalTool(name)) return presentTerminalContent(input)
  if (isReadTool(name)) return presentReadContent(input)
  if (isDiffTool(name)) return presentDiffContent(name, input)
  if (isSearchTool(name)) return presentSearchContent(name, input)
  if (isWebSearchTool(name)) return presentWebSearchContent(input)
  if (isWebFetchTool(name)) return presentWebFetchContent(input)
  if (isMemoryTool(name)) return presentMemoryContent(input)
  if (isLessonTool(name)) return presentLessonContent(input)
  return undefined
}

function presentTerminalContent(input: {
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentToolTerminalContent | undefined {
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  const command = terminalCommand(args) ?? safeText(input.argumentsText, 4_096)
  if (!command) return undefined

  const stdout = safeRecordText(result, 'stdout', TOOL_CARD_TEXT_LIMIT, true)
  const stderr = safeRecordText(result, 'stderr', TOOL_CARD_TEXT_LIMIT, true)
  const plainResult = result ? undefined : safeText(input.resultText, TOOL_CARD_TEXT_LIMIT, true)
  const output = joinTerminalOutput(stdout, stderr) ?? plainResult
  const cwd = safePath(args?.cwd) ?? safePath(result?.cwd)
  const exitCode = finiteInteger(result?.exitCode)
  const signal = safeRecordText(result, 'signal', 80)
  const resultFailed = result?.ok === false || result?.error === true || result?.timedOut === true || result?.aborted === true

  return {
    kind: 'terminal',
    command,
    ...(cwd ? { cwd } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(signal ? { signal } : {}),
    running: input.running,
    failed: input.failed || resultFailed,
    truncated: result?.stdoutTruncated === true || result?.stderrTruncated === true
  }
}

function presentReadContent(input: {
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentToolReadContent | undefined {
  if (input.running || input.failed) return undefined
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  if (!result || result.error !== undefined || typeof result.content !== 'string') return undefined
  const path = safePath(result.path) ?? safePathFromRecord(args)
  const content = safeText(result.content, TOOL_CARD_TEXT_LIMIT, true)
  if (!path || content === undefined) return undefined

  const offset = Math.max(0, finiteInteger(result.offset) ?? 0)
  const rawLines = content === '' ? [] : content.split(/\r?\n/)
  const lines = rawLines.slice(0, TOOL_CARD_ROWS_LIMIT).map((line, index) => {
    const numbered = /^\s*(\d+)\| ?(.*)$/.exec(line)
    return {
      number: numbered ? Number(numbered[1]) : offset + index + 1,
      text: numbered?.[2] ?? line
    }
  })
  const reportedTotal = finiteInteger(result.totalLines)
  const totalLines = Math.max(reportedTotal ?? lines.length, lines.length)

  return {
    kind: 'read',
    path,
    lines,
    totalLines,
    truncated: result.contentTruncated === true || result.nextOffset !== null || rawLines.length > TOOL_CARD_ROWS_LIMIT
  }
}

function presentDiffContent(
  name: string,
  input: {
    argumentsText: string | undefined
    resultText: string | undefined
    running: boolean
    failed: boolean
  }
): AgentToolDiffContent | undefined {
  if (input.failed) return undefined
  // Write args carry the full file content (up to the tool's 1 MiB write cap),
  // so the diff path parses a much larger record than the other cards.
  const args = parseBoundedRecord(input.argumentsText, TOOL_CARD_DIFF_PAYLOAD_LIMIT)
  if (!args) return undefined
  const result = parseBoundedRecord(input.resultText)
  if (!input.running && result?.error !== undefined) return undefined
  const path = safePathFromRecord(args) ?? safePath(result?.path)
  if (!path) return undefined

  if (isEditTool(name)) {
    const oldText = safeRecordTextCapped(args, 'old_string', TOOL_CARD_TEXT_LIMIT, true)
    const newText = safeRecordTextCapped(args, 'new_string', TOOL_CARD_TEXT_LIMIT, true)
    if (oldText === undefined || newText === undefined) return undefined
    return {
      kind: 'diff',
      path,
      oldText: oldText.text,
      newText: newText.text,
      truncated: oldText.truncated || newText.truncated
    }
  }

  const newText = safeRecordTextCapped(args, 'content', TOOL_CARD_TEXT_LIMIT, true)
  if (newText === undefined) return undefined
  return { kind: 'diff', path, oldText: null, newText: newText.text, truncated: newText.truncated }
}

function presentSearchContent(
  name: string,
  input: {
    argumentsText: string | undefined
    resultText: string | undefined
    running: boolean
    failed: boolean
  }
): AgentToolSearchContent | undefined {
  if (input.running || input.failed) return undefined
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  if (!result || result.error !== undefined) return undefined
  const query = safeRecordText(args, 'pattern', 240) ?? safeRecordText(args, 'query', 240)
  const total = Math.max(0, finiteInteger(result.count) ?? 0)
  const truncated = result.truncated === true

  if (name === 'search_workspace' || name === 'grep' || name === 'search') {
    if (!Array.isArray(result.matches)) return undefined
    const grouped = new Map<string, Array<{ lineNumber: number; text: string }>>()
    for (const rawMatch of result.matches.slice(0, TOOL_CARD_ROWS_LIMIT)) {
      const match = asRecord(rawMatch)
      const path = safePath(match?.path)
      const lineNumber = finiteInteger(match?.line)
      const text = safeRecordText(match, 'text', 1_000, true)
      if (!path || lineNumber === undefined || lineNumber < 1 || text === undefined) continue
      const matches = grouped.get(path) ?? []
      matches.push({ lineNumber, text })
      grouped.set(path, matches)
    }
    const files = [...grouped].map(([path, matches]) => ({ path, matches }))
    if (files.length === 0 && result.matches.length > 0) return undefined
    const shown = files.reduce((count, file) => count + file.matches.length, 0)
    return {
      kind: 'search',
      ...(query ? { query } : {}),
      resultKind: 'matches',
      files,
      paths: [],
      total: Math.max(total, shown),
      truncated: truncated || result.matches.length > TOOL_CARD_ROWS_LIMIT
    }
  }

  const rawPaths = name === 'list_workspace'
    ? Array.isArray(result.entries)
      ? result.entries.map((entry) => asRecord(entry)?.path)
      : undefined
    : Array.isArray(result.matches)
      ? result.matches
      : undefined
  if (!rawPaths) return undefined
  const paths = rawPaths
    .slice(0, TOOL_CARD_ROWS_LIMIT)
    .map(safePath)
    .filter((path): path is string => Boolean(path))
  if (paths.length === 0 && rawPaths.length > 0) return undefined
  return {
    kind: 'search',
    ...(query ? { query } : {}),
    resultKind: 'paths',
    files: [],
    paths,
    total: Math.max(total, paths.length),
    truncated: truncated || rawPaths.length > TOOL_CARD_ROWS_LIMIT
  }
}

function terminalCommand(record: Record<string, unknown> | undefined): string | undefined {
  const authored = safeRecordText(record, 'command', 4_096, true)
  if (authored) return authored
  if (!Array.isArray(record?.argv)) return undefined
  const argv = record.argv
    .slice(0, 64)
    .map((part) => safeText(typeof part === 'string' ? part : String(part ?? ''), 4_096))
  if (argv.some((part) => !part)) return undefined
  return safeText(argv.map((part) => shellDisplayToken(part ?? '')).join(' '), 4_096, true)
}

function shellDisplayToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function joinTerminalOutput(stdout: string | undefined, stderr: string | undefined): string | undefined {
  if (stdout === undefined && stderr === undefined) return undefined
  if (!stdout) return stderr ?? ''
  if (!stderr) return stdout
  return `${stdout}${stdout.endsWith('\n') ? '' : '\n'}${stderr}`
}

function parseBoundedRecord(value: string | undefined, limit = TOOL_CARD_PAYLOAD_LIMIT): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) return undefined
  try {
    return asRecord(JSON.parse(value) as unknown)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function safePathFromRecord(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined
  for (const key of ['path', 'file_path', 'filePath', 'relativePath']) {
    const path = safePath(record[key])
    if (path) return path
  }
  return undefined
}

function safePath(value: unknown): string | undefined {
  if (value === '.') return '.'
  return sanitizeFileTouchDisplayPath(value) ?? undefined
}

function safeRecordText(
  record: Record<string, unknown> | undefined,
  key: string,
  limit: number,
  allowEmpty = false
): string | undefined {
  return safeText(typeof record?.[key] === 'string' ? record[key] : undefined, limit, allowEmpty)
}

/**
 * A record string value sliced to `limit` for display, reporting whether it
 * was cut so the card can show a truncation note (the diff path's large
 * write content). Runs the same per-value redaction round-trip as
 * {@link safeText}, so a value carrying a redaction fragment fails closed.
 */
function safeRecordTextCapped(
  record: Record<string, unknown> | undefined,
  key: string,
  limit: number,
  allowEmpty = false
): { text: string; truncated: boolean } | undefined {
  return safeTextCapped(typeof record?.[key] === 'string' ? record[key] : undefined, limit, allowEmpty)
}

function safeTextCapped(value: unknown, limit: number, allowEmpty = false): { text: string; truncated: boolean } | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    if (allowEmpty && value === '') return { text: '', truncated: false }
    return undefined
  }
  const truncated = value.length > limit
  const bounded = truncated ? value.slice(0, limit) : value
  const sanitized = sanitizeAgentPresentationText(bounded)
  if (sanitized !== bounded || (!allowEmpty && !sanitized.trim())) return undefined
  return { text: sanitized, truncated }
}

function safeText(value: string | undefined, limit: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || value.length > limit) return undefined
  if (!allowEmpty && !value.trim()) return undefined
  const sanitized = sanitizeAgentPresentationText(value)
  return sanitized === value && (allowEmpty || Boolean(sanitized.trim())) ? sanitized : undefined
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined
}

/**
 * A web-search card from the `web_search` tool: the query plus the citation
 * list (safe http(s) URLs with title/snippet/publishedAt). Maps the tool's
 * `SearchSource` envelope onto the reference WebSearchBlock source shape.
 */
function presentWebSearchContent(input: {
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentToolWebSearchContent | undefined {
  if (input.running || input.failed) return undefined
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  if (!result || result.error !== undefined) return undefined
  const query = safeRecordText(args, 'query', 240)
  if (!Array.isArray(result.results)) return undefined
  const rawSources = result.results
  const sources = rawSources.slice(0, TOOL_CARD_ROWS_LIMIT).flatMap((raw): AgentToolWebSearchSource[] => {
    const record = asRecord(raw)
    const url = safeWebUrl(record?.url)
    if (!url) return []
    const title = safeRecordText(record, 'title', 240)
    const snippet = safeRecordText(record, 'snippet', 800, true)
    const publishedAt = safeRecordText(record, 'publishedAt', 80)
    return [{
      url,
      ...(title ? { title } : {}),
      ...(snippet !== undefined ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {})
    }]
  })
  if (sources.length === 0 && rawSources.length > 0) return undefined
  const total = Math.max(0, finiteInteger(result.count) ?? sources.length)
  return {
    kind: 'web-search',
    ...(query ? { query } : {}),
    sources,
    total: Math.max(total, sources.length),
    truncated: result.truncated === true || rawSources.length > TOOL_CARD_ROWS_LIMIT
  }
}

/**
 * A web-fetch card from the `web_fetch` tool: the linked final URL plus its
 * HTTP status (mirrors the reference WebFetchBlock). The URL is the resolved
 * `finalUrl` when the tool reports one, falling back to the requested URL.
 */
function presentWebFetchContent(input: {
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentToolWebFetchContent | undefined {
  if (input.running || input.failed) return undefined
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  if (!result || result.error !== undefined) return undefined
  const url = safeWebUrl(result.finalUrl) ?? safeWebUrl(result.url) ?? safeWebUrl(args?.url)
  if (!url) return undefined
  let statusCode: number | undefined
  if (Array.isArray(result.attempts)) {
    const attempts = result.attempts.map(asRecord)
    const settled = [...attempts].reverse().find((attempt) => attempt && typeof attempt.status === 'number')
    if (settled && Number.isFinite(settled.status)) statusCode = Math.trunc(settled.status as number)
  }
  return {
    kind: 'web-fetch',
    url,
    ...(statusCode !== undefined ? { statusCode } : {}),
    truncated: result.truncated === true
  }
}

/**
 * A memory card from the `memory_search` tool: the query plus the hits, each a
 * title (when the record carries one) over its snippet.
 */
function presentMemoryContent(input: {
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentToolMemoryContent | undefined {
  if (input.running || input.failed) return undefined
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  if (!result || result.error !== undefined) return undefined
  const query = safeRecordText(args, 'query', 240)
  if (!Array.isArray(result.hits)) return undefined
  const hits = result.hits.slice(0, TOOL_CARD_ROWS_LIMIT).flatMap((raw): AgentToolMemoryHit[] => {
    const record = asRecord(raw)
    const snippet = safeRecordText(record, 'snippet', 800, true)
    if (snippet === undefined) return []
    const title = safeRecordText(record, 'title', 240)
    return [{ ...(title ? { title } : {}), snippet }]
  })
  if (hits.length === 0 && result.hits.length > 0) return undefined
  const total = Math.max(0, finiteInteger(result.count) ?? hits.length)
  return {
    kind: 'memory',
    ...(query ? { query } : {}),
    hits,
    total: Math.max(total, hits.length)
  }
}

/**
 * A lesson card from the `generate_lesson` tool: the generated course's
 * title and saved path over the tool's ok message. Keeps the core teaching
 * write out of the raw-JSON IN/OUT fallback.
 */
function presentLessonContent(input: {
  argumentsText: string | undefined
  resultText: string | undefined
  running: boolean
  failed: boolean
}): AgentToolLessonContent | undefined {
  if (input.running || input.failed) return undefined
  const args = parseBoundedRecord(input.argumentsText)
  const result = parseBoundedRecord(input.resultText)
  if (!result || result.error !== undefined) return undefined
  const title = safeRecordText(result, 'title', 240)
  const path = safePath(result.path)
  const message = safeRecordText(result, 'message', 800)
  const topic = safeRecordText(args, 'topic', 240)
  if (!title && !path && !message && !topic) return undefined
  return {
    kind: 'lesson',
    ...(topic ? { topic } : {}),
    ...(title ? { title } : {}),
    ...(path ? { path } : {}),
    ...(message ? { message } : {})
  }
}

/** A web result URL: an http(s) URL that survives display sanitization. */
function safeWebUrl(value: unknown, limit = 2_048): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const sanitized = sanitizeAgentPresentationText(value)
  return sanitized === value ? value : undefined
}

function isTerminalTool(name: string): boolean {
  return ['run_workspace_command', 'workspace_shell', 'workspaceshell', 'bash', 'shell'].includes(name)
}

function isReadTool(name: string): boolean {
  return ['read_workspace_file', 'read_file', 'file_read', 'fileread', 'read', 'read_skill_resource'].includes(name)
}

function isEditTool(name: string): boolean {
  return ['edit_workspace_file', 'edit_file', 'edit', 'apply_patch'].includes(name)
}

function isDiffTool(name: string): boolean {
  return isEditTool(name) || ['write_workspace_file', 'write_file', 'file_write', 'write'].includes(name)
}

function isSearchTool(name: string): boolean {
  return ['search_workspace', 'grep', 'search', 'glob_workspace', 'glob', 'list_workspace'].includes(name)
}

function isWebSearchTool(name: string): boolean {
  return ['web_search', 'websearch'].includes(name)
}

function isWebFetchTool(name: string): boolean {
  return ['web_fetch', 'webfetch'].includes(name)
}

function isMemoryTool(name: string): boolean {
  return ['memory_search', 'memorysearch'].includes(name)
}

function isLessonTool(name: string): boolean {
  return ['generate_lesson'].includes(name)
}
