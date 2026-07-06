import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import type { ToolCall, ToolDefinition } from '../../src/main/ai/provider-adapter'
import type { ToolHandlerMap } from '../../src/main/ai/tools/registry'

type Scenario = 'no-tools' | 'single-tool' | 'multi-tool' | 'tool-error' | 'max-iterations'

type RecordedRequest = {
  scenario: Scenario
  body: {
    messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown[] }>
    tools?: unknown[]
    tool_choice?: unknown
  }
}

const requests: RecordedRequest[] = []
let scenario: Scenario = 'no-tools'

const makeToolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RecordedRequest['body']
  requests.push({ scenario, body })

  const toolResults = body.messages?.filter((message) => message.role === 'tool') ?? []
  const responseMessage = (() => {
    if (scenario === 'no-tools') {
      return { role: 'assistant', content: 'Final answer without tools.' }
    }
    if (scenario === 'single-tool') {
      if (toolResults.length > 0) return { role: 'assistant', content: 'Final answer after one tool.' }
      return {
        role: 'assistant',
        content: '',
        tool_calls: [makeToolCall('call-search', 'web_search', { query: 'RAG', maxResults: 2 })]
      }
    }
    if (scenario === 'multi-tool') {
      if (toolResults.length > 0) return { role: 'assistant', content: 'Final answer after two tools.' }
      return {
        role: 'assistant',
        content: '',
        tool_calls: [
          makeToolCall('call-search', 'web_search', { query: 'RAG' }),
          makeToolCall('call-fetch', 'web_fetch', { url: 'https://example.com/rag' })
        ]
      }
    }
    if (scenario === 'tool-error') {
      if (toolResults.length > 0) {
        const content = String(toolResults[0]?.content ?? '')
        return { role: 'assistant', content: `Recovered from ${content}` }
      }
      return {
        role: 'assistant',
        content: '',
        tool_calls: [makeToolCall('call-broken', 'broken_tool', { value: true })]
      }
    }
    if (toolResults.length > 0) return { role: 'assistant', content: 'Forced final after max iterations.' }
    return {
      role: 'assistant',
      content: '',
      tool_calls: [makeToolCall('call-loop', 'web_search', { query: 'keep going' })]
    }
  })()

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: responseMessage }] }))
})

const listen = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => resolve())
})

const close = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.close((error) => error ? reject(error) : resolve())
})

const webSearchTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  }
} satisfies ToolDefinition

const webFetchTool = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description: 'Fetch a URL.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  }
} satisfies ToolDefinition

let tempRoot = ''

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-agent-loop-baseline-'))
  const settings = defaultSettings(join(tempRoot, 'workspaces'))
  settings.provider.activeProviderId = 'custom'
  settings.generator.providerId = 'custom'
  settings.generator.model = 'fake-chat-model'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = true
  settings.tools.maxIterations = 0
  settings.provider.providers = settings.provider.providers.map((provider) =>
    provider.id === 'custom'
      ? {
          ...provider,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'test-key',
          models: ['fake-chat-model']
        }
      : provider
  )
  const provider = settings.provider.providers.find((item) => item.id === 'custom')
  assert.ok(provider)

  const baseMessages = [
    { role: 'system' as const, content: 'Use tools when needed.' },
    { role: 'user' as const, content: 'Teach RAG.' }
  ]
  const toolHandlers = {
    web_search: async (args: unknown) => JSON.stringify({ tool: 'web_search', args }),
    web_fetch: async (args: unknown) => JSON.stringify({ tool: 'web_fetch', args })
  }

  const runScenario = async (nextScenario: Scenario, options: {
    maxIterations?: number
    toolHandlers?: ToolHandlerMap
    maxIterationsBehavior?: 'force_final_answer' | 'error'
    signal?: AbortSignal
  } = {}): Promise<{ events: AgentLoopEvent[]; result: Awaited<ReturnType<typeof runAgentLoop>> }> => {
    scenario = nextScenario
    requests.length = 0
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop({
      settings,
      provider,
      messages: baseMessages,
      tools: [webSearchTool, webFetchTool],
      toolHandlers: options.toolHandlers ?? toolHandlers,
      maxIterations: options.maxIterations,
      maxIterationsBehavior: options.maxIterationsBehavior,
      signal: options.signal,
      callbacks: {
        onEvent: (event) => events.push(event)
      }
    })
    return { events, result }
  }

  const noTools = await runScenario('no-tools')
  assert.equal(noTools.result.stopReason, 'final_answer')
  assert.equal(noTools.result.finalText, 'Final answer without tools.')
  assert.equal(noTools.result.iterations, 1)
  assert.equal(requests.length, 1)
  assert.ok(noTools.events.some((event) => event.type === 'token' && event.delta === 'Final answer without tools.'))

  const singleTool = await runScenario('single-tool')
  assert.equal(singleTool.result.stopReason, 'final_answer')
  assert.equal(singleTool.result.finalText, 'Final answer after one tool.')
  assert.equal(singleTool.result.iterations, 2)
  assert.equal(singleTool.result.messages.filter((message) => message.role === 'tool').length, 1)
  assert.equal(singleTool.events.filter((event) => event.type === 'tool_call').length, 1)
  assert.equal(singleTool.events.filter((event) => event.type === 'tool_result' && !event.isError).length, 1)
  assert.equal(requests[1]?.body.messages?.some((message) => message.role === 'tool'), true)

  const multiTool = await runScenario('multi-tool')
  assert.equal(multiTool.result.stopReason, 'final_answer')
  assert.equal(multiTool.result.finalText, 'Final answer after two tools.')
  assert.equal(multiTool.result.messages.filter((message) => message.role === 'tool').length, 2)
  assert.deepEqual(
    multiTool.events
      .filter((event): event is Extract<AgentLoopEvent, { type: 'tool_call' }> => event.type === 'tool_call')
      .map((event) => event.toolCall.function.name),
    ['web_search', 'web_fetch']
  )

  const toolError = await runScenario('tool-error', {
    toolHandlers: {
      ...toolHandlers,
      broken_tool: async () => {
        throw new Error('simulated handler failure')
      }
    }
  })
  assert.equal(toolError.result.stopReason, 'final_answer')
  assert.match(toolError.result.finalText, /simulated handler failure/)
  const errorEvent = toolError.events.find((event): event is Extract<AgentLoopEvent, { type: 'tool_result' }> =>
    event.type === 'tool_result' && event.isError
  )
  assert.ok(errorEvent)
  assert.match(errorEvent.result, /simulated handler failure/)

  const maxIterations = await runScenario('max-iterations', { maxIterations: 1 })
  assert.equal(maxIterations.result.stopReason, 'max_iterations')
  assert.equal(maxIterations.result.finalText, 'Forced final after max iterations.')
  assert.equal(maxIterations.result.iterations, 1)
  assert.equal(requests.length, 2)
  assert.equal(requests[1]?.body.tools, undefined, 'forced final request should omit tools from the provider body')
  assert.equal(requests[1]?.body.tool_choice, undefined, 'forced final request should omit tool_choice from the provider body')
  assert.ok(maxIterations.events.some((event) => event.type === 'status' && event.status === 'answering'))

  const maxIterationsError = await runScenario('max-iterations', {
    maxIterations: 1,
    maxIterationsBehavior: 'error'
  })
  assert.equal(maxIterationsError.result.stopReason, 'max_iterations')
  assert.equal(maxIterationsError.result.finalText, '')
  assert.match(maxIterationsError.result.error ?? '', /达到工具调用上限/)
  assert.equal(requests.length, 1, 'maxIterationsBehavior=error should not make a forced final provider call')
  assert.ok(maxIterationsError.events.some((event) => event.type === 'status' && event.status === 'error'))

  const controller = new AbortController()
  controller.abort()
  const canceled = await runScenario('no-tools', { signal: controller.signal })
  assert.equal(canceled.result.stopReason, 'canceled')
  assert.equal(canceled.result.finalText, '')
  assert.equal(canceled.events.some((event) => event.type === 'status' && event.status === 'canceled'), true)
  assert.equal(requests.length, 0, 'pre-canceled loops should not call the provider')

  console.log('agent loop baseline ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
