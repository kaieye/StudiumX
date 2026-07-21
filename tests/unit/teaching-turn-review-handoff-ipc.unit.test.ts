import { describe, expect, it } from 'vitest'

import {
  parseProjectTeachingTurnReviewHandoffPayload
} from '../../src/main/teaching-ipc-commands'
import {
  runProjectTeachingTurnReviewHandoffIpc
} from '../../src/main/teaching-turn-review-ipc'
import type { TeachingTurnReviewApprovalProjection } from '../../src/shared/teaching-turn-review-approve'
import type { TeachingTurnReviewBundle } from '../../src/shared/teaching-turn-review'
import type { ProjectTeachingTurnReviewHandoffPayload } from '../../src/shared/teaching-types/teaching-turn-review-ipc'

const GENERATED_AT = '2026-07-21T12:00:00.000Z'

function sampleBundle(overrides?: Record<string, unknown>): TeachingTurnReviewBundle {
  return {
    turnId: 'turn-handoff-ipc-1',
    generatedAt: GENERATED_AT,
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary: 'soft gap',
        requiresHumanApproval: true
      },
      {
        id: 'review:skill_pack_hint:v1',
        kind: 'skill_pack_hint',
        title: 'Skill-pack hint',
        summary: 'soft hint',
        requiresHumanApproval: true
      },
      {
        id: 'review:memory_candidate:v1',
        kind: 'memory_candidate',
        title: 'Memory candidate',
        summary: 'soft memory',
        requiresHumanApproval: true
      },
      {
        id: 'review:other:v1',
        kind: 'other',
        title: 'Other',
        summary: 'unknown path',
        requiresHumanApproval: true
      }
    ],
    ...overrides
  } as TeachingTurnReviewBundle
}

function sampleApprovalProjection(
  overrides?: Partial<TeachingTurnReviewApprovalProjection>
): TeachingTurnReviewApprovalProjection {
  return {
    turnId: 'turn-handoff-ipc-1',
    generatedAt: GENERATED_AT,
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary: 'soft gap',
        requiresHumanApproval: true,
        decision: 'approve'
      },
      {
        id: 'review:skill_pack_hint:v1',
        kind: 'skill_pack_hint',
        title: 'Skill-pack hint',
        summary: 'soft hint',
        requiresHumanApproval: true,
        decision: 'approve'
      },
      {
        id: 'review:memory_candidate:v1',
        kind: 'memory_candidate',
        title: 'Memory candidate',
        summary: 'soft memory',
        requiresHumanApproval: true,
        decision: 'approve'
      },
      {
        id: 'review:other:v1',
        kind: 'other',
        title: 'Other',
        summary: 'unknown path',
        requiresHumanApproval: true,
        decision: 'approve'
      }
    ],
    approvedCandidateIds: [
      'review:lesson_gap:v1',
      'review:skill_pack_hint:v1',
      'review:memory_candidate:v1',
      'review:other:v1'
    ],
    rejectedCandidateIds: [],
    deferredCandidateIds: [],
    ...overrides
  }
}

describe('parseProjectTeachingTurnReviewHandoffPayload', () => {
  it('accepts projection shape', () => {
    const parsed = parseProjectTeachingTurnReviewHandoffPayload({
      projection: sampleApprovalProjection()
    })
    expect('projection' in parsed).toBe(true)
    if (!('projection' in parsed)) return
    expect(parsed.projection.approvedCandidateIds).toHaveLength(4)
    expect(parsed.projection.candidates).toHaveLength(4)
  })

  it('accepts bundle + decision shape', () => {
    const parsed = parseProjectTeachingTurnReviewHandoffPayload({
      bundle: sampleBundle(),
      decision: {
        decisions: [
          { candidateId: 'review:lesson_gap:v1', action: 'approve' },
          { candidateId: 'review:skill_pack_hint:v1', action: 'reject' }
        ]
      }
    })
    expect('bundle' in parsed).toBe(true)
    if (!('bundle' in parsed)) return
    expect(parsed.bundle.candidates).toHaveLength(4)
    expect(parsed.decision.decisions).toHaveLength(2)
  })

  it('rejects mixed projection + bundle', () => {
    expect(() =>
      parseProjectTeachingTurnReviewHandoffPayload({
        projection: sampleApprovalProjection(),
        bundle: sampleBundle()
      })
    ).toThrow(/must not mix/)
  })

  it('rejects empty payload', () => {
    expect(() => parseProjectTeachingTurnReviewHandoffPayload({})).toThrow(
      /requires either "projection" or "bundle"/
    )
  })

  it('rejects unknown keys fail-closed', () => {
    expect(() =>
      parseProjectTeachingTurnReviewHandoffPayload({
        projection: sampleApprovalProjection(),
        autoApply: true
      })
    ).toThrow(/only "projection"/)
  })

  it('rejects bundle without decision', () => {
    expect(() =>
      parseProjectTeachingTurnReviewHandoffPayload({
        bundle: sampleBundle()
      })
    ).toThrow(/requires "decision"/)
  })

  it('rejects projection without candidates / approvedCandidateIds', () => {
    expect(() =>
      parseProjectTeachingTurnReviewHandoffPayload({
        projection: { approvedCandidateIds: [] }
      })
    ).toThrow(/requires "candidates"/)
    expect(() =>
      parseProjectTeachingTurnReviewHandoffPayload({
        projection: { candidates: [] }
      })
    ).toThrow(/requires "approvedCandidateIds"/)
  })
})

describe('runProjectTeachingTurnReviewHandoffIpc', () => {
  it('known kinds approve → intents with correct targets + requiresConsent true', () => {
    const payload: ProjectTeachingTurnReviewHandoffPayload = {
      projection: sampleApprovalProjection({
        approvedCandidateIds: [
          'review:lesson_gap:v1',
          'review:skill_pack_hint:v1',
          'review:memory_candidate:v1'
        ],
        candidates: [
          {
            id: 'review:lesson_gap:v1',
            kind: 'lesson_gap',
            title: 'Possible lesson gap',
            summary: 'soft gap',
            requiresHumanApproval: true,
            decision: 'approve'
          },
          {
            id: 'review:skill_pack_hint:v1',
            kind: 'skill_pack_hint',
            title: 'Skill-pack hint',
            summary: 'soft hint',
            requiresHumanApproval: true,
            decision: 'approve'
          },
          {
            id: 'review:memory_candidate:v1',
            kind: 'memory_candidate',
            title: 'Memory candidate',
            summary: 'soft memory',
            requiresHumanApproval: true,
            decision: 'approve'
          }
        ]
      })
    }
    const result = runProjectTeachingTurnReviewHandoffIpc(payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.handoff.intents).toHaveLength(3)
    expect(result.handoff.intents[0]).toMatchObject({
      candidateId: 'review:lesson_gap:v1',
      kind: 'lesson_gap',
      target: 'lesson_followup',
      requiresConsent: true
    })
    expect(result.handoff.intents[1]).toMatchObject({
      candidateId: 'review:skill_pack_hint:v1',
      target: 'skill_pack_authoring',
      requiresConsent: true
    })
    expect(result.handoff.intents[2]).toMatchObject({
      candidateId: 'review:memory_candidate:v1',
      target: 'memory_consent',
      requiresConsent: true
    })
    expect(result.handoff.unmappedCandidateIds).toEqual([])
  })

  it('reject/defer only → empty intents', () => {
    const result = runProjectTeachingTurnReviewHandoffIpc({
      bundle: sampleBundle(),
      decision: {
        decisions: [
          { candidateId: 'review:lesson_gap:v1', action: 'reject' },
          { candidateId: 'review:skill_pack_hint:v1', action: 'defer' },
          { candidateId: 'review:memory_candidate:v1', action: 'reject' },
          { candidateId: 'review:other:v1', action: 'defer' }
        ]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.handoff.approvedCandidateIds).toEqual([])
    expect(result.handoff.intents).toEqual([])
    expect(result.handoff.unmappedCandidateIds).toEqual([])
  })

  it('unknown kind → unmapped, no intent', () => {
    const result = runProjectTeachingTurnReviewHandoffIpc({
      projection: sampleApprovalProjection({
        approvedCandidateIds: ['review:other:v1'],
        candidates: [
          {
            id: 'review:other:v1',
            kind: 'other',
            title: 'Other',
            summary: 'unknown path',
            requiresHumanApproval: true,
            decision: 'approve'
          }
        ]
      })
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.handoff.intents).toEqual([])
    expect(result.handoff.unmappedCandidateIds).toEqual(['review:other:v1'])
  })

  it('serialization has no auto-apply / skillFileContent / profilePatch fields', () => {
    const result = runProjectTeachingTurnReviewHandoffIpc({
      bundle: sampleBundle(),
      decision: {
        decisions: [
          { candidateId: 'review:lesson_gap:v1', action: 'approve' },
          { candidateId: 'review:skill_pack_hint:v1', action: 'approve' },
          { candidateId: 'review:memory_candidate:v1', action: 'approve' }
        ]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(
      /applyPlan|autoApply|skillFileContent|writePath|profilePatch|mutations|installSkill|createMemory|fsWrite/i
    )
    expect(result.handoff).not.toHaveProperty('applyPlan')
    expect(result.handoff).not.toHaveProperty('autoApply')
    for (const intent of result.handoff.intents) {
      expect(intent.requiresConsent).toBe(true)
      expect(intent).not.toHaveProperty('skillFileContent')
      expect(intent).not.toHaveProperty('profilePatch')
    }
  })

  it('mapper error path returns { ok: false, reason }', () => {
    const result = runProjectTeachingTurnReviewHandoffIpc({
      projection: null as unknown as TeachingTurnReviewApprovalProjection
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('bundle + decision path maps approved known kinds', () => {
    const result = runProjectTeachingTurnReviewHandoffIpc({
      bundle: sampleBundle(),
      decision: {
        turnId: 'turn-handoff-ipc-1',
        decisions: [
          { candidateId: 'review:memory_candidate:v1', action: 'approve' },
          { candidateId: 'review:other:v1', action: 'approve' },
          { candidateId: 'review:lesson_gap:v1', action: 'reject' }
        ]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.handoff.intents).toHaveLength(1)
    expect(result.handoff.intents[0]).toMatchObject({
      candidateId: 'review:memory_candidate:v1',
      target: 'memory_consent',
      requiresConsent: true
    })
    expect(result.handoff.unmappedCandidateIds).toEqual(['review:other:v1'])
  })
})
