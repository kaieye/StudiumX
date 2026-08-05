import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import type { ToolDefinition } from '../../src/main/ai/provider-adapter'

const DSML_TOOL_CALL = '<｜｜DSML｜｜tool_calls>\n' +
  '<｜｜DSML｜｜invoke name="web_search">\n' +
  '<｜｜DSML｜｜parameter name="query" string="true">RAG interview</｜｜DSML｜｜parameter>\n' +
  '</｜｜DSML｜｜invoke>\n' +
  '</｜｜DSML｜｜tool_calls>'

const requests: Array<{ messages?: Array<{ role?: string }>; tools?: unknown[] }> = []

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = Buffer.concat(chunks).toString('utf8')
  const parsed = (body ? JSON.parse(body) : {}) as { messages?: Array<{ role?: string }>; tools?: unknown[] }
  requests.push(parsed)
  const hasToolResult = parsed.messages?.some((message) => message.role === 'tool') === true
  const content = hasToolResult
    ? 'Done after the tool result.'
    : DSML_TOOL_CALL

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content
        }
      }
    ]
  }))
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
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    }
  }
} satisfies ToolDefinition

let tempRoot = ''

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-loop-empty-final-'))
  const settings = defaultSettings(join(tempRoot, 'workspaces'))
  settings.provider.activeProviderId = 'custom'
  settings.generator.providerId = 'custom'
  settings.generator.model = 'fake-chat-model'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = true
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

  const statuses: string[] = []
  const result = await runAgentLoop({
    settings,
    provider,
    messages: [
      { role: 'system', content: 'Use tools when needed.' },
      { role: 'user', content: 'Prepare a RAG interview lesson.' }
    ],
    tools: [webSearchTool],
    toolHandlers: {
      web_search: async () => JSON.stringify({ count: 0, results: [] })
    },
    callbacks: {
      onEvent: (event) => {
        if (event.type === 'status') statuses.push(event.status)
      }
    }
  })

  assert.equal(requests.length, 2, 'the agent loop should continue after a tool result until the model returns a final answer')
  assert.equal(result.stopReason, 'final_answer')
  assert.equal(result.finalText, 'Done after the tool result.')
  assert.ok(
    Array.isArray(requests[1]?.tools) && requests[1]!.tools!.length > 0,
    'continuous continuation should keep tools available on the post-tool model turn'
  )
  assert.ok(statuses.includes('tool_done'), 'the tool round should emit completion before normal finalization')

  console.log('agent loop empty final guard ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
