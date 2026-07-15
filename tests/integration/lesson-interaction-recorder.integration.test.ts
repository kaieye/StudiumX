import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { createLessonInteractionRecorder } from '../../src/main/lesson-interaction-recorder'

const roots: string[] = []
const digest = 'b'.repeat(64)

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-lesson-evidence-integration-'))
  roots.push(root)
  return root
}

async function openSession(workspaceRoot: string) {
  const ledger = createLearningSessionLedger({
    workspaceRoot,
    now: () => '2026-07-15T13:00:00.000Z',
    createId: () => 'session-evidence-integration'
  })
  await ledger.open({
    workspaceId: 'workspace-1',
    courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
    lessonRef: { lessonId: 'lesson-1', title: 'Evidence', relativePath: 'courses/foundations/lesson-1.html' },
    conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversations/conversation-1.json' }]
  })
  return ledger
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LessonInteractionRecorder durable integration', () => {
  it('is idempotent by eventId, preserves multiple attempts, and reloads typed evidence after restart', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot)
    const recorder = createLessonInteractionRecorder({ ledger })
    const base = {
      schemaVersion: 1 as const,
      workspaceId: 'workspace-1', courseId: 'course-1', sessionId: 'session-evidence-integration', lessonId: 'lesson-1',
      itemId: 'retrieval-1', artifactDigest: digest, surface: 'lesson_preview' as const, responseKind: 'short_answer' as const
    }
    const first = await recorder.record({
      ...base, eventId: 'retrieval-001', kind: 'retrieval_response_submitted', attempt: 1,
      observedAt: '2026-07-15T13:00:01.000Z', responseDigest: 'c'.repeat(64)
    })
    const replay = await recorder.record({
      ...base, eventId: 'retrieval-001', kind: 'retrieval_response_submitted', attempt: 1,
      observedAt: '2026-07-15T13:00:01.000Z', responseDigest: 'c'.repeat(64)
    })
    await recorder.record({
      ...base, eventId: 'retrieval-002', kind: 'retrieval_response_submitted', attempt: 2,
      observedAt: '2026-07-15T13:00:02.000Z', responseDigest: 'd'.repeat(64)
    })
    await recorder.record({
      ...base, eventId: 'conversation-001', kind: 'conversation_evidence_recorded', itemId: 'conversation-prompt-1', attempt: 1,
      observedAt: '2026-07-15T13:00:03.000Z', responseDigest: 'e'.repeat(64), responseKind: 'short_answer', surface: 'conversation',
      provenance: {
        conversationId: 'conversation-1', turnId: 'turn-1', author: 'learner', turnCreatedAt: '2026-07-15T13:00:02.500Z'
      }
    })

    expect(first.duplicate).toBe(false)
    expect(replay).toMatchObject({ duplicate: true, sequence: first.sequence })

    const restarted = createLessonInteractionRecorder({ ledger: createLearningSessionLedger({ workspaceRoot }) })
    const evidence = await restarted.list('session-evidence-integration')
    expect(evidence.map((event) => [event.eventId, event.attempt])).toEqual([
      ['retrieval-001', 1], ['retrieval-002', 2], ['conversation-001', 1]
    ])
    expect(evidence[2]).toMatchObject({
      kind: 'conversation_evidence_recorded',
      provenance: { conversationId: 'conversation-1', turnId: 'turn-1', author: 'learner' }
    })
    expect(JSON.stringify(evidence)).not.toMatch(/chain[ -]?of[ -]?thought/i)
  })

  it('uses the atomic ledger receipt when same-content event replays race after both identity loads', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot)
    let completedIdentityLoads = 0
    let releaseIdentityLoads!: () => void
    const bothIdentityLoadsCompleted = new Promise<void>((resolve) => {
      releaseIdentityLoads = resolve
    })
    const synchronizedLedger = {
      async load(sessionId: string) {
        const snapshot = await ledger.load(sessionId)
        completedIdentityLoads += 1
        if (completedIdentityLoads === 2) releaseIdentityLoads()
        await bothIdentityLoadsCompleted
        return snapshot
      },
      appendWithReceipt(sessionId: string, event: Parameters<typeof ledger.appendWithReceipt>[1]) {
        return ledger.appendWithReceipt(sessionId, event)
      }
    }
    const recorder = createLessonInteractionRecorder({ ledger: synchronizedLedger })
    const replay = {
      schemaVersion: 1 as const,
      eventId: 'racing-retrieval-001',
      kind: 'retrieval_response_submitted' as const,
      workspaceId: 'workspace-1',
      courseId: 'course-1',
      sessionId: 'session-evidence-integration',
      lessonId: 'lesson-1',
      itemId: 'retrieval-1',
      attempt: 1,
      observedAt: '2026-07-15T13:00:01.000Z',
      artifactDigest: digest,
      responseDigest: 'c'.repeat(64),
      responseKind: 'short_answer' as const,
      surface: 'lesson_preview' as const
    }

    const receipts = await Promise.all([recorder.record(replay), recorder.record({ ...replay })])

    expect(completedIdentityLoads).toBe(2)
    expect(receipts.filter((receipt) => !receipt.duplicate)).toHaveLength(1)
    expect(receipts.filter((receipt) => receipt.duplicate)).toHaveLength(1)
    expect(receipts[0].sequence).toBe(receipts[1].sequence)

    const restarted = createLessonInteractionRecorder({ ledger: createLearningSessionLedger({ workspaceRoot }) })
    const evidence = await restarted.list('session-evidence-integration')
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ eventId: 'racing-retrieval-001', sequence: receipts[0].sequence })
  })
})
