import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  attachAgentRunAuditMetadata,
  buildAgentTurnAuditMetadata
} from '../../src/main/ai/agent-run-audit'
import {
  parseAgentConversationSessionAuditLines
} from '../../src/main/agent-conversation-session-audit'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import { ContextCompactor } from '../../src/main/ai/context-compactor'
import { AgentRunStore } from '../../src/main/ai/agent-run-store'
import type { ChatMessage } from '../../src/main/ai/provider-adapter'
import {
  agentConversationChildTranscriptDirectoryRelativePathForMarkdown,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import {
  readAgentConversationChildTranscript,
  normalizeAgentConversationTurns,
  readAgentConversationRecord,
  writeAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../src/main/learning-work-ledger'
import type { AgentChatTurn, AgentConversationRecord } from '../../src/shared/teaching-types'

const largeToolResult = `${'line\n'.repeat(45)}${'x'.repeat(2100)}`

const sourceMessages: ChatMessage[] = [
  { role: 'system', content: 'Retain the latest user request.' },
  { role: 'user', content: `Earlier request: ${'history '.repeat(800)}` },
  { role: 'assistant', content: `Earlier response: ${'history '.repeat(800)}` },
  { role: 'user', content: `Earlier follow-up: ${'history '.repeat(800)}` },
  { role: 'assistant', content: `Earlier conclusion: ${'history '.repeat(800)}` },
  { role: 'user', content: 'Recent user context that must remain verbatim.' },
  { role: 'assistant', content: 'Recent assistant context that must remain verbatim.' },
  { role: 'user', content: 'Latest user request must remain authoritative.' }
]
const sourceTurnIds = [undefined, 'u-history-1', 'a-history-1', 'u-history-2', 'a-history-2', 'u-recent', 'a-recent', 'u-latest']
const compactor = new ContextCompactor({
  enabled: true,
  force: true,
  contextWindowTokens: 2_000,
  minTailMessages: 3,
  minMessagesToCompact: 2,
  now: () => Date.parse('2026-07-09T00:00:02.000Z'),
  summarize: async () => 'Earlier study-plan discussion completed; preserve the current request.'
})
const compactionProjection = await compactor.compactIfNeeded({
  messages: sourceMessages,
  messageTurnIds: sourceTurnIds
})
const producedCompaction = compactionProjection.events.find((event) => event.type === 'context_compaction_completed')
assert.ok(producedCompaction, 'compactor should emit a successful compaction event for long persisted history')
assert.equal(producedCompaction.compactionId.startsWith('compaction:'), true)
assert.equal(producedCompaction.createdAt, '2026-07-09T00:00:02.000Z')
assert.deepEqual(
  producedCompaction.replacedTurnIds,
  sourceTurnIds.slice(1, producedCompaction.replacedMessages + 1),
  'completed compaction must name the original persisted turns represented by its summary'
)
assert.equal(producedCompaction.replacedTurnIds.includes('u-latest'), false)

const events: AgentLoopEvent[] = [
  {
    type: 'context_hygiene_applied',
    changed: true,
    savedTokens: 321,
    compactedToolResults: 2,
    digestedToolResults: 1,
    compactedToolCallArgs: 3
  },
  {
    type: 'context_estimated',
    estimate: { messageTokens: 1000, overheadTokens: 200, totalTokens: 1200, source: 'local' }
  },
  {
    type: 'context_compaction_completed',
    compactionId: 'compaction-completed',
    createdAt: '2026-07-09T00:00:02.500Z',
    replacedTurnIds: ['u1', 'a1'],
    reason: 'soft_threshold',
    mode: 'normal',
    replacedTokens: 8000,
    summaryTokens: 900,
    beforeTokens: 12000,
    afterTokens: 4900,
    replacedMessages: 12,
    tailMessages: 6,
    sourceDigest: 'ctx_done',
    cached: false
  },
  {
    type: 'context_compaction_failed',
    compactionId: 'compaction-failed',
    createdAt: '2026-07-09T00:00:02.600Z',
    replacedTurnIds: [],
    reason: 'manual',
    mode: 'manual',
    error: 'summary model unavailable',
    cooldownUntil: '2026-07-09T00:05:00.000Z',
    sourceDigest: 'ctx_failed'
  },
  {
    type: 'child_run_queued',
    child: {
      id: 'child-1',
      label: 'Inspect source persistence',
      profile: 'workspace_audit',
      status: 'queued',
      startedAt: '2026-07-09T00:00:00.000Z'
    }
  },
  {
    type: 'child_run_completed',
    child: {
      id: 'child-1',
      label: 'Inspect source persistence',
      profile: 'workspace_audit',
      status: 'completed',
      summary: 'Existing source metadata is not persisted.',
      startedAt: '2026-07-09T00:00:00.000Z',
      completedAt: '2026-07-09T00:00:03.000Z',
      usage: { toolCalls: 4 }
    }
  },
  {
    type: 'tool_result',
    toolCallId: 'tool-search',
    name: 'web_search',
    result: JSON.stringify({
      provider: 'fixture-search',
      results: [
        {
          sourceId: 'src-search-1',
          title: 'Session persistence patterns',
          url: 'https://example.com/session',
          snippet: 'Append-only session metadata',
          retrievedAt: '2026-07-09T00:00:01.000Z'
        }
      ]
    }),
    isError: false
  },
  {
    type: 'tool_result',
    toolCallId: 'tool-fetch',
    name: 'web_fetch',
    result: JSON.stringify({
      sourceId: 'src-fetch-1',
      title: 'Fetched article',
      finalUrl: 'https://example.com/fetched',
      retrievedAt: '2026-07-09T00:00:02.000Z',
      content: 'Fetched body'
    }),
    isError: false
  },
  {
    type: 'tool_result',
    toolCallId: 'tool-parallel',
    name: 'parallel_tasks',
    result: JSON.stringify({
      mode: 'parallel',
      status: 'completed',
      results: [
        {
          childRunId: 'child-2',
          label: 'Find citations',
          profile: 'research',
          status: 'completed',
          summary: 'Found one citation.',
          filesRead: ['docs/agent/state-persistence-and-memory.md'],
          citations: [
            {
              sourceId: 'src-child-1',
              title: 'Child citation',
              url: 'https://example.com/child'
            }
          ],
          usage: { toolCalls: 2 }
        }
      ]
    }),
    isError: false
  },
  {
    type: 'tool_result',
    toolCallId: 'tool-large',
    name: 'read_workspace_file',
    result: largeToolResult,
    isError: false
  }
]

const metadata = buildAgentTurnAuditMetadata(events)
assert.ok(metadata)
assert.equal(metadata.version, 1)
assert.equal(metadata.sources?.some((source) => source.sourceId === 'src-search-1'), true)
assert.equal(metadata.sources?.some((source) => source.sourceId === 'src-fetch-1'), true)
assert.equal(metadata.sources?.some((source) => source.sourceId === 'src-child-1'), true)
assert.equal(metadata.childRuns?.find((child) => child.childRunId === 'child-1')?.status, 'completed')
assert.equal(metadata.childRuns?.find((child) => child.childRunId === 'child-2')?.filesRead?.[0], 'docs/agent/state-persistence-and-memory.md')
assert.equal(metadata.compactions?.length, 2)
assert.deepEqual(metadata.compactions?.find((compaction) => compaction.id === 'compaction-completed')?.replacedTurnIds, ['u1', 'a1'])
assert.equal(metadata.compactions?.find((compaction) => compaction.id === 'compaction-completed')?.createdAt, '2026-07-09T00:00:02.500Z')
assert.deepEqual(metadata.compactions?.find((compaction) => compaction.id === 'compaction-failed')?.replacedTurnIds, [])
assert.equal(metadata.contextHygiene?.[0]?.savedTokens, 321)
assert.equal(metadata.contextEstimate?.totalTokens, 1200)
assert.equal(metadata.toolResults?.some((tool) => tool.toolCallId === 'tool-large'), true)

const turns: AgentChatTurn[] = [
  { id: 'u1', role: 'user', content: 'Audit this run', createdAt: '2026-07-09T00:00:00.000Z' },
  { id: 'a1', role: 'assistant', content: 'Intermediate tool call.', createdAt: '2026-07-09T00:00:01.000Z' },
  {
    id: 'a2',
    role: 'assistant',
    content: 'Final answer.',
    toolCalls: [
      {
        id: 'permission-1',
        name: 'tool_permission',
        arguments: JSON.stringify({
          id: 'permission-1',
          kind: 'workspace_write',
          toolName: 'generate_lesson',
          operation: '生成课程资产',
          targetPath: 'lessons/retrieval-practice.html',
          creates: true
        }),
        result: '{"decision":"allow"}',
        isError: false
      },
      {
        id: 'tool-generate-lesson',
        name: 'generate_lesson',
        arguments: '{"topic":"Retrieval practice"}',
        result: JSON.stringify({
          ok: true,
          lessonId: 'lesson-1',
          title: 'Retrieval practice',
          path: 'lessons/retrieval-practice.html'
        }),
        isError: false
      },
      {
        id: 'tool-large',
        name: 'read_workspace_file',
        arguments: '{"path":"big.md"}',
        result: largeToolResult,
        isError: false
      }
    ],
    processEvents: [
      {
        id: 'permission-request',
        kind: 'permission_request',
        title: '等待写入审批',
        toolCallId: 'permission-1',
        toolName: 'tool_permission',
        createdAt: '2026-07-09T00:00:02.100Z'
      },
      {
        id: 'permission-resolved',
        kind: 'permission_resolved',
        title: '写入审批已允许',
        toolCallId: 'permission-1',
        toolName: 'tool_permission',
        createdAt: '2026-07-09T00:00:02.150Z'
      },
      {
        id: 'ask-request',
        kind: 'elicitation_request',
        title: '等待用户选择',
        toolCallId: 'ask-1',
        toolName: 'ask',
        createdAt: '2026-07-09T00:00:02.200Z'
      },
      {
        id: 'ask-resolved',
        kind: 'elicitation_resolved',
        title: '用户选择已提交',
        toolCallId: 'ask-1',
        toolName: 'ask',
        createdAt: '2026-07-09T00:00:02.250Z'
      },
      {
        id: 'status-tool-running',
        kind: 'status',
        status: 'tool_running',
        title: '准备调用外部工具',
        createdAt: '2026-07-09T00:00:02.275Z'
      },
      {
        id: 'child-delta',
        kind: 'child_run_delta',
        title: '子任务进度',
        detail: 'child-1：reading',
        createdAt: '2026-07-09T00:00:02.300Z'
      },
      {
        id: 'compaction',
        kind: 'compaction',
        title: '上下文压缩完成',
        detail: '约节省 120 token',
        createdAt: '2026-07-09T00:00:02.400Z'
      }
    ],
    createdAt: '2026-07-09T00:00:02.000Z'
  }
]
const auditedTurns = attachAgentRunAuditMetadata(turns, events)
assert.equal(auditedTurns[1]?.metadata, undefined)
assert.equal(auditedTurns[2]?.metadata?.sources?.length, metadata.sources?.length)

const childTranscript = 'Child transcript: inspected the course notes and found a supporting citation.'
const turnsWithChildTranscript: AgentChatTurn[] = auditedTurns.map((turn) => {
  if (turn.id !== 'a2' || !turn.metadata?.childRuns) return turn
  return {
    ...turn,
    metadata: {
      ...turn.metadata,
      childRuns: turn.metadata.childRuns.map((child) => child.childRunId === 'child-2'
        ? { ...child, transcript: childTranscript }
        : child)
    }
  }
})

let tempRoot = ''
try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-audit-'))
  await mkdir(join(tempRoot, 'conversation'), { recursive: true })
  const workspace = { id: 'workspace-1', name: 'Audit Workspace', rootPath: tempRoot }
  const stagedChildTranscript = 'Staged child transcript: complete message and tool-result history.'
  const runStore = new AgentRunStore(tempRoot, () => '2026-07-09T00:00:02.900Z')
  const stagedChildArchive = await runStore.stageChildTranscript('run-audit-1', 'child-1', stagedChildTranscript)
  const turnsWithChildArtifacts: AgentChatTurn[] = turnsWithChildTranscript.map((turn) => {
    if (turn.id !== 'a2' || !turn.metadata?.childRuns) return turn
    return {
      ...turn,
      metadata: {
        ...turn.metadata,
        childRuns: turn.metadata.childRuns.map((child) => child.childRunId === 'child-1'
          ? { ...child, archive: stagedChildArchive }
          : child)
      }
    }
  })
  const record: AgentConversationRecord = {
    id: 'chat-20260709-audit',
    workspaceId: workspace.id,
    title: 'Audit metadata',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:03.000Z',
    relativePath: 'conversation/chat-20260709-audit.md',
    absolutePath: join(tempRoot, 'conversation', 'chat-20260709-audit.md'),
    messageCount: turnsWithChildArtifacts.length,
    turns: turnsWithChildArtifacts
  }
  const jsonPath = join(tempRoot, agentConversationJsonRelativePathForMarkdown(record.relativePath))
  const markdownPath = join(tempRoot, record.relativePath)
  const auditPath = join(tempRoot, agentConversationSessionAuditRelativePathForMarkdown(record.relativePath))
  const ledgerPath = join(tempRoot, LEARNING_WORK_LEDGER_RELATIVE_PATH)

  const misplacedToolArchiveRecord: AgentConversationRecord = {
    ...record,
    turns: record.turns.map((turn, index) => index !== record.turns.length - 1
      ? turn
      : {
          ...turn,
          metadata: {
            ...turn.metadata,
            version: 1,
            toolResults: [{
              toolCallId: 'tool-malicious-archive',
              toolName: 'read_workspace_file',
              bytes: stagedChildArchive.bytes,
              lines: stagedChildArchive.lines ?? 0,
              archive: stagedChildArchive
            }]
          }
        })
  }
  await assert.rejects(
    () => writeAgentConversationRecord(workspace, misplacedToolArchiveRecord),
    /tool result contains a non-tool artifact reference/,
    'child transcript capabilities must never be accepted through tool-result metadata'
  )
  const normalizedMisplacedArchive = normalizeAgentConversationTurns(misplacedToolArchiveRecord.turns)
    .at(-1)?.metadata?.toolResults?.[0]?.archive
  assert.equal(
    normalizedMisplacedArchive,
    undefined,
    'untrusted tool-result metadata must discard child-transcript artifact references'
  )
  await Promise.all([
    assertMissing(jsonPath),
    assertMissing(markdownPath),
    assertMissing(auditPath),
    assertMissing(ledgerPath)
  ])

  await assert.rejects(
    () => writeAgentConversationRecord(workspace, record),
    /Staged child transcript artifact is not authorized/,
    'run-scoped child transcripts must not be promoted without an explicit save allowance'
  )
  await Promise.all([
    assertMissing(jsonPath),
    assertMissing(markdownPath),
    assertMissing(auditPath),
    assertMissing(ledgerPath)
  ])

  await writeAgentConversationRecord(workspace, record, {
    allowedStagedChildTranscripts: [{ childRunId: 'child-1', archive: stagedChildArchive }]
  })
  const persistedJson = await readFile(jsonPath, 'utf8')
  assert.equal(
    persistedJson.includes(largeToolResult),
    false,
    'large tool result should move out of the conversation JSON materialized view'
  )
  assert.match(persistedJson, /\[tool result archived\]/)
  assert.equal(
    persistedJson.includes(childTranscript),
    false,
    'child transcript should move out of the conversation JSON materialized view'
  )
  assert.equal(
    persistedJson.includes(stagedChildTranscript),
    false,
    'staged child transcript should be promoted without leaking into the conversation JSON materialized view'
  )
  assert.equal(
    persistedJson.includes(stagedChildArchive.relativePath),
    false,
    'conversation metadata should replace run-scoped staging references with conversation-scoped artifacts'
  )
  const loaded = await readAgentConversationRecord(tempRoot, record.id)
  const loadedMetadata = loaded.turns.at(-1)?.metadata
  assert.equal(loadedMetadata?.sources?.some((source) => source.sourceId === 'src-search-1'), true)
  assert.equal(loadedMetadata?.childRuns?.some((child) => child.childRunId === 'child-2'), true)
  assert.deepEqual(
    loadedMetadata?.compactions?.find((compaction) => compaction.id === 'compaction-completed')?.replacedTurnIds,
    ['u1', 'a1'],
    'persisted audit metadata should identify the turns represented by the compaction summary'
  )
  assert.equal(loadedMetadata?.compactions?.some((compaction) => compaction.sourceDigest === 'ctx_done'), true)
  assert.equal(loadedMetadata?.toolResults?.some((tool) => tool.toolCallId === 'tool-large'), true)
  assert.deepEqual(
    loaded.turns.at(-1)?.processEvents?.map((event) => event.kind),
    ['permission_request', 'permission_resolved', 'elicitation_request', 'elicitation_resolved', 'status', 'child_run_delta', 'compaction'],
    'saved conversations must preserve first-class process event kinds'
  )
  const archivedDiagnostic = loadedMetadata?.toolResults?.find((tool) => tool.toolCallId === 'tool-large')
  assert.equal(archivedDiagnostic?.archive?.kind, 'tool_result')
  assert.equal(loaded.turns.at(-1)?.toolCalls?.find((tool) => tool.id === 'tool-large')?.result, largeToolResult)
  const archivedChild = loadedMetadata?.childRuns?.find((child) => child.childRunId === 'child-2') as
    | (NonNullable<typeof loadedMetadata>['childRuns'][number] & { archive?: { kind?: string; relativePath?: string } })
    | undefined
  assert.equal(archivedChild?.archive?.kind, 'child_transcript')
  assert.match(archivedChild?.archive?.relativePath ?? '', /\.agent-sessions\/chat-20260709-audit\/child-transcripts\//)
  const loadedChildTranscript = await readAgentConversationChildTranscript(tempRoot, record.id, 'child-2')
  assert.equal(loadedChildTranscript.content, childTranscript)
  const promotedChild = loadedMetadata?.childRuns?.find((child) => child.childRunId === 'child-1')
  assert.equal(promotedChild?.archive?.kind, 'child_transcript')
  assert.match(promotedChild?.archive?.relativePath ?? '', /\.agent-sessions\/chat-20260709-audit\/child-transcripts\//)
  assert.notEqual(promotedChild?.archive?.relativePath, stagedChildArchive.relativePath)
  const loadedStagedChildTranscript = await readAgentConversationChildTranscript(tempRoot, record.id, 'child-1')
  assert.equal(loadedStagedChildTranscript.content, stagedChildTranscript)
  await assert.rejects(
    () => readAgentConversationChildTranscript(tempRoot, record.id, '../child-2'),
    /Child run id is invalid/
  )
  await assertChildTranscriptLinkEscapeProtection(tempRoot, workspace, { ...record, turns: turnsWithChildTranscript })

    let ledgerLines = parseJsonl(await readFile(ledgerPath, 'utf8'))
  assert.equal(ledgerLines.length, 1)
  assert.equal(ledgerLines[0]?.type, 'conversation_snapshot')
  assert.equal(ledgerLines[0]?.status, 'completed')
  assert.equal(ledgerLines[0]?.conversation?.sessionAuditRelativePath, agentConversationSessionAuditRelativePathForMarkdown(record.relativePath))
  assert.equal(ledgerLines[0]?.evidence?.sources?.some((source: { sourceId?: string }) => source.sourceId === 'src-search-1'), true)
  assert.equal(ledgerLines[0]?.evidence?.childRuns?.some((child: { childRunId?: string }) => child.childRunId === 'child-2'), true)
  assert.equal(
    ledgerLines[0]?.evidence?.permissionDecisions?.some((decision: { decision?: string; targetPath?: string }) =>
      decision.decision === 'allow' && decision.targetPath === 'lessons/retrieval-practice.html'
    ),
    true
  )
  assert.equal(
    ledgerLines[0]?.evidence?.artifacts?.some((artifact: { relativePath?: string }) =>
      artifact.relativePath === 'lessons/retrieval-practice.html'
    ),
    true
  )

  const markdown = await readFile(markdownPath, 'utf8')
  assert.match(markdown, /Sources:/)
  assert.match(markdown, /Child runs:/)
  assert.match(markdown, /Context compaction:/)
  assert.match(markdown, /Tool result diagnostics:/)

  const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
  assert.equal(auditPath, join(tempRoot, auditRelativePath))
  const auditLines = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
  assert.equal(auditLines[0]?.type, 'session')
  assert.equal(auditLines.filter((line) => line.type === 'turn').length, auditedTurns.length)
  assert.equal(auditLines.some((line) => line.type === 'source'), true)
  assert.equal(auditLines.some((line) => line.type === 'child_run'), true)
  const childAuditLine = auditLines.find((line) => line.type === 'child_run' && line.id.endsWith(':child-2')) as
    | { childRun?: { archive?: { kind?: string } } }
    | undefined
  assert.equal(childAuditLine?.childRun?.archive?.kind, 'child_transcript')
  assert.equal(auditLines.some((line) => line.type === 'compaction'), true)
  const compactionAuditLine = auditLines.find((line) => line.type === 'compaction' && line.id.endsWith(':compaction-completed')) as
    | { compaction?: { replacedTurnIds?: string[] } }
    | undefined
  assert.deepEqual(compactionAuditLine?.compaction?.replacedTurnIds, ['u1', 'a1'])
  assert.equal(auditLines.some((line) => line.type === 'context_hygiene'), true)
  assert.equal(auditLines.some((line) => line.type === 'context_estimate'), true)
  assert.equal(auditLines.some((line) => line.type === 'tool_result_diagnostic'), true)
  assert.equal(auditLines.some((line) => line.type === 'tool_call'), true)

  const durableArchiveBeforeRejectedSave = await Promise.all([
    readFile(jsonPath, 'utf8'),
    readFile(markdownPath, 'utf8'),
    readFile(auditPath, 'utf8'),
    readFile(ledgerPath, 'utf8')
  ])
  const invalidArchiveRecord: AgentConversationRecord = {
    ...loaded,
    updatedAt: '2026-07-09T00:00:03.500Z',
    turns: loaded.turns.map((turn) => {
      if (!turn.metadata?.childRuns?.some((child) => child.childRunId === 'child-2')) return turn
      return {
        ...turn,
        metadata: {
          ...turn.metadata,
          childRuns: turn.metadata.childRuns.map((child) => {
            if (child.childRunId !== 'child-2' || !child.archive) return child
            const { transcript: _transcript, transcriptText: _transcriptText, ...persistedChild } = child as typeof child & {
              transcript?: string
              transcriptText?: string
            }
            return {
              ...persistedChild,
              archive: {
                ...child.archive,
                relativePath: child.archive.relativePath.replace(
                  '.agent-sessions/chat-20260709-audit/',
                  '.agent-sessions/chat-other-conversation/'
                )
              }
            }
          })
        }
      }
    })
  }
  await assert.rejects(
    () => writeAgentConversationRecord(workspace, invalidArchiveRecord),
    /child transcript artifact is (?:outside|invalid)/i,
    'archive preflight must reject a child transcript from another conversation scope'
  )
  assert.deepEqual(
    await Promise.all([
      readFile(jsonPath, 'utf8'),
      readFile(markdownPath, 'utf8'),
      readFile(auditPath, 'utf8'),
      readFile(ledgerPath, 'utf8')
    ]),
    durableArchiveBeforeRejectedSave,
    'a failed archive preflight must not mutate canonical JSON, Markdown, audit, or ledger files'
  )

  await writeAgentConversationRecord(workspace, record, {
    allowedStagedChildTranscripts: [{ childRunId: 'child-1', archive: stagedChildArchive }]
  })
  ledgerLines = parseJsonl(await readFile(ledgerPath, 'utf8'))
  assert.equal(ledgerLines.length, 1, 'learning work ledger should skip duplicate conversation snapshots')
  const auditLinesAfterRepeatWrite = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
  assert.equal(
    auditLinesAfterRepeatWrite.length,
    auditLines.length,
    'session audit log should be idempotent when the same conversation snapshot is saved again'
  )

  const continuedRecord: AgentConversationRecord = {
    ...record,
    updatedAt: '2026-07-09T00:00:04.000Z',
    messageCount: loaded.messageCount + 2,
    turns: [
      ...loaded.turns,
      { id: 'u2', role: 'user', content: 'Continue', createdAt: '2026-07-09T00:00:04.000Z' },
      { id: 'a3', role: 'assistant', content: 'Continued.', createdAt: '2026-07-09T00:00:05.000Z' }
    ]
  }
  await writeAgentConversationRecord(workspace, continuedRecord)
  ledgerLines = parseJsonl(await readFile(ledgerPath, 'utf8'))
  assert.equal(ledgerLines.length, 2, 'learning work ledger should append a new snapshot after continuation')
  const auditLinesAfterContinuation = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
  assert.equal(
    auditLinesAfterContinuation.filter((line) => line.type === 'turn').length,
    auditedTurns.length + 2,
    'session audit log should append new turn entries for a continuation'
  )
  assert.equal(
    auditLinesAfterContinuation.filter((line) => line.type === 'session').length,
    1,
    'session audit log should keep a single header'
  )

  await writeFile(
    join(tempRoot, 'conversation', 'chat-20260709-malformed.json'),
    `${JSON.stringify({
      id: 'chat-20260709-malformed',
      title: 'Malformed metadata',
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
      relativePath: 'conversation/chat-20260709-malformed.md',
      turns: [
        {
          id: 'u1',
          role: 'user',
          content: 'Old record',
          metadata: { sources: [{ title: 'missing url' }], childRuns: [{ status: 'weird' }] },
          createdAt: '2026-07-09T00:00:00.000Z'
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Ok',
          metadata: { sources: [{ url: 'https://example.com/no-id' }] },
          createdAt: '2026-07-09T00:00:01.000Z'
        }
      ]
    }, null, 2)}\n`
  )
  const malformed = await readAgentConversationRecord(tempRoot, 'chat-20260709-malformed')
  assert.equal(malformed.turns[0]?.metadata, undefined)
  assert.equal(malformed.turns[1]?.metadata?.sources?.[0]?.url, 'https://example.com/no-id')
  assert.match(malformed.turns[1]?.metadata?.sources?.[0]?.sourceId ?? '', /^source-/)

  console.log('agent conversation audit metadata ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

async function assertChildTranscriptLinkEscapeProtection(
  fixtureRoot: string,
  workspaceTemplate: { id: string; name: string },
  sourceRecord: AgentConversationRecord
): Promise<void> {
  const outsideRoot = join(fixtureRoot, 'artifact-link-outside')
  await mkdir(outsideRoot, { recursive: true })

  const writeRoot = join(fixtureRoot, 'artifact-link-write-workspace')
  const writeRecord = conversationRecordForWorkspace(sourceRecord, writeRoot, 'chat-20260709-write-link-escape')
  const writeLink = join(
    writeRoot,
    agentConversationChildTranscriptDirectoryRelativePathForMarkdown(writeRecord.relativePath)
  )
  await mkdir(dirname(writeLink), { recursive: true })
  if (!(await createDirectoryLinkOrSkip(outsideRoot, writeLink, 'child transcript write escape'))) return
  try {
    await assert.rejects(
      () => writeAgentConversationRecord({ ...workspaceTemplate, rootPath: writeRoot }, writeRecord),
      /symbolic link|junction|resolving symlinks/i,
      'artifact writes must reject a child-transcript parent that escapes through a link'
    )
    assert.deepEqual(
      await readdir(outsideRoot),
      [],
      'rejected child transcript writes must not materialize content outside the workspace'
    )
  } finally {
    await rm(writeLink, { recursive: true, force: true })
  }

  const readRoot = join(fixtureRoot, 'artifact-link-read-workspace')
  await mkdir(readRoot, { recursive: true })
  const readRecord = conversationRecordForWorkspace(sourceRecord, readRoot, 'chat-20260709-read-link-escape')
  await writeAgentConversationRecord({ ...workspaceTemplate, rootPath: readRoot }, readRecord)
  const persisted = await readAgentConversationRecord(readRoot, readRecord.id)
  const archivedChild = persisted.turns
    .flatMap((turn) => turn.metadata?.childRuns ?? [])
    .find((child) => child.childRunId === 'child-2') as
      | ({ archive?: { kind?: string; relativePath?: string } })
      | undefined
  assert.equal(archivedChild?.archive?.kind, 'child_transcript')
  const artifactRelativePath = archivedChild?.archive?.relativePath
  assert.ok(artifactRelativePath)

  const readLink = join(
    readRoot,
    agentConversationChildTranscriptDirectoryRelativePathForMarkdown(readRecord.relativePath)
  )
  const artifactPath = join(readRoot, artifactRelativePath)
  const escapedArtifact = join(outsideRoot, basename(artifactRelativePath))
  await writeFile(escapedArtifact, childTranscript, 'utf8')

  await writeFile(artifactPath, 'tampered child transcript', 'utf8')
  await assert.rejects(
    () => writeAgentConversationRecord({ ...workspaceTemplate, rootPath: readRoot }, readRecord),
    /Content-addressed file already exists with different content/i,
    'content-addressed artifact writes must reject conflicting existing content'
  )
  assert.equal(
    await readFile(artifactPath, 'utf8'),
    'tampered child transcript',
    'content-addressed artifact writes must never overwrite a conflicting file'
  )

  await rm(artifactPath, { force: true })
  if (await createFileLinkOrSkip(escapedArtifact, artifactPath, 'final child transcript symlink')) {
    try {
      await assert.rejects(
        () => readAgentConversationChildTranscript(readRoot, readRecord.id, 'child-2'),
        /unavailable|integrity validation|symbolic link/i,
        'artifact reads must reject a final child-transcript symlink even when its content matches'
      )
      await assert.rejects(
        () => writeAgentConversationRecord({ ...workspaceTemplate, rootPath: readRoot }, readRecord),
        /Final path must not be a symbolic link|junction/i,
        'content-addressed artifact writes must not follow a pre-existing final symlink'
      )
    } finally {
      await rm(artifactPath, { force: true })
    }
  }

  await mkdir(artifactPath)
  try {
    await assert.rejects(
      () => writeAgentConversationRecord({ ...workspaceTemplate, rootPath: readRoot }, readRecord),
      /Final path must be a regular file/i,
      'content-addressed artifact writes must reject a non-regular final path'
    )
  } finally {
    await rm(artifactPath, { recursive: true, force: true })
  }

  await rm(readLink, { recursive: true, force: true })
  if (!(await createDirectoryLinkOrSkip(outsideRoot, readLink, 'child transcript read escape'))) return
  try {
    await assert.rejects(
      () => readAgentConversationChildTranscript(readRoot, readRecord.id, 'child-2'),
      /unavailable|integrity validation|resolving symlinks/i,
      'artifact reads must reject a child-transcript parent that resolves outside the workspace'
    )
    await assert.rejects(
      () => writeAgentConversationRecord({ ...workspaceTemplate, rootPath: readRoot }, persisted),
      /Conversation child transcript artifact is unavailable.*resolving symlinks/i,
      'archive verification must use the same realpath-contained artifact reader'
    )
  } finally {
    await rm(readLink, { recursive: true, force: true })
  }
}

function conversationRecordForWorkspace(
  source: AgentConversationRecord,
  rootPath: string,
  id: string
): AgentConversationRecord {
  const relativePath = `conversation/${id}.md`
  return {
    ...source,
    id,
    relativePath,
    absolutePath: join(rootPath, relativePath)
  }
}

async function createFileLinkOrSkip(target: string, linkPath: string, label: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, 'file')
    return true
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(code)) {
      console.warn(`SKIP ${label}: Windows did not permit creating a file symlink (${code || 'unknown error'}).`)
      return false
    }
    throw error
  }
}

async function createDirectoryLinkOrSkip(target: string, linkPath: string, label: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(code)) {
      console.warn(`SKIP ${label}: Windows did not permit creating a junction (${code || 'unknown error'}).`)
      return false
    }
    throw error
  }
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(
    () => readFile(path, 'utf8'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT',
    `${path} should not exist`
  )
}

function parseJsonl(content: string): Array<Record<string, any>> {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}
