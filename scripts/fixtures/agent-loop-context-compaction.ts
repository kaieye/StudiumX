import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import type { ChatMessage, ToolCall, ToolDefinition } from '../../src/main/ai/provider-adapter'

type Scenario = 'summary-success' | 'summary-failure'
type RequestKind = 'summary' | 'main'

type ProviderMessage = {
  role?: string
  content?: unknown
  tool_call_id?: string
  tool_calls?: unknown[]
}

type RecordedRequest = {
  scenario: Scenario
  kind: RequestKind
  body: {
    messages?: ProviderMessage[]
    tools?: unknown[]
    tool_choice?: unknown
  }
}

const LATEST_USER_SENTINEL = 'LATEST_USER_CONTEXT_COMPACTION_SENTINEL'
const OLD_HISTORY_SENTINEL = 'OLD_CONTEXT_COMPACTION_HISTORY_SENTINEL'
const OLD_TOOL_RESULT_SENTINEL = 'OLD_TOOL_RESULT_CONTEXT_COMPACTION_SENTINEL'
const RECENT_TOOL_ID = 'call-recent-context-compaction'
const RECENT_TOOL_RESULT_SENTINEL = 'RECENT_TOOL_RESULT_CONTEXT_COMPACTION_SENTINEL'
const SUMMARY_TEXT = [
  'Preserved constraints: keep workspace edits narrow and answer the latest request.',
  'Historical task snapshot: the old repeated study-plan discussion was completed.',
  'Resolved decisions: prefer local fake providers in tests.',
  'Open facts: old transcript content was compacted, not deleted.',
  'Recent work state: continue from the retained tail.'
].join('\n')

let scenario: Scenario = 'summary-success'
const requests: RecordedRequest[] = []

const makeToolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RecordedRequest['body']
  const kind = classifyRequest(body)
  requests.push({ scenario, kind, body })

  if (kind === 'summary') {
    if (scenario === 'summary-failure') {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'simulated summary failure' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: SUMMARY_TEXT } }] }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Final answer after compaction check.' } }] }))
})

const listen = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => resolve())
})

const close = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.close((error) => error ? reject(error) : resolve())
})

const lookupTool = {
  type: 'function',
  function: {
    name: 'lookup_course_fact',
    description: 'Lookup a course fact.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  }
} satisfies ToolDefinition

let tempRoot = ''

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-agent-loop-context-compaction-'))
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

  const runScenario = async (nextScenario: Scenario): Promise<{
    events: Array<Record<string, unknown>>
    result: Awaited<ReturnType<typeof runAgentLoop>>
    originalMessages: ChatMessage[]
    recorded: RecordedRequest[]
  }> => {
    scenario = nextScenario
    requests.length = 0
    const events: Array<Record<string, unknown>> = []
    const originalMessages = buildLongHistory()
    const compactionConfig = {
      enabled: true,
      contextWindowTokens: 1_600,
      softThresholdTokens: 900,
      hardThresholdTokens: 1_200,
      normalTailRatio: 0.35,
      aggressiveTailRatio: 0.25,
      minTailMessages: 4,
      minMessagesToCompact: 4,
      summaryInputTokenLimit: 1_200,
      maxSummaryTokens: 500,
      failureCooldownMs: 10_000
    }
    ;(settings as unknown as { contextCompaction?: unknown }).contextCompaction = compactionConfig

    const result = await runAgentLoop({
      settings,
      provider,
      messages: originalMessages,
      tools: [lookupTool],
      toolHandlers: {
        lookup_course_fact: async () => 'unused in this fixture'
      },
      contextCompaction: compactionConfig,
      callbacks: {
        onEvent: (event: unknown) => {
          if (isRecord(event)) events.push(event)
        }
      }
    } as Parameters<typeof runAgentLoop>[0] & { contextCompaction?: unknown })

    return { events, result, originalMessages, recorded: [...requests] }
  }

  const success = await runScenario('summary-success')
  assert.equal(success.result.stopReason, 'final_answer')
  assert.equal(success.result.finalText, 'Final answer after compaction check.')
  assert.ok(
    success.recorded.some((request) => request.kind === 'summary'),
    'long history should trigger a summary provider request before the main call'
  )

  const successMain = latestMainRequest(success.recorded)
  const successMessages = successMain.body.messages ?? []
  const sentText = serializeProviderMessages(successMessages)
  assert.match(sentText, /CONTEXT COMPACTION/i, 'provider request should include a compaction summary marker')
  assert.match(sentText, /REFERENCE ONLY/i, 'compaction summary should be marked reference-only')
  assert.match(sentText, /latest user message/i, 'summary wrapper should make the latest user message authoritative')
  assert.match(sentText, /Preserved constraints/i, 'provider request should include the generated summary content')
  assert.match(sentText, new RegExp(LATEST_USER_SENTINEL), 'latest user message should remain in the provider request')
  assert.ok(
    countOccurrences(sentText, OLD_HISTORY_SENTINEL) < 3,
    'older repeated history should be replaced by the summary instead of resent verbatim'
  )
  assert.ok(
    successMessages.length < success.originalMessages.length - 10,
    'compacted provider request should contain fewer messages than the original transcript'
  )
  assert.ok(
    byteLength(sentText) < byteLength(serializeMessages(success.originalMessages)) * 0.7,
    'compacted provider request should be materially smaller than the original transcript'
  )
  assert.match(
    serializeMessages(success.result.messages),
    new RegExp(`${OLD_HISTORY_SENTINEL}_0`),
    'result transcript should preserve original old history'
  )
  assert.match(
    serializeMessages(success.result.messages),
    new RegExp(OLD_TOOL_RESULT_SENTINEL),
    'result transcript should preserve original tool output history'
  )
  assert.ok(
    success.result.messages.length >= success.originalMessages.length + 1,
    'result transcript should keep the original history and append the assistant result'
  )
  assertRetainedToolPair(successMessages, RECENT_TOOL_ID, RECENT_TOOL_RESULT_SENTINEL)
  assertNoOrphanToolResults(successMessages)

  const started = requireEvent(success.events, 'context_compaction_started')
  assert.equal(typeof started.reason, 'string')
  assert.equal(typeof started.mode, 'string')
  const completed = requireEvent(success.events, 'context_compaction_completed')
  assert.equal(typeof completed.replacedTokens, 'number')
  assert.equal(typeof completed.summaryTokens, 'number')
  assert.ok(Number(completed.replacedTokens) > 0)
  assert.ok(Number(completed.summaryTokens) > 0)
  assert.ok(
    Number(completed.replacedTokens) > Number(completed.summaryTokens),
    'completed event should report a summary smaller than the replaced history'
  )

  const failure = await runScenario('summary-failure')
  assert.equal(failure.result.stopReason, 'final_answer')
  assert.equal(failure.result.finalText, 'Final answer after compaction check.')
  assert.ok(
    failure.recorded.some((request) => request.kind === 'summary'),
    'failure scenario should attempt summary generation before falling back'
  )
  const failureMain = latestMainRequest(failure.recorded)
  const failureMessages = failureMain.body.messages ?? []
  const failureText = serializeProviderMessages(failureMessages)
  assert.doesNotMatch(
    failureText,
    /CONTEXT COMPACTION[\s\S]*REFERENCE ONLY/i,
    'summary failure should not send a fabricated compaction summary'
  )
  assert.match(
    failureText,
    new RegExp(`${OLD_HISTORY_SENTINEL}_0`),
    'summary failure should fall back to the original old history'
  )
  assert.match(
    failureText,
    new RegExp(LATEST_USER_SENTINEL),
    'latest user message should still be present after summary failure'
  )
  assert.ok(
    failureMessages.length >= failure.originalMessages.length,
    'summary failure should send the original transcript shape to the provider'
  )
  assertRetainedToolPair(failureMessages, RECENT_TOOL_ID, RECENT_TOOL_RESULT_SENTINEL)
  assertNoOrphanToolResults(failureMessages)

  const failed = requireEvent(failure.events, 'context_compaction_failed')
  assert.equal(typeof failed.error, 'string')
  assert.match(String(failed.error), /summary failure|Provider/i)

  console.log('agent loop context compaction scaffold ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

function buildLongHistory(): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Use compacted history only as background. Keep tool pairs valid.' },
    { role: 'user', content: 'Initial setup: we are preparing a long study conversation.' },
    { role: 'assistant', content: 'Acknowledged the setup and constraints.' }
  ]

  for (let index = 0; index < 42; index += 1) {
    messages.push({
      role: 'user',
      content: [
        `${OLD_HISTORY_SENTINEL}_${index}`,
        `Old request ${index}: build a detailed study plan for topic ${index}.`,
        repeatedParagraph(index, 9)
      ].join('\n')
    })
    messages.push({
      role: 'assistant',
      content: [
        `Old answer ${index}: completed the previous study-plan request.`,
        repeatedParagraph(index + 100, 8)
      ].join('\n')
    })
  }

  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [makeToolCall('call-old-context-compaction', 'lookup_course_fact', {
      query: `${OLD_TOOL_RESULT_SENTINEL} older lookup`,
      payload: repeatedParagraph(777, 16)
    })]
  })
  messages.push({
    role: 'tool',
    tool_call_id: 'call-old-context-compaction',
    content: `${OLD_TOOL_RESULT_SENTINEL}\n${repeatedParagraph(888, 24)}`
  })
  messages.push({ role: 'assistant', content: 'The old lookup was resolved and is no longer the active task.' })
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [makeToolCall(RECENT_TOOL_ID, 'lookup_course_fact', { query: 'current tail fact' })]
  })
  messages.push({
    role: 'tool',
    tool_call_id: RECENT_TOOL_ID,
    content: `${RECENT_TOOL_RESULT_SENTINEL}\nFresh tail fact that should not become an orphaned tool result.`
  })
  messages.push({
    role: 'user',
    content: `${LATEST_USER_SENTINEL}: answer only the current question using the retained tail.`
  })
  return messages
}

function classifyRequest(body: RecordedRequest['body']): RequestKind {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0
  const text = serializeProviderMessages(body.messages ?? [])
  return !hasTools && /\b(compact|compaction|summary|summari[sz]e)\b|压缩|摘要/i.test(text)
    ? 'summary'
    : 'main'
}

function latestMainRequest(recorded: RecordedRequest[]): RecordedRequest {
  const main = recorded.filter((request) => request.kind === 'main')
  const latest = main[main.length - 1]
  assert.ok(latest, 'expected at least one main provider request')
  return latest
}

function requireEvent(events: Array<Record<string, unknown>>, type: string): Record<string, unknown> {
  const event = events.find((item) => item.type === type)
  assert.ok(event, `expected ${type} event`)
  return event
}

function assertNoOrphanToolResults(messages: ProviderMessage[]): void {
  const toolCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      const id = isRecord(call) && typeof call.id === 'string' ? call.id : ''
      if (id) toolCallIds.add(id)
    }
  }
  for (const message of messages) {
    if (message.role !== 'tool') continue
    assert.ok(
      typeof message.tool_call_id === 'string' && toolCallIds.has(message.tool_call_id),
      `provider request must not contain orphan tool result ${String(message.tool_call_id ?? '')}`
    )
  }
}

function assertRetainedToolPair(messages: ProviderMessage[], toolCallId: string, resultSentinel: string): void {
  const assistant = messages.find((message) =>
    message.role === 'assistant' &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.some((call) => isRecord(call) && call.id === toolCallId)
  )
  const tool = messages.find((message) =>
    message.role === 'tool' &&
    message.tool_call_id === toolCallId &&
    contentToText(message.content).includes(resultSentinel)
  )
  assert.ok(assistant, `provider request should retain assistant tool call ${toolCallId}`)
  assert.ok(tool, `provider request should retain paired tool result ${toolCallId}`)
}

function serializeMessages(messages: ChatMessage[]): string {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return `${message.role}:${message.content ?? ''}:${JSON.stringify(message.tool_calls ?? [])}`
    }
    if (message.role === 'tool') return `${message.role}:${message.tool_call_id}:${message.content}`
    return `${message.role}:${message.content}`
  }).join('\n')
}

function serializeProviderMessages(messages: ProviderMessage[]): string {
  return messages.map((message) => {
    const content = contentToText(message.content)
    const calls = Array.isArray(message.tool_calls) ? JSON.stringify(message.tool_calls) : ''
    return `${message.role ?? ''}:${message.tool_call_id ?? ''}:${content}:${calls}`
  }).join('\n')
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) return content.map(contentToText).join('\n')
  if (isRecord(content) && typeof content.text === 'string') return content.text
  return JSON.stringify(content)
}

function repeatedParagraph(seed: number, repeats: number): string {
  return Array.from({ length: repeats }, (_, index) =>
    `historical filler ${seed}.${index}: concept map, exercise notes, constraints, and resolved decisions.`
  ).join(' ')
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let index = 0
  while (index < text.length) {
    const next = text.indexOf(needle, index)
    if (next < 0) break
    count += 1
    index = next + needle.length
  }
  return count
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
