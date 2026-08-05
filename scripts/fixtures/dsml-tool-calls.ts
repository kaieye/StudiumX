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
  '<｜｜DSML｜｜parameter name="query" string="true">Claude Code agent features loop</｜｜DSML｜｜parameter>\n' +
  '<｜｜DSML｜｜parameter name="maxResults" string="false">5</｜｜DSML｜｜parameter>\n' +
  '</｜｜DSML｜｜invoke>\n' +
  '</｜｜DSML｜｜tool_calls>'

const requests: Array<{
  method: string | undefined
  url: string | undefined
  body: { messages?: Array<{ role: string; content?: string; tool_call_id?: string }> }
}> = []

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = Buffer.concat(chunks).toString('utf8')
  requests.push({
    method: req.method,
    url: req.url,
    body: body ? JSON.parse(body) : {}
  })

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unexpected route' }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: requests.length === 1 ? DSML_TOOL_CALL : '没有搜索到相关结果。'
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
        query: { type: 'string' },
        maxResults: { type: 'number' }
      },
      required: ['query']
    }
  }
} satisfies ToolDefinition

let tempRoot = ''
let capturedArgs: unknown = null

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-dsml-tool-calls-'))
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

  const result = await runAgentLoop({
    settings,
    provider,
    messages: [
      { role: 'system', content: 'Use tools when needed.' },
      { role: 'user', content: 'Search for Claude Code agent features loop.' }
    ],
    tools: [webSearchTool],
    toolHandlers: {
      web_search: async (args) => {
        capturedArgs = args
        return JSON.stringify({ query: (args as { query?: string }).query, count: 0, results: [] })
      }
    }
  })

  assert.equal(requests.length, 2, 'DSML content tool calls should continue the agent loop')
  assert.deepEqual(capturedArgs, {
    query: 'Claude Code agent features loop',
    maxResults: 5
  })
  assert.equal(result.finalText, '没有搜索到相关结果。')
  assert.ok(!result.finalText.includes('DSML'), 'final answer must not expose raw DSML markers')

  const firstAssistant = result.messages.find((message) => message.role === 'assistant')
  assert.equal(firstAssistant?.role, 'assistant')
  assert.equal(firstAssistant.content, null)
  assert.equal(firstAssistant.tool_calls?.[0]?.function.name, 'web_search')
  assert.ok(
    requests[1]?.body.messages?.some((message) => message.role === 'tool' && message.content?.includes('"count":0')),
    'tool result should be sent back to the provider'
  )

  console.log('dsml tool calls ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
