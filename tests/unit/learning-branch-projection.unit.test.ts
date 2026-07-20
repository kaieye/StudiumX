import { describe, expect, it } from 'vitest'
import {
  createLearningBranchProjector,
  fingerprintLearningBranchProjection,
  projectLearningBranch
} from '../../src/main/learning-branch-projection'
import type { LearningBranchProjectionFacts } from '../../src/shared/teaching-types/learning-branch-projection'

const NOW = '2026-07-20T12:00:00.000Z'

function facts(): LearningBranchProjectionFacts {
  return {
    mission: { id: 'mission-foundations', nextGoal: 'available' },
    course: { id: 'course-foundations' },
    latestSession: { id: 'session-1', source: 'canonical', readOnly: false },
    durableOutcome: {
      status: 'trusted',
      id: 'outcome-1',
      kind: 'established',
      evidenceEventIds: ['event-1']
    },
    evidence: { status: 'verified' },
    resources: { readiness: 'ready', availableCount: 2, provenanceIds: ['resource-1'] }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as object)) deepFreeze(nested)
  }
  return value
}

describe('LearningBranchProjection', () => {
  it('builds a linear primary path that mirrors the planner for current facts', () => {
    const projection = projectLearningBranch(facts(), { now: () => NOW })

    expect(projection.schemaVersion).toBe(1)
    expect(projection.generatedAt).toBe(NOW)
    expect(projection.primaryPath).toEqual([
      'session:session-1',
      'primary:continue_next_session:established_with_next_goal'
    ])

    const primaryStep = projection.nodes.find(
      (node) => node.id === 'primary:continue_next_session:established_with_next_goal'
    )
    expect(primaryStep).toMatchObject({
      kind: 'primary',
      action: 'continue_next_session',
      reason: 'established_with_next_goal',
      parentNodeId: 'session:session-1',
      sessionId: 'session-1',
      canonical: true
    })

    // Every primary path node is present and marked canonical.
    for (const id of projection.primaryPath) {
      const node = projection.nodes.find((entry) => entry.id === id)
      expect(node?.canonical).toBe(true)
    }
  })

  it('projects an alternate retry branch without mutating canonical outcome facts', () => {
    const projection = projectLearningBranch(facts())

    const retryAlt = projection.nodes.find((node) => node.reason === 'alternate_needs_practice')
    expect(retryAlt).toMatchObject({
      kind: 'retry',
      action: 'contrast_and_retry',
      reason: 'alternate_needs_practice',
      parentNodeId: 'session:session-1',
      sessionId: 'session-1',
      canonical: false
    })

    expect(projection.alternatePaths.some((path) => path.includes(retryAlt!.id))).toBe(true)
    expect(projection.primaryPath).not.toContain(retryAlt!.id)

    // Primary remains continue_next_session for established+verified facts.
    expect(projection.primaryPath.at(-1)).toBe(
      'primary:continue_next_session:established_with_next_goal'
    )
  })

  it('keeps needs_practice primary as retry and still projects other alternates', () => {
    const input = facts()
    input.durableOutcome = {
      status: 'trusted',
      id: 'outcome-practice',
      kind: 'needs_practice',
      evidenceEventIds: ['event-p']
    }

    const projection = projectLearningBranch(input)
    expect(projection.primaryPath.at(-1)).toBe('primary:contrast_and_retry:needs_practice')

    // Alternate retry is omitted when primary already is needs_practice retry.
    expect(projection.nodes.some((node) => node.reason === 'alternate_needs_practice')).toBe(false)
    expect(projection.nodes.some((node) => node.reason === 'alternate_not_evidenced')).toBe(true)
    expect(projection.nodes.some((node) => node.reason === 'alternate_resources_not_ready')).toBe(true)
  })

  it('projects legacy read-only sessions as clarification-only without remediation alternates', () => {
    const input = facts()
    input.latestSession = { id: 'legacy-session', source: 'legacy_lesson', readOnly: true }

    const projection = projectLearningBranch(input)

    expect(projection.primaryPath).toEqual([
      'session:legacy-session',
      'primary:request_goal_clarification:legacy_read_only'
    ])
    expect(projection.alternatePaths).toEqual([])
    expect(projection.nodes.every((node) => node.kind !== 'retry')).toBe(true)
    expect(projection.nodes.every((node) => node.kind !== 'resource_wait')).toBe(true)

    const primary = projection.nodes.find((node) => node.id === projection.primaryPath[1])
    expect(primary).toMatchObject({
      kind: 'clarification',
      action: 'request_goal_clarification',
      reason: 'legacy_read_only',
      canonical: true
    })
  })

  it('includes optional historical session summaries as non-canonical nodes', () => {
    const input = facts()
    input.historySessions = [
      { id: 'session-b', status: 'completed', outcomeKind: 'needs_practice' },
      { id: 'session-a', status: 'completed', outcomeKind: 'established' },
      { id: 'session-b', status: 'active', outcomeKind: null }
    ]

    const projection = projectLearningBranch(input)
    const historical = projection.nodes.filter((node) => node.kind === 'historical')

    expect(historical.map((node) => node.sessionId)).toEqual(['session-a', 'session-b'])
    expect(historical.every((node) => node.canonical === false)).toBe(true)
    expect(historical.every((node) => node.action === null)).toBe(true)
    expect(historical.every((node) => node.reason === 'historical_session')).toBe(true)
  })

  it('keeps fingerprint stable for identical facts and independent of generatedAt', () => {
    const first = projectLearningBranch(facts(), { now: () => '2026-01-01T00:00:00.000Z' })
    const second = projectLearningBranch(facts(), { now: () => '2026-12-31T23:59:59.000Z' })
    const third = createLearningBranchProjector().project(facts())

    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.fingerprint).toBe(third.fingerprint)
    expect(first.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)

    const body = {
      schemaVersion: first.schemaVersion,
      nodes: first.nodes,
      primaryPath: first.primaryPath,
      alternatePaths: first.alternatePaths
    }
    expect(fingerprintLearningBranchProjection(body)).toBe(first.fingerprint)
  })

  it('does not mutate deeply frozen facts', () => {
    const input = deepFreeze(facts())
    const before = structuredClone(input)

    expect(() => projectLearningBranch(input)).not.toThrow()
    expect(input).toEqual(before)
    expect(Object.isFrozen(input.durableOutcome)).toBe(true)
    expect(Object.isFrozen(input.resources.provenanceIds)).toBe(true)
  })

  it('never projects raw learner, assessment, or provider payloads', () => {
    const input = Object.assign(facts(), {
      learnerAnswer: 'private answer that must never escape',
      rawEvidenceText: 'private evidence that must never escape',
      assessmentPayload: { selectedOptionIds: ['secret-choice'] },
      providerResponse: { completion: 'private provider data' }
    }) as LearningBranchProjectionFacts

    const json = JSON.stringify(projectLearningBranch(input))

    expect(json).not.toContain('learnerAnswer')
    expect(json).not.toContain('private answer that must never escape')
    expect(json).not.toContain('rawEvidenceText')
    expect(json).not.toContain('private evidence that must never escape')
    expect(json).not.toContain('assessmentPayload')
    expect(json).not.toContain('secret-choice')
    expect(json).not.toContain('providerResponse')
    expect(json).not.toContain('private provider data')
  })

  it('marks all alternate path nodes as non-canonical', () => {
    const projection = projectLearningBranch(facts())
    for (const path of projection.alternatePaths) {
      for (const id of path) {
        const node = projection.nodes.find((entry) => entry.id === id)
        // Session anchor is shared and canonical; leaf alternate must not be.
        if (id.startsWith('alt:')) {
          expect(node?.canonical).toBe(false)
        }
      }
    }
  })
})
