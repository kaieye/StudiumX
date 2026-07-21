/**
 * Bounded FIFO for follow-up / steer messages while an agent run is busy.
 *
 * Ownership boundary:
 * - Stores opaque queued inputs only (text + kind + optional CAS metadata).
 * - Does not abort runs, execute tools, or inject into the provider transcript.
 * - Cancel policy is explicit: clearOnCancel drains and rejects further enqueues
 *   until reopen (or a new queue is created per run).
 *
 * Steer is not abort: callers must route interrupt separately via AbortSignal.
 */
export type AgentInputKind = 'follow_up' | 'steer'

export type AgentQueuedInput = Readonly<{
  id: string
  kind: AgentInputKind
  text: string
  enqueuedAt: string
  conversationId?: string
  expectedRevision?: number
}>

export type AgentInputEnqueueOk = Readonly<{
  ok: true
  entry: AgentQueuedInput
  depth: number
}>

export type AgentInputEnqueueFailure = Readonly<{
  ok: false
  reason: 'empty_text' | 'full' | 'closed'
  depth: number
}>

export type AgentInputEnqueueResult = AgentInputEnqueueOk | AgentInputEnqueueFailure

export type AgentInputQueueOptions = {
  /** Hard cap on queued items. Defaults to DEFAULT_AGENT_INPUT_QUEUE_HARD_CAP. */
  hardCap?: number
  idFactory?: () => string
  now?: () => string
}

export const DEFAULT_AGENT_INPUT_QUEUE_HARD_CAP = 16

let nextSyntheticId = 0

function defaultIdFactory(): string {
  nextSyntheticId += 1
  return `queued-input-${nextSyntheticId}`
}

/**
 * Process-local, race-safe (single-threaded JS) bounded FIFO.
 * Concurrent callers in the same tick observe consistent size/order because
 * all mutators are synchronous.
 */
export class AgentInputQueue {
  private readonly items: AgentQueuedInput[] = []
  private readonly hardCap: number
  private readonly idFactory: () => string
  private readonly now: () => string
  private closed = false

  constructor(options: AgentInputQueueOptions = {}) {
    const hardCap = options.hardCap ?? DEFAULT_AGENT_INPUT_QUEUE_HARD_CAP
    if (!Number.isSafeInteger(hardCap) || hardCap < 1) {
      throw new Error('AgentInputQueue hardCap must be a positive safe integer.')
    }
    this.hardCap = hardCap
    this.idFactory = options.idFactory ?? defaultIdFactory
    this.now = options.now ?? (() => new Date().toISOString())
  }

  get capacity(): number {
    return this.hardCap
  }

  size(): number {
    return this.items.length
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  isFull(): boolean {
    return this.items.length >= this.hardCap
  }

  isClosed(): boolean {
    return this.closed
  }

  snapshot(): readonly AgentQueuedInput[] {
    return this.items.slice()
  }

  enqueue(input: {
    text: string
    kind?: AgentInputKind
    conversationId?: string
    expectedRevision?: number
  }): AgentInputEnqueueResult {
    const text = input.text.trim()
    if (!text) {
      return { ok: false, reason: 'empty_text', depth: this.items.length }
    }
    if (this.closed) {
      return { ok: false, reason: 'closed', depth: this.items.length }
    }
    if (this.items.length >= this.hardCap) {
      return { ok: false, reason: 'full', depth: this.items.length }
    }

    const entry: AgentQueuedInput = {
      id: this.idFactory(),
      kind: input.kind ?? 'follow_up',
      text,
      enqueuedAt: this.now(),
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {})
    }
    this.items.push(entry)
    return { ok: true, entry, depth: this.items.length }
  }

  peek(): AgentQueuedInput | undefined {
    return this.items[0]
  }

  dequeue(): AgentQueuedInput | undefined {
    return this.items.shift()
  }

  /**
   * Drain up to `max` items (default: all). FIFO order is preserved.
   * Does not close the queue.
   */
  drain(max: number = this.items.length): AgentQueuedInput[] {
    if (!Number.isSafeInteger(max) || max < 0) {
      throw new Error('AgentInputQueue.drain max must be a non-negative safe integer.')
    }
    const count = Math.min(max, this.items.length)
    return this.items.splice(0, count)
  }

  /**
   * Explicit cancel policy: remove all pending inputs and refuse further
   * enqueues until reopen(). Returns the cleared entries for UI/ack surfaces.
   */
  clearOnCancel(_reason?: string): AgentQueuedInput[] {
    const cleared = this.items.splice(0, this.items.length)
    this.closed = true
    return cleared
  }

  /** Allow enqueue again after a cancel cycle (e.g. new run on same conversation). */
  reopen(): void {
    this.closed = false
  }
}

/**
 * Optional process-scoped registry so cancel paths can clear queues without a
 * full AgentSessionFacade. Keys are typically streamId or conversationId.
 */
export class AgentInputQueueRegistry {
  private readonly queues = new Map<string, AgentInputQueue>()

  constructor(private readonly createQueue: () => AgentInputQueue = () => new AgentInputQueue()) {}

  get(key: string): AgentInputQueue | undefined {
    return this.queues.get(key)
  }

  getOrCreate(key: string): AgentInputQueue {
    const existing = this.queues.get(key)
    if (existing) return existing
    const created = this.createQueue()
    this.queues.set(key, created)
    return created
  }

  /** Cancel policy: clear + close the queue, then drop the registry entry. */
  clearOnCancel(key: string, reason?: string): AgentQueuedInput[] {
    const queue = this.queues.get(key)
    if (!queue) return []
    const cleared = queue.clearOnCancel(reason)
    this.queues.delete(key)
    return cleared
  }

  clearAllOnCancel(reason?: string): number {
    let total = 0
    for (const key of [...this.queues.keys()]) {
      total += this.clearOnCancel(key, reason).length
    }
    return total
  }

  size(): number {
    return this.queues.size
  }
}
