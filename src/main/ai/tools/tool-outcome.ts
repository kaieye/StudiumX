/**
 * Typed tool call outcomes for the dispatcher path.
 *
 * Status is the source of truth. Callers must not infer failure from free-text
 * content (e.g. a string merely containing "error"). Legacy adapters may still
 * inspect structured handler JSON for backward-compatible `isError` flags.
 */

export type ToolEffectClass = 'read' | 'workspace_write' | 'external_write' | 'privileged'

export type ToolOutcomeStatus = 'succeeded' | 'failed' | 'cancelled' | 'denied' | 'timed_out'

/** Audit-safe correlation metadata only — no provider payloads or learner answers. */
export type ToolOutcomeCorrelation = Readonly<{
  toolCallId: string
  runId?: string
  operationId?: string
}>

export type ToolOutcomeError = Readonly<{
  code: string
  message: string
}>

type ToolOutcomeBase = Readonly<{
  toolCallId: string
  name: string
  effectClass: ToolEffectClass
  /** Deterministic id when runId is known; otherwise omitted. */
  operationId?: string
  correlation: ToolOutcomeCorrelation
  /** Model-facing tool result payload (JSON string or plain text). */
  content: string
}>

export type ToolOutcomeSucceeded<TOutput extends string = string> = ToolOutcomeBase &
  Readonly<{
    status: 'succeeded'
    content: TOutput
    isError: false
  }>

export type ToolOutcomeFailed = ToolOutcomeBase &
  Readonly<{
    status: 'failed'
    error: ToolOutcomeError
    isError: true
  }>

export type ToolOutcomeCancelled = ToolOutcomeBase &
  Readonly<{
    status: 'cancelled'
    error: ToolOutcomeError
    isError: true
  }>

export type ToolOutcomeDenied = ToolOutcomeBase &
  Readonly<{
    status: 'denied'
    error: ToolOutcomeError
    isError: true
  }>

export type ToolOutcomeTimedOut = ToolOutcomeBase &
  Readonly<{
    status: 'timed_out'
    error: ToolOutcomeError
    isError: true
  }>

export type ToolOutcome<TOutput extends string = string> =
  | ToolOutcomeSucceeded<TOutput>
  | ToolOutcomeFailed
  | ToolOutcomeCancelled
  | ToolOutcomeDenied
  | ToolOutcomeTimedOut

export function isToolOutcomeSuccess<TOutput extends string>(
  outcome: ToolOutcome<TOutput>
): outcome is ToolOutcomeSucceeded<TOutput> {
  return outcome.status === 'succeeded'
}

export function toolOutcomeIsError(outcome: ToolOutcome): boolean {
  return outcome.status !== 'succeeded'
}

export function buildToolOutcomeCorrelation(input: {
  toolCallId: string
  runId?: string
  operationId?: string
}): ToolOutcomeCorrelation {
  return {
    toolCallId: input.toolCallId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.operationId ? { operationId: input.operationId } : {})
  }
}
