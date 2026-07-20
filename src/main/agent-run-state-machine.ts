/**
 * Explicit Agent run state machine, separate from teaching SessionLedger.
 *
 * Durable checkpoint statuses (permission waits, conversation save, canceled, …)
 * project into this smaller surface. Correlation with LearningSession is by IDs
 * only — this module never reads or mutates SessionLedger state.
 */

import type { AgentRunCheckpointStatus } from './ai/agent-run-types'

export const AGENT_RUN_STATES = [
  'waiting',
  'running',
  'awaiting_user',
  'cancelling',
  'completed',
  'failed',
  'interrupted'
] as const

export type AgentRunState = (typeof AGENT_RUN_STATES)[number]

export type AgentRunTrigger =
  | { type: 'start' }
  | { type: 'await_user'; reason?: 'permission' | 'elicitation' | 'other' }
  | { type: 'resume' }
  | { type: 'request_cancel' }
  | { type: 'complete' }
  | { type: 'fail'; reason?: string }
  | { type: 'interrupt'; reason?: string }
  | { type: 'recover' }

/** Plan seam alias: transition(current, command|event). */
export type AgentRunCommand = AgentRunTrigger
export type AgentRunEvent = AgentRunTrigger

export type TransitionKind = 'applied' | 'idempotent' | 'illegal'

export type TransitionResult = {
  ok: boolean
  kind: TransitionKind
  from: AgentRunState
  to: AgentRunState
  trigger: AgentRunTrigger
  /** Present when kind is illegal; never used to silently coerce state. */
  reason?: string
}

/**
 * ID-only correlation with teaching Session / conversation. No ledger fields.
 */
export type AgentRunSessionCorrelation = {
  runId: string
  streamId?: string
  conversationId?: string
  learningSessionId?: string
}

const TERMINAL_STATES = new Set<AgentRunState>(['completed', 'failed', 'interrupted'])

/**
 * Explicit legal edges. Keys are `from|trigger`; value is the destination.
 * Same-state self-loops for cancel/recover terminals are handled as idempotent
 * outside this table so illegal moves stay visible.
 */
export const LEGAL_AGENT_RUN_EDGES: Readonly<Record<string, AgentRunState>> = Object.freeze({
  'waiting|start': 'running',
  'waiting|request_cancel': 'cancelling',

  'running|await_user': 'awaiting_user',
  'running|request_cancel': 'cancelling',
  'running|complete': 'completed',
  'running|fail': 'failed',
  'running|interrupt': 'interrupted',

  'awaiting_user|resume': 'running',
  'awaiting_user|request_cancel': 'cancelling',
  'awaiting_user|complete': 'completed',
  'awaiting_user|fail': 'failed',
  'awaiting_user|interrupt': 'interrupted',

  'cancelling|complete': 'completed',
  'cancelling|fail': 'failed',
  'cancelling|interrupt': 'interrupted',

  // After crash recovery the user may open a fresh run from waiting.
  'interrupted|recover': 'waiting'
})

export function isAgentRunState(value: unknown): value is AgentRunState {
  return typeof value === 'string' && (AGENT_RUN_STATES as readonly string[]).includes(value)
}

export function isTerminalAgentRunState(state: AgentRunState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isActiveAgentRunState(state: AgentRunState): boolean {
  return state === 'running' || state === 'awaiting_user' || state === 'cancelling'
}

/**
 * Pure transition. Illegal moves keep `to === from` and set kind to `illegal`
 * — callers must record the result; this function never auto-corrects state.
 */
export function transition(current: AgentRunState, trigger: AgentRunTrigger): TransitionResult {
  if (!isAgentRunState(current)) {
    const fallback: AgentRunState = 'waiting'
    return {
      ok: false,
      kind: 'illegal',
      from: fallback,
      to: fallback,
      trigger,
      reason: `Unknown agent run state: ${String(current)}`
    }
  }

  if (isIdempotentNoop(current, trigger)) {
    return {
      ok: true,
      kind: 'idempotent',
      from: current,
      to: current,
      trigger
    }
  }

  const next = LEGAL_AGENT_RUN_EDGES[`${current}|${trigger.type}`]
  if (!next) {
    return {
      ok: false,
      kind: 'illegal',
      from: current,
      to: current,
      trigger,
      reason: `Illegal agent run transition: ${current} --${trigger.type}--> (denied)`
    }
  }

  return {
    ok: true,
    kind: 'applied',
    from: current,
    to: next,
    trigger
  }
}

/**
 * Cancel helper: request cancel when active/waiting; finish to completed when
 * already cancelling; stay put when already terminal. Always idempotent on
 * repeated cancel of the same terminal state.
 */
export function cancelAgentRun(current: AgentRunState): TransitionResult {
  if (current === 'cancelling') {
    return transition(current, { type: 'complete' })
  }

  const requested = transition(current, { type: 'request_cancel' })
  if (!requested.ok || requested.kind === 'idempotent') return requested

  if (requested.to === 'cancelling') {
    // Convenience path: pure cancel helper settles cancel in one step so
    // callers that only need terminal cancel semantics stay thin.
    return {
      ok: true,
      kind: 'applied',
      from: current,
      to: 'completed',
      trigger: { type: 'request_cancel' }
    }
  }

  return requested
}

/**
 * Recovery helper used at process restart: mark in-flight runs interrupted.
 * Already interrupted / completed / failed stay put (idempotent). Waiting has
 * nothing to recover and is illegal rather than silently ignored.
 */
export function recoverAgentRun(current: AgentRunState): TransitionResult {
  if (current === 'interrupted' || current === 'completed' || current === 'failed') {
    return {
      ok: true,
      kind: 'idempotent',
      from: current,
      to: current,
      trigger: { type: 'interrupt' }
    }
  }

  if (current === 'waiting') {
    return {
      ok: false,
      kind: 'illegal',
      from: current,
      to: current,
      trigger: { type: 'interrupt' },
      reason: 'Illegal agent run transition: waiting --interrupt--> (denied)'
    }
  }

  return transition(current, { type: 'interrupt' })
}

/**
 * After an interrupted run is acknowledged, return to waiting so a new run
 * (correlated by IDs only) can start. Idempotent when already waiting.
 */
export function resumeAfterRecovery(current: AgentRunState): TransitionResult {
  if (current === 'waiting') {
    return {
      ok: true,
      kind: 'idempotent',
      from: current,
      to: current,
      trigger: { type: 'recover' }
    }
  }
  return transition(current, { type: 'recover' })
}

/** Map durable checkpoint status into the explicit run state surface. */
export function projectCheckpointStatusToRunState(status: AgentRunCheckpointStatus): AgentRunState {
  switch (status) {
    case 'running':
    case 'awaiting_conversation_save':
      return 'running'
    case 'waiting_for_permission':
    case 'waiting_for_elicitation':
      return 'awaiting_user'
    case 'completed':
    case 'canceled':
      // Durable "canceled" is a settled terminal; the SM uses completed after cancel.
      return 'completed'
    case 'failed':
      return 'failed'
    case 'interrupted':
      return 'interrupted'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

/**
 * Suggest durable checkpoint statuses that correspond to a run state.
 * Callers choose among active wait variants; this never invents Session state.
 */
export function projectRunStateToCheckpointStatuses(
  state: AgentRunState
): readonly AgentRunCheckpointStatus[] {
  switch (state) {
    case 'waiting':
      // No durable checkpoint until the run starts.
      return []
    case 'running':
      return ['running', 'awaiting_conversation_save']
    case 'awaiting_user':
      return ['waiting_for_permission', 'waiting_for_elicitation']
    case 'cancelling':
      // In-flight cancel is not yet a durable terminal; keep prior active until settle.
      return ['running', 'waiting_for_permission', 'waiting_for_elicitation', 'awaiting_conversation_save']
    case 'completed':
      return ['completed', 'canceled']
    case 'failed':
      return ['failed']
    case 'interrupted':
      return ['interrupted']
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

/**
 * Thin facade matching the plan seam: AgentRunStateMachine.transition(...).
 * Pure — no I/O, no SessionLedger.
 */
export class AgentRunStateMachine {
  transition(current: AgentRunState, trigger: AgentRunTrigger | AgentRunCommand | AgentRunEvent): TransitionResult {
    return transition(current, trigger)
  }

  cancel(current: AgentRunState): TransitionResult {
    return cancelAgentRun(current)
  }

  recover(current: AgentRunState): TransitionResult {
    return recoverAgentRun(current)
  }

  resumeAfterRecovery(current: AgentRunState): TransitionResult {
    return resumeAfterRecovery(current)
  }

  projectCheckpoint(status: AgentRunCheckpointStatus): AgentRunState {
    return projectCheckpointStatusToRunState(status)
  }
}

export function createAgentRunStateMachine(): AgentRunStateMachine {
  return new AgentRunStateMachine()
}

function isIdempotentNoop(current: AgentRunState, trigger: AgentRunTrigger): boolean {
  if (trigger.type === 'request_cancel') {
    return current === 'cancelling' || isTerminalAgentRunState(current)
  }
  if (trigger.type === 'interrupt') {
    return current === 'interrupted'
  }
  if (trigger.type === 'recover') {
    return current === 'waiting'
  }
  if (trigger.type === 'complete') {
    return current === 'completed'
  }
  if (trigger.type === 'fail') {
    return current === 'failed'
  }
  return false
}
