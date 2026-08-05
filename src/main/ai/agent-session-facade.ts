/**
 * Stateful façade for one live agent session / run context (B-02).
 *
 * Deep module boundary:
 * - Owns busy policy application, follow-up/steer FIFO, abort + cancel clear,
 *   and safe-boundary drain. Callers inject the actual loop / stream runner.
 * - Does **not** reimplement `runAgentLoop`, settlement, or Electron IPC.
 * - Does **not** replace TeachingSessionProtocol (ADR-0040) — that remains the
 *   higher-level teaching session contract; this façade is the run-scoped
 *   input/busy surface that completes B-01 drain wiring (ADR-0055).
 *
 * Child runs: {@link AgentSessionFacade.createChildFacade} allocates a **new**
 * queue by default so parent steering never leaks into children.
 */

import {
  AgentInputQueue,
  type AgentInputEnqueueFailure,
  type AgentInputKind,
  type AgentQueuedInput
} from './agent-input-queue'
import {
  canInjectQueuedInput,
  resolveBusyInputAction,
  type BusyInputAction,
  type BusyInputPhase
} from './agent-busy-input-policy'
import {
  projectAgentSessionQueue,
  type AgentSessionQueueProjection,
  type ProjectAgentSessionQueueOptions
} from './agent-session-queue-projection'
import type {
  AgentResourceTerminalStatus,
  AgentRunUsageAggregate,
  AgentTerminalReason
} from '../../shared/teaching-types'

/** Defeats method-local CFA: host may call abort()/setPhase while executeRun awaits. */
function isCancelingPhase(phase: BusyInputPhase): boolean {
  return phase === 'canceling'
}

export type AgentSessionFacadeSnapshot = {
  busy: boolean
  phase: BusyInputPhase
  queueDepth: number
  queueCapacity: number
  streamId?: string
  runId?: string
  conversationId?: string
}

export type AgentSessionInput = {
  text: string
  expectedRevision?: number
  conversationId?: string
  /** Explicit busy preference; default is queue (never YOLO). */
  preferredAction?: BusyInputAction
}

export type AgentSessionPromptResult =
  | {
      ok: true
      disposition: 'accepted' | 'queued' | 'steered'
      reason: string
      entry?: AgentQueuedInput
      depth?: number
      run?: AgentSessionRunResult
    }
  | {
      ok: false
      disposition: 'rejected' | 'interrupt_pending'
      reason: string
      depth: number
      enqueueReason?: AgentInputEnqueueFailure['reason']
    }

export type AgentSessionRunResult = {
  runId?: string
  streamId?: string
  conversationId?: string
  finalText?: string
  canceled?: boolean
  error?: string
  /** Resource terminals are not successful completion and require explicit continuation. */
  resourceStopped?: true
  status?: AgentResourceTerminalStatus
  message?: string
  stopReason?: AgentTerminalReason
  usage?: AgentRunUsageAggregate
}

/**
 * Injected turn runner. Facade never imports provider / Electron code.
 * Implementations typically call `runAgentLoop` or the teaching conversation stream.
 */
export type AgentSessionRunInvoker = (input: {
  text: string
  kind: AgentInputKind | 'prompt'
  conversationId?: string
  expectedRevision?: number
  signal: AbortSignal
  streamId?: string
  runId?: string
}) => Promise<AgentSessionRunResult>

export type AgentSessionFacadeOptions = {
  queue?: AgentInputQueue
  /** Factory for child façades / reopen cycles. Defaults to a fresh queue. */
  createQueue?: () => AgentInputQueue
  run?: AgentSessionRunInvoker
  createAbortController?: () => AbortController
  streamId?: string
  runId?: string
  conversationId?: string
  /**
   * When true (default), finishing a turn drains queued follow-ups (and steers
   * only when `canInjectQueuedInput` allows) FIFO as sequential turns.
   */
  autoDrain?: boolean
}

const DEFAULT_RUN_INVOKER: AgentSessionRunInvoker = async () => ({})

/**
 * One session-scoped busy/input façade. Process-local and single-threaded-safe
 * under the same assumptions as {@link AgentInputQueue}.
 */
export class AgentSessionFacade {
  private readonly queue: AgentInputQueue
  private readonly createQueue: () => AgentInputQueue
  private readonly runInvoker: AgentSessionRunInvoker
  private readonly createAbortController: () => AbortController
  private readonly autoDrain: boolean

  private phase: BusyInputPhase = 'idle'
  private busy = false
  private streamId?: string
  private runId?: string
  private conversationId?: string
  private activeController: AbortController | null = null
  private runChain: Promise<void> = Promise.resolve()
  private drainInFlight = false

  constructor(options: AgentSessionFacadeOptions = {}) {
    this.createQueue = options.createQueue ?? (() => new AgentInputQueue())
    this.queue = options.queue ?? this.createQueue()
    this.runInvoker = options.run ?? DEFAULT_RUN_INVOKER
    this.createAbortController = options.createAbortController ?? (() => new AbortController())
    this.autoDrain = options.autoDrain !== false
    this.streamId = options.streamId
    this.runId = options.runId
    this.conversationId = options.conversationId
  }

  /**
   * Child runs must **not** share the parent steering queue by default.
   * Returns a new façade with a fresh queue and the same invoker factory.
   */
  createChildFacade(overrides: Partial<AgentSessionFacadeOptions> = {}): AgentSessionFacade {
    const {
      queue: overrideQueue,
      createQueue: overrideCreateQueue,
      run: overrideRun,
      createAbortController: overrideAbort,
      autoDrain: overrideAutoDrain,
      streamId,
      runId,
      conversationId,
      ...rest
    } = overrides

    const createQueue = overrideCreateQueue ?? this.createQueue
    // Isolation: never inherit parent.queue unless the caller passes one explicitly.
    const queue = overrideQueue ?? createQueue()

    return new AgentSessionFacade({
      ...rest,
      createQueue,
      queue,
      run: overrideRun ?? this.runInvoker,
      createAbortController: overrideAbort ?? this.createAbortController,
      autoDrain: overrideAutoDrain ?? this.autoDrain,
      streamId,
      runId,
      conversationId: conversationId ?? this.conversationId
    })
  }

  snapshot(): AgentSessionFacadeSnapshot {
    return {
      busy: this.busy,
      phase: this.phase,
      queueDepth: this.queue.size(),
      queueCapacity: this.queue.capacity,
      ...(this.streamId !== undefined ? { streamId: this.streamId } : {}),
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      ...(this.conversationId !== undefined ? { conversationId: this.conversationId } : {})
    }
  }


  /**
   * Thin projection of session + queue for future renderer sync (B-02 residual).
   * Pure mapper; does not drain, mutate, or flip autoDrain. Product path remains
   * autoDrain false (ADR-0082 / ADR-0089).
   */
  projectQueue(
    options: Omit<ProjectAgentSessionQueueOptions, 'autoDrain' | 'closed'> = {}
  ): AgentSessionQueueProjection {
    return projectAgentSessionQueue(this.snapshot(), this.queue.snapshot(), {
      ...options,
      autoDrain: this.autoDrain,
      closed: this.queue.isClosed()
    })
  }
  /** Host/loop reports coarse phase so drain and policy stay accurate. */
  setPhase(phase: BusyInputPhase): void {
    this.phase = phase
    if (phase === 'idle' && !this.activeController) {
      this.busy = false
    } else if (phase === 'canceling') {
      this.busy = true
    } else if (phase !== 'idle') {
      this.busy = true
    }
  }

  bindIdentity(ids: { streamId?: string; runId?: string; conversationId?: string }): void {
    if (ids.streamId !== undefined) this.streamId = ids.streamId
    if (ids.runId !== undefined) this.runId = ids.runId
    if (ids.conversationId !== undefined) this.conversationId = ids.conversationId
  }

  /**
   * Primary user prompt. Idle → accept + run. Busy → default queue (policy).
   * Interrupt preference aborts the current run; the new prompt is not auto-started.
   */
  async prompt(input: AgentSessionInput): Promise<AgentSessionPromptResult> {
    return this.handleInbound(input, 'user_message', 'prompt')
  }

  /**
   * Follow-up while busy: routes through policy with follow_up kind (default queue).
   * When idle, accepted as a normal turn.
   */
  async followUp(input: AgentSessionInput): Promise<AgentSessionPromptResult> {
    return this.handleInbound(input, 'follow_up', 'follow_up')
  }

  /**
   * Steer ≠ abort. Only injects at a safe turn boundary; otherwise demotes to
   * queue (never silent drop, never aborts the run).
   */
  async steer(input: AgentSessionInput): Promise<AgentSessionPromptResult> {
    return this.handleInbound(
      { ...input, preferredAction: input.preferredAction ?? 'steer' },
      'steer',
      'steer'
    )
  }

  /**
   * Abort the active run and clear the queue via `clearOnCancel`.
   * Reopens the queue so a subsequent idle prompt can enqueue again.
   */
  abort(reason = 'user_abort'): void {
    this.phase = 'canceling'
    this.busy = true
    const controller = this.activeController
    this.activeController = null
    if (controller && !controller.signal.aborted) {
      controller.abort()
    }
    this.queue.clearOnCancel(reason)
    // New run on same conversation may enqueue after cancel cycle.
    this.queue.reopen()
    this.busy = false
    this.phase = 'idle'
  }

  /**
   * Drain queued inputs at a safe boundary. FIFO. Steers inject only when
   * `canInjectQueuedInput` allows; unsafe head entries stop the drain (left
   * in place) so order is preserved.
   */
  async drain(max: number = Number.MAX_SAFE_INTEGER): Promise<AgentQueuedInput[]> {
    if (this.drainInFlight) return []
    this.drainInFlight = true
    const drained: AgentQueuedInput[] = []
    try {
      const limit =
        Number.isFinite(max) && Number.isSafeInteger(max) ? Math.max(0, max) : Number.MAX_SAFE_INTEGER

      // Drain runs at a safe boundary: promote idle → turn_boundary so steers
      // may inject; follow_ups are allowed at both idle and turn_boundary.
      if (this.phase === 'idle' || this.phase === 'turn_boundary') {
        this.phase = 'turn_boundary'
      }

      while (drained.length < limit) {
        if (this.busy && this.activeController) {
          // A run started by a previous drained item is still live; stop and
          // let auto-drain resume after that turn completes.
          break
        }
        // Re-assert safe boundary between sequential drained turns.
        if (!this.busy) {
          this.phase = 'turn_boundary'
        }
        const head = this.queue.peek()
        if (!head) break
        if (!canInjectQueuedInput(this.phase, head.kind)) {
          break
        }
        const entry = this.queue.dequeue()
        if (!entry) break
        drained.push(entry)

        await this.startRun({
          text: entry.text,
          kind: entry.kind,
          conversationId: entry.conversationId ?? this.conversationId,
          expectedRevision: entry.expectedRevision
        })
      }
      return drained
    } finally {
      this.drainInFlight = false
      if (!this.busy && this.phase === 'turn_boundary') {
        this.phase = 'idle'
      }
    }
  }

  /** Expose queue for registry wiring / tests without free-form mutation APIs. */
  getQueue(): AgentInputQueue {
    return this.queue
  }

  private async handleInbound(
    input: AgentSessionInput,
    inputKind: 'user_message' | 'follow_up' | 'steer' | 'stranded',
    runKind: AgentInputKind | 'prompt'
  ): Promise<AgentSessionPromptResult> {
    const text = input.text.trim()
    if (!text) {
      return { ok: false, disposition: 'rejected', reason: 'empty_text', depth: this.queue.size() }
    }

    if (input.conversationId !== undefined) {
      this.conversationId = input.conversationId
    }

    const decision = resolveBusyInputAction({
      busy: this.busy,
      phase: this.phase,
      preferredAction: input.preferredAction,
      inputKind,
      queueAtCapacity: this.queue.isFull(),
      cancelRequested: this.phase === 'canceling'
    })

    if (decision.action === 'accept') {
      const run = await this.startRun({
        text,
        kind: runKind,
        conversationId: input.conversationId ?? this.conversationId,
        expectedRevision: input.expectedRevision
      })
      return {
        ok: true,
        disposition: 'accepted',
        reason: decision.reason,
        run
      }
    }

    if (decision.action === 'interrupt') {
      this.abort('busy_interrupt')
      return {
        ok: false,
        disposition: 'interrupt_pending',
        reason: decision.reason,
        depth: this.queue.size()
      }
    }

    if (decision.action === 'steer') {
      // Safe boundary inject — do not abort; invoke as steer kind.
      const run = await this.startRun({
        text,
        kind: 'steer',
        conversationId: input.conversationId ?? this.conversationId,
        expectedRevision: input.expectedRevision
      })
      return {
        ok: true,
        disposition: 'steered',
        reason: decision.reason,
        run
      }
    }

    if (decision.action === 'reject') {
      return {
        ok: false,
        disposition: 'rejected',
        reason: decision.reason,
        depth: this.queue.size()
      }
    }

    // queue
    const kind: AgentInputKind =
      inputKind === 'steer' || runKind === 'steer' ? 'steer' : 'follow_up'
    const enqueued = this.queue.enqueue({
      text,
      kind,
      conversationId: input.conversationId ?? this.conversationId,
      expectedRevision: input.expectedRevision
    })
    if (!enqueued.ok) {
      return {
        ok: false,
        disposition: 'rejected',
        reason: decision.reason,
        depth: enqueued.depth,
        enqueueReason: enqueued.reason
      }
    }
    return {
      ok: true,
      disposition: 'queued',
      reason: decision.reason,
      entry: enqueued.entry,
      depth: enqueued.depth
    }
  }

  private async startRun(input: {
    text: string
    kind: AgentInputKind | 'prompt'
    conversationId?: string
    expectedRevision?: number
  }): Promise<AgentSessionRunResult> {
    // Serialize runs on this façade so drain FIFO cannot overlap.
    const runPromise = this.runChain.then(() => this.executeRun(input))
    this.runChain = runPromise.then(
      () => undefined,
      () => undefined
    )
    return runPromise
  }

  private async executeRun(input: {
    text: string
    kind: AgentInputKind | 'prompt'
    conversationId?: string
    expectedRevision?: number
  }): Promise<AgentSessionRunResult> {
    const controller = this.createAbortController()
    this.activeController = controller
    this.busy = true
    this.phase = 'provider'

    let result: AgentSessionRunResult = {}
    try {
      result = await this.runInvoker({
        text: input.text,
        kind: input.kind,
        conversationId: input.conversationId,
        expectedRevision: input.expectedRevision,
        signal: controller.signal,
        streamId: this.streamId,
        runId: this.runId
      })
      if (result.streamId) this.streamId = result.streamId
      if (result.runId) this.runId = result.runId
      if (result.conversationId) this.conversationId = result.conversationId
      return result
    } catch (error) {
      if (controller.signal.aborted) {
        return { ...result, canceled: true }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { ...result, error: message }
    } finally {
      const wasAborted = controller.signal.aborted
      if (this.activeController === controller) {
        this.activeController = null
      }
      // this.phase was set to 'provider' above; TS CFA would treat === 'canceling'
      // as impossible. Concurrent abort()/setPhase can still land canceling.
      if (wasAborted || isCancelingPhase(this.phase)) {
        this.busy = false
        this.phase = 'idle'
      } else {
        // Safe boundary after turn completion.
        this.busy = false
        this.phase = 'turn_boundary'
        if (this.autoDrain && !this.queue.isEmpty() && !this.drainInFlight) {
          // Schedule drain after this turn settles; do not await inside finally
          // (would deadlock on runChain). Floating promise is intentional.
          void this.drain()
        } else if (!this.drainInFlight) {
          // Outer drain owns the boundary phase while it is in flight.
          this.phase = 'idle'
        }
      }
    }
  }
}

/**
 * Optional process-scoped registry so gateway cancel can abort a façade by
 * streamId without importing Electron into the façade module.
 */
export class AgentSessionFacadeRegistry {
  private readonly facades = new Map<string, AgentSessionFacade>()

  attach(streamId: string, facade: AgentSessionFacade): void {
    this.facades.set(streamId, facade)
    facade.bindIdentity({ streamId })
  }

  get(streamId: string): AgentSessionFacade | undefined {
    return this.facades.get(streamId)
  }

  detach(streamId: string): AgentSessionFacade | undefined {
    const existing = this.facades.get(streamId)
    if (existing) this.facades.delete(streamId)
    return existing
  }

  /**
   * Cancel path: abort façade (clears its queue) and drop the registry entry.
   * Returns true when a façade was present.
   */
  abortAndDetach(streamId: string, reason = 'cancel_agent_chat_stream'): boolean {
    const facade = this.facades.get(streamId)
    if (!facade) return false
    facade.abort(reason)
    this.facades.delete(streamId)
    return true
  }

  size(): number {
    return this.facades.size
  }
}

/**
 * Closed-copy busy-ack (B-12). Source of truth for the string body is shared:
 * `src/shared/agent-session-busy-ack.ts`. Main re-exports for unit tests and
 * any main-only consumers; renderer must import shared, not this module.
 */
export { AGENT_SESSION_BUSY_QUEUED_ACK } from '../../shared/agent-session-busy-ack'

