import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CANONICAL_LEARNING_SESSION_EVENT_KINDS,
  CANONICAL_LEARNING_WORK_ENTRY_TYPES,
  DEBUG_EVENT_KINDS,
  EVENT_DENSITY_BUDGETS,
  assertLearningWorkCanonicalEntry,
  assertNotDebugEventForCanonicalLedger,
  classifyEventKind,
  isCanonicalLearningSessionEventKind,
  isCanonicalLearningWorkEntryType,
  isDebugEventKind,
  validateLearningWorkCanonicalEntry
} from '../../src/shared/event-density-policy'
import {
  LearningWorkLedger,
  LEARNING_WORK_LEDGER_RELATIVE_PATH
} from '../../src/main/learning-work-ledger'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import type { AgentChatTurn, AgentConversationRecord } from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'
const updatedAt = '2026-07-14T10:05:00.000Z'

function conversation(id: string): AgentConversationRecord {
  const relativePath = `courses/physics/conversation/${id}.md`
  const turns: AgentChatTurn[] = [
    {
      id: 'turn-1',
      role: 'assistant',
      content: 'Compact answer',
      createdAt: updatedAt,
      processEvents: [{ id: 'done', kind: 'status', title: 'done', createdAt: updatedAt, status: 'done' }]
    }
  ]
  return {
    id,
    workspaceId: 'ws-1',
    title: `Conversation ${id}`,
    createdAt,
    updatedAt,
    relativePath,
    absolutePath: relativePath,
    messageCount: turns.length,
    turns
  }
}

describe('event density policy (DB-P1-3)', () => {
  it('classifies closed session kinds as canonical and stream kinds as debug', () => {
    for (const kind of CANONICAL_LEARNING_SESSION_EVENT_KINDS) {
      expect(isCanonicalLearningSessionEventKind(kind)).toBe(true)
      expect(classifyEventKind(kind)).toBe('canonical_learning_session')
    }
    for (const type of CANONICAL_LEARNING_WORK_ENTRY_TYPES) {
      expect(isCanonicalLearningWorkEntryType(type)).toBe(true)
      expect(classifyEventKind(type)).toBe('canonical_learning_work')
    }
    for (const kind of DEBUG_EVENT_KINDS) {
      expect(isDebugEventKind(kind)).toBe(true)
      expect(isDebugEventKind(kind.toUpperCase())).toBe(true)
      expect(classifyEventKind(kind)).toBe('operational_debug')
    }
    expect(isDebugEventKind('token_stream')).toBe(true)
    expect(isCanonicalLearningSessionEventKind('token_stream')).toBe(false)
  })

  it('documents max rate and payload budgets for each ledger class', () => {
    expect(EVENT_DENSITY_BUDGETS.learningSession.maxEventBytes).toBe(1024 * 1024)
    expect(EVENT_DENSITY_BUDGETS.learningSession.maxPayloadBytes).toBe(512 * 1024)
    expect(EVENT_DENSITY_BUDGETS.learningSession.softMaxEventsPerSession).toBe(500)
    expect(EVENT_DENSITY_BUDGETS.learningSession.softMaxAppendsPerMinute).toBe(30)

    expect(EVENT_DENSITY_BUDGETS.learningWork.maxEvidenceItemsPerCategory).toBe(40)
    expect(EVENT_DENSITY_BUDGETS.learningWork.maxTextFieldChars).toBe(500)
    expect(EVENT_DENSITY_BUDGETS.learningWork.maxActiveSegmentBytes).toBe(50 * 1024 * 1024)
    expect(EVENT_DENSITY_BUDGETS.learningWork.forbidTokenStream).toBe(true)
    expect(EVENT_DENSITY_BUDGETS.learningWork.forbidTurnContent).toBe(true)

    expect(EVENT_DENSITY_BUDGETS.operationalDebug.purgeable).toBe(true)
    expect(EVENT_DENSITY_BUDGETS.operationalDebug.forbiddenLedgers).toContain('learning-work.jsonl')
  })

  it('rejects debug / stream rows for the learning-work canonical ledger', () => {
    const ok = validateLearningWorkCanonicalEntry({
      version: 1,
      entryId: 'learning-work:c1:abc',
      type: 'conversation_snapshot',
      createdAt: updatedAt,
      status: 'completed',
      workspace: { name: 'W' },
      conversation: {
        id: 'c1',
        title: 'T',
        relativePath: 'c.md',
        jsonRelativePath: 'c.json',
        sessionAuditRelativePath: 'c.audit.json',
        updatedAt,
        messageCount: 1
      },
      pointers: { markdown: 'c.md', materializedJson: 'c.json', sessionAudit: 'c.audit.json' },
      evidence: {}
    })
    expect(ok).toEqual({ ok: true })

    expect(validateLearningWorkCanonicalEntry({ type: 'token_stream', entryId: 'x' }).ok).toBe(false)
    expect(validateLearningWorkCanonicalEntry({ type: 'conversation_snapshot', kind: 'token_delta', entryId: 'x' }).ok).toBe(
      false
    )
    expect(validateLearningWorkCanonicalEntry({ type: 'debug_event', entryId: 'x' }).code).toBe('debug_kind_forbidden')
    expect(validateLearningWorkCanonicalEntry({ type: 'agent_stream', entryId: 'x' }).code).toBe('debug_kind_forbidden')
    expect(
      validateLearningWorkCanonicalEntry({
        type: 'conversation_snapshot',
        entryId: 'x',
        content: 'full transcript dump'
      }).ok
    ).toBe(false)

    expect(() => assertNotDebugEventForCanonicalLedger('token_stream')).toThrow(/Debug event kind/)
    expect(() =>
      assertLearningWorkCanonicalEntry({ type: 'prompt_dump', entryId: 'x' })
    ).toThrow(/must not be written/)
  })

  it('guards LearningWorkLedger so debug-shaped snapshots cannot be appended', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-event-density-lw-'))
    try {
      await mkdir(join(root, 'courses', 'physics', 'conversation'), { recursive: true })
      await LearningWorkLedger.appendSnapshot({
        rootPath: root,
        workspace: { id: 'ws-1', name: 'Physics' },
        conversation: conversation('ok-1')
      })
      const lines = (await readFile(join(root, LEARNING_WORK_LEDGER_RELATIVE_PATH), 'utf8'))
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
      expect(lines).toHaveLength(1)
      const parsed = JSON.parse(lines[0]!) as { type: string }
      expect(parsed.type).toBe('conversation_snapshot')

      // Direct append path rejects a forged debug row via the shared guard.
      expect(() =>
        assertLearningWorkCanonicalEntry({
          version: 1,
          entryId: 'forged',
          type: 'token_stream',
          createdAt: updatedAt,
          status: 'completed',
          workspace: { name: 'Physics' },
          conversation: { id: 'x', title: 't', relativePath: 'x.md', jsonRelativePath: 'x.json', sessionAuditRelativePath: 'x.a', updatedAt, messageCount: 0 },
          pointers: { markdown: 'x.md', materializedJson: 'x.json', sessionAudit: 'x.a' },
          evidence: {}
        })
      ).toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects debug kinds on LearningSessionLedger append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-event-density-session-'))
    try {
      const ledger = createLearningSessionLedger({
        workspaceRoot: root,
        now: () => '2026-07-21T01:00:00.000Z',
        createId: () => 'session-density-1'
      })
      await ledger.open({
        workspaceId: 'workspace-1',
        courseRef: {
          courseId: 'course-1',
          courseName: 'Foundations',
          relativePath: 'courses/foundations'
        },
        lessonRef: {
          lessonId: '0001',
          title: 'Density',
          relativePath: 'courses/foundations/lesson/0001-density.html'
        }
      })

      await expect(
        ledger.append('session-density-1', {
          schemaVersion: 1,
          eventId: 'evt-debug-1',
          sessionId: 'session-density-1',
          kind: 'token_stream' as never,
          occurredAt: '2026-07-21T01:00:01.000Z',
          payload: { tokens: ['hello'] }
        })
      ).rejects.toThrow(/Debug \/ stream event kinds/)

      await expect(
        ledger.append('session-density-1', {
          schemaVersion: 1,
          eventId: 'evt-ok-1',
          sessionId: 'session-density-1',
          kind: 'quiz_attempted',
          occurredAt: '2026-07-21T01:00:02.000Z',
          payload: { itemId: 'q1', correct: true }
        })
      ).resolves.toMatchObject({ eventCount: 1 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
