import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runAgentLoop, type AgentLoopEvent } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { ToolDefinition } from '../../src/main/ai/provider-adapter'

type Scenario = 'provider' | 'tool' | 'token' | 'missing' | 'reported' | 'warning'
let scenario: Scenario = 'reported'
let calls = 0

const tool = {
  type: 'function',
  function: {
    name: 'budget_tool',
    description: 'budget test tool',
    parameters: { type: 'object', properties: {} }
  }
} satisfies ToolDefinition

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: unknown[]; messages?: Array<{ role?: string }> }
  calls += 1
  const hasToolResult = body.messages?.some((message) => message.role === 'tool') === true
  const toolCalls = scenario === 'tool'
    ? [
        { id: 'tool-1', type: 'function', function: { name: 'budget_tool', arguments: '{}' } },
        { id: 'tool-2', type: 'function', function: { name: 'budget_tool', arguments: '{}' } }
      ]
    : [{ id: `tool-${calls}`, type: 'function', function: { name: 'budget_tool', arguments: '{}' } }]
  const needsTool = scenario === 'provider' || scenario === 'token' || scenario === 'warning' || scenario === 'tool'
  const forceFinal = !body.tools || body.tools.length === 0
  const message = needsTool && !hasToolResult && !forceFinal
    ? { role: 'assistant', content: '', tool_calls: toolCalls }
    : scenario === 'provider' && !forceFinal
      ? { role: 'assistant', content: '', tool_calls: toolCalls }
      : { role: 'assistant', content: 'safe final' }
  const usage = scenario === 'missing'
    ? undefined
    : scenario === 'token'
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

const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-budget-'))

try {
  await listen()
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const settings = defaultSettings(root)
  settings.provider.activeProviderId = 'custom'
  settings.generator.providerId = 'custom'
  settings.generator.model = 'budget-model'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = true
  settings.provider.providers = settings.provider.providers.map((provider) => provider.id === 'custom'
    ? { ...provider, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test-key', models: ['budget-model'] }
    : provider)
  const provider = settings.provider.providers.find((item) => item.id === 'custom')
  assert.ok(provider)
  const messages = [{ role: 'user' as const, content: 'test budget' }]
  const run = async (next: Scenario, budget: Parameters<typeof runAgentLoop>[0]['budget'], now?: () => number) => {
    scenario = next
    calls = 0
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop({
      settings,
      provider,
      messages,
      tools: [tool],
      toolHandlers: { budget_tool: async () => '{"ok":true}' },
      budget,
      now,
      callbacks: { onEvent: (event) => events.push(event) }
    })
    return { result, events, calls }
  }

  const providerLimited = await run('provider', { maxProviderCalls: 1 })
  assert.equal(providerLimited.result.stopReason, 'budget_exhausted')
  assert.equal(providerLimited.result.usage.budgetStopReason, 'provider_calls')
  assert.equal(providerLimited.result.usage.providerCalls, 1)
  assert.equal(providerLimited.calls, 1)

  const toolLimited = await run('tool', { maxToolCalls: 1 })
  assert.equal(toolLimited.result.stopReason, 'budget_exhausted')
  assert.equal(toolLimited.result.finalText, 'safe final')
  assert.equal(toolLimited.result.usage.budgetStopReason, 'tool_calls')
  assert.equal(toolLimited.result.usage.toolCalls, 1)
  assert.equal(toolLimited.result.usage.providerCalls, 2)

  const tokenLimited = await run('token', { maxTotalTokens: 1000 })
  assert.equal(tokenLimited.result.stopReason, 'budget_exhausted')
  assert.equal(tokenLimited.result.usage.budgetStopReason, 'total_tokens')
  assert.equal(tokenLimited.result.usage.totalTokens, 1000)
  assert.equal(tokenLimited.result.usage.toolCalls, 0)

  const missing = await run('missing', {})
  assert.equal(missing.result.stopReason, 'final_answer')
  assert.equal(missing.result.usage.promptTokens, undefined)
  assert.equal(missing.result.usage.completionTokens, undefined)
  assert.equal(missing.result.usage.totalTokens, undefined)

  const reported = await run('reported', {})
  assert.deepEqual({
    promptTokens: reported.result.usage.promptTokens,
    completionTokens: reported.result.usage.completionTokens,
    totalTokens: reported.result.usage.totalTokens
  }, { promptTokens: 10, completionTokens: 5, totalTokens: 15 })

  const warning = await run('warning', { maxProviderCalls: 2, warningThreshold: 0.5 })
  assert.equal(warning.events.filter((event) => event.type === 'status' && event.message?.includes('接近安全预算')).length, 1)
  assert.equal(warning.events.some((event) => event.type === 'status' && /test budget|test-key|价格/.test(event.message ?? '')), false)
  const warningEventIndex = warning.events.findIndex((event) => event.type === 'status' && event.message?.includes('接近安全预算'))
  const firstToolCallIndex = warning.events.findIndex((event) => event.type === 'tool_call')
  assert.ok(warningEventIndex >= 0 && firstToolCallIndex >= 0)
  assert.ok(warningEventIndex < firstToolCallIndex, 'budget warning must be emitted before the newly budgeted tool call')

  let time = 0
  const duration = await run('reported', { maxDurationMs: 5000 }, () => {
    const value = time
    time += 6000
    return value
  })
  assert.equal(duration.result.stopReason, 'budget_exhausted')
  assert.equal(duration.result.usage.budgetStopReason, 'duration')
  assert.equal(duration.calls, 0)

  console.log('agent run budget and provider usage boundaries ok')
} finally {
  await close().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
