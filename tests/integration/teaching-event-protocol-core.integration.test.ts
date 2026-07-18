import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { createLessonInteractionRecorder } from '../../src/main/lesson-interaction-recorder'
import { createLearningOutcomeCommitter } from '../../src/main/learning-outcome-committer'
import { createNextTeachingStepPlanner } from '../../src/main/next-teaching-step-planner'
import { createTeachingTurnCoordinator } from '../../src/main/teaching-turn-coordinator'
import { loadTeachingLoopFactSource } from '../../src/main/teaching-loop-fact-source'

const roots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-teaching-protocol-core-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('teaching-event-protocol-core filesystem integration', () => {
  it('opens a real ledger session, records evidence, projects snapshot from durable facts, and stays idempotent', async () => {
    const workspaceRoot = await createWorkspace()
    const times = [
      '2026-07-18T12:00:00.000Z',
      '2026-07-18T12:00:01.000Z',
      '2026-07-18T12:00:02.000Z',
      '2026-07-18T12:00:03.000Z',
      '2026-07-18T12:00:04.000Z',
      '2026-07-18T12:00:05.000Z',
      '2026-07-18T12:00:06.000Z',
      '2026-07-18T12:00:07.000Z',
      '2026-07-18T12:00:08.000Z'
    ]
    const now = () => times.shift() ?? '2026-07-18T12:00:09.000Z'

    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now,
      createId: () => 'session-protocol-1'
    })
    const recorder = createLessonInteractionRecorder({ ledger })
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger, now })
    const planner = createNextTeachingStepPlanner()
    const coordinator = createTeachingTurnCoordinator({
      ledger,
      recorder,
      committer,
      planner,
      factSource: { ledger, workspaceRoot, committer },
      now
    })

    const opened = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-open',
      eventId: 'event-open-1',
      operationId: 'op-open-1',
      workspaceId: 'workspace-protocol',
      open: {
        sessionId: 'session-protocol-1',
        workspaceId: 'workspace-protocol',
        courseRef: {
          courseId: 'course-protocol',
          courseName: 'Protocol Course',
          relativePath: 'courses/protocol'
        },
        lessonRef: {
          lessonId: 'lesson-1',
          title: 'Protocol Lesson',
          relativePath: 'courses/protocol/lesson-1.html'
        }
      }
    })
    expect(opened.sessionId).toBe('session-protocol-1')
    expect(opened.acceptance).toBe('accepted')
    expect(opened.events.some((event) => event.payload.type === 'session_opened' && event.durability === 'durable')).toBe(true)
    // Intermediate commands stay nonterminal so one turn can span open/record/project/commit.
    expect(opened.terminal).toBeNull()
    expect(opened.events.some((event) => event.payload.type === 'turn_terminal')).toBe(false)

    const openedAgain = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-open',
      eventId: 'event-open-1',
      operationId: 'op-open-1',
      workspaceId: 'workspace-protocol',
      open: {
        sessionId: 'session-protocol-1',
        workspaceId: 'workspace-protocol',
        courseRef: {
          courseId: 'course-protocol',
          courseName: 'Protocol Course',
          relativePath: 'courses/protocol'
        },
        lessonRef: {
          lessonId: 'lesson-1',
          title: 'Protocol Lesson',
          relativePath: 'courses/protocol/lesson-1.html'
        }
      }
    })
    expect(openedAgain.acceptance).toBe('duplicate')
    expect(openedAgain.events.some((event) => event.payload.type === 'command_duplicate')).toBe(true)

    const evidence = await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-open',
      eventId: 'event-evidence-1',
      operationId: 'op-evidence-1',
      workspaceId: 'workspace-protocol',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-protocol-1',
        kind: 'lesson_opened',
        workspaceId: 'workspace-protocol',
        courseId: 'course-protocol',
        sessionId: 'session-protocol-1',
        lessonId: 'lesson-1',
        itemId: 'item-open',
        attempt: 1,
        observedAt: '2026-07-18T12:00:03.000Z',
        artifactDigest: 'b'.repeat(64),
        surface: 'lesson_preview'
      }
    })
    expect(evidence.acceptance).toBe('accepted')
    expect(evidence.terminal).toBeNull()
    expect(evidence.events.some((event) => event.payload.type === 'evidence_recorded' && event.durability === 'durable')).toBe(true)

    const loaded = await loadTeachingLoopFactSource(
      { ledger, workspaceRoot, committer },
      {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-protocol' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['resource-1'] },
        sessionId: 'session-protocol-1'
      }
    )
    expect(loaded.facts.latestSession).toMatchObject({
      id: 'session-protocol-1',
      source: 'canonical',
      status: 'active'
    })
    expect(loaded.facts.latestSession?.eventCount).toBeGreaterThan(0)

    const projected = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-project',
      eventId: 'event-project-1',
      operationId: 'op-project-1',
      workspaceId: 'workspace-protocol',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-protocol' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['resource-1'] },
        sessionId: 'session-protocol-1'
      }
    })
    expect(projected.acceptance).toBe('accepted')
    expect(projected.terminal).toBeNull()
    expect(projected.snapshot?.identity).toMatch(/^[a-f0-9]{64}$/)
    expect(projected.snapshot?.safeProjection.session?.id).toBe('session-protocol-1')
    expect(projected.events.some((event) => event.payload.type === 'loop_snapshot' && event.durability === 'ephemeral')).toBe(true)

    const durableSession = await ledger.load('session-protocol-1')
    expect(durableSession).toMatchObject({ id: 'session-protocol-1', status: 'active' })
    expect(durableSession?.events.some((event) => event.eventId === 'evidence-protocol-1')).toBe(true)

    const canceled = await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-open',
      eventId: 'event-cancel-1',
      operationId: 'op-cancel-1',
      workspaceId: 'workspace-protocol',
      sessionId: 'session-protocol-1',
      reasonCode: 'user_cancel'
    })
    expect(canceled.acceptance).toBe('accepted')
    expect(canceled.terminal?.payload).toMatchObject({ type: 'turn_terminal', outcome: 'canceled' })
    const afterTerminal = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-open',
      eventId: 'event-project-late',
      operationId: 'op-project-late',
      workspaceId: 'workspace-protocol',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-protocol' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['resource-1'] },
        sessionId: 'session-protocol-1'
      }
    })
    expect(afterTerminal.acceptance).toBe('rejected')
    expect(afterTerminal.rejectReason).toBe('already_terminal')
  })
})

