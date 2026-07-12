import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  attachAgentRunAuditMetadata,
  buildAgentTurnAuditMetadata
} from '../../src/main/ai/agent-run-audit'
import {
  parseAgentConversationSessionAuditLines
} from '../../src/main/agent-conversation-session-audit'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import {
  readAgentConversationRecord,
  writeAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../src/main/learning-work-ledger'
import type { AgentChatTurn, AgentConversationRecord } from '../../src/shared/teaching-types'

const largeToolResult = `${'line\n'.repeat(45)}${'x'.repeat(2100)}`

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

let tempRoot = ''
try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-audit-'))
  await mkdir(join(tempRoot, 'conversation'), { recursive: true })
  const workspace = { id: 'workspace-1', name: 'Audit Workspace', rootPath: tempRoot }
  const record: AgentConversationRecord = {
    id: 'chat-20260709-audit',
    workspaceId: workspace.id,
    title: 'Audit metadata',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:03.000Z',
    relativePath: 'conversation/chat-20260709-audit.md',
    absolutePath: join(tempRoot, 'conversation', 'chat-20260709-audit.md'),
    messageCount: auditedTurns.length,
    turns: auditedTurns
  }

  await writeAgentConversationRecord(workspace, record)
  const persistedJson = await readFile(join(tempRoot, agentConversationJsonRelativePathForMarkdown(record.relativePath)), 'utf8')
  assert.equal(
    persistedJson.includes(largeToolResult),
    false,
    'large tool result should move out of the conversation JSON materialized view'
  )
  assert.match(persistedJson, /\[tool result archived\]/)
  const loaded = await readAgentConversationRecord(tempRoot, record.id)
  const loadedMetadata = loaded.turns.at(-1)?.metadata
  assert.equal(loadedMetadata?.sources?.some((source) => source.sourceId === 'src-search-1'), true)
  assert.equal(loadedMetadata?.childRuns?.some((child) => child.childRunId === 'child-2'), true)
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

  const ledgerPath = join(tempRoot, LEARNING_WORK_LEDGER_RELATIVE_PATH)
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

  const markdown = await readFile(join(tempRoot, record.relativePath), 'utf8')
  assert.match(markdown, /Sources:/)
  assert.match(markdown, /Child runs:/)
  assert.match(markdown, /Context compaction:/)
  assert.match(markdown, /Tool result diagnostics:/)

  const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(record.relativePath)
  const auditPath = join(tempRoot, auditRelativePath)
  const auditLines = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
  assert.equal(auditLines[0]?.type, 'session')
  assert.equal(auditLines.filter((line) => line.type === 'turn').length, auditedTurns.length)
  assert.equal(auditLines.some((line) => line.type === 'source'), true)
  assert.equal(auditLines.some((line) => line.type === 'child_run'), true)
  assert.equal(auditLines.some((line) => line.type === 'compaction'), true)
  assert.equal(auditLines.some((line) => line.type === 'context_hygiene'), true)
  assert.equal(auditLines.some((line) => line.type === 'context_estimate'), true)
  assert.equal(auditLines.some((line) => line.type === 'tool_result_diagnostic'), true)
  assert.equal(auditLines.some((line) => line.type === 'tool_call'), true)

  await writeAgentConversationRecord(workspace, record)
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
    messageCount: record.messageCount + 2,
    turns: [
      ...record.turns,
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

function parseJsonl(content: string): Array<Record<string, any>> {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}
