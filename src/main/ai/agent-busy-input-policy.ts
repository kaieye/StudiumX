/**
 * Pure busy-input policy for agent runs.
 *
 * Maps a busy runtime phase + preferred action into interrupt | queue | steer
 * (or reject when the queue cannot accept more work). Defaults:
 * - busy + unspecified preference → queue
 * - write / privileged tool phases never allow steer inject
 * - stranded inputs always queue (never silently drop)
 * - steer is only legal at a safe turn boundary
 * - steer ≠ abort (interrupt is a separate action)
 *
 * This module has no I/O and does not touch AbortSignal / settlement.
 */
export type BusyInputAction = 'interrupt' | 'queue' | 'steer'

export type BusyInputKind = 'user_message' | 'follow_up' | 'steer' | 'stranded'

/**
 * Coarse run phase observed by the gateway / façade.
 * `turn_boundary` is the only phase that may accept steer injection.
 */
export type BusyInputPhase =
  | 'idle'
  | 'provider'
  | 'tool_batch'
  | 'write_tool'
  | 'privileged_tool'
  | 'turn_boundary'
  | 'canceling'

export type BusyInputDecisionAction = BusyInputAction | 'accept' | 'reject'

export type BusyInputPolicyInput = Readonly<{
  busy: boolean
  phase: BusyInputPhase
  /** Explicit user/UI preference when busy. Defaults to queue. */
  preferredAction?: BusyInputAction
  inputKind?: BusyInputKind
  queueAtCapacity?: boolean
  cancelRequested?: boolean
}>

export type BusyInputDecision = Readonly<{
  action: BusyInputDecisionAction
  reason: string
  /** True only when steer inject is safe for this phase. */
  steerAllowed: boolean
  /** True when the decision is interrupt (abort current run). Never true for steer/queue. */
  abortsRun: boolean
}>

export const DEFAULT_BUSY_INPUT_ACTION: BusyInputAction = 'queue'

const WRITE_LIKE_PHASES: ReadonlySet<BusyInputPhase> = new Set(['write_tool', 'privileged_tool'])

type QueuedInputKind = 'follow_up' | 'steer'

/**
 * Resolve how to handle an inbound message while a run may be busy.
 * Pure and deterministic — callers own queue mutation and AbortSignal.
 */
export function resolveBusyInputAction(input: BusyInputPolicyInput): BusyInputDecision {
  const inputKind = input.inputKind ?? 'user_message'
  const preferred = input.preferredAction ?? DEFAULT_BUSY_INPUT_ACTION
  const steerAllowed = input.busy && input.phase === 'turn_boundary'

  if (!input.busy && input.phase === 'idle') {
    return {
      action: 'accept',
      reason: 'run_idle',
      steerAllowed: false,
      abortsRun: false
    }
  }

  if (input.cancelRequested || input.phase === 'canceling') {
    // During cancel, never interrupt again and never steer; stranded work queues
    // only if capacity remains, otherwise reject so UI can surface busy-ack later.
    if (input.queueAtCapacity) {
      return {
        action: 'reject',
        reason: 'canceling_queue_full',
        steerAllowed: false,
        abortsRun: false
      }
    }
    return {
      action: 'queue',
      reason: 'canceling_stranded_queue',
      steerAllowed: false,
      abortsRun: false
    }
  }

  if (!input.busy) {
    return {
      action: 'accept',
      reason: 'not_busy',
      steerAllowed: false,
      abortsRun: false
    }
  }

  // Stranded inputs (e.g. failed steer inject after loop exit) always queue.
  if (inputKind === 'stranded') {
    if (input.queueAtCapacity) {
      return {
        action: 'reject',
        reason: 'stranded_queue_full',
        steerAllowed: false,
        abortsRun: false
      }
    }
    return {
      action: 'queue',
      reason: 'stranded_to_queue',
      steerAllowed: false,
      abortsRun: false
    }
  }

  // Write / privileged tool: never steer inject.
  if (WRITE_LIKE_PHASES.has(input.phase)) {
    if (preferred === 'interrupt') {
      return {
        action: 'interrupt',
        reason: 'busy_write_interrupt',
        steerAllowed: false,
        abortsRun: true
      }
    }
    if (input.queueAtCapacity) {
      return {
        action: 'reject',
        reason: 'busy_write_queue_full',
        steerAllowed: false,
        abortsRun: false
      }
    }
    return {
      action: 'queue',
      reason: 'busy_write_no_steer',
      steerAllowed: false,
      abortsRun: false
    }
  }

  if (preferred === 'steer') {
    if (steerAllowed) {
      return {
        action: 'steer',
        reason: 'safe_turn_boundary_steer',
        steerAllowed: true,
        abortsRun: false
      }
    }
    // Unsafe phase for steer → demote to queue (never silent drop, never abort).
    if (input.queueAtCapacity) {
      return {
        action: 'reject',
        reason: 'steer_demoted_queue_full',
        steerAllowed: false,
        abortsRun: false
      }
    }
    return {
      action: 'queue',
      reason: 'steer_demoted_to_queue',
      steerAllowed: false,
      abortsRun: false
    }
  }

  if (preferred === 'interrupt') {
    return {
      action: 'interrupt',
      reason: 'busy_interrupt',
      steerAllowed: false,
      abortsRun: true
    }
  }

  // Default busy path: queue.
  if (input.queueAtCapacity) {
    return {
      action: 'reject',
      reason: 'busy_queue_full',
      steerAllowed: false,
      abortsRun: false
    }
  }
  return {
    action: 'queue',
    reason: 'busy_default_queue',
    steerAllowed: false,
    abortsRun: false
  }
}

/**
 * Whether a drained queue entry of the given kind may be injected now.
 * Steer inject is restricted to turn_boundary and never equals abort.
 */
export function canInjectQueuedInput(phase: BusyInputPhase, kind: QueuedInputKind): boolean {
  if (WRITE_LIKE_PHASES.has(phase) || phase === 'canceling') return false
  if (kind === 'steer') return phase === 'turn_boundary'
  // follow_up drains after the run is idle / between turns, not mid-tool.
  return phase === 'idle' || phase === 'turn_boundary'
}
