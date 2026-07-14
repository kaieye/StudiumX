import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import type { ToolCall } from '../../src/main/ai/provider-adapter'
import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { createDelegationToolEntries } from '../../src/main/ai/tools/delegation'
import { DelegationRuntime, childRegistryForProfile } from '../../src/main/ai/delegation-runtime'
import { AgentRunStore } from '../../src/main/ai/agent-run-store'
import { attachAgentRunAuditMetadata } from '../../src/main/ai/agent-run-audit'

type RecordedRequest = {
  phase: 'parent' | 'child'
  body: {
    messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }>
    tools?: Array<{ function?: { name?: string } }>
    tool_choice?: unknown
  }
}

const requests: RecordedRequest[] = []
let scenario: 'success' | 'child-error' | 'parallel' | 'slow' = 'success'
let resolveSlowChildRequest: (() => void) | undefined

const DELEGATION_STREAM_ID = 'delegation-test-stream'
const CHILD_SYSTEM_MARKER = '只读 child agent'
const MISSION_TRANSCRIPT_MARKER = 'TRANSCRIPT_ONLY_MISSION_EVIDENCE_6C'
const RESOURCES_TRANSCRIPT_MARKER = 'TRANSCRIPT_ONLY_RESOURCES_EVIDENCE_6C'

type ChildTranscriptArchive = {
  kind: 'child_transcript'
  relativePath: string
  sha256: string
  bytes: number
  lines: number
  archivedAt?: string
}

type ChildTranscriptDocument = {
  version?: number
  childRunId?: string
  status?: string
  messages?: Array<{
    role?: string
    content?: unknown
    tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
  }>
}

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
      const payload = JSON.parse(String(toolResult.content ?? '{}')) as { status?: string; summary?: string; mode?: string; completed?: number; total?: number }
      if (payload.mode === 'parallel') {
        reply({ role: 'assistant', content: `父任务已整合并行结果：${payload.status} ${payload.completed}/${payload.total}` })
        return
      }
      reply({ role: 'assistant', content: `父任务已整合：${payload.status} ${payload.summary ?? ''}` })
      return
    }
    if (scenario === 'parallel') {
      reply({
        role: 'assistant',
        content: null,
        tool_calls: [
          makeToolCall('call-parallel', 'parallel_tasks', {
            concurrency: 2,
            tasks: [
              {
                label: '检查 mission',
                prompt: '读取 MISSION.md，并用一句话总结学习目标。',
                profile: 'workspace_audit',
                maxIterations: 3
              },
              {
                label: '检查 resources',
                prompt: '读取 RESOURCES.md，并用一句话总结资料范围。',
                profile: 'workspace_audit',
                maxIterations: 3
              }
            ]
          })
        ]
      })
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

  if (scenario === 'slow') {
    resolveSlowChildRequest?.()
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    if (!res.destroyed) reply({ role: 'assistant', content: 'This response should be aborted before it completes.' })
    return
  }

  const hasToolResult = body.messages?.some((message) => message.role === 'tool') ?? false
  if (!hasToolResult) {
    const taskText = String(body.messages?.find((message) => message.role === 'user')?.content ?? '')
    const path = taskText.includes('RESOURCES.md') ? 'RESOURCES.md' : 'MISSION.md'
    reply({
      role: 'assistant',
      content: null,
      tool_calls: [makeToolCall(`call-read-${path.toLowerCase().replace(/[^a-z]+/g, '-')}`, 'read_workspace_file', { path })]
    })
    return
  }
  const toolText = String(body.messages?.find((message) => message.role === 'tool')?.content ?? '')
  reply({
    role: 'assistant',
    content: toolText.includes('RESOURCES') ? 'RESOURCES.md 表明资料范围是 RAG 论文与面试题。' : 'MISSION.md 表明学习目标是掌握 RAG 面试解释。'
  })
})

const listen = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => resolve())
})

const close = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.close((error) => error ? reject(error) : resolve())
})

function findTerminalChildArchive(events: AgentLoopEvent[], childRunId: string): unknown {
  for (const event of events) {
    if ((event.type === 'child_run_completed' ||
      event.type === 'child_run_failed' ||
      event.type === 'child_run_canceled') && event.child.id === childRunId) {
      return event.child.archive
    }
  }
  return undefined
}

function requireChildTranscriptArchive(
  value: unknown,
  runId = DELEGATION_STREAM_ID
): ChildTranscriptArchive {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'child result should include an archive object')
  const archive = value as Partial<ChildTranscriptArchive>
  assert.equal(archive.kind, 'child_transcript')
  assert.match(archive.relativePath ?? '', /^\.agent-sessions\/child-transcripts\/[A-Za-z0-9._:-]{1,160}\/[a-f0-9]{16}-[a-f0-9]{64}\.txt$/)
  assert.ok(archive.relativePath?.startsWith(`.agent-sessions/child-transcripts/${runId}/`))
  assert.match(archive.sha256 ?? '', /^[a-f0-9]{64}$/)
  assert.ok(archive.relativePath?.endsWith(`-${archive.sha256}.txt`))
  assert.ok(Number.isInteger(archive.bytes) && (archive.bytes ?? 0) > 0)
  assert.ok(Number.isInteger(archive.lines) && (archive.lines ?? 0) > 0)
  return archive as ChildTranscriptArchive
}

async function verifyStagedTranscript(input: {
  storageRoot: string
  childRunId: string
  archive: ChildTranscriptArchive
  expectedPath: 'MISSION.md' | 'RESOURCES.md'
  expectedToolMarker: string
}): Promise<void> {
  const text = await readFile(join(input.storageRoot, input.archive.relativePath), 'utf8')
  assert.equal(Buffer.byteLength(text, 'utf8'), input.archive.bytes)
  assert.equal(text.split(/\r\n|\r|\n/).length, input.archive.lines)
  assert.match(text, new RegExp(CHILD_SYSTEM_MARKER))
  assert.match(text, new RegExp(input.expectedToolMarker))

  const transcript = JSON.parse(text) as ChildTranscriptDocument
  assert.equal(transcript.version, 1)
  assert.equal(transcript.childRunId, input.childRunId)
  assert.equal(transcript.status, 'completed')
  assert.deepEqual(transcript.messages?.map((message) => message.role), ['system', 'user', 'assistant', 'tool', 'assistant'])
  assert.match(String(transcript.messages?.[0]?.content ?? ''), new RegExp(CHILD_SYSTEM_MARKER))
  assert.match(String(transcript.messages?.[1]?.content ?? ''), new RegExp(input.expectedPath.replace('.', '\\.')))
  assert.equal(transcript.messages?.[2]?.tool_calls?.[0]?.function?.name, 'read_workspace_file')
  assert.match(transcript.messages?.[2]?.tool_calls?.[0]?.function?.arguments ?? '', new RegExp(input.expectedPath.replace('.', '\\.')))
  assert.match(String(transcript.messages?.[3]?.content ?? ''), new RegExp(input.expectedToolMarker))
  assert.ok(String(transcript.messages?.[4]?.content ?? '').trim(), 'child transcript should include the final assistant summary')
}

function assertNoChildTranscriptLeak(label: string, value: unknown, toolMarker: string): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  assert.equal(text.includes(CHILD_SYSTEM_MARKER), false, `${label} should not contain the child system prompt`)
  assert.equal(text.includes(toolMarker), false, `${label} should not contain the raw child tool result`)
  assert.equal(text.includes('\"messages\"'), false, `${label} should not contain child messages`)
}

let tempRoot = ''

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-delegation-'))
  await writeFile(join(tempRoot, 'MISSION.md'), `# Mission\n\n掌握 RAG 面试解释。\n${MISSION_TRANSCRIPT_MARKER}\n`, 'utf8')
  await writeFile(join(tempRoot, 'RESOURCES.md'), `# Resources\n\nRAG 论文与面试题。\n${RESOURCES_TRANSCRIPT_MARKER}\n`, 'utf8')

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

  const runStore = new AgentRunStore(tempRoot)
  const parentRegistry = buildDefaultRegistry(settings, { workspaceRoot: tempRoot, workspaceWrite: true })
  for (const tool of createDelegationToolEntries({ provider, streamId: DELEGATION_STREAM_ID, runStore })) {
    parentRegistry.register(tool)
  }
  assert.equal(parentRegistry.definitions().some((tool) => tool.function.name === 'delegate_task'), true)
  assert.equal(parentRegistry.definitions().some((tool) => tool.function.name === 'parallel_tasks'), true)
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
  const delegationToolResult = String(success.result.messages.find((message) => message.role === 'tool')?.content ?? '{}')
  const delegationPayload = JSON.parse(delegationToolResult) as {
    childRunId?: string
    label?: string
    profile?: string
    status?: string
    summary?: string
    filesRead?: string[]
    usage?: { toolCalls?: number }
    archive?: unknown
  }
  assert.equal(delegationPayload.status, 'completed')
  assert.match(delegationPayload.summary ?? '', /MISSION\.md/)
  assert.deepEqual(delegationPayload.filesRead, ['MISSION.md'])
  assert.equal(delegationPayload.usage?.toolCalls, 1)
  assert.ok(delegationPayload.childRunId)
  assert.equal(delegationPayload.archive, undefined, 'delegation tool JSON must not expose the staged archive capability')
  const delegationArchive = requireChildTranscriptArchive(
    findTerminalChildArchive(success.events, delegationPayload.childRunId)
  )
  await verifyStagedTranscript({
    storageRoot: tempRoot,
    childRunId: delegationPayload.childRunId,
    archive: delegationArchive,
    expectedPath: 'MISSION.md',
    expectedToolMarker: MISSION_TRANSCRIPT_MARKER
  })
  assertNoChildTranscriptLeak('delegation tool JSON', delegationToolResult, MISSION_TRANSCRIPT_MARKER)
  const delegationJournal = await readFile(
    join(tempRoot, '.agent-sessions', 'child-runs', DELEGATION_STREAM_ID, `${delegationPayload.childRunId}.json`),
    'utf8'
  )
  assertNoChildTranscriptLeak('durable child journal', delegationJournal, MISSION_TRANSCRIPT_MARKER)
  assertNoChildTranscriptLeak('runtime child events', success.events, MISSION_TRANSCRIPT_MARKER)

  const auditedSuccessTurns = attachAgentRunAuditMetadata([
    {
      id: 'success-user',
      role: 'user',
      content: '检查当前 mission。',
      createdAt: '2026-07-14T00:00:00.000Z'
    },
    {
      id: 'success-assistant',
      role: 'assistant',
      content: success.result.finalText,
      toolCalls: [{
        id: 'call-delegate',
        name: 'delegate_task',
        arguments: '{}',
        result: delegationToolResult
      }],
      createdAt: '2026-07-14T00:00:01.000Z'
    }
  ], success.events)
  const auditedDelegation = auditedSuccessTurns[1]?.metadata?.childRuns?.find(
    (child) => child.childRunId === delegationPayload.childRunId
  )
  assert.deepEqual(auditedDelegation?.archive, delegationArchive, 'audit metadata should retain the staged archive ref')
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

  scenario = 'parallel'
  requests.length = 0
  const parallel = await runParent()
  assert.equal(parallel.result.stopReason, 'final_answer')
  assert.match(parallel.result.finalText, /父任务已整合并行结果：completed 2\/2/)
  assert.equal(parallel.result.messages.filter((message) => message.role === 'tool').length, 1, 'parent transcript should store only the parallel_tasks tool result')
  const parallelToolResult = String(parallel.result.messages.find((message) => message.role === 'tool')?.content ?? '{}')
  const parallelPayload = JSON.parse(parallelToolResult) as {
    mode?: string
    status?: string
    total?: number
    completed?: number
    concurrency?: number
    results?: Array<{
      childRunId?: string
      label?: string
      status?: string
      filesRead?: string[]
      archive?: unknown
    }>
    usage?: { toolCalls?: number }
  }
  assert.equal(parallelPayload.mode, 'parallel')
  assert.equal(parallelPayload.status, 'completed')
  assert.equal(parallelPayload.total, 2)
  assert.equal(parallelPayload.completed, 2)
  assert.equal(parallelPayload.concurrency, 2)
  assert.deepEqual(
    parallelPayload.results?.map((result) => result.label),
    ['检查 mission', '检查 resources']
  )
  assert.deepEqual(parallelPayload.results?.[0]?.filesRead, ['MISSION.md'])
  assert.deepEqual(parallelPayload.results?.[1]?.filesRead, ['RESOURCES.md'])
  assert.equal(parallelPayload.usage?.toolCalls, 2)
  const expectedParallelTranscripts = [
    { path: 'MISSION.md' as const, marker: MISSION_TRANSCRIPT_MARKER },
    { path: 'RESOURCES.md' as const, marker: RESOURCES_TRANSCRIPT_MARKER }
  ]
  for (const [index, expected] of expectedParallelTranscripts.entries()) {
    const child = parallelPayload.results?.[index]
    assert.ok(child?.childRunId)
    assert.equal(child.archive, undefined, 'parallel tool JSON must not expose staged archive capabilities')
    const archive = requireChildTranscriptArchive(findTerminalChildArchive(parallel.events, child.childRunId))
    await verifyStagedTranscript({
      storageRoot: tempRoot,
      childRunId: child.childRunId,
      archive,
      expectedPath: expected.path,
      expectedToolMarker: expected.marker
    })
    const journal = await readFile(
      join(tempRoot, '.agent-sessions', 'child-runs', DELEGATION_STREAM_ID, `${child.childRunId}.json`),
      'utf8'
    )
    assertNoChildTranscriptLeak(`parallel durable child journal ${index + 1}`, journal, expected.marker)
  }
  for (const marker of [MISSION_TRANSCRIPT_MARKER, RESOURCES_TRANSCRIPT_MARKER]) {
    assertNoChildTranscriptLeak('parallel tool JSON', parallelToolResult, marker)
    assertNoChildTranscriptLeak('parallel runtime child events', parallel.events, marker)
  }

  const auditedParallelTurns = attachAgentRunAuditMetadata([
    {
      id: 'parallel-user',
      role: 'user',
      content: '并行检查 mission 与 resources。',
      createdAt: '2026-07-14T00:00:02.000Z'
    },
    {
      id: 'parallel-assistant',
      role: 'assistant',
      content: parallel.result.finalText,
      toolCalls: [{
        id: 'call-parallel',
        name: 'parallel_tasks',
        arguments: '{}',
        result: parallelToolResult
      }],
      createdAt: '2026-07-14T00:00:03.000Z'
    }
  ], parallel.events)
  const auditedParallelChildren = auditedParallelTurns[1]?.metadata?.childRuns ?? []
  for (const child of parallelPayload.results ?? []) {
    assert.ok(child.childRunId)
    assert.deepEqual(
      auditedParallelChildren.find((audited) => audited.childRunId === child.childRunId)?.archive,
      requireChildTranscriptArchive(findTerminalChildArchive(parallel.events, child.childRunId)),
      `audit metadata should retain the archive ref for ${child.childRunId}`
    )
  }
  assert.equal(parallel.events.filter((event) => event.type === 'child_run_queued').length, 2)
  assert.equal(parallel.events.filter((event) => event.type === 'child_run_started').length, 2)
  assert.equal(parallel.events.filter((event) => event.type === 'child_run_completed').length, 2)
  assert.equal(
    parallel.events.some((event) => event.type === 'tool_call' && event.toolCall.function.name === 'read_workspace_file'),
    false,
    'parallel child tool calls should not be emitted as parent tool calls'
  )

  scenario = 'slow'
  requests.length = 0
  let childRunId = ''
  const cancellationEvents: string[] = []
  let cancellationTerminalArchive: unknown
  const slowRequestStarted = new Promise<void>((resolve) => {
    resolveSlowChildRequest = resolve
  })
  const runtime = new DelegationRuntime({
    settings,
    provider,
    workspaceRoot: tempRoot,
    parentStreamId: 'abort-fixture',
    stageTranscript: (runChildId, transcript) => runStore.stageChildTranscript('abort-fixture', runChildId, transcript)
  })
  const cancellationRun = runtime.runChild(
    {
      label: 'cancel active child',
      prompt: 'Wait for the provider response.',
      profile: 'workspace_audit',
      timeoutMs: 5_000
    },
    {
      emit: (event) => {
        cancellationEvents.push(event.type)
        if (event.type === 'child_run_started') childRunId = event.child.id
        if (event.type === 'child_run_canceled') cancellationTerminalArchive = event.child.archive
      }
    }
  )
  await slowRequestStarted
  assert.ok(childRunId, 'the child must be running before it can be aborted')
  await runtime.abortChild(childRunId)
  const canceled = await Promise.race([
    cancellationRun,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('abortChild did not abort the active child loop')), 750))
  ])
  assert.equal(canceled.status, 'canceled')
  const canceledArchive = requireChildTranscriptArchive(canceled.archive, 'abort-fixture')
  assert.deepEqual(cancellationTerminalArchive, canceledArchive)
  assert.deepEqual(runtime.listRuns('abort-fixture')[0]?.archive, canceledArchive)
  const canceledTranscriptText = await readFile(join(tempRoot, canceledArchive.relativePath), 'utf8')
  const canceledTranscript = JSON.parse(canceledTranscriptText) as ChildTranscriptDocument
  assert.equal(canceledTranscript.childRunId, childRunId)
  assert.equal(canceledTranscript.status, 'canceled')
  assert.equal(runtime.listRuns('abort-fixture')[0]?.status, 'canceled')
  assert.ok(cancellationEvents.indexOf('child_run_queued') < cancellationEvents.indexOf('child_run_started'))
  assert.ok(cancellationEvents.indexOf('child_run_started') < cancellationEvents.indexOf('child_run_canceled'))
  assert.deepEqual(
    cancellationEvents.filter((type) => type === 'child_run_completed' || type === 'child_run_failed' || type === 'child_run_canceled'),
    ['child_run_canceled']
  )

  console.log('agent delegation runtime ok')
} finally {
  await close(server).catch(() => undefined)
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
