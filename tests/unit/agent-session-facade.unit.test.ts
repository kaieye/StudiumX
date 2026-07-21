import { describe, expect, it, vi } from 'vitest'
import { AgentInputQueue } from '../../src/main/ai/agent-input-queue'
import {
  AGENT_SESSION_BUSY_QUEUED_ACK,
  AgentSessionFacade,
  AgentSessionFacadeRegistry,
  type AgentSessionRunInvoker
} from '../../src/main/ai/agent-session-facade'

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AgentSessionFacade', () => {
  it('accepts idle prompt and marks busy during the injected run', async () => {
    const gate = deferred()
    const seen: string[] = []
    const run: AgentSessionRunInvoker = async (input) => {
      seen.push(input.text)
      await gate.promise
      return { finalText: `echo:${input.text}`, runId: 'run-1', streamId: 'stream-1' }
    }
    const facade = new AgentSessionFacade({
      run,
      conversationId: 'conv-1',
      autoDrain: false
    })

    expect(facade.snapshot()).toMatchObject({
      busy: false,
      phase: 'idle',
      queueDepth: 0,
      conversationId: 'conv-1'
    })

    const pending = facade.prompt({ text: '  hello  ', expectedRevision: 3 })
    // Allow microtask so executeRun marks busy.
    await Promise.resolve()
    expect(facade.snapshot().busy).toBe(true)
    expect(facade.snapshot().phase).toBe('provider')

    gate.resolve()
    const result = await pending
    expect(result).toMatchObject({
      ok: true,
      disposition: 'accepted',
      reason: 'run_idle'
    })
    if (result.ok) {
      expect(result.run).toMatchObject({ finalText: 'echo:hello', runId: 'run-1', streamId: 'stream-1' })
    }
    expect(seen).toEqual(['hello'])
    expect(facade.snapshot()).toMatchObject({
      busy: false,
      phase: 'idle',
      runId: 'run-1',
      streamId: 'stream-1',
      queueDepth: 0
    })
  })

  it('queues busy default prompt (never aborts) and records FIFO depth', async () => {
    const gate = deferred()
    const run = vi.fn<AgentSessionRunInvoker>(async () => {
      await gate.promise
      return { finalText: 'done' }
    })
    const facade = new AgentSessionFacade({ run, autoDrain: false })

    const first = facade.prompt({ text: 'first' })
    await Promise.resolve()
    expect(facade.snapshot().busy).toBe(true)

    const queued = await facade.prompt({ text: 'second' })
    expect(queued).toMatchObject({
      ok: true,
      disposition: 'queued',
      reason: 'busy_default_queue',
      depth: 1
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(facade.snapshot().queueDepth).toBe(1)
    expect(facade.getQueue().snapshot()[0]?.text).toBe('second')

    gate.resolve()
    await first
    expect(facade.snapshot().busy).toBe(false)
  })

  it('demotes steer at write_tool to queue and never aborts', async () => {
    const facade = new AgentSessionFacade({
      run: async () => ({}),
      autoDrain: false
    })
    facade.setPhase('write_tool')
    expect(facade.snapshot()).toMatchObject({ busy: true, phase: 'write_tool' })

    const result = await facade.steer({ text: 'nudge' })
    expect(result).toMatchObject({
      ok: true,
      disposition: 'queued',
      reason: 'busy_write_no_steer'
    })
    expect(facade.getQueue().snapshot()[0]).toMatchObject({ kind: 'steer', text: 'nudge' })
    expect(facade.snapshot().busy).toBe(true)
    expect(facade.snapshot().phase).toBe('write_tool')
  })

  it('abort clears the queue via clearOnCancel and reopens for later prompts', async () => {
    const gate = deferred()
    const facade = new AgentSessionFacade({
      run: async () => {
        await gate.promise
        return {}
      },
      autoDrain: false
    })
    const pending = facade.prompt({ text: 'live' })
    await Promise.resolve()
    await facade.followUp({ text: 'q1' })
    await facade.steer({ text: 'q2' })
    expect(facade.snapshot().queueDepth).toBe(2)

    facade.abort('test_cancel')
    expect(facade.snapshot()).toMatchObject({
      busy: false,
      phase: 'idle',
      queueDepth: 0
    })
    expect(facade.getQueue().isClosed()).toBe(false)

    gate.resolve()
    await pending

    const again = await facade.prompt({ text: 'after-abort', conversationId: 'c2' })
    expect(again).toMatchObject({ ok: true, disposition: 'accepted' })
  })

  it('drains queued follow-ups FIFO after a safe boundary', async () => {
    const texts: string[] = []
    const run: AgentSessionRunInvoker = async (input) => {
      texts.push(`${input.kind}:${input.text}`)
      return { finalText: input.text }
    }
    const facade = new AgentSessionFacade({ run, autoDrain: false })

    // Seed queue while artificially busy, then drain at idle.
    facade.setPhase('provider')
    await facade.followUp({ text: 'B' })
    await facade.followUp({ text: 'C' })
    expect(facade.snapshot().queueDepth).toBe(2)

    facade.setPhase('idle')
    const drained = await facade.drain()
    expect(drained.map((e) => e.text)).toEqual(['B', 'C'])
    expect(texts).toEqual(['follow_up:B', 'follow_up:C'])
    expect(facade.snapshot().queueDepth).toBe(0)
  })

  it('auto-drains FIFO after an accepted prompt completes', async () => {
    const texts: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstEntered = false
    const run: AgentSessionRunInvoker = async (input) => {
      texts.push(`${input.kind}:${input.text}`)
      if (!firstEntered) {
        firstEntered = true
        await firstGate
      }
      return { finalText: input.text }
    }
    const facade = new AgentSessionFacade({ run, autoDrain: true })
    const first = facade.prompt({ text: 'A' })
    // Wait until first run is live.
    for (let i = 0; i < 20 && texts.length < 1; i += 1) {
      await Promise.resolve()
    }
    expect(texts).toEqual(['prompt:A'])
    await facade.followUp({ text: 'B' })
    await facade.followUp({ text: 'C' })
    expect(facade.snapshot().queueDepth).toBe(2)

    releaseFirst?.()
    await first
    // Auto-drain chain: B then C.
    for (let i = 0; i < 50 && texts.length < 3; i += 1) {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(texts).toEqual(['prompt:A', 'follow_up:B', 'follow_up:C'])
    expect(facade.snapshot().queueDepth).toBe(0)
  })

  it('snapshot exposes queue capacity and identity fields', () => {
    const queue = new AgentInputQueue({ hardCap: 4 })
    const facade = new AgentSessionFacade({
      queue,
      streamId: 's1',
      runId: 'r1',
      conversationId: 'c1',
      autoDrain: false
    })
    expect(facade.snapshot()).toEqual({
      busy: false,
      phase: 'idle',
      queueDepth: 0,
      queueCapacity: 4,
      streamId: 's1',
      runId: 'r1',
      conversationId: 'c1'
    })
    expect(AGENT_SESSION_BUSY_QUEUED_ACK.length).toBeGreaterThan(0)
  })

  it('child façade does not share the parent steering queue by default', async () => {
    const parent = new AgentSessionFacade({ autoDrain: false })
    parent.setPhase('provider')
    await parent.followUp({ text: 'parent-only' })
    expect(parent.snapshot().queueDepth).toBe(1)

    const child = parent.createChildFacade({ streamId: 'child-stream' })
    expect(child.getQueue()).not.toBe(parent.getQueue())
    expect(child.snapshot().queueDepth).toBe(0)

    child.setPhase('tool_batch')
    await child.followUp({ text: 'child-only' })
    expect(child.snapshot().queueDepth).toBe(1)
    expect(parent.snapshot().queueDepth).toBe(1)
    expect(parent.getQueue().snapshot()[0]?.text).toBe('parent-only')
    expect(child.getQueue().snapshot()[0]?.text).toBe('child-only')
  })

  it('manual drain respects canInjectQueuedInput and keeps unsafe head ordered', async () => {
    const facade = new AgentSessionFacade({ autoDrain: false })
    facade.setPhase('write_tool')
    await facade.steer({ text: 'steer-1' })
    await facade.followUp({ text: 'fu-1' })
    expect(facade.getQueue().snapshot().map((e) => e.text)).toEqual(['steer-1', 'fu-1'])

    // Still in write_tool → drain injects nothing.
    const drained = await facade.drain()
    expect(drained).toEqual([])
    expect(facade.snapshot().queueDepth).toBe(2)

    // Safe boundary: both kinds allowed at turn_boundary / idle after promote.
    facade.setPhase('idle')
    const order: string[] = []
    const runFacade = new AgentSessionFacade({
      queue: facade.getQueue(),
      run: async (input) => {
        order.push(input.text)
        return {}
      },
      autoDrain: false
    })
    // Transfer remaining queue into a runner façade by reusing same queue instance.
    const drained2 = await runFacade.drain()
    expect(drained2.map((e) => e.text)).toEqual(['steer-1', 'fu-1'])
    expect(order).toEqual(['steer-1', 'fu-1'])
  })

  it('registry abortAndDetach clears queue and drops stream key', async () => {
    const registry = new AgentSessionFacadeRegistry()
    const facade = new AgentSessionFacade({ autoDrain: false })
    facade.setPhase('provider')
    await facade.followUp({ text: 'pending' })
    registry.attach('stream-x', facade)
    expect(registry.size()).toBe(1)
    expect(registry.abortAndDetach('stream-x', 'cancel')).toBe(true)
    expect(registry.get('stream-x')).toBeUndefined()
    expect(facade.snapshot().queueDepth).toBe(0)
    expect(registry.abortAndDetach('missing')).toBe(false)
  })
})

