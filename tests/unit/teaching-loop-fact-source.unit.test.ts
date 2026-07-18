import { describe, expect, it, vi } from 'vitest'
import {
  loadTeachingLoopFactSource,
  projectTeachingLoopFactSource,
  settlementFromMarker,
  settlementFromCommitter,
  readSettlementMarkerFromFilesystem
} from '../../src/main/teaching-loop-fact-source'
import type { LearningSessionScanResult, CanonicalLearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'
import type { OutcomeSettlementMarker, OutcomeReconciliation } from '../../src/main/learning-outcome-committer'

function emptyScan(overrides: Partial<LearningSessionScanResult> = {}): LearningSessionScanResult {
  return {
    sessions: [],
    canonicalSessions: [],
    legacySessions: [],
    diagnostics: [],
    quarantined: [],
    stages: [],
    recoveries: [],
    settlement: { fileSync: 'supported', directorySync: 'supported' },
    ...overrides
  }
}

function canonical(overrides: Partial<CanonicalLearningSessionSnapshot> = {}): CanonicalLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-1',
    workspaceId: 'workspace-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T01:00:00.000Z',
    completedAt: null,
    courseRef: {
      courseId: 'course-1',
      courseName: 'Course 1',
      relativePath: 'courses/course-1'
    },
    lessonRef: null,
    conversationRefs: [],
    eventCount: 2,
    outcomeRef: null,
    events: [],
    ...overrides
  }
}

describe('teaching-loop-fact-source adapters', () => {
  it('loads facts from ledger scan without writing or inventing a second truth', async () => {
    const session = canonical()
    const scan = emptyScan({
      sessions: [session],
      canonicalSessions: [session]
    })
    const ledger = {
      scan: vi.fn(async () => scan)
    }
    const loadSettlement = vi.fn(async () => null)

    const loaded = await loadTeachingLoopFactSource(
      { ledger, loadSettlement },
      {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['resource-1'] }
      }
    )

    expect(ledger.scan).toHaveBeenCalledTimes(1)
    expect(loadSettlement).toHaveBeenCalledWith('session-1')
    expect(loaded.facts.latestSession).toMatchObject({ id: 'session-1', eventCount: 2 })
    expect(loaded.snapshot.safeProjection.courseId).toBe('course-1')
    expect(loaded.snapshot.identity).toMatch(/^[a-f0-9]{64}$/)
  })

  it('projects settlement markers into trusted durable outcome facts', async () => {
    const session = canonical({ eventCount: 4 })
    const scan = emptyScan({
      sessions: [session],
      canonicalSessions: [session]
    })
    const settlement = {
      sessionId: 'session-1',
      outcomeId: 'outcome-1',
      kind: 'needs_practice' as const,
      evidenceEventIds: ['evidence-1']
    }

    const loaded = await loadTeachingLoopFactSource(
      {
        ledger: { scan: async () => scan },
        loadSettlement: async () => settlement
      },
      {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        resources: { readiness: 'ready', availableCount: 0, provenanceIds: [] },
        sessionId: 'session-1'
      }
    )

    expect(loaded.facts.durableOutcome).toEqual({
      status: 'trusted',
      id: 'outcome-1',
      kind: 'needs_practice',
      evidenceEventIds: ['evidence-1']
    })
    expect(loaded.facts.evidence.status).toBe('verified')
    expect(loaded.snapshot.displayState).toBe('waiting_for_learner')
  })

  it('maps committer reconcile markers and omits review_required settlements', async () => {
    const marker: OutcomeSettlementMarker = {
      schemaVersion: 1,
      sessionId: 'session-1',
      outcomeId: 'outcome-1',
      operationId: 'op-1',
      kind: 'established',
      evidenceEventIds: ['e1'],
      evaluatorVersion: 1,
      record: null
    }
    const settled: OutcomeReconciliation = {
      sessionId: 'session-1',
      state: 'settled',
      marker,
      record: null,
      catalogRecordPresent: false,
      diagnostics: []
    }
    const review: OutcomeReconciliation = {
      ...settled,
      state: 'review_required',
      marker
    }

    await expect(settlementFromCommitter({ reconcile: async () => settled }, 'session-1')).resolves.toEqual(
      settlementFromMarker(marker)
    )
    await expect(settlementFromCommitter({ reconcile: async () => review }, 'session-1')).resolves.toBeNull()
  })

  it('projectTeachingLoopFactSource is pure over already-loaded source inputs', () => {
    const session = canonical()
    const source = {
      mission: { id: 'mission-1', nextGoal: 'available' as const },
      course: { id: 'course-1' },
      sessions: emptyScan({
        sessions: [session],
        canonicalSessions: [session]
      }),
      resources: { readiness: 'ready' as const, availableCount: 1, provenanceIds: ['r1'] }
    }

    const first = projectTeachingLoopFactSource(source)
    const second = projectTeachingLoopFactSource(source)
    expect(first.snapshot.identity).toBe(second.snapshot.identity)
    expect(first.facts.latestSession?.id).toBe('session-1')
  })

  it('readSettlementMarkerFromFilesystem rejects unknown outcome kinds', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const root = await mkdtemp(join(tmpdir(), 'tlfs-'))
    try {
      const sessionDir = join(root, 'learning-sessions', 'session-1')
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, 'outcome-settlement.json'),
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'session-1',
          outcomeId: 'outcome-1',
          kind: 'mastered',
          evidenceEventIds: ['e1']
        }),
        'utf8'
      )
      await expect(readSettlementMarkerFromFilesystem(root, 'session-1')).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('readSettlementMarkerFromFilesystem rejects malformed ids and mixed evidence arrays', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const root = await mkdtemp(join(tmpdir(), 'tlfs-malformed-'))
    try {
      const sessionDir = join(root, 'learning-sessions', 'session-1')
      await mkdir(sessionDir, { recursive: true })
      const writeMarker = async (body: unknown) => {
        await writeFile(join(sessionDir, 'outcome-settlement.json'), JSON.stringify(body), 'utf8')
      }

      await writeMarker({
        schemaVersion: 1,
        sessionId: 'session-1',
        outcomeId: '../escape',
        kind: 'established',
        evidenceEventIds: ['e1']
      })
      await expect(readSettlementMarkerFromFilesystem(root, 'session-1')).resolves.toBeNull()

      await writeMarker({
        schemaVersion: 1,
        sessionId: 'session-1',
        outcomeId: 'outcome-1',
        kind: 'established',
        evidenceEventIds: ['ok-id', 42, 'also-ok']
      })
      await expect(readSettlementMarkerFromFilesystem(root, 'session-1')).resolves.toBeNull()

      await writeMarker({
        schemaVersion: 1,
        sessionId: 'session-1',
        outcomeId: 'outcome-1',
        kind: 'established',
        evidenceEventIds: ['ok-id', 'bad id with spaces']
      })
      await expect(readSettlementMarkerFromFilesystem(root, 'session-1')).resolves.toBeNull()

      await writeMarker({
        schemaVersion: 1,
        sessionId: 'session-1',
        outcomeId: 'outcome-1',
        kind: 'established',
        evidenceEventIds: ['evidence-1', 'evidence-2']
      })
      await expect(readSettlementMarkerFromFilesystem(root, 'session-1')).resolves.toEqual({
        sessionId: 'session-1',
        outcomeId: 'outcome-1',
        kind: 'established',
        evidenceEventIds: ['evidence-1', 'evidence-2']
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
