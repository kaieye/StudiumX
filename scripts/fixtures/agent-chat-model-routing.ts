import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { parseAgentChatStreamPayload } from '../../src/main/teaching-ipc-commands'
import { SkillLibraryService } from '../../src/main/skill-library'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { hasAgentParentTurnCommit, readRawAgentConversationRecord } from '../../src/main/teaching-agent-conversations'
import { agentConversationJsonRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'

const MODEL_REPLY = 'MODEL_REPLY_FROM_PROVIDER'

type RecordedRequestBody = {
  model?: string
  messages?: Array<{
    role: string
    content?: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
    tool_call_id?: string
  }>
}

type RecordedRequest = {
  method: string | undefined
  url: string | undefined
  phase: 'parent' | 'child'
  body: RecordedRequestBody
}

const requests: RecordedRequest[] = []
let delegationScenarioActive = false

const makeToolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) }
})

const requestPhase = (body: RecordedRequestBody): RecordedRequest['phase'] =>
  String(body.messages?.[0]?.content ?? '').includes('只读 child agent') ? 'child' : 'parent'

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const requestText = Buffer.concat(chunks).toString('utf8')
  const body = (requestText ? JSON.parse(requestText) : {}) as RecordedRequestBody
  const phase = requestPhase(body)
  requests.push({ method: req.method, url: req.url, phase, body })

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unexpected route' }))
    return
  }

  const reply = (message: Record<string, unknown>): void => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message }] }))
  }

  if (delegationScenarioActive) {
    const toolResult = body.messages?.find((message) => message.role === 'tool')
    if (phase === 'child') {
      if (!toolResult) {
        reply({
          role: 'assistant',
          content: null,
          tool_calls: [makeToolCall('call-read-mission', 'read_workspace_file', { path: 'MISSION.md' })]
        })
        return
      }
      reply({ role: 'assistant', content: 'MISSION.md 已读取，学习目标是掌握 RAG。' })
      return
    }

    if (!toolResult) {
      reply({
        role: 'assistant',
        content: null,
        tool_calls: [makeToolCall('call-delegate-save', 'delegate_task', {
          label: '检查 mission',
          prompt: '读取 MISSION.md，并用一句话总结学习目标。',
          profile: 'read_only'
        })]
      })
      return
    }
    reply({ role: 'assistant', content: '父任务已整合 child agent 的 MISSION.md 检查结果。' })
    return
  }

  reply({ role: 'assistant', content: MODEL_REPLY })
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

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-chat-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.provider.activeProviderId = 'deepseek'
  settings.generator.providerId = 'deepseek'
  settings.generator.model = 'deepseek-v4-flash'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.webSearch = false
  settings.tools.webFetch = false
  settings.provider.providers = settings.provider.providers.map((provider) =>
    provider.id === 'deepseek'
      ? {
          ...provider,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'test-key',
          models: ['deepseek-v4-flash']
        }
      : provider
  )

  const skillLibraryService = new SkillLibraryService({
    builtInRoots: [join(process.cwd(), 'resources', 'builtin-skills')],
    personalRoot: join(tempRoot, '.studiumx', 'skills')
  })
  await skillLibraryService.installSkill('teach')

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'studiumx-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings,
    skillLibraryService
  })
  const state = await service.createWorkspace({ name: 'learn-rag', prompt: '学习 RAG' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)

  const chunks: string[] = []
  const statuses: string[] = []
  const result = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '请介绍 RAG'
    },
    {
      streamId: 'test-stream',
      onChunk: (chunk) => chunks.push(chunk.delta),
      onStatus: (status) => statuses.push(status.status),
      onTool: () => {}
    }
  )

  assert.equal(requests.length, 1, 'teaching-mode chat must call the configured model provider')
  assert.equal(requests[0]?.url, '/v1/chat/completions')
  assert.equal(requests[0]?.body.model, 'deepseek-v4-flash')
  assert.ok(!('error' in result), 'agent chat should return the provider response')
  assert.equal(result.finalText, MODEL_REPLY)
  assert.equal(chunks.join(''), MODEL_REPLY)
  assert.deepEqual(statuses, ['thinking', 'answering', 'done'])

  const sentMessages = requests[0]?.body.messages ?? []
  assert.equal(sentMessages[0]?.role, 'system')
  assert.match(sentMessages[0]?.content ?? '', /teach skill/)
  assert.match(sentMessages[0]?.content ?? '', /progressive disclosure/)
  assert.match(sentMessages[0]?.content ?? '', /Teaching Workspace/)
  assert.match(sentMessages[0]?.content ?? '', /lesson-generation-policy/)
  assert.match(sentMessages[0]?.content ?? '', /generate_lesson/)
  assert.match(sentMessages[0]?.content ?? '', /do not treat readiness hints as a canned assistant answer/)
  assert.doesNotMatch(sentMessages[0]?.content ?? '', /Claude|Anthropic/)
  assert.equal(sentMessages.at(-1)?.role, 'user')
  assert.ok(sentMessages.at(-1)?.content?.endsWith('请介绍 RAG'), 'the current user input should remain at the end of the context packet')

  const retryableSavePayload = {
    workspaceId: workspace.id,
    runId: 'test-stream',
    turns: result.turns
  }
  const firstSavedTurn = await service.saveAgentConversation(retryableSavePayload)
  const retriedSavedTurn = await service.saveAgentConversation(retryableSavePayload)
  assert.equal(
    retriedSavedTurn.conversation.id,
    firstSavedTurn.conversation.id,
    'a lost save response must retry against the same staged conversation target'
  )
  const retriedConversation = await service.readAgentConversation({
    workspaceId: workspace.id,
    conversationId: firstSavedTurn.conversation.id
  })
  assert.equal(
    retriedConversation.turns.filter((turn) => turn.role === 'assistant' && turn.metadata?.runId === 'test-stream').length,
    1,
    'retrying a settled parent turn must not append a duplicate assistant turn'
  )

  await assert.rejects(
    () => service.agentChatStream(
      {
        workspaceId: workspace.id,
        conversationId: retriedConversation.id,
        messages: [],
        userInput: '继续'
      },
      { streamId: 'missing-revision', onChunk: () => {}, onStatus: () => {}, onTool: () => {} }
    ),
    /expected branch revision is required/i,
    'continuing an existing branch must fail before provider execution when the CAS token is missing'
  )
  assert.equal(requests.length, 1, 'missing branch revision must be rejected before provider execution')

  const identityChunks: string[] = []
  const identityStatuses: string[] = []
  const identityResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '你是什么模型？'
    },
    {
      streamId: 'identity-stream',
      onChunk: (chunk) => identityChunks.push(chunk.delta),
      onStatus: (status) => identityStatuses.push(status.status),
      onTool: () => {}
    }
  )

  assert.equal(
    requests.length,
    2,
    'model identity questions should still be answered by the configured model provider'
  )
  assert.ok(!('error' in identityResult), 'model identity response should return the provider response')
  assert.equal(identityResult.finalText, MODEL_REPLY)
  assert.equal(identityChunks.join(''), MODEL_REPLY)
  assert.deepEqual(identityStatuses, ['thinking', 'answering', 'done'])

  const identityMessages = requests[1]?.body.messages ?? []
  assert.equal(identityMessages[0]?.role, 'system')
  // Provider selection is verified from the actual transport request above.
  // The teaching prompt must not embed a stale provider/model identity claim.
  assert.match(identityMessages[0]?.content ?? '', /teach skill/)
  assert.doesNotMatch(identityMessages[0]?.content ?? '', /configuredProvider|configuredModelId|endpointFormat|Claude|Anthropic/)
  assert.equal(identityMessages.at(-1)?.role, 'user')
  assert.ok(identityMessages.at(-1)?.content?.endsWith('你是什么模型？'), 'the identity question should remain at the end of the context packet')

  const temporaryResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'temporary',
      messages: [],
      userInput: '我有哪些课程？'
    },
    {
      streamId: 'temporary-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )

  assert.equal(requests.length, 3, 'temporary chat should call the configured model provider')
  assert.ok(!('error' in temporaryResult), 'temporary chat should return the provider response')
  const temporaryBody = requests[2]?.body ?? {}
  const temporaryMessages = temporaryBody.messages ?? []
  assert.equal(temporaryMessages[0]?.role, 'system')
  assert.match(temporaryMessages[0]?.content ?? '', /临时会话助手/)
  assert.match(temporaryMessages[0]?.content ?? '', /临时会话只能使用已注入的画像、课程概览和可见页面文本/)
  assert.doesNotMatch(temporaryMessages[0]?.content ?? '', /automatically loaded/)
  assert.doesNotMatch(temporaryMessages[0]?.content ?? '', /Teaching Workspace/)
  assert.doesNotMatch(JSON.stringify(temporaryBody), /list_workspace|read_workspace_file|search_workspace|glob_workspace/)
  assert.equal(temporaryMessages.at(-1)?.role, 'user')
  assert.ok(temporaryMessages.at(-1)?.content?.endsWith('我有哪些课程？'), 'the temporary user input should remain at the end of the context packet')

  const invokedSkillResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'temporary',
      messages: [],
      userInput: '/teach 请解释向量检索'
    },
    {
      streamId: 'temporary-skill-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )
  assert.equal(requests.length, 4, 'a typed slash command should resolve the installed skill in the main process')
  assert.ok(!('error' in invokedSkillResult), 'an installed slash skill should reach the configured provider')
  const invokedSkillMessages = requests[3]?.body.messages ?? []
  assert.match(invokedSkillMessages[0]?.content ?? '', /<skill-index>/)
  assert.match(invokedSkillMessages[0]?.content ?? '', /id=teach/)
  assert.doesNotMatch(invokedSkillMessages[0]?.content ?? '', /Teaching Workspace/)
  if (!('error' in invokedSkillResult)) {
    const invokedUserTurn = invokedSkillResult.turns.findLast((turn) => turn.role === 'user')
    assert.equal(invokedUserTurn?.metadata?.skillInvocation?.state, 'applied')
    assert.equal(invokedUserTurn?.metadata?.skillInvocation?.skillId, 'teach')
  }

  const canceledController = new AbortController()
  canceledController.abort()
  const canceledStatuses: string[] = []
  const canceledResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '这条会被中断'
    },
    {
      streamId: 'canceled-stream',
      signal: canceledController.signal,
      onChunk: () => {},
      onStatus: (status) => canceledStatuses.push(status.status),
      onTool: () => {}
    }
  )
  assert.equal('canceled' in canceledResult, true, 'aborted agent chat should return a canceled result')
  assert.equal(requests.length, 4, 'aborted agent chat should not call the provider')
  assert.deepEqual(canceledStatuses, [])

  const lineageMessages = [
    { role: 'system' as const, content: 'obsolete client system prompt' },
    { role: 'user' as const, content: `history-1 ${'context '.repeat(160)}` },
    {
      role: 'assistant' as const,
      content: null,
      toolCalls: [{ id: 'lineage-tool-call', name: 'lookup', arguments: '{}' }]
    },
    {
      role: 'tool' as const,
      content: `tool-history ${'context '.repeat(160)}`,
      toolCallId: 'lineage-tool-call'
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `history-${index + 2} ${'context '.repeat(160)}`
    }))
  ]
  const lineageTurnIds = [
    '',
    'u1',
    'a1',
    undefined,
    ...Array.from({ length: 10 }, (_, index) => `${index % 2 === 0 ? 'u' : 'a'}${Math.floor(index / 2) + 2}`)
  ]
  const originalMaxOutputTokens = settings.generator.maxOutputTokens
  settings.generator.maxOutputTokens = 1024
  const parsedLineagePayload = parseAgentChatStreamPayload({
    workspaceId: workspace.id,
    mode: 'temporary',
    messages: lineageMessages,
    messageTurnIds: lineageTurnIds,
    contextCompaction: { enabled: true, force: true, contextWindowTokens: 10000 },
    userInput: '总结当前讨论'
  })
  assert.equal(parsedLineagePayload.messageTurnIds?.length, lineageMessages.length)
  assert.equal(parsedLineagePayload.messageTurnIds?.[0], undefined, 'system placeholder should preserve its index')
  assert.equal(parsedLineagePayload.messageTurnIds?.[3], undefined, 'tool placeholder should preserve its index')
  const mismatchedLineagePayload = parseAgentChatStreamPayload({
    messages: lineageMessages,
    messageTurnIds: lineageTurnIds.slice(1),
    userInput: '长度不匹配时忽略 lineage'
  })
  assert.equal(mismatchedLineagePayload.messageTurnIds, undefined, 'misaligned turn IDs must not pass downstream')
  const lineageResult = await service.agentChatStream(
    parsedLineagePayload,
    {
      streamId: 'lineage-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )
  assert.ok(!('error' in lineageResult), 'forced compaction should complete through the configured provider')
  const lineageCompaction = 'turns' in lineageResult
    ? lineageResult.turns.at(-1)?.metadata?.compactions?.at(-1)
    : undefined
  assert.ok(lineageCompaction, 'forced compaction should persist audit metadata')
  assert.ok(lineageCompaction.replacedTurnIds.length > 0, 'compaction should retain persisted source turn IDs')
  assert.deepEqual(lineageCompaction.replacedTurnIds.slice(0, 2), ['u1', 'a1'])
  assert.equal(requests.length, 6, 'forced compaction should make one summary call and one answer call')
  settings.generator.maxOutputTokens = originalMaxOutputTokens

  const delegationRunId = 'delegation-save-stream'
  delegationScenarioActive = true
  const delegationResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '派发只读 child agent 检查 MISSION.md'
    },
    {
      streamId: delegationRunId,
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )
  assert.ok(!('error' in delegationResult) && !('canceled' in delegationResult), 'delegation run should complete')
  assert.deepEqual(
    requests.slice(-4).map((request) => request.phase),
    ['parent', 'child', 'child', 'parent'],
    'delegation should exercise the parent and child provider loops through the local server'
  )

  const stagedChild = delegationResult.turns
    .flatMap((turn) => turn.metadata?.childRuns ?? [])
    .find((child) => child.archive?.relativePath.startsWith(`.agent-sessions/child-transcripts/${delegationRunId}/`))
  assert.ok(stagedChild?.archive, 'delegation result should expose a run-scoped staged child transcript')
  const stagedArchive = stagedChild.archive
  assert.equal(stagedArchive.kind, 'child_transcript')
  assert.match(
    stagedArchive.relativePath,
    /^\.agent-sessions\/child-transcripts\/delegation-save-stream\/[a-f0-9]{16}-[a-f0-9]{64}\.txt$/
  )

  const stagedSavePayload = {
    workspaceId: workspace.id,
    runId: delegationRunId,
    turns: delegationResult.turns
  }
  await assert.rejects(
    () => service.saveAgentConversation({ ...stagedSavePayload, runId: 'wrong-delegation-save-stream' }),
    /not authorized for this run|staging is unavailable/i,
    'a different run id must not authorize promotion of this staged transcript'
  )

  const mismatchedFinalTurns = structuredClone(delegationResult.turns)
  const mismatchedFinal = mismatchedFinalTurns.findLast((turn) => turn.role === 'assistant')
  assert.ok(mismatchedFinal, 'final mismatch test should find the assistant turn')
  mismatchedFinal.content = 'renderer 中未被 runtime 确认的回答'
  await assert.rejects(
    () => service.saveAgentConversation({ ...stagedSavePayload, turns: mismatchedFinalTurns }),
    /does not match the explicitly confirmed parent turn/i,
    'conversation persistence must reject assistant text that differs from the confirmed final'
  )

  const mismatchedUserTurns = structuredClone(delegationResult.turns)
  const mismatchedUser = mismatchedUserTurns.findLast((turn) => turn.role === 'user')
  assert.ok(mismatchedUser, 'user mismatch test should find the current user turn')
  mismatchedUser.content = 'renderer 中被替换的用户输入'
  await assert.rejects(
    () => service.saveAgentConversation({ ...stagedSavePayload, turns: mismatchedUserTurns }),
    /does not match the staged parent turn/i,
    'conversation persistence must reject user text that differs from staging'
  )

  const tamperedTurns = structuredClone(delegationResult.turns)
  const tamperedArchive = tamperedTurns
    .flatMap((turn) => turn.metadata?.childRuns ?? [])
    .find((child) => child.childRunId === stagedChild.childRunId)
    ?.archive
  assert.ok(tamperedArchive, 'tamper test should find the staged child transcript')
  tamperedArchive.sha256 = tamperedArchive.sha256.startsWith('0')
    ? `1${tamperedArchive.sha256.slice(1)}`
    : `0${tamperedArchive.sha256.slice(1)}`
  await assert.rejects(
    () => service.saveAgentConversation({ ...stagedSavePayload, turns: tamperedTurns }),
    /unrecognized artifact reference/i,
    'a mutated staged transcript reference must not inherit the run capability'
  )

  const savedDelegation = await service.saveAgentConversation(stagedSavePayload)
  const canonicalPath = join(
    workspace.rootPath,
    agentConversationJsonRelativePathForMarkdown(savedDelegation.conversation.relativePath)
  )
  const canonicalJson = await readFile(canonicalPath, 'utf8')

  const loadedDelegation = await service.readAgentConversation({
    workspaceId: workspace.id,
    conversationId: savedDelegation.conversation.id
  })
  const promotedArchive = loadedDelegation.turns
    .flatMap((turn) => turn.metadata?.childRuns ?? [])
    .find((child) => child.childRunId === stagedChild.childRunId)
    ?.archive
  assert.ok(promotedArchive, 'saved conversation should retain the promoted child transcript reference')
  const rawCanonicalDelegation = await readRawAgentConversationRecord(workspace.rootPath, savedDelegation.conversation.id)
  const savedParentTurnMarker = rawCanonicalDelegation.turns
    .findLast((turn) => turn.role === 'assistant' && turn.metadata?.runId === delegationRunId)
    ?.metadata?.parentTurnProof?.digest
  assert.ok(savedParentTurnMarker, 'saved conversation should retain the parent-turn commit marker')
  assert.equal(
    hasAgentParentTurnCommit(rawCanonicalDelegation.turns, delegationRunId, savedParentTurnMarker),
    true,
    'restart verification must use the unhydrated final promoted canonical record'
  )
  assert.notEqual(promotedArchive.relativePath, stagedArchive.relativePath)
  assert.equal(promotedArchive.relativePath.startsWith('.agent-sessions/child-transcripts/'), false)

  const replayedDelegation = await service.saveAgentConversation(stagedSavePayload)
  assert.equal(replayedDelegation.conversation.id, savedDelegation.conversation.id)
  assert.equal(replayedDelegation.branch?.revision, savedDelegation.branch?.revision)
  const replayedCanonicalJson = await readFile(canonicalPath, 'utf8')
  assert.equal(replayedCanonicalJson, canonicalJson, 'same-run save retry must not rewrite the canonical transcript')

  await assert.rejects(
    () => service.saveAgentConversation({
      workspaceId: workspace.id,
      conversationId: loadedDelegation.id,
      expectedBranchRevision: loadedDelegation.branch?.revision,
      runId: 'missing-parent-turn-stage',
      turns: loadedDelegation.turns
    }),
    /parent turn staging is unavailable/i,
    'a run-scoped save must fail closed when its staging record is missing or quarantined'
  )

  const resavedDelegation = await service.saveAgentConversation({
    workspaceId: workspace.id,
    conversationId: loadedDelegation.id,
    expectedBranchRevision: loadedDelegation.branch?.revision,
    turns: loadedDelegation.turns
  })
  assert.equal(resavedDelegation.conversation.id, loadedDelegation.id)
  const resavedCanonicalJson = await readFile(canonicalPath, 'utf8')
  assert.equal(requests.length, 10, 'conversation persistence should not make additional provider calls')
  for (const persistedJson of [canonicalJson, resavedCanonicalJson]) {
    assert.equal(
      persistedJson.includes(stagedArchive.relativePath),
      false,
      'canonical conversation JSON must not retain the run-scoped staging path'
    )
    assert.doesNotMatch(
      persistedJson,
      /"relativePath"\s*:\s*"\.agent-sessions\/child-transcripts\//,
      'canonical conversation JSON must contain only conversation-scoped child transcript references'
    )
  }

  console.log('agent chat model routing ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
