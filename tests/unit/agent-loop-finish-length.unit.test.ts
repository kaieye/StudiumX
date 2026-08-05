import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLoopExecutionState } from '../../src/main/ai/agent-loop-execution-state'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-finish-length-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 50
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

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('AgentLoopExecutionState finish reason ledger', () => {
  it('records the real finish reason instead of forging stop', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 10 }, 'provider_reported', 'length')

    const snapshot = (execution as unknown as {
      providerHooks: { snapshot: () => { stopReasons: string[]; completed: number } }
    }).providerHooks.snapshot()

    expect(snapshot.completed).toBe(1)
    expect(snapshot.stopReasons).toEqual(['length'])
  })

  it('does not forge a stop event when finishReason is absent', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage({ totalTokens: 10 })

    const snapshot = (execution as unknown as {
      providerHooks: { snapshot: () => { stopReasons: string[]; completed: number; calls: number } }
    }).providerHooks.snapshot()

    expect(snapshot.calls).toBe(1)
    expect(snapshot.completed).toBe(0)
    expect(snapshot.stopReasons).toEqual([])
  })

  it('passes tool_calls and stop through the ledger', () => {
    const execution = new AgentLoopExecutionState({ now: () => 1_000 })
    execution.startProviderCall()
    execution.recordProviderUsage(undefined, 'provider_reported', 'tool_calls')
    execution.startProviderCall()
    execution.recordProviderUsage(undefined, 'provider_reported', 'stop')

    const snapshot = (execution as unknown as {
      providerHooks: { snapshot: () => { stopReasons: string[]; completed: number } }
    }).providerHooks.snapshot()

    expect(snapshot.completed).toBe(2)
    expect(snapshot.stopReasons).toEqual(['tool_calls', 'stop'])
  })
})

describe('runAgentLoop length tool rejection (A-02)', () => {
  it('does not execute handlers when finishReason is length and toolCalls are present', async () => {
    const responses = [
      jsonResponse({
        choices: [{
          finish_reason: 'length',
          message: {
            content: 'partial',
            tool_calls: [{
              id: 'call-trunc',
              type: 'function',
              function: { name: 'write_workspace_file', arguments: '{"path":"x.md","content":"oops' }
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

    const events: Array<{ type: string; status?: string; isError?: boolean; name?: string }> = []
    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'write' }],
      tools: [{
        type: 'function',
        function: {
          name: 'write_workspace_file',
          description: 'write',
          parameters: { type: 'object', properties: {} }
        }
      }],
      toolHandlers: { write_workspace_file: handler },
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'status') events.push({ type: event.type, status: event.status })
          if (event.type === 'tool_result') {
            events.push({
              type: event.type,
              isError: event.isError,
              name: event.name
            })
          }
        }
      }
    })

    expect(handler).not.toHaveBeenCalled()
    expect(result.usage.toolCalls).toBe(0)
    expect(result.finalText).toBe('已停止不完整工具调用。')
    expect(events.some((e) => e.type === 'status' && e.status === 'error')).toBe(true)
    expect(events.some((e) => e.type === 'tool_result' && e.isError === true)).toBe(true)
    const rejected = result.messages.find((m) => m.role === 'tool')
    expect(rejected?.content).toContain('tool_calls_rejected_due_to_length')
  })

  it('still executes toolCalls when finishReason is stop or tool_calls', async () => {
    const responses = [
      jsonResponse({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{
              id: 'call-ok',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' }
            }]
          }
        }]
      }),
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '查完了' } }]
      })
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    const handler = vi.fn(async () => 'tool-ok')

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'look' }],
      tools: [{
        type: 'function',
        function: { name: 'lookup', description: 'lookup', parameters: { type: 'object', properties: {} } }
      }],
      toolHandlers: { lookup: handler },
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(result.finalText).toBe('查完了')
    expect(result.usage.toolCalls).toBe(1)
  })

  it('ends cleanly on pure length without tools', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        choices: [{ finish_reason: 'length', message: { content: '截断但无工具' } }]
      })) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('截断但无工具')
    expect(result.usage.toolCalls).toBe(0)
  })

  it('surfaces length finishReason end-to-end through streamChatProvider', async () => {
    globalThis.fetch = (async () => sseResponse([
      { choices: [{ delta: { content: 'partial answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] }
    ])) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.finalText).toBe('partial answer')
    expect(result.stopReason).toBe('final_answer')
  })
})
