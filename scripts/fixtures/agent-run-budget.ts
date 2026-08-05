import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runAgentLoop, type AgentLoopEvent } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { ToolDefinition } from '../../src/main/ai/provider-adapter'

type Scenario = 'provider-observability' | 'tool-observability' | 'token-observability' | 'missing-usage'
let scenario: Scenario = 'provider-observability'
let calls = 0

const tool = {
  type: 'function',
  function: {
    name: 'usage_tool',
    description: 'usage observability test tool',
    parameters: { type: 'object', properties: {} }
  }
} satisfies ToolDefinition

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages?: Array<{ role?: string }> }
  calls += 1
  const hasToolResult = body.messages?.some((message) => message.role === 'tool') === true
  const toolCalls = scenario === 'tool-observability'
    ? [
        { id: 'tool-1', type: 'function', function: { name: 'usage_tool', arguments: '{}' } },
        { id: 'tool-2', type: 'function', function: { name: 'usage_tool', arguments: '{}' } }
      ]
    : [{ id: 'tool-1', type: 'function', function: { name: 'usage_tool', arguments: '{}' } }]
  const wantsTool = scenario !== 'missing-usage'
  const message = wantsTool && !hasToolResult
    ? { role: 'assistant', content: '', tool_calls: toolCalls }
    : { role: 'assistant', content: 'safe final' }
  const usage = scenario === 'missing-usage'
    ? undefined
    : scenario === 'token-observability'
      ? { prompt_tokens: 700, completion_tokens: 300, total_tokens: 1000 }
      : { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message }], ...(usage ? { usage } : {}) }))
})

const listen = (): Promise<void> => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve())
})
const close = (): Promise<void> => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))

const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-usage-observability-'))

try {
  await listen()
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const settings = defaultSettings(root)
  settings.provider.activeProviderId = 'custom'
  settings.generator.providerId = 'custom'
  settings.generator.model = 'usage-model'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.provider.providers = settings.provider.providers.map((provider) => provider.id === 'custom'
    ? { ...provider, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test-key', models: ['usage-model'] }
    : provider)
  const provider = settings.provider.providers.find((item) => item.id === 'custom')
  assert.ok(provider)
  const messages = [{ role: 'user' as const, content: 'test local usage observability' }]
  const run = async (next: Scenario) => {
    scenario = next
    calls = 0
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop({
      settings,
      provider,
      messages,
      tools: [tool],
      toolHandlers: { usage_tool: async () => '{"ok":true}' },
      callbacks: { onEvent: (event) => events.push(event) }
    })
    return { result, events, calls }
  }

  const providerUsage = await run('provider-observability')
  assert.equal(providerUsage.result.stopReason, 'final_answer')
  assert.equal(providerUsage.result.usage.providerCalls, 2)
  assert.equal(providerUsage.result.usage.toolCalls, 1)
  assert.equal(providerUsage.result.finalText, 'safe final')
  assert.equal('budgetStopReason' in providerUsage.result.usage, false)

  const toolUsage = await run('tool-observability')
  assert.equal(toolUsage.result.stopReason, 'final_answer')
  assert.equal(toolUsage.result.usage.providerCalls, 2)
  assert.equal(toolUsage.result.usage.toolCalls, 2)
  assert.equal(toolUsage.result.finalText, 'safe final')

  const tokenUsage = await run('token-observability')
  assert.equal(tokenUsage.result.stopReason, 'final_answer')
  assert.equal(tokenUsage.result.usage.promptTokens, 1400)
  assert.equal(tokenUsage.result.usage.completionTokens, 600)
  assert.equal(tokenUsage.result.usage.totalTokens, 2000)
  assert.equal(tokenUsage.result.usage.providerCalls, 2)

  const missing = await run('missing-usage')
  assert.equal(missing.result.stopReason, 'final_answer')
  assert.equal(missing.result.usage.promptTokens, undefined)
  assert.equal(missing.result.usage.completionTokens, undefined)
  assert.equal(missing.result.usage.totalTokens, undefined)

  console.log('agent run usage observability remains non-authoritative')
} finally {
  await close().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
