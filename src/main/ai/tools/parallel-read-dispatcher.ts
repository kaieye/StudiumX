/**
 * Conservative parallel dispatch for pure-read tools only.
 *
 * Mixed batches fail open for reads and fail closed for non-reads:
 * workspace_write / external_write / privileged calls are denied without
 * running, while pure-read calls still execute under bounded concurrency.
 *
 * Concurrent same-path pure reads are allowed. Any non-read in the batch is
 * never executed.
 */

import type { ToolCall } from '../provider-adapter'
import { agentOperationId } from '../agent-run-types'
import { ToolDispatcher, type ToolDispatcherOptions } from './dispatcher'
import { classifyToolEffect } from './effect-policy'
import type { ToolCallContext, ToolHandlerMap } from './registry'
import { TOOL_CANCELED_MESSAGE } from './tool-arguments'
import {
  buildToolOutcomeCorrelation,
  type ToolEffectClass,
  type ToolOutcome,
  type ToolOutcomeError
} from './tool-outcome'
import { toPosixWorkspacePath } from './workspace-path-target'

export const DEFAULT_PARALLEL_READ_CONCURRENCY = 4
export const MAX_PARALLEL_READ_CONCURRENCY = 8

export type ParallelReadDispatchOptions = Readonly<{
  /** Bounded concurrency for pure-read calls. Default 4, clamped to [1, 8]. */
  concurrency?: number
  /** Optional effect-class allow-list for this dispatch scope. */
  allowedEffects?: readonly ToolEffectClass[]
  /** Optional tool-name allow predicate (capability / projection policy). */
  allowsTool?: (toolName: string) => boolean
  /**
   * Optional audit hook after outcome is produced (metadata only).
   * Must not log secrets, raw learner answers, or provider payloads.
   *
   * When `source` is already a ToolDispatcher that carries its own onOutcome,
   * that hook remains authoritative for executed calls; this option is used for
   * pre-denied non-read outcomes and when constructing a dispatcher from handlers.
   */
  onOutcome?: (outcome: ToolOutcome) => void
}>

export type ParallelReadDispatchSource =
  | ToolDispatcher
  | ToolHandlerMap
  | (ToolDispatcherOptions & { handlers: ToolHandlerMap })

/**
 * Dispatch a batch of tool calls with conservative parallel execution for
 * pure-read tools only. Non-read tools receive denied outcomes and never run.
 * Outcomes are returned in the same order as `calls`.
 */
export async function dispatchReadToolsInParallel(
  source: ParallelReadDispatchSource,
  calls: readonly ToolCall[],
  callCtx?: ToolCallContext,
  options?: ParallelReadDispatchOptions
): Promise<ToolOutcome[]> {
  if (calls.length === 0) return []

  const dispatcher = resolveDispatcher(source, options)
  const concurrency = clampConcurrency(options?.concurrency)
  const outcomes: Array<ToolOutcome | undefined> = new Array(calls.length)
  const runnable: Array<{ index: number; call: ToolCall }> = []

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]
    const denial = precheckCall(call, callCtx)
    if (denial) {
      // Pre-denied outcomes never enter ToolDispatcher; fire options hook once.
      options?.onOutcome?.(denial)
      outcomes[index] = denial
      continue
    }
    runnable.push({ index, call })
  }

  if (runnable.length > 0) {
    await mapWithConcurrency(runnable, concurrency, async (item) => {
      // ToolDispatcher invokes onOutcome for executed paths when wired.
      const outcome = await dispatcher.dispatch(item.call, {
        toolCallId: item.call.id,
        toolName: item.call.function.name,
        ...(callCtx?.emit ? { emit: callCtx.emit } : {}),
        ...(callCtx?.signal ? { signal: callCtx.signal } : {}),
        ...(callCtx?.runId ? { runId: callCtx.runId } : {})
      })
      outcomes[item.index] = outcome
    })
  }

  return outcomes.map((outcome, index) => {
    if (outcome) return outcome
    return buildTerminalOutcome(calls[index], callCtx, 'denied', {
      code: 'parallel_read_slot_missing',
      message: '并行只读调度未能产生结果，已安全拒绝。'
    })
  })
}

/**
 * Extract normalized relative path/glob targets from tool-call arguments when
 * present. Concurrent same-path pure reads are intentionally allowed; this
 * helper supports diagnostics and future lock coordination.
 */
export function extractReadPathTargets(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return []
  const record = args as Record<string, unknown>
  const keys = ['path', 'glob', 'target', 'targetPath', 'file', 'directory'] as const
  const out: string[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const normalized = normalizeReadTarget(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/**
 * True when two pure-read target lists share a normalized path.
 * Concurrent same-path reads are OK; non-read calls never reach this check.
 */
export function readTargetsOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const setB = new Set(b)
  return a.some((item) => setB.has(item))
}

function precheckCall(call: ToolCall, callCtx: ToolCallContext | undefined): ToolOutcome | null {
  const name = call.function.name

  if (callCtx?.signal?.aborted) {
    return buildTerminalOutcome(call, callCtx, 'cancelled', {
      code: 'tool_canceled',
      message: TOOL_CANCELED_MESSAGE
    })
  }

  const effectClass = classifyToolEffect(name)
  if (effectClass !== 'read') {
    return buildTerminalOutcome(call, callCtx, 'denied', {
      code: 'parallel_read_only',
      message: `并行只读调度拒绝非 read 工具 ${name}（effect=${effectClass}）。`
    })
  }

  return null
}

function resolveDispatcher(
  source: ParallelReadDispatchSource,
  options?: ParallelReadDispatchOptions
): ToolDispatcher {
  if (source instanceof ToolDispatcher) {
    return source
  }

  if (isHandlerMap(source)) {
    return new ToolDispatcher({
      handlers: source,
      ...(options?.allowedEffects ? { allowedEffects: options.allowedEffects } : {}),
      ...(options?.allowsTool ? { allowsTool: options.allowsTool } : {}),
      ...(options?.onOutcome ? { onOutcome: options.onOutcome } : {})
    })
  }

  return new ToolDispatcher({
    handlers: source.handlers,
    allowedEffects: options?.allowedEffects ?? source.allowedEffects,
    allowsTool: options?.allowsTool ?? source.allowsTool,
    onOutcome: options?.onOutcome ?? source.onOutcome
  })
}

function isHandlerMap(value: ParallelReadDispatchSource): value is ToolHandlerMap {
  return typeof value === 'object' && value !== null && !('handlers' in value)
}

function clampConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_PARALLEL_READ_CONCURRENCY
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_PARALLEL_READ_CONCURRENCY) return MAX_PARALLEL_READ_CONCURRENCY
  return n
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let next = 0
  const workerCount = Math.min(concurrency, items.length)
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = next
      next += 1
      if (current >= items.length) return
      await worker(items[current])
    }
  })
  await Promise.all(runners)
}

function buildTerminalOutcome(
  call: ToolCall,
  callCtx: ToolCallContext | undefined,
  status: 'denied' | 'cancelled',
  error: ToolOutcomeError
): ToolOutcome {
  const name = call.function.name
  const toolCallId = call.id
  const effectClass = classifyToolEffect(name)
  const operationId = resolveOperationId(callCtx?.runId, toolCallId)
  const correlation = buildToolOutcomeCorrelation({
    toolCallId,
    runId: callCtx?.runId,
    operationId
  })
  return {
    toolCallId,
    name,
    effectClass,
    ...(operationId ? { operationId } : {}),
    correlation,
    status,
    content: JSON.stringify({ error: error.message, code: error.code }),
    error,
    isError: true
  }
}

function resolveOperationId(runId: string | undefined, toolCallId: string): string | undefined {
  if (!runId?.trim() || !toolCallId.trim()) return undefined
  try {
    return agentOperationId(runId, toolCallId)
  } catch {
    return undefined
  }
}

function normalizeReadTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const posix = toPosixWorkspacePath(trimmed).replace(/^\.\/+/, '')
  if (!posix || posix === '.') return '.'
  return posix.replace(/\/+$/, '') || '.'
}
