import { describe, expect, it, vi } from 'vitest'

import type { ToolCall } from '../../src/main/ai/provider-adapter'
import { ToolDispatcher } from '../../src/main/ai/tools/dispatcher'
import {
  DEFAULT_PARALLEL_READ_CONCURRENCY,
  dispatchReadToolsInParallel,
  extractReadPathTargets,
  MAX_PARALLEL_READ_CONCURRENCY,
  readTargetsOverlap
} from '../../src/main/ai/tools/parallel-read-dispatcher'
import type { ToolHandlerMap } from '../../src/main/ai/tools/registry'

function toolCall(name: string, args: string, id = `call-${name}`): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: args }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('extractReadPathTargets / overlap', () => {
  it('normalizes relative path targets without absolute FS resolution', () => {
    expect(extractReadPathTargets({ path: './docs/a.md' })).toEqual(['docs/a.md'])
    expect(extractReadPathTargets({ path: 'docs\\b.md' })).toEqual(['docs/b.md'])
    expect(extractReadPathTargets({ glob: 'src/**/*.ts' })).toEqual(['src/**/*.ts'])
    expect(extractReadPathTargets({ pattern: 'TODO', path: 'src' })).toEqual(['src'])
    expect(extractReadPathTargets(null)).toEqual([])
    expect(extractReadPathTargets('x')).toEqual([])
  })

  it('detects same-path overlap for diagnostics; concurrent same-path reads remain allowed', () => {
    expect(readTargetsOverlap(['docs/a.md'], ['docs/a.md'])).toBe(true)
    expect(readTargetsOverlap(['docs/a.md'], ['docs/b.md'])).toBe(false)
    expect(readTargetsOverlap([], ['docs/a.md'])).toBe(false)
  })
})

describe('dispatchReadToolsInParallel', () => {
  it('runs pure-read tools concurrently under the default bound and preserves outcome order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const started: string[] = []

    const handlers: ToolHandlerMap = {
      read_workspace_file: async (args) => {
        const path =
          args && typeof args === 'object' && 'path' in args
            ? String((args as { path: unknown }).path)
            : 'unknown'
        started.push(path)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(40)
        inFlight -= 1
        return JSON.stringify({ ok: true, path })
      }
    }

    const calls = [
      toolCall('read_workspace_file', '{"path":"a.md"}', 'c1'),
      toolCall('read_workspace_file', '{"path":"b.md"}', 'c2'),
      toolCall('read_workspace_file', '{"path":"c.md"}', 'c3'),
      toolCall('read_workspace_file', '{"path":"d.md"}', 'c4'),
      toolCall('read_workspace_file', '{"path":"e.md"}', 'c5')
    ]

    const outcomes = await dispatchReadToolsInParallel(handlers, calls, undefined, {
      concurrency: DEFAULT_PARALLEL_READ_CONCURRENCY
    })

    expect(outcomes).toHaveLength(5)
    expect(outcomes.map((o) => o.toolCallId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(outcomes.every((o) => o.status === 'succeeded')).toBe(true)
    expect(outcomes.every((o) => o.effectClass === 'read')).toBe(true)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_PARALLEL_READ_CONCURRENCY)
    expect(started).toHaveLength(5)
  })

  it('clamps concurrency to max 8 and never exceeds it', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const handlers: ToolHandlerMap = {
      list_workspace: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(25)
        inFlight -= 1
        return JSON.stringify({ ok: true })
      }
    }

    const calls = Array.from({ length: 12 }, (_, i) =>
      toolCall('list_workspace', '{"path":"."}', `list-${i}`)
    )

    const outcomes = await dispatchReadToolsInParallel(handlers, calls, undefined, {
      concurrency: 99
    })

    expect(outcomes).toHaveLength(12)
    expect(outcomes.every((o) => o.status === 'succeeded')).toBe(true)
    expect(maxInFlight).toBeLessThanOrEqual(MAX_PARALLEL_READ_CONCURRENCY)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('denies workspace_write and privileged tools without running them, while still parallelizing pure reads', async () => {
    const writeHandler = vi.fn(async () => JSON.stringify({ ok: true, wrote: true }))
    const privilegedHandler = vi.fn(async () => JSON.stringify({ ok: true }))
    const externalHandler = vi.fn(async () => JSON.stringify({ ok: true }))
    let readRuns = 0
    let inFlight = 0
    let maxInFlight = 0

    const handlers: ToolHandlerMap = {
      write_workspace_file: writeHandler,
      ask: privilegedHandler,
      web_search: externalHandler,
      read_workspace_file: async (args) => {
        readRuns += 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(30)
        inFlight -= 1
        const path =
          args && typeof args === 'object' && 'path' in args
            ? String((args as { path: unknown }).path)
            : 'unknown'
        return JSON.stringify({ ok: true, path })
      }
    }

    const calls = [
      toolCall('read_workspace_file', '{"path":"a.md"}', 'r1'),
      toolCall('write_workspace_file', '{"path":"a.md","content":"x"}', 'w1'),
      toolCall('read_workspace_file', '{"path":"b.md"}', 'r2'),
      toolCall('ask', '{"prompt":"hi"}', 'p1'),
      toolCall('web_search', '{"query":"x"}', 'e1'),
      toolCall('read_workspace_file', '{"path":"c.md"}', 'r3')
    ]

    const outcomes = await dispatchReadToolsInParallel(handlers, calls)

    expect(writeHandler).not.toHaveBeenCalled()
    expect(privilegedHandler).not.toHaveBeenCalled()
    expect(externalHandler).not.toHaveBeenCalled()
    expect(readRuns).toBe(3)

    expect(outcomes.map((o) => o.toolCallId)).toEqual(['r1', 'w1', 'r2', 'p1', 'e1', 'r3'])
    expect(outcomes[0].status).toBe('succeeded')
    expect(outcomes[1].status).toBe('denied')
    expect(outcomes[2].status).toBe('succeeded')
    expect(outcomes[3].status).toBe('denied')
    expect(outcomes[4].status).toBe('denied')
    expect(outcomes[5].status).toBe('succeeded')

    if (outcomes[1].status === 'denied') {
      expect(outcomes[1].error.code).toBe('parallel_read_only')
      expect(outcomes[1].effectClass).toBe('workspace_write')
    }
    if (outcomes[3].status === 'denied') {
      expect(outcomes[3].error.code).toBe('parallel_read_only')
      expect(outcomes[3].effectClass).toBe('privileged')
    }
    if (outcomes[4].status === 'denied') {
      expect(outcomes[4].error.code).toBe('parallel_read_only')
      expect(outcomes[4].effectClass).toBe('external_write')
    }

    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('allows concurrent same-path pure reads (no false conflict denial)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const handlers: ToolHandlerMap = {
      read_workspace_file: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(30)
        inFlight -= 1
        return JSON.stringify({ ok: true, path: 'shared.md' })
      }
    }

    const calls = [
      toolCall('read_workspace_file', '{"path":"shared.md"}', 's1'),
      toolCall('read_workspace_file', '{"path":"shared.md"}', 's2')
    ]

    const outcomes = await dispatchReadToolsInParallel(handlers, calls, undefined, {
      concurrency: 2
    })

    expect(outcomes.every((o) => o.status === 'succeeded')).toBe(true)
    expect(maxInFlight).toBe(2)
  })

  it('accepts an existing ToolDispatcher and keeps correlation metadata', async () => {
    const outcomesSeen: string[] = []
    const dispatcher = new ToolDispatcher({
      handlers: {
        glob_workspace: async () => JSON.stringify({ ok: true, matches: [] })
      },
      onOutcome: (outcome) => {
        outcomesSeen.push(outcome.toolCallId)
      }
    })

    const outcomeList = await dispatchReadToolsInParallel(
      dispatcher,
      [toolCall('glob_workspace', '{"glob":"**/*.md"}', 'g1')],
      { toolCallId: 'g1', toolName: 'glob_workspace', runId: 'run-pr-1' }
    )

    expect(outcomeList).toHaveLength(1)
    expect(outcomeList[0].status).toBe('succeeded')
    expect(outcomeList[0].correlation.runId).toBe('run-pr-1')
    expect(outcomeList[0].operationId).toBeTruthy()
    expect(outcomesSeen).toEqual(['g1'])
  })

  it('returns cancelled without running when the shared signal is already aborted', async () => {
    const handler = vi.fn(async () => JSON.stringify({ ok: true }))
    const aborted = new AbortController()
    aborted.abort()

    const outcomes = await dispatchReadToolsInParallel(
      { read_workspace_file: handler },
      [toolCall('read_workspace_file', '{"path":"a.md"}', 'ab1')],
      { toolCallId: 'ab1', toolName: 'read_workspace_file', signal: aborted.signal }
    )

    expect(handler).not.toHaveBeenCalled()
    expect(outcomes[0].status).toBe('cancelled')
  })

  it('returns empty array for empty batch', async () => {
    const outcomes = await dispatchReadToolsInParallel({}, [])
    expect(outcomes).toEqual([])
  })
})
