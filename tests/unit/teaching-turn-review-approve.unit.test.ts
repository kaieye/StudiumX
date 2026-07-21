import { describe, expect, it } from 'vitest'

import {
  assertReviewNotAutoApplied,
  assertTeachingTurnReviewDecision,
  buildTeachingTurnReviewBundle,
  projectTeachingTurnReviewForHuman,
  sanitizeDecisionNote,
  type TeachingTurnReviewBundle,
  type TeachingTurnReviewHumanDecision
} from '../../src/shared/teaching-turn-review'

function sampleBundle(overrides?: Partial<TeachingTurnReviewBundle>): TeachingTurnReviewBundle {
  return buildTeachingTurnReviewBundle({
    turnId: 'turn-approve-1',
    generatedAt: '2026-07-21T12:00:00.000Z',
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
      }
    ],
    ...overrides
  })
}

describe('projectTeachingTurnReviewForHuman', () => {
  it('projects pending decisions when no human decision is provided', () => {
    const bundle = sampleBundle()
    assertReviewNotAutoApplied(bundle)

    const projection = projectTeachingTurnReviewForHuman(bundle)

    expect(projection.turnId).toBe('turn-approve-1')
    expect(projection.generatedAt).toBe('2026-07-21T12:00:00.000Z')
    expect(projection.candidates).toHaveLength(2)
    for (const c of projection.candidates) {
      expect(c.requiresHumanApproval).toBe(true)
      expect(c.decision).toBe('pending')
      expect(c).not.toHaveProperty('payload')
      expect(c).not.toHaveProperty('applyPlan')
      expect(c).not.toHaveProperty('autoApply')
    }
    expect(projection.approvedCandidateIds).toEqual([])
    expect(projection.rejectedCandidateIds).toEqual([])
    expect(projection.deferredCandidateIds).toEqual([])
  })

  it('partitions approve / reject / defer into id lists (non-executable)', () => {
    const bundle = sampleBundle()
    const decision: TeachingTurnReviewHumanDecision = {
      turnId: 'turn-approve-1',
      decidedAt: '2026-07-21T12:05:00.000Z',
      decisions: [
        { candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'looks good' },
        { candidateId: 'review:skill_pack_hint:v1', action: 'reject' }
      ]
    }

    const projection = projectTeachingTurnReviewForHuman(bundle, decision)

    expect(projection.approvedCandidateIds).toEqual(['review:lesson_gap:v1'])
    expect(projection.rejectedCandidateIds).toEqual(['review:skill_pack_hint:v1'])
    expect(projection.deferredCandidateIds).toEqual([])

    const approved = projection.candidates.find((c) => c.id === 'review:lesson_gap:v1')
    const rejected = projection.candidates.find((c) => c.id === 'review:skill_pack_hint:v1')
    expect(approved?.decision).toBe('approve')
    expect(approved?.note).toBe('looks good')
    expect(approved?.requiresHumanApproval).toBe(true)
    expect(rejected?.decision).toBe('reject')
    expect(rejected?.requiresHumanApproval).toBe(true)

    // approved ids are ids only — projection must not invent execute/apply fields
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toMatch(/applyPlan|autoApply|skillFileContent|writePath|profilePatch|mutations/i)
  })

  it('records defer separately and leaves undecided candidates pending', () => {
    const bundle = sampleBundle({
      candidates: [
        ...sampleBundle().candidates,
        {
          id: 'review:memory_candidate:v1',
          kind: 'memory_candidate',
          title: 'Memory candidate',
          summary: 'soft memory',
          requiresHumanApproval: true
        }
      ]
    })
    // Cap is a soft product rule on build; bundle may still carry more for projection tests.
    const decision: TeachingTurnReviewHumanDecision = {
      decisions: [
        { candidateId: 'review:lesson_gap:v1', action: 'defer', note: 'later' },
        { candidateId: 'review:skill_pack_hint:v1', action: 'approve' }
        // memory left undecided → pending
      ]
    }

    const projection = projectTeachingTurnReviewForHuman(bundle, decision)
    expect(projection.deferredCandidateIds).toEqual(['review:lesson_gap:v1'])
    expect(projection.approvedCandidateIds).toEqual(['review:skill_pack_hint:v1'])
    expect(projection.rejectedCandidateIds).toEqual([])
    expect(projection.candidates.find((c) => c.id === 'review:memory_candidate:v1')?.decision).toBe(
      'pending'
    )
  })

  it('accepts synthetic empty candidate bundles', () => {
    const empty = buildTeachingTurnReviewBundle({
      turnId: 'synth',
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: []
    })
    assertReviewNotAutoApplied(empty)

    const projection = projectTeachingTurnReviewForHuman(empty, { decisions: [] })
    expect(projection.candidates).toEqual([])
    expect(projection.approvedCandidateIds).toEqual([])
    expect(projection.rejectedCandidateIds).toEqual([])
    expect(projection.deferredCandidateIds).toEqual([])
  })

  it('still asserts source bundle is not auto-apply shaped', () => {
    const evil: TeachingTurnReviewBundle = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: [
        {
          id: 'evil',
          kind: 'other',
          title: 't',
          summary: 's',
          requiresHumanApproval: true,
          payload: { applyPlan: [{ write: '/tmp/x' }] }
        }
      ]
    }
    expect(() => projectTeachingTurnReviewForHuman(evil)).toThrow(/applyPlan|auto-apply|forbidden/i)
  })
})

describe('assertTeachingTurnReviewDecision', () => {
  it('rejects unknown candidate ids fail-closed', () => {
    const bundle = sampleBundle()
    const decision: TeachingTurnReviewHumanDecision = {
      decisions: [{ candidateId: 'review:does_not_exist:v1', action: 'approve' }]
    }
    expect(() => assertTeachingTurnReviewDecision(bundle, decision)).toThrow(/Unknown review candidate id/)
    expect(() => projectTeachingTurnReviewForHuman(bundle, decision)).toThrow(/Unknown review candidate id/)
  })

  it('rejects duplicate candidate ids', () => {
    const bundle = sampleBundle()
    const decision: TeachingTurnReviewHumanDecision = {
      decisions: [
        { candidateId: 'review:lesson_gap:v1', action: 'approve' },
        { candidateId: 'review:lesson_gap:v1', action: 'reject' }
      ]
    }
    expect(() => assertTeachingTurnReviewDecision(bundle, decision)).toThrow(/Duplicate decision/)
  })

  it('rejects forbidden / unknown actions', () => {
    const bundle = sampleBundle()
    const decision = {
      decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'auto_apply' }]
    } as unknown as TeachingTurnReviewHumanDecision
    expect(() => assertTeachingTurnReviewDecision(bundle, decision)).toThrow(
      /Forbidden or unknown decision action/
    )
  })

  it('allows empty decisions array', () => {
    const bundle = sampleBundle()
    expect(() => assertTeachingTurnReviewDecision(bundle, { decisions: [] })).not.toThrow()
  })

  it('rejects decisions against a bundle that fails assertReviewNotAutoApplied', () => {
    const bad = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: [
        {
          id: 'x',
          kind: 'other',
          title: 't',
          summary: 's',
          requiresHumanApproval: false
        }
      ]
    } as unknown as TeachingTurnReviewBundle
    expect(() =>
      assertTeachingTurnReviewDecision(bad, {
        decisions: [{ candidateId: 'x', action: 'approve' }]
      })
    ).toThrow(/requiresHumanApproval/)
  })
})

describe('sanitizeDecisionNote', () => {
  it('strips NULs / control chars and caps length', () => {
    expect(sanitizeDecisionNote('hello\u0000world\u0007!')).toBe('helloworld!')
    const long = 'a'.repeat(600)
    expect(sanitizeDecisionNote(long).length).toBe(500)
  })
})
