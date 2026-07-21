import { describe, expect, it, vi } from 'vitest'

import type { ToolCall } from '../../src/main/ai/provider-adapter'
import {
  executeToolBatch,
  partitionToolCalls
} from '../../src/main/ai/tools/batch-dispatch'
import type { ToolHandlerMap } from '../../src/main/ai/tools/registry'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

function toolCall(name: string, args: string, id: string): ToolCall {
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

function control(overrides: Partial<{
  canceled: boolean
  toolBudget: number
}> = {}) {
  let started = 0
  let errors = 0
  const maxTools = overrides.toolBudget ?? 100
  return {
    started: () => started,
    errors: () => errors,
    ctl: {
      isCanceled: () => overrides.canceled === true,
      budgetStop: () => (started >= maxTools ? ('tool_calls' as const) : undefined),
      startToolCall: () => {
        started += 1
      },
      recordToolError: () => {
        errors += 1
      },
      onToolCall: vi.fn()
    }
  }
}

describe('partitionToolCalls', () => {
  it('groups contiguous pure-read runs and isolates non-reads', () => {
    const segments = partitionToolCalls([
      toolCall('read_workspace_file', '{"path":"a"}', 'r1'),
      toolCall('read_workspace_file', '{"path":"b"}', 'r2'),
      toolCall('write_workspace_file', '{"path":"a","content":"x"}', 'w1'),
      toolCall('read_workspace_file', '{"path":"c"}', 'r3'),
      toolCall('ask', '{"prompt":"hi"}', 'p1')
    ])
    expect(segments[0]).toMatchObject({ kind: 'read' })
    if (segments[0].kind === 'read') {
      expect(segments[0].calls.map((c) => c.id)).toEqual(['r1', 'r2'])
    }
    expect(segments[1]).toMatchObject({ kind: 'serial', call: expect.objectContaining({ id: 'w1' }) })
    if (segments[2].kind === 'read') {
      expect(segments[2].calls.map((c) => c.id)).toEqual(['r3'])
    }
    expect(segments[3]).toMatchObject({ kind: 'serial', call: expect.objectContaining({ id: 'p1' }) })
  })
})

describe('executeToolBatch hybrid scheduling', () => {
  it('runs all-read batches in parallel under concurrency and preserves order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const handlers: ToolHandlerMap = {
      read_workspace_file: async (args) => {
        const path =
          args && typeof args === 'object' && 'path' in args
            ? String((args as { path: unknown }).path)
            : 'unknown'
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(40)
        inFlight -= 1
        return JSON.stringify({ ok: true, path })
      }
    }
    const { ctl } = control()
    const outcome = await executeToolBatch(
      [
        toolCall('read_workspace_file', '{"path":"a.md"}', 'c1'),
        toolCall('read_workspace_file', '{"path":"b.md"}', 'c2'),
        toolCall('read_workspace_file', '{"path":"c.md"}', 'c3'),
        toolCall('read_workspace_file', '{"path":"d.md"}', 'c4')
      ],
      handlers,
      undefined,
      { ...ctl, concurrency: 4 }
    )
    expect(outcome.results.map((r) => r.toolCallId)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(outcome.results.every((r) => r.isError === false)).toBe(true)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })

  it('executes writes serially and never overlaps non-read handlers', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const order: string[] = []
    const handlers: ToolHandlerMap = {
      write_workspace_file: async (args) => {
        const path =
          args && typeof args === 'object' && 'path' in args
            ? String((args as { path: unknown }).path)
            : 'unknown'
        order.push(`start:${path}`)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(30)
        inFlight -= 1
        order.push(`end:${path}`)
        return JSON.stringify({ ok: true, path })
      }
    }
    const { ctl } = control()
    const outcome = await executeToolBatch(
      [
        toolCall('write_workspace_file', '{"path":"a.md","content":"1"}', 'w1'),
        toolCall('write_workspace_file', '{"path":"b.md","content":"2"}', 'w2')
      ],
      handlers,
      undefined,
      ctl
    )
    expect(outcome.results.map((r) => r.toolCallId)).toEqual(['w1', 'w2'])
    expect(maxInFlight).toBe(1)
    expect(order).toEqual(['start:a.md', 'end:a.md', 'start:b.md', 'end:b.md'])
  })

  it('mixed [read,read,write,read] parallelizes first pair, serializes write, then last read', async () => {
    let readInFlight = 0
    let maxReadInFlight = 0
    let writeInFlight = 0
    let maxWriteInFlight = 0
    const timeline: string[] = []

    const handlers: ToolHandlerMap = {
      read_workspace_file: async (args) => {
        const path =
          args && typeof args === 'object' && 'path' in args
            ? String((args as { path: unknown }).path)
            : 'unknown'
        timeline.push(`read-start:${path}`)
        readInFlight += 1
        maxReadInFlight = Math.max(maxReadInFlight, readInFlight)
        await sleep(35)
        readInFlight -= 1
        timeline.push(`read-end:${path}`)
        return JSON.stringify({ ok: true, path })
      },
      write_workspace_file: async () => {
        timeline.push('write-start')
        writeInFlight += 1
        maxWriteInFlight = Math.max(maxWriteInFlight, writeInFlight)
        await sleep(20)
        writeInFlight -= 1
        timeline.push('write-end')
        return JSON.stringify({ ok: true })
      }
    }

    const { ctl, started } = control()
    const outcome = await executeToolBatch(
      [
        toolCall('read_workspace_file', '{"path":"a.md"}', 'r1'),
        toolCall('read_workspace_file', '{"path":"b.md"}', 'r2'),
        toolCall('write_workspace_file', '{"path":"out.md","content":"x"}', 'w1'),
        toolCall('read_workspace_file', '{"path":"c.md"}', 'r3')
      ],
      handlers,
      undefined,
      { ...ctl, concurrency: 2 }
    )

    expect(outcome.results.map((r) => r.toolCallId)).toEqual(['r1', 'r2', 'w1', 'r3'])
    expect(outcome.results.every((r) => !r.isError)).toBe(true)
    expect(maxReadInFlight).toBeGreaterThan(1)
    expect(maxWriteInFlight).toBe(1)
    expect(started()).toBe(4)
    const writeStart = timeline.indexOf('write-start')
    const writeEnd = timeline.indexOf('write-end')
    const firstPairEnds = Math.max(timeline.indexOf('read-end:a.md'), timeline.indexOf('read-end:b.md'))
    const lastReadStart = timeline.indexOf('read-start:c.md')
    expect(writeStart).toBeGreaterThan(firstPairEnds)
    expect(lastReadStart).toBeGreaterThan(writeEnd)
  })

  it('does not start non-admitted tools after cancel mid-batch', async () => {
    let canceled = false
    const writeHandler = vi.fn(async () => JSON.stringify({ ok: true }))
    const handlers: ToolHandlerMap = {
      read_workspace_file: async () => {
        await sleep(10)
        canceled = true
        return JSON.stringify({ ok: true, path: 'a' })
      },
      write_workspace_file: writeHandler
    }
    const outcome = await executeToolBatch(
      [
        toolCall('read_workspace_file', '{"path":"a.md"}', 'r1'),
        toolCall('write_workspace_file', '{"path":"b.md","content":"x"}', 'w1')
      ],
      handlers,
      undefined,
      {
        isCanceled: () => canceled,
        budgetStop: () => undefined,
        startToolCall: () => {},
        recordToolError: () => {},
        onToolCall: () => {}
      }
    )
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].toolCallId).toBe('r1')
    expect(outcome.canceled).toBe(true)
    expect(writeHandler).not.toHaveBeenCalled()
  })

  it('honors tool budget admission and stops without running remaining calls', async () => {
    const writeHandler = vi.fn(async () => JSON.stringify({ ok: true }))
    const handlers: ToolHandlerMap = {
      read_workspace_file: async () => JSON.stringify({ ok: true }),
      write_workspace_file: writeHandler
    }
    const { ctl, started } = control({ toolBudget: 1 })
    const outcome = await executeToolBatch(
      [
        toolCall('read_workspace_file', '{"path":"a.md"}', 'r1'),
        toolCall('write_workspace_file', '{"path":"b.md","content":"x"}', 'w1')
      ],
      handlers,
      undefined,
      ctl
    )
    expect(started()).toBe(1)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.exhausted).toBe('tool_calls')
    expect(writeHandler).not.toHaveBeenCalled()
  })

  it('supports recovery-style resolveCall skips without invoking handlers', async () => {
    const handler = vi.fn(async () => JSON.stringify({ ok: true }))
    const handlers: ToolHandlerMap = {
      write_workspace_file: handler,
      ask: handler
    }
    const { ctl } = control()
    const outcome = await executeToolBatch(
      [
        toolCall('write_workspace_file', '{"path":"a.md","content":"x"}', 'w1'),
        toolCall('ask', '{"prompt":"x"}', 'p1')
      ],
      handlers,
      undefined,
      {
        ...ctl,
        resolveCall: (call) => {
          if (call.function.name === 'write_workspace_file') return 'execute'
          return {
            skip: {
              toolCallId: call.id,
              name: call.function.name,
              content: '恢复阶段不允许调用工具 ask。',
              isError: true
            }
          }
        }
      }
    )
    expect(handler).toHaveBeenCalledTimes(1)
    expect(outcome.results[1].isError).toBe(true)
    expect(outcome.results[1].content).toContain('不允许')
  })
})

describe('runAgentLoop hybrid batch wiring (B-03)', () => {
  const originalFetch = globalThis.fetch

  function settings(): TeachingSettingsV1 {
    const value = defaultSettings('C:/agent-loop-batch-fixture')
    value.generator.endpointFormat = 'chat_completions'
    value.generator.requestTimeoutMs = 50
    value.tools.maxIterations = 3
    return value
  }

  function provider(): TeachingModelProviderProfile {
    return {
      ...settings().provider.providers[0]!,
      baseUrl: 'https://provider.example/v1',
      endpointFormat: 'chat_completions',
      apiKey: 'sk-fixture'
    }
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  it('parallelizes contiguous reads inside a live agent-loop turn', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const responses = [
      jsonResponse({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'r1',
                type: 'function',
                function: { name: 'read_workspace_file', arguments: '{"path":"a.md"}' }
              },
              {
                id: 'r2',
                type: 'function',
                function: { name: 'read_workspace_file', arguments: '{"path":"b.md"}' }
              }
            ]
          }
        }]
      }),
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '读完了' } }]
      })
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    try {
      const result = await runAgentLoop({
        settings: settings(),
        provider: provider(),
        messages: [{ role: 'user', content: 'read both' }],
        tools: [{
          type: 'function',
          function: {
            name: 'read_workspace_file',
            description: 'read',
            parameters: { type: 'object', properties: {} }
          }
        }],
        toolHandlers: {
          read_workspace_file: async () => {
            inFlight += 1
            maxInFlight = Math.max(maxInFlight, inFlight)
            await sleep(40)
            inFlight -= 1
            return JSON.stringify({ ok: true })
          }
        },
        maxIterations: 2
      })
      expect(result.finalText).toBe('读完了')
      expect(result.usage.toolCalls).toBe(2)
      expect(maxInFlight).toBeGreaterThan(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('still rejects length-truncated tool batches with zero handlers (A-02)', async () => {
    const responses = [
      jsonResponse({
        choices: [{
          finish_reason: 'length',
          message: {
            content: 'partial',
            tool_calls: [{
              id: 'call-trunc',
              type: 'function',
              function: { name: 'read_workspace_file', arguments: '{"path":"x.md"' }
            }]
          }
        }]
      }),
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '已停止不完整工具调用。' } }]
      })
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    const handler = vi.fn(async () => 'should-not-run')
    try {
      const result = await runAgentLoop({
        settings: settings(),
        provider: provider(),
        messages: [{ role: 'user', content: 'read' }],
        tools: [{
          type: 'function',
          function: {
            name: 'read_workspace_file',
            description: 'read',
            parameters: { type: 'object', properties: {} }
          }
        }],
        toolHandlers: { read_workspace_file: handler },
        maxIterations: 2
      })
      expect(handler).not.toHaveBeenCalled()
      expect(result.usage.toolCalls).toBe(0)
      expect(
        result.messages.some(
          (m) => m.role === 'tool' && String(m.content).includes('tool_calls_rejected_due_to_length')
        )
      ).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
