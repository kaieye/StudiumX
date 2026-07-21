import { describe, expect, it } from 'vitest'

import {
  buildTeachingTurnReviewBundle,
  projectTeachingTurnReviewForHuman,
  projectTeachingTurnReviewHandoff,
  projectTeachingTurnReviewHandoffFromBundle,
  type TeachingTurnReviewBundle,
  type TeachingTurnReviewHumanDecision
} from '../../src/shared/teaching-turn-review'

function sampleBundle(overrides?: Partial<TeachingTurnReviewBundle>): TeachingTurnReviewBundle {
  return buildTeachingTurnReviewBundle({
    turnId: 'turn-handoff-1',
    generatedAt: '2026-07-21T14:00:00.000Z',
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary: 'soft gap',
        requiresHumanApproval: true,
        payload: { signal: 'gap' }
      },
      {
        id: 'review:skill_pack_hint:v1',
        kind: 'skill_pack_hint',
        title: 'Skill-pack hint',
        summary: 'soft hint',
        requiresHumanApproval: true,
        payload: { signal: 'reusable' }
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
  })
}

describe('projectTeachingTurnReviewHandoff', () => {
  it('maps approved known kinds to consent-gated handoff intents (ordered)', () => {
    const bundle = sampleBundle()
    const decision: TeachingTurnReviewHumanDecision = {
      turnId: 'turn-handoff-1',
      decisions: [
        { candidateId: 'review:memory_candidate:v1', action: 'approve' },
        { candidateId: 'review:skill_pack_hint:v1', action: 'approve' },
        { candidateId: 'review:lesson_gap:v1', action: 'approve' },
        { candidateId: 'review:other:v1', action: 'reject' }
      ]
    }
    const approval = projectTeachingTurnReviewForHuman(bundle, decision)
    const handoff = projectTeachingTurnReviewHandoff(approval)

    expect(handoff.turnId).toBe('turn-handoff-1')
    // Order follows approval projection (bundle candidate order), not decision order.
    expect(handoff.approvedCandidateIds).toEqual([
      'review:lesson_gap:v1',
      'review:skill_pack_hint:v1',
      'review:memory_candidate:v1'
    ])
    expect(handoff.unmappedCandidateIds).toEqual([])
    expect(handoff.intents).toHaveLength(3)

    expect(handoff.intents[0]).toMatchObject({
      candidateId: 'review:lesson_gap:v1',
      kind: 'lesson_gap',
      target: 'lesson_followup',
      requiresConsent: true
    })
    expect(handoff.intents[1]).toMatchObject({
      candidateId: 'review:skill_pack_hint:v1',
      kind: 'skill_pack_hint',
      target: 'skill_pack_authoring',
      requiresConsent: true
    })
    expect(handoff.intents[2]).toMatchObject({
      candidateId: 'review:memory_candidate:v1',
      kind: 'memory_candidate',
      target: 'memory_consent',
      requiresConsent: true
    })

    for (const intent of handoff.intents) {
      expect(intent.requiresConsent).toBe(true)
      expect(typeof intent.reason).toBe('string')
      expect(intent.reason.length).toBeGreaterThan(0)
      expect(intent.reason.length).toBeLessThanOrEqual(200)
      expect(intent).not.toHaveProperty('applyPlan')
      expect(intent).not.toHaveProperty('autoApply')
      expect(intent).not.toHaveProperty('skillFileContent')
      expect(intent).not.toHaveProperty('profilePatch')
      expect(intent).not.toHaveProperty('writePath')
    }

    const serialized = JSON.stringify(handoff)
    expect(serialized).not.toMatch(
      /applyPlan|autoApply|skillFileContent|writePath|profilePatch|mutations|fsWrite/i
    )
  })

  it('ignores reject and defer — only approve ids produce intents', () => {
    const bundle = sampleBundle()
    const decision: TeachingTurnReviewHumanDecision = {
      decisions: [
        { candidateId: 'review:lesson_gap:v1', action: 'reject' },
        { candidateId: 'review:skill_pack_hint:v1', action: 'defer' },
        { candidateId: 'review:memory_candidate:v1', action: 'approve' }
      ]
    }
    const handoff = projectTeachingTurnReviewHandoffFromBundle(bundle, decision)

    expect(handoff.approvedCandidateIds).toEqual(['review:memory_candidate:v1'])
    expect(handoff.intents).toHaveLength(1)
    expect(handoff.intents[0]?.target).toBe('memory_consent')
    expect(handoff.unmappedCandidateIds).toEqual([])
  })

  it('puts unknown approved kinds in unmappedCandidateIds with no intent', () => {
    const bundle = sampleBundle()
    const decision: TeachingTurnReviewHumanDecision = {
      decisions: [
        { candidateId: 'review:other:v1', action: 'approve' },
        { candidateId: 'review:lesson_gap:v1', action: 'approve' }
      ]
    }
    const handoff = projectTeachingTurnReviewHandoffFromBundle(bundle, decision)

    // Bundle order: lesson_gap before other
    expect(handoff.approvedCandidateIds).toEqual([
      'review:lesson_gap:v1',
      'review:other:v1'
    ])
    expect(handoff.unmappedCandidateIds).toEqual(['review:other:v1'])
    expect(handoff.intents).toHaveLength(1)
    expect(handoff.intents[0]?.candidateId).toBe('review:lesson_gap:v1')
    expect(handoff.intents[0]?.target).toBe('lesson_followup')
  })

  it('defense in depth: approvedCandidateIds without decision===approve become unmapped', () => {
    const bundle = sampleBundle()
    const approval = projectTeachingTurnReviewForHuman(bundle, {
      decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'approve' }]
    })
    // Tamper: inject an id that is not actually approve on the candidate row.
    const tampered = {
      ...approval,
      approvedCandidateIds: [
        ...approval.approvedCandidateIds,
        'review:skill_pack_hint:v1' // still pending on candidates
      ]
    }

    const handoff = projectTeachingTurnReviewHandoff(tampered)
    expect(handoff.approvedCandidateIds).toContain('review:skill_pack_hint:v1')
    expect(handoff.unmappedCandidateIds).toContain('review:skill_pack_hint:v1')
    expect(handoff.intents.map((i) => i.candidateId)).toEqual(['review:lesson_gap:v1'])
  })

  it('returns empty intents for empty approvals', () => {
    const empty = buildTeachingTurnReviewBundle({
      turnId: 'empty',
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: []
    })
    const handoff = projectTeachingTurnReviewHandoffFromBundle(empty, { decisions: [] })
    expect(handoff.approvedCandidateIds).toEqual([])
    expect(handoff.intents).toEqual([])
    expect(handoff.unmappedCandidateIds).toEqual([])
    expect(handoff.turnId).toBe('empty')
  })

  it('requiresConsent is always true on every intent', () => {
    const bundle = sampleBundle()
    const handoff = projectTeachingTurnReviewHandoffFromBundle(bundle, {
      decisions: [
        { candidateId: 'review:memory_candidate:v1', action: 'approve' },
        { candidateId: 'review:skill_pack_hint:v1', action: 'approve' },
        { candidateId: 'review:lesson_gap:v1', action: 'approve' }
      ]
    })
    expect(handoff.intents.every((i) => i.requiresConsent === true)).toBe(true)
  })

  it('fromBundle asserts source bundle is not auto-apply shaped', () => {
    const evil: TeachingTurnReviewBundle = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: [
        {
          id: 'evil',
          kind: 'lesson_gap',
          title: 't',
          summary: 's',
          requiresHumanApproval: true,
          payload: { applyPlan: [{ write: '/tmp/x' }] }
        }
      ]
    }
    expect(() =>
      projectTeachingTurnReviewHandoffFromBundle(evil, {
        decisions: [{ candidateId: 'evil', action: 'approve' }]
      })
    ).toThrow(/applyPlan|auto-apply|forbidden/i)
  })

  it('de-dupes approvedCandidateIds while preserving first-seen order', () => {
    const bundle = sampleBundle()
    const approval = projectTeachingTurnReviewForHuman(bundle, {
      decisions: [
        { candidateId: 'review:memory_candidate:v1', action: 'approve' },
        { candidateId: 'review:lesson_gap:v1', action: 'approve' }
      ]
    })
    const tampered = {
      ...approval,
      approvedCandidateIds: [
        'review:lesson_gap:v1',
        'review:memory_candidate:v1',
        'review:lesson_gap:v1'
      ]
    }
    const handoff = projectTeachingTurnReviewHandoff(tampered)
    expect(handoff.approvedCandidateIds).toEqual([
      'review:lesson_gap:v1',
      'review:memory_candidate:v1'
    ])
    expect(handoff.intents.map((i) => i.candidateId)).toEqual([
      'review:lesson_gap:v1',
      'review:memory_candidate:v1'
    ])
  })
})
