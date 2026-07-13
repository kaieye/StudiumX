import type { ChatMessage } from './provider-adapter'
import { ContextEstimator } from './context-estimator'

export type RequestHistoryHygieneOptions = {
  maxToolResultLines?: number
  maxToolResultBytes?: number
  maxToolResultTokens?: number
  maxToolArgumentStringBytes?: number
  maxToolArgumentStringTokens?: number
  maxArrayItems?: number
  maxCumulativeToolResultTokens?: number
  keepRecentToolResults?: number
}

export type RequestHistoryHygieneStats = {
  compactedToolResults: number
  digestedToolResults: number
  compactedToolCallArgs: number
}

export type RequestHistoryHygieneResult = {
  messages: ChatMessage[]
  changed: boolean
  beforeMessageTokens: number
  afterMessageTokens: number
  savedTokens: number
  stats: RequestHistoryHygieneStats
}

export type RequestHistoryHygieneDiagnostic = {
  type: 'context_hygiene_applied'
  changed: boolean
  savedTokens: number
  compactedToolResults: number
  digestedToolResults: number
  compactedToolCallArgs: number
}

type HygieneLimits = Required<RequestHistoryHygieneOptions>
type CompactResult<T> = { value: T; changed: boolean }

const DEFAULT_MAX_TOOL_RESULT_LINES = 240
const DEFAULT_MAX_TOOL_RESULT_BYTES = 24 * 1024
const DEFAULT_MAX_TOOL_RESULT_TOKENS = 6_000
const DEFAULT_MAX_TOOL_ARGUMENT_STRING_BYTES = 8 * 1024
const DEFAULT_MAX_TOOL_ARGUMENT_STRING_TOKENS = 2_000
const DEFAULT_MAX_ARRAY_ITEMS = 80
const DEFAULT_MAX_CUMULATIVE_TOOL_RESULT_TOKENS = 12_000
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 1
const MAX_SIGNAL_LINES = 48
const MAX_LINE_CHARS = 280
const LONG_ARGUMENT_PREVIEW_CHARS = 160
const ESC = String.fromCharCode(27)

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const SIGNAL_LINE_RE =
  /\b(error|failed?|fatal|panic|exception|traceback|warning|warn|denied|timeout|timed out|not found|cannot|invalid)\b/i
const BASE64_RE = /(?:^data:[^;,]+;base64,|^[A-Za-z0-9+/]{512,}={0,2}$)/

export function applyRequestHistoryHygiene(
  messages: ChatMessage[],
  options: RequestHistoryHygieneOptions = {},
  estimator = new ContextEstimator()
): RequestHistoryHygieneResult {
  const limits = normalizeOptions(options)
  const beforeMessageTokens = estimator.estimateMessages(messages)
  const pairedToolCallIds = collectPairedToolCallIds(messages)
  const toolNames = collectToolNames(messages)
  const recentToolIndexes = collectRecentToolIndexes(messages, limits.keepRecentToolResults)
  const stats: RequestHistoryHygieneStats = {
    compactedToolResults: 0,
    digestedToolResults: 0,
    compactedToolCallArgs: 0
  }
  let changed = false

  const compacted = messages.map((message, index): ChatMessage => {
    if (message.role === 'tool') {
      if (recentToolIndexes.has(index)) return message
      const result = compactToolResultText(message.content, limits, estimator)
      if (!result.changed) return message
      changed = true
      stats.compactedToolResults += 1
      return { ...message, content: result.value }
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      let callsChanged = false
      const toolCalls = message.tool_calls.map((call) => {
        if (!pairedToolCallIds.has(call.id)) return call
        const result = compactToolCallArguments(call.function.arguments, call.function.name, limits, estimator)
        if (!result.changed) return call
        callsChanged = true
        stats.compactedToolCallArgs += 1
        return {
          ...call,
          function: {
            ...call.function,
            arguments: result.value
          }
        }
      })
      if (!callsChanged) return message
      changed = true
      return { ...message, tool_calls: toolCalls }
    }

    return message
  })

  const budgeted = applyCumulativeToolResultBudget(compacted, toolNames, limits, estimator, stats)
  if (budgeted !== compacted) changed = true
  const out = changed ? budgeted : messages
  const afterMessageTokens = changed ? estimator.estimateMessages(out) : beforeMessageTokens
  return {
    messages: out,
    changed,
    beforeMessageTokens,
    afterMessageTokens,
    savedTokens: Math.max(0, beforeMessageTokens - afterMessageTokens),
    stats
  }
}


export function requestHistoryHygieneDiagnostic(
  result: RequestHistoryHygieneResult
): RequestHistoryHygieneDiagnostic {
  return {
    type: 'context_hygiene_applied',
    changed: result.changed,
    savedTokens: result.savedTokens,
    compactedToolResults: result.stats.compactedToolResults,
    digestedToolResults: result.stats.digestedToolResults,
    compactedToolCallArgs: result.stats.compactedToolCallArgs
  }
}

function collectRecentToolIndexes(messages: ChatMessage[], keepRecentToolResults: number): Set<number> {
  if (keepRecentToolResults <= 0) return new Set()
  const indexes: number[] = []
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'tool') indexes.push(index)
  }
  return new Set(indexes.slice(-keepRecentToolResults))
}

function collectPairedToolCallIds(messages: ChatMessage[]): Set<string> {
  return new Set(
    messages
      .filter((message): message is Extract<ChatMessage, { role: 'tool' }> => message.role === 'tool')
      .map((message) => message.tool_call_id)
      .filter(Boolean)
  )
}

function collectToolNames(messages: ChatMessage[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) {
      names.set(call.id, call.function.name)
    }
  }
  return names
}

function applyCumulativeToolResultBudget(
  messages: ChatMessage[],
  toolNames: Map<string, string>,
  limits: HygieneLimits,
  estimator: ContextEstimator,
  stats: RequestHistoryHygieneStats
): ChatMessage[] {
  if (limits.maxCumulativeToolResultTokens <= 0) return messages
  const toolIndexes: number[] = []
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'tool') toolIndexes.push(index)
  }
  if (toolIndexes.length === 0) return messages

  const alwaysKeep = new Set(toolIndexes.slice(-limits.keepRecentToolResults))
  const collapse = new Set<number>()
  let used = 0
  for (let cursor = toolIndexes.length - 1; cursor >= 0; cursor -= 1) {
    const index = toolIndexes[cursor]
    const message = messages[index]
    if (!message || message.role !== 'tool') continue
    const cost = Math.max(1, estimator.estimateText(message.content))
    if (alwaysKeep.has(index)) {
      used += cost
      continue
    }
    if (used + cost <= limits.maxCumulativeToolResultTokens) {
      used += cost
      continue
    }
    collapse.add(index)
  }
  if (collapse.size === 0) return messages

  stats.digestedToolResults += collapse.size
  return messages.map((message, index) => {
    if (!collapse.has(index) || message.role !== 'tool') return message
    const toolName = toolNames.get(message.tool_call_id) ?? 'tool'
    return { ...message, content: digestStaleToolResult(toolName, message.content, estimator) }
  })
}

function compactToolResultText(
  text: string,
  limits: HygieneLimits,
  estimator: ContextEstimator
): CompactResult<string> {
  if (shouldOmitBase64(text)) {
    return {
      value: `[context hygiene: omitted base64-like tool result, ${formatBytes(byteLength(text))}]`,
      changed: true
    }
  }

  const originalBytes = byteLength(text)
  const originalLines = countLines(text)
  const originalTokens = estimator.estimateText(text)
  if (
    originalBytes <= limits.maxToolResultBytes &&
    originalLines <= limits.maxToolResultLines &&
    originalTokens <= limits.maxToolResultTokens
  ) {
    return { value: text, changed: false }
  }

  const normalized = normalizeTextBlock(text)
  const lines = normalized ? normalized.split('\n') : []
  const selected = selectUsefulLines(lines, limits.maxToolResultLines)
  const omittedLines = Math.max(0, lines.length - selected.length)
  const selectedText = selected.join('\n')
  const omittedBytes = Math.max(0, originalBytes - byteLength(selectedText))
  const selectedTokens = estimator.estimateText(selectedText)
  const omittedTokens = Math.max(0, originalTokens - selectedTokens)
  const marker = `[context hygiene: omitted ${omittedLines} line(s), ${formatBytes(omittedBytes)}, approx ${omittedTokens} token(s); use a narrower tool request for full details]`
  const fitted = fitLinesToBudget(selected.map(compactLine), {
    maxBytes: Math.max(0, limits.maxToolResultBytes - byteLength(marker) - 1),
    maxTokens: Math.max(0, limits.maxToolResultTokens - estimator.estimateText(marker) - 1),
    estimator
  })
  return {
    value: [...fitted, marker].filter(Boolean).join('\n'),
    changed: true
  }
}

function compactToolCallArguments(
  raw: string,
  toolName: string,
  limits: HygieneLimits,
  estimator: ContextEstimator
): CompactResult<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    const result = compactArgumentString(raw, toolName, 'arguments', limits, estimator)
    if (!result.changed) return { value: raw, changed: false }
    return { value: JSON.stringify({ context_hygiene: result.value }), changed: true }
  }

  const compacted = compactArgumentValue(parsed, toolName, '', limits, estimator)
  if (!compacted.changed) return { value: raw, changed: false }
  return { value: JSON.stringify(compacted.value), changed: true }
}

function compactArgumentValue(
  value: unknown,
  toolName: string,
  key: string,
  limits: HygieneLimits,
  estimator: ContextEstimator
): CompactResult<unknown> {
  if (typeof value === 'string') {
    return compactArgumentString(value, toolName, key || 'value', limits, estimator)
  }
  if (Array.isArray(value)) {
    const selected = value.length > limits.maxArrayItems
      ? [
          ...value.slice(0, Math.max(1, limits.maxArrayItems - 1)),
          { context_hygiene_omitted_items: value.length - limits.maxArrayItems + 1 }
        ]
      : value
    let changed = selected !== value
    const out = selected.map((child) => {
      const result = compactArgumentValue(child, toolName, key, limits, estimator)
      changed ||= result.changed
      return result.value
    })
    return changed ? { value: out, changed: true } : { value, changed: false }
  }
  if (!isRecord(value)) return { value, changed: false }

  let changed = false
  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    const result = compactArgumentValue(childValue, toolName, childKey, limits, estimator)
    out[childKey] = result.value
    changed ||= result.changed
  }
  return changed ? { value: out, changed: true } : { value, changed: false }
}

function compactArgumentString(
  value: string,
  toolName: string,
  key: string,
  limits: HygieneLimits,
  estimator: ContextEstimator
): CompactResult<string> {
  const bytes = byteLength(value)
  const tokens = estimator.estimateText(value)
  if (bytes <= limits.maxToolArgumentStringBytes && tokens <= limits.maxToolArgumentStringTokens) {
    return { value, changed: false }
  }
  const preview = value.slice(0, LONG_ARGUMENT_PREVIEW_CHARS).replace(/\s+/g, ' ').trim()
  return {
    value:
      `[context hygiene: omitted completed ${toolName}.${key} argument, ${formatBytes(bytes)}, ` +
      `approx ${tokens} token(s); see paired tool result]${preview ? ` preview=${JSON.stringify(preview)}` : ''}`,
    changed: true
  }
}

function digestStaleToolResult(toolName: string, content: string, estimator: ContextEstimator): string {
  const tokens = Math.max(1, estimator.estimateText(content))
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  const signalLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => SIGNAL_LINE_RE.test(line))
  const preview = firstLine ? ` first line: ${clipInline(firstLine, 160)}` : ''
  const signal = signalLine ? ` signal: ${clipInline(signalLine, 160)}` : ''
  return `[context hygiene: older ${toolName} result elided to bound context, approx ${tokens} token(s); re-run the tool or narrow the request if needed.]${preview}`
    + signal
}

function normalizeOptions(options: RequestHistoryHygieneOptions): HygieneLimits {
  return {
    maxToolResultLines: Math.max(1, Math.floor(options.maxToolResultLines ?? DEFAULT_MAX_TOOL_RESULT_LINES)),
    maxToolResultBytes: Math.max(512, Math.floor(options.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES)),
    maxToolResultTokens: Math.max(128, Math.floor(options.maxToolResultTokens ?? DEFAULT_MAX_TOOL_RESULT_TOKENS)),
    maxToolArgumentStringBytes:
      Math.max(512, Math.floor(options.maxToolArgumentStringBytes ?? DEFAULT_MAX_TOOL_ARGUMENT_STRING_BYTES)),
    maxToolArgumentStringTokens:
      Math.max(128, Math.floor(options.maxToolArgumentStringTokens ?? DEFAULT_MAX_TOOL_ARGUMENT_STRING_TOKENS)),
    maxArrayItems: Math.max(1, Math.floor(options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS)),
    maxCumulativeToolResultTokens: Math.max(
      0,
      Math.floor(options.maxCumulativeToolResultTokens ?? DEFAULT_MAX_CUMULATIVE_TOOL_RESULT_TOKENS)
    ),
    keepRecentToolResults: Math.max(0, Math.floor(options.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS))
  }
}

function selectUsefulLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines
  const indexes = new Set<number>()
  const headCount = Math.min(80, Math.max(1, Math.floor(maxLines * 0.25)))
  const tailCount = Math.min(120, Math.max(1, Math.floor(maxLines * 0.35)))
  for (let index = 0; index < Math.min(headCount, lines.length); index += 1) indexes.add(index)
  for (let index = Math.max(0, lines.length - tailCount); index < lines.length; index += 1) indexes.add(index)

  let signalCount = 0
  for (let index = 0; index < lines.length && indexes.size < maxLines; index += 1) {
    if (!SIGNAL_LINE_RE.test(lines[index] ?? '')) continue
    indexes.add(index)
    signalCount += 1
    if (signalCount >= MAX_SIGNAL_LINES) break
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .slice(0, maxLines)
    .map((index) => lines[index] ?? '')
}

function fitLinesToBudget(
  lines: string[],
  budget: { maxBytes: number; maxTokens: number; estimator: ContextEstimator }
): string[] {
  const out: string[] = []
  let bytes = 0
  let tokens = 0
  for (const line of lines) {
    const lineBytes = byteLength(line) + (out.length > 0 ? 1 : 0)
    const lineTokens = budget.estimator.estimateText(line) + (out.length > 0 ? 1 : 0)
    if (bytes + lineBytes > budget.maxBytes || tokens + lineTokens > budget.maxTokens) break
    out.push(line)
    bytes += lineBytes
    tokens += lineTokens
  }
  if (out.length === 0 && lines.length > 0 && budget.maxBytes > 0 && budget.maxTokens > 0) {
    out.push(truncateStringToBudget(lines[0] ?? '', budget))
  }
  return out
}

function truncateStringToBudget(
  text: string,
  budget: { maxBytes: number; maxTokens: number; estimator: ContextEstimator }
): string {
  let out = ''
  let bytes = 0
  let tokens = 0
  for (const char of text) {
    const charBytes = byteLength(char)
    const charTokens = budget.estimator.estimateText(char)
    if (bytes + charBytes > budget.maxBytes || tokens + charTokens > budget.maxTokens) break
    out += char
    bytes += charBytes
    tokens += charTokens
  }
  return out
}

function normalizeTextBlock(text: string): string {
  const stripped = text.replace(/\r\n/g, '\n').replace(ANSI_RE, '')
  const lines = stripped.split('\n').map((line) => line.trimEnd())
  const out: string[] = []
  let blankRun = 0
  let previous = ''
  let repeatCount = 0
  const flushRepeat = (): void => {
    if (repeatCount > 1) out.push(`[previous line repeated ${repeatCount - 1} time(s)]`)
    repeatCount = 0
  }

  for (const line of lines) {
    if (!line.trim()) {
      flushRepeat()
      blankRun += 1
      if (blankRun <= 2) out.push('')
      previous = ''
      continue
    }
    blankRun = 0
    if (line === previous) {
      repeatCount += 1
      continue
    }
    flushRepeat()
    out.push(line)
    previous = line
    repeatCount = 1
  }
  flushRepeat()
  return out.join('\n').trim()
}

function compactLine(line: string): string {
  const trimmed = line.trimEnd()
  if (trimmed.length <= MAX_LINE_CHARS) return trimmed
  const head = Math.floor(MAX_LINE_CHARS * 0.6)
  const tail = Math.max(0, MAX_LINE_CHARS - head - 5)
  return `${trimmed.slice(0, head).trimEnd()} ... ${trimmed.slice(-tail).trimStart()}`
}

function shouldOmitBase64(text: string): boolean {
  return text.length > 2048 && BASE64_RE.test(text.trim())
}

function countLines(text: string): number {
  if (!text) return 0
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.length - 1 : lines.length
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function clipInline(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
