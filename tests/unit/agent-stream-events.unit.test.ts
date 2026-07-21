import { describe, expect, it } from 'vitest'

import {
  createAgentStreamPresentationAdapter,
  mapAgentLoopEventToPresentation,
  safePresent,
  wrapPresentationCallbacks,
  type AgentStreamPresentationDiagnostic
} from '../../src/main/ai/agent-stream-events'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import type {
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent
} from '../../src/shared/teaching-types'
import { createAgentEventBus } from '../../src/main/ai/agent-event-bus'

describe('mapAgentLoopEventToPresentation', () => {
  it('maps token / status / tool_result correctly', () => {
    expect(mapAgentLoopEventToPresentation('s1', { type: 'token', delta: 'hi' })).toEqual([
      { kind: 'chunk', delta: 'hi', channel: 'answer' }
    ])
    expect(
      mapAgentLoopEventToPresentation('s1', { type: 'status', status: 'thinking', message: 'read' })
    ).toEqual([{ kind: 'status', status: 'thinking', message: 'read' }])
    expect(
      mapAgentLoopEventToPresentation('s1', {
        type: 'tool_result',
        toolCallId: 'c1',
        name: 'list_workspace',
        result: '{"ok":true}',
        isError: false
      })
    ).toEqual([
      {
        kind: 'tool',
        event: {
          toolCall: { id: 'c1', name: 'list_workspace', arguments: '' },
          result: '{"ok":true}',
          isError: false
        }
      }
    ])
  })

  it('maps tool_call and reasoning channels', () => {
    const toolCall: AgentLoopEvent = {
      type: 'tool_call',
      toolCall: {
        id: 'call-1',
        type: 'function',
        function: { name: 'read_workspace_file', arguments: '{"path":"a.md"}' }
      }
    }
    expect(mapAgentLoopEventToPresentation('s1', toolCall)).toEqual([
      {
        kind: 'tool',
        event: {
          toolCall: {
            id: 'call-1',
            name: 'read_workspace_file',
            arguments: '{"path":"a.md"}'
          }
        }
      }
    ])
    expect(mapAgentLoopEventToPresentation('s1', { type: 'reasoning', delta: 'think' })).toEqual([
      { kind: 'chunk', delta: 'think', channel: 'reasoning' }
    ])
  })

  it('maps child-run and compaction status labels without inventing a timeline store', () => {
    expect(
      mapAgentLoopEventToPresentation('s1', {
        type: 'child_run_queued',
        child: {
          id: 'child-1',
          label: '检索',
          profile: 'read_only',
          status: 'queued'
        } as never
      })[0]
    ).toMatchObject({ kind: 'status', status: 'tool_running', message: '子任务排队：检索' })

    expect(
      mapAgentLoopEventToPresentation('s1', {
        type: 'context_compaction_completed',
        reason: 'soft_threshold',
        mode: 'normal',
        sourceDigest: 'd',
        beforeTokens: 1000,
        afterTokens: 600,
        replacedTokens: 500,
        summaryTokens: 120,
        replacedMessages: 4,
        tailMessages: 6,
        cached: false
      } as never)[0]
    ).toMatchObject({
      kind: 'status',
      status: 'thinking',
      message: '上下文压缩完成：约节省 380 token'
    })
  })

  it('returns empty actions for loop-internal events', () => {
    expect(
      mapAgentLoopEventToPresentation('s1', {
        type: 'assistant_message',
        message: { role: 'assistant', content: 'x' }
      })
    ).toEqual([])
  })
})

describe('safePresent / createAgentStreamPresentationAdapter', () => {
  it('does not rethrow when the sink throws', () => {
    const diagnostics: AgentStreamPresentationDiagnostic[] = []
    const adapter = createAgentStreamPresentationAdapter({
      streamId: 'stream-safe',
      sink: {
        chunk: () => {
          throw new Error('chunk boom')
        },
        status: () => {
          throw new Error('status boom')
        },
        tool: () => {
          throw new Error('tool boom')
        }
      },
      onPresentationError: (d) => diagnostics.push(d)
    })

    expect(() => adapter.presentChunk('x')).not.toThrow()
    expect(() => adapter.presentStatus('thinking')).not.toThrow()
    expect(() =>
      adapter.presentTool({ toolCall: { id: 't', name: 'list_workspace', arguments: '{}' } })
    ).not.toThrow()
    expect(() => adapter.presentLoopEvent({ type: 'token', delta: 'z' })).not.toThrow()

    expect(diagnostics.map((d) => d.method)).toEqual(['chunk', 'status', 'tool', 'chunk'])
    expect(diagnostics.every((d) => d.kind === 'presentation_error')).toBe(true)
  })

  it('delivers cancel / terminal status events when the sink is healthy', () => {
    const statuses: AgentChatStreamStatus[] = []
    const chunks: AgentChatStreamChunk[] = []
    const tools: AgentChatStreamToolEvent[] = []
    const adapter = createAgentStreamPresentationAdapter({
      streamId: 'stream-ok',
      sink: {
        chunk: (c) => chunks.push(c),
        status: (s) => statuses.push(s),
        tool: (t) => tools.push(t)
      }
    })

    adapter.presentLoopEvent({ type: 'status', status: 'thinking' })
    adapter.presentLoopEvent({ type: 'token', delta: 'hello' })
    adapter.presentLoopEvent({
      type: 'tool_result',
      toolCallId: 'c1',
      name: 'list_workspace',
      result: 'ok',
      isError: false
    })
    adapter.presentLoopEvent({ type: 'status', status: 'canceled', message: '用户取消' })

    expect(chunks).toEqual([{ streamId: 'stream-ok', delta: 'hello' }])
    expect(tools).toHaveLength(1)
    expect(tools[0]?.result).toBe('ok')
    expect(statuses.map((s) => s.status)).toEqual(['thinking', 'canceled'])
    expect(statuses[1]?.message).toBe('用户取消')
  })

  it('safePresent swallows errors and reports once', () => {
    const reports: AgentStreamPresentationDiagnostic[] = []
    const ok = safePresent('probe', () => {
      throw new Error('nope')
    }, (d) => reports.push(d))
    expect(ok).toBe(false)
    expect(reports).toEqual([{ kind: 'presentation_error', method: 'probe', message: 'nope' }])

    const ok2 = safePresent('probe2', () => undefined)
    expect(ok2).toBe(true)
  })

  it('does not rethrow when the diagnostic sink itself throws', () => {
    expect(() =>
      safePresent(
        'x',
        () => {
          throw new Error('primary')
        },
        () => {
          throw new Error('diag boom')
        }
      )
    ).not.toThrow()
  })
})

describe('wrapPresentationCallbacks + AgentEventBus isolation', () => {
  it('wraps multi-callback sinks without rethrowing', () => {
    const wrapped = wrapPresentationCallbacks({
      onChunk: () => {
        throw new Error('chunk')
      },
      onStatus: () => {
        throw new Error('status')
      },
      onTool: () => {
        throw new Error('tool')
      }
    })
    expect(() => wrapped.onChunk({ streamId: 's', delta: 'a' })).not.toThrow()
    expect(() => wrapped.onStatus({ streamId: 's', status: 'done' })).not.toThrow()
    expect(() =>
      wrapped.onTool({ streamId: 's', toolCall: { id: '1', name: 'x', arguments: '' } })
    ).not.toThrow()
  })

  it('AgentEventBus continues mapping after presentation throw; cancel still records terminal', () => {
    const statuses: AgentChatStreamStatus[] = []
    const chunks: AgentChatStreamChunk[] = []
    const tools: AgentChatStreamToolEvent[] = []
    const diagnostics: AgentStreamPresentationDiagnostic[] = []
    let chunkCalls = 0

    const bus = createAgentEventBus({
      streamId: 'bus-1',
      now: () => '2026-07-21T00:00:00.000Z',
      onChunk: (chunk) => {
        chunkCalls += 1
        if (chunkCalls === 1) throw new Error('ui chunk fail')
        chunks.push(chunk)
      },
      onStatus: (status) => statuses.push(status),
      onTool: (event) => tools.push(event),
      onPresentationError: (d) => diagnostics.push(d)
    })

    expect(() => bus.publishLoopEvent({ type: 'token', delta: 'first' })).not.toThrow()
    expect(() => bus.publishLoopEvent({ type: 'token', delta: 'second' })).not.toThrow()
    expect(() =>
      bus.publishLoopEvent({
        type: 'tool_result',
        toolCallId: 'c1',
        name: 'list_workspace',
        result: 'ok',
        isError: false
      })
    ).not.toThrow()
    expect(() => bus.publishLoopEvent({ type: 'status', status: 'canceled' })).not.toThrow()

    expect(diagnostics.some((d) => d.method === 'onChunk')).toBe(true)
    expect(chunks).toEqual([{ streamId: 'bus-1', delta: 'second' }])
    expect(tools).toHaveLength(1)
    expect(statuses.map((s) => s.status)).toEqual(['canceled'])
    const terminal = bus.terminal()
    expect(terminal?.kind).toBe('terminal')
    if (terminal?.kind === 'terminal') expect(terminal.outcome).toBe('canceled')
  })
})
