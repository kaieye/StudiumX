import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  attachAgentRunAuditMetadata,
  buildAgentTurnAuditMetadata
} from '../../src/main/ai/agent-run-audit'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import {
  readAgentConversationRecord,
  writeAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'
import type { AgentChatTurn, AgentConversationRecord } from '../../src/shared/teaching-types'

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
    result: `${'line\n'.repeat(45)}${'x'.repeat(2100)}`,
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
  { id: 'a2', role: 'assistant', content: 'Final answer.', createdAt: '2026-07-09T00:00:02.000Z' }
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
  const loaded = await readAgentConversationRecord(tempRoot, record.id)
  const loadedMetadata = loaded.turns.at(-1)?.metadata
  assert.equal(loadedMetadata?.sources?.some((source) => source.sourceId === 'src-search-1'), true)
  assert.equal(loadedMetadata?.childRuns?.some((child) => child.childRunId === 'child-2'), true)
  assert.equal(loadedMetadata?.compactions?.some((compaction) => compaction.sourceDigest === 'ctx_done'), true)
  assert.equal(loadedMetadata?.toolResults?.some((tool) => tool.toolCallId === 'tool-large'), true)

  const markdown = await readFile(join(tempRoot, record.relativePath), 'utf8')
  assert.match(markdown, /Sources:/)
  assert.match(markdown, /Child runs:/)
  assert.match(markdown, /Context compaction:/)
  assert.match(markdown, /Tool result diagnostics:/)

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
