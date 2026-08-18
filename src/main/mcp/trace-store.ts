/**
 * Process-local, bounded MCP call diagnostics (ADR-0013).
 *
 * This module intentionally accepts only a small allowlist of metadata. It
 * never retains arguments, result content, URLs, environment/header data,
 * paths, artifact identifiers, or secret-bearing strings. It has no IPC,
 * telemetry, persistence, or teaching/settlement dependencies.
 */

export const MCP_TRACE_DEFAULT_CAPACITY = 128
export const MCP_TRACE_MAX_CAPACITY = 512
export const MCP_TRACE_MAX_IDENTIFIER_LENGTH = 256
export const MCP_TRACE_MAX_ERROR_CODE_LENGTH = 80
export const MCP_TRACE_MAX_DURATION_MS = 24 * 60 * 60 * 1000
export const MCP_TRACE_MAX_RESULT_BYTES = 1024 * 1024 * 1024

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_ERROR_CODE = /^[a-z][a-z0-9_]*$/

/** A closed, stable summary of the normalized MCP result shape. */
export const MCP_TRACE_RESULT_KINDS = [
  'empty',
  'text',
  'structured',
  'resource_link',
  'artifact',
  'mixed',
  'error',
  'unknown'
] as const

export type McpTraceResultKind = (typeof MCP_TRACE_RESULT_KINDS)[number]

/**
 * The only caller-provided fields trace storage will consider. Do not add raw
 * payload fields here: trace is a local diagnostic index, not a replay log.
 */
export type McpTraceAppendInput = Readonly<{
  serverId: string
  registeredToolName: string
  rawToolName: string
  durationMs: number
  cancelled: boolean
  resultBytes: number
  truncated: boolean
  spilled: boolean
  resultKind: McpTraceResultKind
  errorCode?: string | null
}>

export type McpTraceEntry = Readonly<{
  /** Monotonic within this in-memory store only; it is not a durable call id. */
  sequence: number
  serverId: string
  registeredToolName: string
  rawToolName: string
  durationMs: number
  cancelled: boolean
  resultBytes: number
  truncated: boolean
  spilled: boolean
  resultKind: McpTraceResultKind
  errorCode: string | null
}>

export type McpTraceStoreOptions = Readonly<{
  /** Bounded to [1, MCP_TRACE_MAX_CAPACITY]. Defaults to 128. */
  capacity?: number
}>

export type McpTraceStore = Readonly<{
  readonly capacity: number
  readonly size: () => number
  /** Returns a frozen copy in oldest-to-newest order. */
  readonly snapshot: () => readonly McpTraceEntry[]
  /** Appends an allowlisted entry, or rejects invalid tool/server identifiers. */
  readonly append: (input: McpTraceAppendInput) => McpTraceEntry | null
  readonly clear: () => void
}>

/**
 * Builds a process-local FIFO trace store. Instances are deliberately not
 * singletons so their lifecycle remains explicit at the main-process owner.
 */
export function createMcpTraceStore(options: McpTraceStoreOptions = {}): McpTraceStore {
  const capacity = normalizeCapacity(options.capacity)
  const entries: McpTraceEntry[] = []
  let nextSequence = 1

  return Object.freeze({
    capacity,
    size: () => entries.length,
    snapshot: () => Object.freeze([...entries]),
    append: (input: McpTraceAppendInput): McpTraceEntry | null => {
      const entry = normalizeEntry(input, nextSequence)
      if (!entry) return null

      nextSequence += 1
      if (entries.length === capacity) entries.shift()
      entries.push(entry)
      return entry
    },
    clear: () => {
      entries.length = 0
    }
  })
}

function normalizeEntry(input: McpTraceAppendInput, sequence: number): McpTraceEntry | null {
  // Pick individual fields instead of spreading input so runtime callers cannot
  // smuggle untyped data into the process-local diagnostic record.
  const serverId = normalizeIdentifier(input?.serverId)
  const registeredToolName = normalizeIdentifier(input?.registeredToolName)
  const rawToolName = normalizeIdentifier(input?.rawToolName)
  if (!serverId || !registeredToolName || !rawToolName) return null

  const entry: McpTraceEntry = {
    sequence,
    serverId,
    registeredToolName,
    rawToolName,
    durationMs: normalizeBoundedInteger(input?.durationMs, MCP_TRACE_MAX_DURATION_MS),
    cancelled: input?.cancelled === true,
    resultBytes: normalizeBoundedInteger(input?.resultBytes, MCP_TRACE_MAX_RESULT_BYTES),
    truncated: input?.truncated === true,
    spilled: input?.spilled === true,
    resultKind: normalizeResultKind(input?.resultKind),
    errorCode: normalizeErrorCode(input?.errorCode)
  }
  return Object.freeze(entry)
}

function normalizeCapacity(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return MCP_TRACE_DEFAULT_CAPACITY
  }
  return Math.min(MCP_TRACE_MAX_CAPACITY, Math.max(1, Math.floor(value)))
}

function normalizeIdentifier(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MCP_TRACE_MAX_IDENTIFIER_LENGTH ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    return null
  }
  return value
}

function normalizeErrorCode(value: unknown): string | null {
  if (value == null) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MCP_TRACE_MAX_ERROR_CODE_LENGTH ||
    !SAFE_ERROR_CODE.test(value)
  ) {
    return 'mcp_unknown_error'
  }
  return value
}

function normalizeResultKind(value: unknown): McpTraceResultKind {
  return (MCP_TRACE_RESULT_KINDS as readonly string[]).includes(value as string)
    ? (value as McpTraceResultKind)
    : 'unknown'
}

function normalizeBoundedInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.floor(value)))
}
