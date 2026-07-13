import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseAgentConversationSessionAuditLines } from '../../src/main/agent-conversation-session-audit'
import { LEARNING_WORK_LEDGER_RELATIVE_PATH } from '../../src/main/learning-work-ledger'
import {
  listAgentConversations,
  readAgentConversationRecord,
  writeAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'
import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const workspace = { id: 'archive-workspace', name: 'Archive Workspace', rootPath: '' }
const largeNormalResult = `${'normal result line\n'.repeat(80)}${'n'.repeat(2400)}`
const largeFailedResult = `${'failed result line\n'.repeat(80)}${'f'.repeat(2400)}`
let rootPath = ''

try {
  rootPath = await mkdtemp(join(tmpdir(), 'studiumx-agent-conversation-archive-'))
  workspace.rootPath = rootPath
  await mkdir(join(rootPath, 'courses', 'algorithms', 'conversation'), { recursive: true })
  await mkdir(join(rootPath, 'conversations'), { recursive: true })

  const courseRecord = createRecord({
    id: 'chat-course-archive',
    title: 'Archive a course conversation',
    relativePath: 'courses/algorithms/conversation/chat-course-archive.md',
    updatedAt: '2026-07-14T01:00:00.000Z'
  })
  await writeAgentConversationRecord(workspace, courseRecord)

  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(courseRecord.relativePath)
  const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(courseRecord.relativePath)
  const jsonPath = join(rootPath, jsonRelativePath)
  const markdownPath = join(rootPath, courseRecord.relativePath)
  const auditPath = join(rootPath, auditRelativePath)
  const ledgerPath = join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
  const persisted = JSON.parse(await readFile(jsonPath, 'utf8')) as AgentConversationRecord

  assert.equal(persisted.relativePath, courseRecord.relativePath)
  assert.equal(persisted.workspaceId, workspace.id)
  assert.equal((await readFile(markdownPath, 'utf8')).startsWith('# Archive a course conversation'), true)
  const toolDiagnostics = persisted.turns.flatMap((turn) => turn.metadata?.toolResults ?? [])
  const normalDiagnostic = toolDiagnostics.find((entry) => entry.toolCallId === 'normal-tool')
  const failedDiagnostic = toolDiagnostics.find((entry) => entry.toolCallId === 'failed-tool')
  assert.equal(normalDiagnostic?.archive?.kind, 'tool_result')
  assert.equal(failedDiagnostic?.archive?.kind, 'tool_result')
  assert.equal(failedDiagnostic?.isError, true)
  assert.ok(normalDiagnostic?.archive?.relativePath.includes('courses/algorithms/conversation/.agent-sessions/chat-course-archive/tool-results/'))
  assert.ok(failedDiagnostic?.archive?.relativePath.includes('courses/algorithms/conversation/.agent-sessions/chat-course-archive/tool-results/'))
  assert.equal(await readFile(join(rootPath, normalDiagnostic!.archive!.relativePath), 'utf8'), largeNormalResult)
  assert.equal(await readFile(join(rootPath, failedDiagnostic!.archive!.relativePath), 'utf8'), largeFailedResult)

  const hydrated = await readAgentConversationRecord(rootPath, courseRecord.id)
  const hydratedTools = hydrated.turns.flatMap((turn) => turn.toolCalls ?? [])
  assert.equal(hydratedTools.find((tool) => tool.id === 'normal-tool')?.result, largeNormalResult)
  assert.equal(hydratedTools.find((tool) => tool.id === 'failed-tool')?.result, largeFailedResult)

  const initialAudit = parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8'))
  const initialLedger = parseJsonl(await readFile(ledgerPath, 'utf8'))
  assert.equal(initialAudit.filter((line) => line.type === 'session').length, 1)
  assert.equal(initialAudit.filter((line) => line.type === 'tool_call').length, 2)
  assert.equal(initialLedger.length, 1)
  assert.equal(initialLedger[0]?.conversation?.relativePath, courseRecord.relativePath)
  assert.equal(initialLedger[0]?.conversation?.jsonRelativePath, jsonRelativePath)
  assert.equal(initialLedger[0]?.conversation?.sessionAuditRelativePath, auditRelativePath)

  await writeAgentConversationRecord(workspace, courseRecord)
  assert.equal(parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8')).length, initialAudit.length)
  assert.equal(parseJsonl(await readFile(ledgerPath, 'utf8')).length, initialLedger.length)

  const temporaryRecord = createRecord({
    id: 'chat-temporary-archive',
    title: 'Archive a temporary conversation',
    relativePath: 'conversations/chat-temporary-archive.md',
    updatedAt: '2026-07-14T02:00:00.000Z'
  })
  await writeAgentConversationRecord(workspace, temporaryRecord)
  const summaries = await listAgentConversations(rootPath)
  assert.deepEqual(summaries.map((summary) => summary.id), [temporaryRecord.id, courseRecord.id])
  assert.equal(summaries.find((summary) => summary.id === courseRecord.id)?.relativePath, courseRecord.relativePath)
  assert.equal(summaries.find((summary) => summary.id === temporaryRecord.id)?.relativePath, temporaryRecord.relativePath)

  // Simulate a process dying after JSON and ledger were durable but before the derived archive completed.
  await unlink(markdownPath)
  await unlink(auditPath)
  await unlink(join(rootPath, normalDiagnostic!.archive!.relativePath))
  await writeFile(jsonPath, '{"partial":true}\n', 'utf8')
  const ledgerCountBeforeRepair = parseJsonl(await readFile(ledgerPath, 'utf8')).length
  await writeAgentConversationRecord(workspace, courseRecord)
  assert.equal(await readFile(join(rootPath, normalDiagnostic!.archive!.relativePath), 'utf8'), largeNormalResult)
  assert.equal(parseAgentConversationSessionAuditLines(await readFile(auditPath, 'utf8')).filter((line) => line.type === 'session').length, 1)
  assert.equal(parseJsonl(await readFile(ledgerPath, 'utf8')).length, ledgerCountBeforeRepair)
  const repaired = JSON.parse(await readFile(jsonPath, 'utf8')) as AgentConversationRecord
  assert.equal(repaired.id, courseRecord.id)
  assert.equal((await readFile(markdownPath, 'utf8')).includes('Tool result diagnostics:'), true)

  await assert.rejects(
    () => writeAgentConversationRecord(workspace, {
      ...courseRecord,
      id: 'chat-invalid-placement',
      relativePath: 'notes/chat-invalid-placement.md'
    }),
    /outside a conversations directory/
  )

  console.log('agent conversation durable archive boundaries ok')
} finally {
  if (rootPath) await rm(rootPath, { recursive: true, force: true })
}

function createRecord(input: {
  id: string
  title: string
  relativePath: string
  updatedAt: string
}): AgentConversationRecord {
  return {
    id: input.id,
    workspaceId: workspace.id,
    title: input.title,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: input.updatedAt,
    relativePath: input.relativePath,
    absolutePath: join(workspace.rootPath, input.relativePath),
    messageCount: 2,
    turns: [
      {
        id: 'user-1',
        role: 'user',
        content: 'Please archive this conversation.',
        createdAt: '2026-07-14T00:00:00.000Z'
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'I used two tools and saved their results.',
        createdAt: '2026-07-14T00:00:01.000Z',
        toolCalls: [
          {
            id: 'normal-tool',
            name: 'read_workspace_file',
            arguments: '{"path":"notes.md"}',
            result: largeNormalResult,
            isError: false
          },
          {
            id: 'failed-tool',
            name: 'web_fetch',
            arguments: '{"url":"https://example.com"}',
            result: largeFailedResult,
            isError: true
          }
        ]
      }
    ]
  }
}

function parseJsonl(content: string): Array<Record<string, any>> {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}
