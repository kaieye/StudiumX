/**
 * Deterministic workspace file-touch ledger (projection floor only).
 *
 * After successful single-path tool calls (read / write / edit / delete style),
 * records path-sanitized entries for context projection. This is **data not
 * instructions**, **not** teaching-evidence or settlement authority, and must
 * never feed the ContextCompactor summarizer payload.
 *
 * Product floor: no shell tools, no YOLO, no FTS authority, no settlement write.
 */

import type { ChatMessage, ToolCall } from './provider-adapter'
import { parseToolArguments, readToolPathArg } from './tools/tool-arguments'
import { toolContentLooksLikeError } from './tools/execution'
import {
  DEFAULT_FILE_TOUCH_MAX_ENTRIES,
  DEFAULT_FILE_TOUCH_MAX_PATH_CHARS,
  classifyFileTouchTool as classifyFileTouchToolShared,
  sanitizeFileTouchPath as sanitizeFileTouchPathShared,
  stickyFileTouchKind,
  clampFileTouchInt,
  type FileTouchKind as SharedFileTouchKind
} from '../../shared/file-touch-tools'

/** Access kind for a touched workspace path. */
export type FileTouchKind = SharedFileTouchKind

export type FileTouchEntry = Readonly<{
  /** Sanitized relative workspace path (posix). */
  path: string
  kind: FileTouchKind
  /**
   * Monotonic message/tool order used for merge stability.
   * Higher means later in the conversation.
   */
  order: number
}>

export type ContextFileLedger = Readonly<{
  entries: readonly FileTouchEntry[]
}>

export type ContextFileLedgerBudget = Readonly<{
  /** Max retained entries after merge; surplus **dropped** (oldest first). */
  maxEntries: number
  /** Paths longer than this after sanitize are **dropped** (never truncated). */
  maxPathChars: number
}>

export type FileTouchToolOutcome = Readonly<{
  toolCallId: string
  name: string
  isError: boolean
  /** Optional content used when rebuilding from transcript (error JSON). */
  content?: string
}>

export type RecordFileTouchesInput = Readonly<{
  ledger: ContextFileLedger
  calls: readonly ToolCall[]
  results: readonly FileTouchToolOutcome[]
  /** Starting order for this batch (defaults to max existing + 1). */
  orderStart?: number
  budget?: Partial<ContextFileLedgerBudget>
}>

export const DEFAULT_FILE_LEDGER_MAX_ENTRIES = DEFAULT_FILE_TOUCH_MAX_ENTRIES
export const DEFAULT_FILE_LEDGER_MAX_PATH_CHARS = DEFAULT_FILE_TOUCH_MAX_PATH_CHARS

/** Stable marker embedded in projection data messages (not free-text commands). */
export const FILE_TOUCH_LEDGER_DATA_TYPE = 'workspace_file_touch_ledger' as const

export function emptyContextFileLedger(): ContextFileLedger {
  return { entries: [] }
}

export function normalizeFileLedgerBudget(
  budget?: Partial<ContextFileLedgerBudget>
): ContextFileLedgerBudget {
  const maxEntries = clampFileTouchInt(
    budget?.maxEntries,
    1,
    10_000,
    DEFAULT_FILE_LEDGER_MAX_ENTRIES
  )
  const maxPathChars = clampFileTouchInt(
    budget?.maxPathChars,
    16,
    4_096,
    DEFAULT_FILE_LEDGER_MAX_PATH_CHARS
  )
  return { maxEntries, maxPathChars }
}

/**
 * Lexical path sanitization for ledger keys (shared closed-set helpers).
 * Rejects absolute / UNC / drive / traversal breakout; normalizes to posix relative.
 * Returns null when the path must be **dropped** (never partially truncated).
 */
export function sanitizeFileTouchPath(
  raw: unknown,
  maxPathChars: number = DEFAULT_FILE_LEDGER_MAX_PATH_CHARS
): string | null {
  return sanitizeFileTouchPathShared(raw, maxPathChars)
}

/**
 * Classify a tool name into a file-touch kind when it targets a single path.
 * Multi-path / search / list tools return null (not recorded).
 * Dead aliases such as apply_patch are intentionally omitted.
 */
export function classifyFileTouchTool(toolName: string): FileTouchKind | null {
  return classifyFileTouchToolShared(toolName)
}

/**
 * Merge ledgers in message order. Later order wins for recency; `modified` is sticky
 * when either side marked the path modified.
 */
export function mergeContextFileLedgers(
  ledgers: readonly ContextFileLedger[],
  budget?: Partial<ContextFileLedgerBudget>
): ContextFileLedger {
  const limits = normalizeFileLedgerBudget(budget)
  const byPath = new Map<string, FileTouchEntry>()

  for (const ledger of ledgers) {
    for (const entry of ledger.entries) {
      const path = sanitizeFileTouchPath(entry.path, limits.maxPathChars)
      if (!path) continue
      const kind: FileTouchKind =
        entry.kind === 'modified' ? 'modified' : 'read'
      const order = Number.isFinite(entry.order) ? Math.floor(entry.order) : 0
      const prev = byPath.get(path)
      if (!prev) {
        byPath.set(path, { path, kind, order })
        continue
      }
      byPath.set(path, {
        path,
        kind: stickyFileTouchKind(prev.kind, kind),
        order: Math.max(prev.order, order)
      })
    }
  }

  return applyBudget(byPath, limits)
}

/**
 * Record successful single-path tool outcomes into a mergeable ledger.
 * Failed / canceled / denied results are excluded.
 */
export function recordFileTouchesFromToolBatch(
  input: RecordFileTouchesInput
): ContextFileLedger {
  const limits = normalizeFileLedgerBudget(input.budget)
  const callById = new Map(input.calls.map((call) => [call.id, call]))
  let nextOrder =
    input.orderStart ??
    (input.ledger.entries.reduce((max, e) => Math.max(max, e.order), -1) + 1)

  const batchEntries: FileTouchEntry[] = []

  for (const result of input.results) {
    if (result.isError) continue
    if (result.content !== undefined && toolContentLooksLikeError(result.content)) {
      continue
    }

    const kind = classifyFileTouchTool(result.name)
    if (!kind) continue

    const call = callById.get(result.toolCallId)
    if (!call) continue

    const path = extractSinglePathFromToolCall(call, limits.maxPathChars)
    if (!path) continue

    batchEntries.push({ path, kind, order: nextOrder })
    nextOrder += 1
  }

  return mergeContextFileLedgers(
    [input.ledger, { entries: batchEntries }],
    limits
  )
}

/**
 * Rebuild a ledger by scanning assistant tool_calls + tool results in message order.
 * Used for resume / projection when no live agent-loop ledger is held.
 */
export function rebuildFileTouchLedgerFromTranscript(
  messages: readonly ChatMessage[],
  budget?: Partial<ContextFileLedgerBudget>
): ContextFileLedger {
  const limits = normalizeFileLedgerBudget(budget)
  const callsById = new Map<string, ToolCall>()
  const batchEntries: FileTouchEntry[] = []
  let order = 0

  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        callsById.set(call.id, call)
      }
      continue
    }
    if (message.role !== 'tool') continue

    const call = callsById.get(message.tool_call_id)
    if (!call) continue

    const kind = classifyFileTouchTool(call.function.name)
    if (!kind) continue
    if (toolContentLooksLikeError(message.content)) continue

    const path = extractSinglePathFromToolCall(call, limits.maxPathChars)
    if (!path) continue

    batchEntries.push({ path, kind, order })
    order += 1
  }

  return mergeContextFileLedgers([{ entries: batchEntries }], limits)
}

/**
 * Structured projection payload: JSON data envelope, not imperative instructions.
 */
export function buildFileTouchLedgerProjectionData(
  ledger: ContextFileLedger
): Readonly<{
  type: typeof FILE_TOUCH_LEDGER_DATA_TYPE
  role: 'reference_data'
  files: ReadonlyArray<{ path: string; kind: FileTouchKind }>
}> {
  const sorted = [...ledger.entries].sort((a, b) => a.order - b.order)
  return {
    type: FILE_TOUCH_LEDGER_DATA_TYPE,
    role: 'reference_data',
    files: sorted.map((e) => ({ path: e.path, kind: e.kind }))
  }
}

/**
 * Append ledger as a trailing system **data** message (JSON). Empty ledgers are no-ops.
 * Callers must inject **after** compaction so the summarizer never sees this message.
 */
export function appendFileTouchLedgerDataMessage(
  messages: readonly ChatMessage[],
  ledger: ContextFileLedger | undefined
): ChatMessage[] {
  if (!ledger || ledger.entries.length === 0) {
    return [...messages]
  }
  const stripped = stripFileTouchLedgerMessages(messages)
  const data = buildFileTouchLedgerProjectionData(ledger)
  const dataMessage: ChatMessage = {
    role: 'system',
    content: JSON.stringify(data)
  }
  return [...stripped, dataMessage]
}

export function isFileTouchLedgerMessage(message: ChatMessage): boolean {
  if (message.role !== 'system') return false
  const content = message.content
  if (typeof content !== 'string' || !content.includes(FILE_TOUCH_LEDGER_DATA_TYPE)) {
    return false
  }
  try {
    const parsed = JSON.parse(content) as { type?: unknown; role?: unknown }
    return (
      parsed?.type === FILE_TOUCH_LEDGER_DATA_TYPE && parsed?.role === 'reference_data'
    )
  } catch {
    return false
  }
}

export function stripFileTouchLedgerMessages(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  return messages.filter((message) => !isFileTouchLedgerMessage(message))
}

/**
 * Structural boundary: messages that may be sent to the compaction summarizer
 * must not include file-touch ledger data payloads.
 */
export function buildSummarizerInputMessages(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  return stripFileTouchLedgerMessages(messages)
}

function extractSinglePathFromToolCall(
  call: ToolCall,
  maxPathChars: number
): string | null {
  let args: unknown
  try {
    args = parseToolArguments(call.function.arguments)
  } catch {
    return null
  }
  const resolved = readToolPathArg(args)
  if (!resolved.path) return null
  return sanitizeFileTouchPath(resolved.path, maxPathChars)
}

function applyBudget(
  byPath: Map<string, FileTouchEntry>,
  limits: ContextFileLedgerBudget
): ContextFileLedger {
  const sorted = [...byPath.values()].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.path.localeCompare(b.path)
  })

  // Drop oldest when over entry budget (whole entries, never mid-path).
  const kept =
    sorted.length <= limits.maxEntries
      ? sorted
      : sorted.slice(sorted.length - limits.maxEntries)

  return { entries: kept }
}

