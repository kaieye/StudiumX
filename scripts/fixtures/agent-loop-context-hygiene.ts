import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import { ContextEstimator } from '../../src/main/ai/context-estimator'
import { applyRequestHistoryHygiene } from '../../src/main/ai/request-history-hygiene'
import type { ChatMessage, ToolCall, ToolDefinition } from '../../src/main/ai/provider-adapter'

type RecordedRequest = {
  messages?: Array<{ role?: string; content?: unknown; tool_call_id?: string; tool_calls?: unknown[] }>
  tools?: unknown[]
  tool_choice?: unknown
}

const requests: RecordedRequest[] = []
let callCount = 0

const makeToolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RecordedRequest
  requests.push(body)

  const toolResults = body.messages?.filter((message) => message.role === 'tool') ?? []
  let message: { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  if (toolResults.length === 0) {
    message = {
      role: 'assistant',
      content: '',
      tool_calls: [makeToolCall('call-old', 'read_workspace_file', { path: 'old.md' })]
    }
  } else if (toolResults.length === 1) {
    message = {
      role: 'assistant',
      content: '',
      tool_calls: [makeToolCall('call-new', 'read_workspace_file', { path: 'new.md' })]
    }
  } else {
    message = { role: 'assistant', content: 'Final answer with bounded tool context.' }
  }
  callCount += 1

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message }] }))
})

const listen = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => resolve())
})

const close = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.close((error) => error ? reject(error) : resolve())
})

const readTool = {
  type: 'function',
  function: {
    name: 'read_workspace_file',
    description: 'Read a workspace file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  }
} satisfies ToolDefinition

const assertPureHygiene = (): void => {
  const estimator = new ContextEstimator()
  assert.equal(estimator.estimateText('aaaaaaaa'), 2, 'ASCII should be packed at roughly four chars per token')
  assert.equal(estimator.estimateText('汉字测试'), 4, 'CJK should count close to one token per character')

  const oldOutput = [
    'old line 0',
    ...Array.from({ length: 260 }, (_, index) => index === 120 ? 'ERROR important failure line' : `old filler ${index}`),
    'old final line'
  ].join('\n')
  const newestOutput = Array.from({ length: 300 }, (_, index) => `newest full line ${index}`).join('\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Use tools.' },
    { role: 'user', content: 'Read files.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [makeToolCall('old-call', 'read_workspace_file', { path: 'old.md', content: 'x'.repeat(12_000) })]
    },
    { role: 'tool', tool_call_id: 'old-call', content: oldOutput },
    {
      role: 'assistant',
      content: null,
      tool_calls: [makeToolCall('new-call', 'read_workspace_file', { path: 'new.md' })]
    },
    { role: 'tool', tool_call_id: 'new-call', content: newestOutput }
  ]

  const hygiened = applyRequestHistoryHygiene(messages, {
    maxToolResultLines: 80,
    maxToolResultBytes: 4 * 1024,
    maxToolResultTokens: 1_000,
    maxToolArgumentStringBytes: 512,
    maxToolArgumentStringTokens: 128,
    maxCumulativeToolResultTokens: 1_000,
    keepRecentToolResults: 1
  }, estimator)

  assert.equal(hygiened.changed, true)
  assert.ok(hygiened.savedTokens > 0, 'hygiene should report saved local tokens')
  assert.match(hygiened.messages[2]?.role === 'assistant' ? hygiened.messages[2].tool_calls?.[0]?.function.arguments ?? '' : '', /context hygiene/)
  assert.match(hygiened.messages[3]?.role === 'tool' ? hygiened.messages[3].content : '', /context hygiene/)
  assert.match(hygiened.messages[3]?.role === 'tool' ? hygiened.messages[3].content : '', /ERROR important failure line/)
  assert.equal(hygiened.messages[5]?.role === 'tool' ? hygiened.messages[5].content : '', newestOutput, 'latest tool result should stay complete')
  assert.equal(messages[3]?.role === 'tool' ? messages[3].content : '', oldOutput, 'hygiene must not mutate the source transcript')
}

let tempRoot = ''

try {
  assertPureHygiene()
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-loop-context-hygiene-'))
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

  const oldPayload = Array.from({ length: 420 }, (_, index) =>
    index === 210 ? 'ERROR old payload signal' : `old payload line ${index}`
  ).join('\n')
  const newPayload = Array.from({ length: 420 }, (_, index) => `new payload line ${index}`).join('\n')
  const events: AgentLoopEvent[] = []
  const result = await runAgentLoop({
    settings,
    provider,
    messages: [
      { role: 'system', content: 'Use tools when useful.' },
      { role: 'user', content: 'Read two files.' }
    ],
    tools: [readTool],
    toolHandlers: {
      read_workspace_file: async (args) => {
        const path = (args as { path?: string }).path
        return path === 'old.md' ? oldPayload : newPayload
      }
    },
    callbacks: { onEvent: (event) => events.push(event) }
  })

  assert.equal(result.stopReason, 'final_answer')
  assert.equal(result.finalText, 'Final answer with bounded tool context.')
  assert.equal(callCount, 3)
  assert.equal(requests.length, 3)
  const finalRequestTools = requests[2]?.messages?.filter((message) => message.role === 'tool') ?? []
  assert.equal(finalRequestTools.length, 2)
  const sentOld = String(finalRequestTools.find((message) => message.tool_call_id === 'call-old')?.content ?? '')
  const sentNew = String(finalRequestTools.find((message) => message.tool_call_id === 'call-new')?.content ?? '')
  assert.match(sentOld, /context hygiene/)
  assert.match(sentOld, /ERROR old payload signal/)
  assert.ok(sentOld.length < oldPayload.length, 'old tool result should be shortened in the provider request')
  assert.equal(sentNew, newPayload, 'most recent tool result should be sent in full')

  const storedOld = result.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-old')
  const storedNew = result.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-new')
  assert.equal(storedOld?.role === 'tool' ? storedOld.content : '', oldPayload, 'result transcript should keep full old tool result')
  assert.equal(storedNew?.role === 'tool' ? storedNew.content : '', newPayload, 'result transcript should keep full latest tool result')

  const changedHygiene = events.find(
    (event): event is Extract<AgentLoopEvent, { type: 'context_hygiene_applied' }> =>
      event.type === 'context_hygiene_applied' && event.changed
  )
  assert.ok(changedHygiene, 'loop should emit a hygiene diagnostic when a request projection changes')
  assert.ok(changedHygiene.savedTokens > 0)
  assert.ok(events.some((event) => event.type === 'context_estimated' && event.estimate.totalTokens > 0))

  console.log('agent loop context hygiene ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
