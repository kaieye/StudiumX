import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import type { ToolCall } from '../../src/main/ai/provider-adapter'
import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { createDelegationToolEntries } from '../../src/main/ai/tools/delegation'
import { childRegistryForProfile } from '../../src/main/ai/delegation-runtime'

type RecordedRequest = {
  phase: 'parent' | 'child'
  body: {
    messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }>
    tools?: Array<{ function?: { name?: string } }>
    tool_choice?: unknown
  }
}

const requests: RecordedRequest[] = []
let scenario: 'success' | 'child-error' = 'success'

const makeToolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

function requestPhase(body: RecordedRequest['body']): 'parent' | 'child' {
  const firstContent = String(body.messages?.[0]?.content ?? '')
  return firstContent.includes('只读 child agent') ? 'child' : 'parent'
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as RecordedRequest['body']
  const phase = requestPhase(body)
  requests.push({ phase, body })

  const reply = (message: Record<string, unknown>): void => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message }] }))
  }

  if (phase === 'parent') {
    const toolResult = body.messages?.find((message) => message.role === 'tool')
    if (toolResult) {
      const payload = JSON.parse(String(toolResult.content ?? '{}')) as { status?: string; summary?: string }
      reply({ role: 'assistant', content: `父任务已整合：${payload.status} ${payload.summary ?? ''}` })
      return
    }
    reply({
      role: 'assistant',
      content: null,
      tool_calls: [
        makeToolCall('call-delegate', 'delegate_task', {
          label: '检查 mission',
          prompt: '读取 MISSION.md，并用一句话总结学习目标。',
          profile: 'read_only',
          maxIterations: 3
        })
      ]
    })
    return
  }

  if (scenario === 'child-error') {
    reply({ role: 'assistant', content: null, tool_calls: [makeToolCall('call-denied-write', 'write_workspace_file', { path: 'NOTES.md', content: 'bad' })] })
    return
  }

  const hasToolResult = body.messages?.some((message) => message.role === 'tool') ?? false
  if (!hasToolResult) {
    reply({
      role: 'assistant',
      content: null,
      tool_calls: [makeToolCall('call-read-mission', 'read_workspace_file', { path: 'MISSION.md' })]
    })
    return
  }
  reply({ role: 'assistant', content: 'MISSION.md 表明学习目标是掌握 RAG 面试解释。' })
})

const listen = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => resolve())
})

const close = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.close((error) => error ? reject(error) : resolve())
})

let tempRoot = ''

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-agent-delegation-'))
  await writeFile(join(tempRoot, 'MISSION.md'), '# Mission\n\n掌握 RAG 面试解释。\n', 'utf8')

  const settings = defaultSettings(join(tempRoot, 'workspaces'))
  settings.provider.activeProviderId = 'custom'
  settings.generator.providerId = 'custom'
  settings.generator.model = 'fake-chat-model'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.webSearch = true
  settings.tools.webFetch = true
  settings.tools.maxIterations = 4
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

  const childReadOnly = childRegistryForProfile({ settings, workspaceRoot: tempRoot, profile: 'read_only' })
  const childAudit = childRegistryForProfile({ settings, workspaceRoot: tempRoot, profile: 'workspace_audit' })
  assert.equal(childReadOnly.definitions().some((tool) => tool.function.name === 'write_workspace_file'), false)
  assert.equal(childReadOnly.definitions().some((tool) => tool.function.name === 'delegate_task'), false)
  assert.equal(childReadOnly.definitions().some((tool) => tool.function.name === 'web_search'), true)
  assert.equal(childAudit.definitions().some((tool) => tool.function.name === 'web_search'), false)

  const parentRegistry = buildDefaultRegistry(settings, { workspaceRoot: tempRoot, workspaceWrite: true })
  for (const tool of createDelegationToolEntries({ provider, streamId: 'delegation-test-stream' })) {
    parentRegistry.register(tool)
  }
  assert.equal(parentRegistry.definitions().some((tool) => tool.function.name === 'delegate_task'), true)
  assert.equal(parentRegistry.definitions().some((tool) => tool.function.name === 'write_workspace_file'), true)

  const runParent = async (): Promise<{ events: AgentLoopEvent[]; result: Awaited<ReturnType<typeof runAgentLoop>> }> => {
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop({
      settings,
      provider,
      messages: [
        { role: 'system', content: 'Use delegation for independent read-only work.' },
        { role: 'user', content: '检查当前 mission。' }
      ],
      tools: parentRegistry.definitions(),
      toolHandlers: parentRegistry.handlerMap(buildToolContext(settings, { workspaceRoot: tempRoot })),
      maxIterations: 4,
      callbacks: { onEvent: (event) => events.push(event) }
    })
    return { events, result }
  }

  scenario = 'success'
  requests.length = 0
  const success = await runParent()
  assert.equal(success.result.stopReason, 'final_answer')
  assert.match(success.result.finalText, /父任务已整合：completed/)
  assert.equal(success.result.messages.filter((message) => message.role === 'tool').length, 1, 'parent transcript should store only the delegation tool result')
  const delegationPayload = JSON.parse(String(success.result.messages.find((message) => message.role === 'tool')?.content ?? '{}')) as {
    status?: string
    summary?: string
    filesRead?: string[]
    usage?: { toolCalls?: number }
  }
  assert.equal(delegationPayload.status, 'completed')
  assert.match(delegationPayload.summary ?? '', /MISSION\.md/)
  assert.deepEqual(delegationPayload.filesRead, ['MISSION.md'])
  assert.equal(delegationPayload.usage?.toolCalls, 1)
  assert.ok(success.events.some((event) => event.type === 'child_run_started'))
  assert.ok(success.events.some((event) => event.type === 'child_run_completed'))
  assert.equal(
    success.events.some((event) => event.type === 'tool_call' && event.toolCall.function.name === 'read_workspace_file'),
    false,
    'child tool calls should not be emitted as parent tool calls'
  )

  const childFirstRequest = requests.find((request) => request.phase === 'child')
  assert.ok(childFirstRequest)
  const childToolNames = childFirstRequest.body.tools?.map((tool) => tool.function?.name).filter(Boolean) ?? []
  assert.ok(childToolNames.includes('read_workspace_file'))
  assert.ok(!childToolNames.includes('write_workspace_file'))
  assert.ok(!childToolNames.includes('ask'))
  assert.ok(!childToolNames.includes('generate_lesson'))
  assert.ok(!childToolNames.includes('delegate_task'))

  scenario = 'child-error'
  requests.length = 0
  const childError = await runParent()
  const failedPayload = JSON.parse(String(childError.result.messages.find((message) => message.role === 'tool')?.content ?? '{}')) as {
    status?: string
    summary?: string
    error?: string
  }
  assert.equal(failedPayload.status, 'failed')
  assert.match(failedPayload.summary ?? '', /未知工具：write_workspace_file/)
  assert.ok(childError.events.some((event) => event.type === 'child_run_failed'))
  assert.equal(childError.result.stopReason, 'final_answer', 'child failure should not crash the parent loop')

  console.log('agent delegation runtime ok')
} finally {
  await close(server).catch(() => undefined)
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
