/**
 * Hybrid tool-batch dispatch for the agent loop.
 *
 * Contiguous pure-read runs execute via dispatchReadToolsInParallel.
 * workspace_write / external_write / privileged / unknown run one-by-one
 * through executeToolCall. Original call order is preserved for outcomes.
 *
 * Never parallelizes non-read effects. Effect-policy / permission gates stay
 * inside ToolDispatcher / executeToolCall.
 */

import type { ToolCall } from '../provider-adapter'
import type { AgentRunBudgetStopReason } from '../../../shared/teaching-types'
import type { ToolCallContext, ToolHandlerMap, ToolRuntimeEvent } from './registry'
import { classifyToolEffect } from './effect-policy'
import {
  dispatchReadToolsInParallel,
  DEFAULT_PARALLEL_READ_CONCURRENCY
} from './parallel-read-dispatcher'
import {
  executeToolCall,
  toolOutcomeToExecutionResult,
  type ToolExecutionResult
} from './execution'

export type ToolBatchCallContext = Readonly<{
  emit?: (event: ToolRuntimeEvent) => void
  signal?: AbortSignal
  runId?: string
}>

export type ToolBatchControl = Readonly<{
  isCanceled: () => boolean
  budgetStop: () => AgentRunBudgetStopReason | undefined
  startToolCall: () => void
  recordToolError: () => void
  isDurationExhausted?: () => boolean
  onToolCall?: (call: ToolCall) => void
  /**
   * Optional per-call gate (recovery allow-list). Return `'execute'` to run the
   * tool, or `{ skip }` to record a synthetic result without invoking the handler.
   * Skipped calls still count against the tool budget when admitted.
   */
  resolveCall?: (call: ToolCall) => 'execute' | { skip: ToolExecutionResult }
  /** Parallel read concurrency (clamped by the dispatcher). Default 4. */
  concurrency?: number
}>

export type ToolBatchResult = Readonly<{
  results: ToolExecutionResult[]
  exhausted?: AgentRunBudgetStopReason
  canceled?: boolean
  durationExhausted?: boolean
}>

type BatchSegment =
  | { kind: 'read'; calls: ToolCall[] }
  | { kind: 'serial'; call: ToolCall }

type AdmittedSlot =
  | { mode: 'execute'; call: ToolCall }
  | { mode: 'skip'; call: ToolCall; result: ToolExecutionResult }

/**
 * Execute a model tool-call batch with hybrid scheduling:
 * contiguous pure-`read` runs → parallel; everything else → serial.
 * Stops early on cancel / tool budget / duration exhaustion (same semantics as
 * the former serial for-loop in agent-loop).
 */
export async function executeToolBatch(
  toolCalls: readonly ToolCall[],
  toolHandlers: ToolHandlerMap,
  callCtx: ToolBatchCallContext | undefined,
  control: ToolBatchControl
): Promise<ToolBatchResult> {
  if (toolCalls.length === 0) {
    return { results: [] }
  }

  const results: ToolExecutionResult[] = []
  const segments = partitionToolCalls(toolCalls)

  for (const segment of segments) {
    if (control.isCanceled()) {
      return { results, canceled: true }
    }
    if (control.isDurationExhausted?.()) {
      return { results, durationExhausted: true }
    }

    if (segment.kind === 'read') {
      const partial = await executeReadSegment(segment.calls, toolHandlers, callCtx, control)
      results.push(...partial.results)
      if (partial.canceled) return { results, canceled: true }
      if (partial.durationExhausted) return { results, durationExhausted: true }
      if (partial.exhausted) return { results, exhausted: partial.exhausted }
      continue
    }

    const partial = await executeSerialCall(segment.call, toolHandlers, callCtx, control)
    if (partial.skippedAdmission) {
      if (partial.canceled) return { results, canceled: true }
      if (partial.durationExhausted) return { results, durationExhausted: true }
      if (partial.exhausted) return { results, exhausted: partial.exhausted }
      return { results }
    }
    if (partial.result) results.push(partial.result)
    if (partial.canceled) return { results, canceled: true }
    if (partial.durationExhausted) return { results, durationExhausted: true }
    if (partial.exhausted) return { results, exhausted: partial.exhausted }
  }

  return { results }
}

/**
 * Split toolCalls into contiguous pure-read runs and single non-read slots,
 * preserving original order.
 */
export function partitionToolCalls(toolCalls: readonly ToolCall[]): BatchSegment[] {
  const segments: BatchSegment[] = []
  let readRun: ToolCall[] = []

  const flushReads = (): void => {
    if (readRun.length === 0) return
    segments.push({ kind: 'read', calls: readRun })
    readRun = []
  }

  for (const call of toolCalls) {
    if (classifyToolEffect(call.function.name) === 'read') {
      readRun.push(call)
      continue
    }
    flushReads()
    segments.push({ kind: 'serial', call })
  }
  flushReads()
  return segments
}

async function executeReadSegment(
  calls: readonly ToolCall[],
  toolHandlers: ToolHandlerMap,
  callCtx: ToolBatchCallContext | undefined,
  control: ToolBatchControl
): Promise<ToolBatchResult> {
  const slots: AdmittedSlot[] = []
  let stopReason: AgentRunBudgetStopReason | undefined
  let canceledDuringAdmit = false
  let durationDuringAdmit = false

  for (const call of calls) {
    if (control.isCanceled()) {
      canceledDuringAdmit = true
      break
    }
    if (control.isDurationExhausted?.()) {
      durationDuringAdmit = true
      break
    }
    const toolStop = control.budgetStop()
    if (toolStop) {
      stopReason = toolStop
      break
    }

    control.startToolCall()
    control.onToolCall?.(call)

    const resolution = control.resolveCall?.(call) ?? 'execute'
    if (resolution !== 'execute') {
      if (resolution.skip.isError) control.recordToolError()
      slots.push({ mode: 'skip', call, result: resolution.skip })
      continue
    }
    slots.push({ mode: 'execute', call })
  }

  const runnable = slots.filter(
    (slot): slot is { mode: 'execute'; call: ToolCall } => slot.mode === 'execute'
  )

  let executedResults: ToolExecutionResult[] = []
  if (runnable.length > 0) {
    const outcomes = await dispatchReadToolsInParallel(
      toolHandlers,
      runnable.map((slot) => slot.call),
      {
        toolCallId: runnable[0].call.id,
        toolName: runnable[0].call.function.name,
        ...(callCtx?.emit ? { emit: callCtx.emit } : {}),
        ...(callCtx?.signal ? { signal: callCtx.signal } : {}),
        ...(callCtx?.runId ? { runId: callCtx.runId } : {})
      } satisfies ToolCallContext,
      {
        concurrency: control.concurrency ?? DEFAULT_PARALLEL_READ_CONCURRENCY
      }
    )
    executedResults = outcomes.map((outcome) => toolOutcomeToExecutionResult(outcome))
    for (const result of executedResults) {
      if (result.isError) control.recordToolError()
    }
  }

  const results = materializeReadSlots(slots, executedResults)

  if (canceledDuringAdmit || control.isCanceled()) {
    return { results, canceled: true }
  }
  if (durationDuringAdmit || control.isDurationExhausted?.()) {
    return { results, durationExhausted: true }
  }
  if (stopReason) {
    return { results, exhausted: stopReason }
  }
  return { results }
}

function materializeReadSlots(
  slots: readonly AdmittedSlot[],
  executedResults: readonly ToolExecutionResult[]
): ToolExecutionResult[] {
  const out: ToolExecutionResult[] = []
  let executeIndex = 0
  for (const slot of slots) {
    if (slot.mode === 'skip') {
      out.push(slot.result)
      continue
    }
    const result = executedResults[executeIndex]
    executeIndex += 1
    if (result) {
      out.push(result)
      continue
    }
    // Fail closed if a parallel slot somehow vanished after admission.
    out.push({
      toolCallId: slot.call.id,
      name: slot.call.function.name,
      content: JSON.stringify({
        error: 'parallel_read_slot_missing',
        message: '并行只读调度未能产生结果，已安全拒绝。'
      }),
      isError: true
    })
  }
  return out
}

async function executeSerialCall(
  call: ToolCall,
  toolHandlers: ToolHandlerMap,
  callCtx: ToolBatchCallContext | undefined,
  control: ToolBatchControl
): Promise<{
  result?: ToolExecutionResult
  exhausted?: AgentRunBudgetStopReason
  canceled?: boolean
  durationExhausted?: boolean
  skippedAdmission?: boolean
}> {
  if (control.isCanceled()) {
    return { canceled: true, skippedAdmission: true }
  }
  if (control.isDurationExhausted?.()) {
    return { durationExhausted: true, skippedAdmission: true }
  }
  const toolStop = control.budgetStop()
  if (toolStop) {
    return { exhausted: toolStop, skippedAdmission: true }
  }

  control.startToolCall()
  control.onToolCall?.(call)

  const resolution = control.resolveCall?.(call) ?? 'execute'
  let result: ToolExecutionResult
  if (resolution === 'execute') {
    result = await executeToolCall(toolHandlers, call, {
      toolCallId: call.id,
      toolName: call.function.name,
      ...(callCtx?.emit ? { emit: callCtx.emit } : {}),
      ...(callCtx?.signal ? { signal: callCtx.signal } : {}),
      ...(callCtx?.runId ? { runId: callCtx.runId } : {})
    })
  } else {
    result = resolution.skip
  }

  if (result.isError) control.recordToolError()

  if (control.isCanceled()) {
    return { result, canceled: true }
  }
  if (control.isDurationExhausted?.()) {
    return { result, durationExhausted: true }
  }
  return { result }
}
