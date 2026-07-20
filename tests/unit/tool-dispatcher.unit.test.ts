import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { ToolCall } from '../../src/main/ai/provider-adapter'
import { ToolDispatcher } from '../../src/main/ai/tools/dispatcher'
import {
  authorizeToolEffect,
  classifyToolEffect
} from '../../src/main/ai/tools/effect-policy'
import {
  executeToolCall,
  parseToolArguments,
  ToolArgumentParseError,
  toolOutcomeToExecutionResult
} from '../../src/main/ai/tools/execution'
import { isToolOutcomeSuccess, toolOutcomeIsError } from '../../src/main/ai/tools/tool-outcome'

function toolCall(name: string, args: string, id = `call-${name}`): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: args }
  }
}

describe('effect policy classification', () => {
  it('maps known teaching tools to effect classes and fails closed for unknown names', () => {
    expect(classifyToolEffect('read_workspace_file')).toBe('read')
    expect(classifyToolEffect('list_workspace')).toBe('read')
    expect(classifyToolEffect('write_workspace_file')).toBe('workspace_write')
    expect(classifyToolEffect('web_search')).toBe('external_write')
    expect(classifyToolEffect('web_fetch')).toBe('external_write')
    expect(classifyToolEffect('ask')).toBe('privileged')
    expect(classifyToolEffect('generate_lesson')).toBe('privileged')
    expect(classifyToolEffect('future_shell_tool')).toBe('privileged')
  })

  it('authorizes by tool allow-list and effect allow-list before any handler work', () => {
    expect(
      authorizeToolEffect({
        toolName: 'web_search',
        effectClass: 'external_write',
        allowsTool: (name) => name === 'web_search'
      })
    ).toEqual({ allowed: true })

    expect(
      authorizeToolEffect({
        toolName: 'write_workspace_file',
        effectClass: 'workspace_write',
        allowsTool: () => false
      })
    ).toMatchObject({ allowed: false, code: 'tool_not_allowed' })

    expect(
      authorizeToolEffect({
        toolName: 'web_fetch',
        effectClass: 'external_write',
        allowedEffects: ['read']
      })
    ).toMatchObject({ allowed: false, code: 'effect_not_allowed' })
  })
})

describe('strict tool argument parsing', () => {
  it('accepts empty args as {} and rejects illegal JSON without silent coercion', () => {
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('   ')).toEqual({})
    expect(parseToolArguments('{"query":"rag"}')).toEqual({ query: 'rag' })
    expect(() => parseToolArguments('not json')).toThrow(ToolArgumentParseError)
    expect(() => parseToolArguments('{')).toThrow(ToolArgumentParseError)
  })
})

describe('ToolDispatcher', () => {
  it('returns failed outcome for illegal JSON and never invokes the handler with {}', async () => {
    const handler = vi.fn(async () => JSON.stringify({ ok: true }))
    const dispatcher = new ToolDispatcher({ handlers: { web_search: handler } })

    const outcome = await dispatcher.dispatch(toolCall('web_search', 'not-json'))

    expect(handler).not.toHaveBeenCalled()
    expect(outcome.status).toBe('failed')
    expect(outcome.isError).toBe(true)
    expect(outcome.effectClass).toBe('external_write')
    if (outcome.status === 'failed') {
      expect(outcome.error.code).toBe('invalid_tool_arguments')
    }
    expect(outcome.content).not.toContain('"args":{}')
    expect(isToolOutcomeSuccess(outcome)).toBe(false)
    expect(toolOutcomeIsError(outcome)).toBe(true)
  })

  it('authorizes effect before the handler runs', async () => {
    const handler = vi.fn(async () => JSON.stringify({ ok: true }))
    const dispatcher = new ToolDispatcher({
      handlers: { write_workspace_file: handler },
      allowedEffects: ['read']
    })

    const outcome = await dispatcher.dispatch(
      toolCall('write_workspace_file', '{"path":"a.md","content":"x"}')
    )

    expect(handler).not.toHaveBeenCalled()
    expect(outcome.status).toBe('denied')
    expect(outcome.effectClass).toBe('workspace_write')
    if (outcome.status === 'denied') {
      expect(outcome.error.code).toBe('effect_not_allowed')
    }
  })

  it('denies tools blocked by allowsTool without running the handler', async () => {
    const handler = vi.fn(async () => JSON.stringify({ ok: true }))
    const dispatcher = new ToolDispatcher({
      handlers: { web_fetch: handler },
      allowsTool: (name) => name !== 'web_fetch'
    })

    const outcome = await dispatcher.dispatch(toolCall('web_fetch', '{"url":"https://example.com"}'))

    expect(handler).not.toHaveBeenCalled()
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') {
      expect(outcome.error.code).toBe('tool_not_allowed')
    }
  })

  it('returns succeeded with explicit status and does not treat the word error in content as failure', async () => {
    const dispatcher = new ToolDispatcher({
      handlers: {
        read_workspace_file: async () =>
          JSON.stringify({ ok: true, note: 'no error field; contains word error only in prose' })
      }
    })

    const outcome = await dispatcher.dispatch(toolCall('read_workspace_file', '{"path":"MISSION.md"}'))

    expect(outcome.status).toBe('succeeded')
    expect(outcome.isError).toBe(false)
    expect(outcome.effectClass).toBe('read')
    expect(isToolOutcomeSuccess(outcome)).toBe(true)
  })

  it('maps thrown errors to failed and abort to cancelled; timeout to timed_out', async () => {
    const failed = await new ToolDispatcher({
      handlers: {
        web_search: async () => {
          throw new Error('provider unavailable')
        }
      }
    }).dispatch(toolCall('web_search', '{}'))
    expect(failed.status).toBe('failed')
    if (failed.status === 'failed') {
      expect(failed.error.message).toMatch(/provider unavailable/)
    }

    const aborted = new AbortController()
    aborted.abort()
    let ran = false
    const cancelled = await new ToolDispatcher({
      handlers: {
        web_search: async () => {
          ran = true
          return '{}'
        }
      }
    }).dispatch(toolCall('web_search', '{}'), {
      toolCallId: 'call-web_search',
      toolName: 'web_search',
      signal: aborted.signal
    })
    expect(ran).toBe(false)
    expect(cancelled.status).toBe('cancelled')

    const timedOut = await new ToolDispatcher({
      handlers: {
        web_fetch: async () => {
          const error = new Error('request timed out after 20s')
          error.name = 'TimeoutError'
          throw error
        }
      }
    }).dispatch(toolCall('web_fetch', '{"url":"https://example.com"}'))
    expect(timedOut.status).toBe('timed_out')
  })

  it('wires operationId and audit correlation metadata when runId is present', async () => {
    const outcomes: unknown[] = []
    const runId = 'run-teaching-1'
    const toolCallId = 'call-read-1'
    const expectedOperationId = createHash('sha256').update(`${runId}\0${toolCallId}`).digest('hex')

    const dispatcher = new ToolDispatcher({
      handlers: {
        read_workspace_file: async () => JSON.stringify({ ok: true, path: 'MISSION.md' })
      },
      onOutcome: (outcome) => {
        outcomes.push({
          status: outcome.status,
          operationId: outcome.operationId,
          correlation: outcome.correlation
        })
      }
    })

    const outcome = await dispatcher.dispatch(toolCall('read_workspace_file', '{"path":"MISSION.md"}', toolCallId), {
      toolCallId,
      toolName: 'read_workspace_file',
      runId
    })

    expect(outcome.operationId).toBe(expectedOperationId)
    expect(outcome.correlation).toEqual({
      toolCallId,
      runId,
      operationId: expectedOperationId
    })
    expect(outcomes).toEqual([
      {
        status: 'succeeded',
        operationId: expectedOperationId,
        correlation: {
          toolCallId,
          runId,
          operationId: expectedOperationId
        }
      }
    ])
  })

  it('returns failed for unknown tools without inventing a handler', async () => {
    const outcome = await new ToolDispatcher({ handlers: {} }).dispatch(toolCall('unknown_tool', '{}'))
    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(outcome.error.code).toBe('unknown_tool')
      expect(outcome.error.message).toMatch(/未知工具：unknown_tool/)
    }
  })
})

describe('legacy executeToolCall adapter', () => {
  it('preserves ToolExecutionResult shape and structured handler error isError detection', async () => {
    const ok = await executeToolCall(
      {
        web_search: async (args) => JSON.stringify({ ok: true, args })
      },
      toolCall('web_search', '{"query":"rag"}')
    )
    expect(ok).toEqual({
      toolCallId: 'call-web_search',
      name: 'web_search',
      content: '{"ok":true,"args":{"query":"rag"}}',
      isError: false
    })

    const returnedError = await executeToolCall(
      {
        web_fetch: async () => JSON.stringify({ error: '缺少参数 url。' })
      },
      toolCall('web_fetch', '{}')
    )
    expect(returnedError.isError).toBe(true)
    expect(returnedError.content).toContain('缺少参数 url')

    const illegal = await executeToolCall(
      {
        web_search: async () => JSON.stringify({ ok: true })
      },
      toolCall('web_search', 'not json')
    )
    expect(illegal.isError).toBe(true)
    expect(illegal.content).toMatch(/合法 JSON|invalid_tool_arguments|工具参数/)
  })

  it('maps ToolOutcome statuses through toolOutcomeToExecutionResult', () => {
    const result = toolOutcomeToExecutionResult({
      toolCallId: 'c1',
      name: 'web_search',
      effectClass: 'external_write',
      correlation: { toolCallId: 'c1' },
      status: 'denied',
      content: JSON.stringify({ error: 'denied', code: 'tool_not_allowed' }),
      error: { code: 'tool_not_allowed', message: 'denied' },
      isError: true
    })
    expect(result.isError).toBe(true)
    expect(result.toolCallId).toBe('c1')
  })
})
