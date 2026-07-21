/**
 * Process-local turn / tool correlation identifiers.
 *
 * Pure in-memory helpers for correlating a teaching or agent turn with child
 * tool spans in logs and diagnostics. No network, no disk, no remote telemetry.
 *
 * ID format (stable shapes, not globally unique across processes unless inputs are):
 * - turnId:  `turn_<12 hex>`
 * - toolSpanId: `tool_<turnSuffix>_<seq padded>`
 * - runId / streamId: caller-owned, sanitized to opaque token charset
 */

import { randomBytes } from 'node:crypto'

const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HEX_CHUNK = /^[0-9a-f]+$/i

export type CreateTurnContextInput = {
  /** Caller-owned run identifier (sanitized; invalid becomes `run_unknown`). */
  runId: string
  /** Optional stream / conversation stream id. */
  streamId?: string | null
  /** Optional injected entropy for tests (must be hex, length >= 12). */
  entropy?: string
}

export type ToolSpanContext = Readonly<{
  runId: string
  streamId: string | null
  turnId: string
  toolSpanId: string
  /** Optional short tool label; never free-form path or secret. */
  toolName?: string
}>

export type TurnContext = Readonly<{
  runId: string
  streamId: string | null
  turnId: string
  /** Allocate the next child tool span id under this turn. */
  nextToolSpanId: () => string
  /** Create a frozen child span context (optionally labelled). */
  child: (toolName?: string) => ToolSpanContext
  /** Snapshot fields safe for local logs (no paths / secrets). */
  toCorrelation: () => Readonly<{
    runId: string
    streamId: string | null
    turnId: string
  }>
}>

/**
 * Create a process-local turn context with a fresh turnId and a tool-span
 * sequence counter. Safe for concurrent turns within one process.
 */
export function createTurnContext(input: CreateTurnContextInput): TurnContext {
  const runId = requireOpaqueId(input.runId, 'run_unknown')
  const streamId =
    input.streamId == null || String(input.streamId).trim() === ''
      ? null
      : requireOpaqueId(String(input.streamId), 'stream_unknown')
  const turnId = formatTurnId(input.entropy)
  const turnSuffix = turnId.slice('turn_'.length, 'turn_'.length + 8)
  let seq = 0

  const nextToolSpanId = (): string => {
    seq += 1
    if (seq > 99_999) {
      // Fail closed on absurd span counts rather than wrap or use unbounded digits.
      throw new RangeError('Turn tool-span sequence exceeded process-local budget')
    }
    return `tool_${turnSuffix}_${String(seq).padStart(4, '0')}`
  }

  return {
    runId,
    streamId,
    turnId,
    nextToolSpanId,
    child(toolName?: string): ToolSpanContext {
      const toolSpanId = nextToolSpanId()
      const safeName =
        toolName == null || String(toolName).trim() === ''
          ? undefined
          : tryOpaqueId(String(toolName))
      return {
        runId,
        streamId,
        turnId,
        toolSpanId,
        ...(safeName ? { toolName: safeName } : {})
      }
    },
    toCorrelation() {
      return { runId, streamId, turnId }
    }
  }
}

/** Stable turn id shape: `turn_` + 12 lowercase hex. */
export function formatTurnId(entropy?: string): string {
  const hex = resolveEntropy(entropy, 12)
  return `turn_${hex}`
}

/** True when value matches the turn id shape. */
export function isTurnId(value: unknown): value is string {
  return typeof value === 'string' && /^turn_[0-9a-f]{12}$/.test(value)
}

/** True when value matches the tool span id shape. */
export function isToolSpanId(value: unknown): value is string {
  return typeof value === 'string' && /^tool_[0-9a-f]{8}_\d{4}$/.test(value)
}

function resolveEntropy(entropy: string | undefined, length: number): string {
  if (typeof entropy === 'string' && HEX_CHUNK.test(entropy) && entropy.length >= length) {
    return entropy.slice(0, length).toLowerCase()
  }
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
}

/** Sanitize to opaque id; always returns a string (fallback if unrecoverable). */
function requireOpaqueId(value: string, fallback: string): string {
  return tryOpaqueId(value) ?? fallback
}

/** Sanitize to opaque id or undefined when nothing safe remains. */
function tryOpaqueId(value: string): string | undefined {
  const trimmed = value.trim()
  if (OPAQUE_ID_RE.test(trimmed)) return trimmed
  // Collapse to a conservative token so free-text / paths never become correlation labels.
  const collapsed = trimmed
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128)
  if (OPAQUE_ID_RE.test(collapsed)) return collapsed
  return undefined
}
