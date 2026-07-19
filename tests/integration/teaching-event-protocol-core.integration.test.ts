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

  it('round6 multi-session: project_snapshot for older A is not polluted by newer B', async () => {
    const workspaceRoot = await createWorkspace()
    let clock = 0
    const now = () => {
      clock += 1
      return new Date(Date.UTC(2026, 6, 18, 12, 0, clock)).toISOString().replace(/\.\d{3}Z$/, '.000Z')
    }
    let idSeq = 0
    const createId = () => {
      idSeq += 1
      return idSeq === 1 ? 'session-a-old' : 'session-b-new'
    }

    const ledger = createLearningSessionLedger({ workspaceRoot, now, createId })
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

    const openA = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-a',
      eventId: 'ev-open-a',
      operationId: 'op-open-a',
      workspaceId: 'workspace-protocol',
      open: {
        sessionId: 'session-a-old',
        workspaceId: 'workspace-protocol',
        courseRef: {
          courseId: 'course-protocol',
          courseName: 'Protocol Course',
          relativePath: 'courses/protocol'
        },
        lessonRef: {
          lessonId: 'lesson-a',
          title: 'Lesson A',
          relativePath: 'courses/protocol/lesson-a.html'
        }
      }
    })
    expect(openA.acceptance).toBe('accepted')
    expect(openA.sessionId).toBe('session-a-old')

    await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-a',
      eventId: 'ev-evidence-a',
      operationId: 'op-evidence-a',
      workspaceId: 'workspace-protocol',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-A-1',
        kind: 'lesson_opened',
        workspaceId: 'workspace-protocol',
        courseId: 'course-protocol',
        sessionId: 'session-a-old',
        lessonId: 'lesson-a',
        itemId: 'item-a',
        attempt: 1,
        observedAt: '2026-07-18T12:00:10.000Z',
        artifactDigest: 'a'.repeat(64),
        surface: 'lesson_preview'
      }
    })

    const openB = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-b',
      eventId: 'ev-open-b',
      operationId: 'op-open-b',
      workspaceId: 'workspace-protocol',
      open: {
        sessionId: 'session-b-new',
        workspaceId: 'workspace-protocol',
        courseRef: {
          courseId: 'course-protocol',
          courseName: 'Protocol Course',
          relativePath: 'courses/protocol'
        },
        lessonRef: {
          lessonId: 'lesson-b',
          title: 'Lesson B',
          relativePath: 'courses/protocol/lesson-b.html'
        }
      }
    })
    expect(openB.acceptance).toBe('accepted')
    expect(openB.sessionId).toBe('session-b-new')

    // Record more activity on B so it is clearly the scan-latest session.
    await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-b',
      eventId: 'ev-evidence-b1',
      operationId: 'op-evidence-b1',
      workspaceId: 'workspace-protocol',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-B-1',
        kind: 'lesson_opened',
        workspaceId: 'workspace-protocol',
        courseId: 'course-protocol',
        sessionId: 'session-b-new',
        lessonId: 'lesson-b',
        itemId: 'item-b1',
        attempt: 1,
        observedAt: '2026-07-18T12:00:20.000Z',
        artifactDigest: 'b'.repeat(64),
        surface: 'lesson_preview'
      }
    })
    await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-b',
      eventId: 'ev-evidence-b2',
      operationId: 'op-evidence-b2',
      workspaceId: 'workspace-protocol',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-B-2',
        kind: 'quiz_answered',
        workspaceId: 'workspace-protocol',
        courseId: 'course-protocol',
        sessionId: 'session-b-new',
        lessonId: 'lesson-b',
        itemId: 'item-b2',
        attempt: 1,
        observedAt: '2026-07-18T12:00:21.000Z',
        artifactDigest: 'c'.repeat(64),
        surface: 'lesson_preview',
        selectedOptionIds: ['x'],
        correct: false
      }
    })

    const loadedLatest = await loadTeachingLoopFactSource(
      { ledger, workspaceRoot, committer },
      {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-protocol' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['resource-1'] }
      }
    )
    expect(loadedLatest.facts.latestSession?.id).toBe('session-b-new')

    const projectA = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-project-a',
      eventId: 'ev-project-a',
      operationId: 'op-project-a',
      workspaceId: 'workspace-protocol',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-protocol' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['resource-1'] },
        sessionId: 'session-a-old'
      }
    })
    expect(projectA.acceptance).toBe('accepted')
    expect(projectA.sessionId).toBe('session-a-old')
    // H1: facts, safeProjection, planner inputs, and envelopes all pin A (not scan-latest B).
    expect(projectA.facts?.latestSession?.id).toBe('session-a-old')
    expect(projectA.facts?.latestSession?.eventCount).toBe(1)
    expect(loadedLatest.facts.latestSession?.eventCount).toBeGreaterThan(
      projectA.facts?.latestSession?.eventCount ?? 0
    )
    expect(projectA.snapshot?.safeProjection.session?.id).toBe('session-a-old')
    expect(projectA.snapshot?.safeProjection.session?.id).not.toBe('session-b-new')
    expect(projectA.snapshot?.safeProjection.courseId).toBe('course-protocol')
    const loopA = projectA.events.find((e) => e.payload.type === 'loop_snapshot')
    expect(loopA?.payload).toMatchObject({ type: 'loop_snapshot', sessionId: 'session-a-old' })
    expect(loopA?.sessionId).toBe('session-a-old')
    expect(projectA.nextStep).toBeDefined()
    expect(projectA.nextStep?.safeInputSummary.latestSession.id).toBe('session-a-old')
    expect(projectA.nextStep?.action).toEqual(expect.any(String))
    expect(projectA.nextStep?.reason).toEqual(expect.any(String))
    // Envelope identity must stay on A — never B.
    for (const event of projectA.events) {
      expect(event.sessionId).toBe('session-a-old')
      expect(event.sessionId).not.toBe('session-b-new')
    }
  })

})
