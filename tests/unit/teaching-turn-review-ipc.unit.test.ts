import { describe, expect, it } from 'vitest'

import {
  parseDecideTeachingTurnReviewPayload,
  parseProjectTeachingTurnReviewPayload
} from '../../src/main/teaching-ipc-commands'
import {
  runDecideTeachingTurnReviewIpc,
  runProjectTeachingTurnReviewIpc
} from '../../src/main/teaching-turn-review-ipc'
import type {
  DecideTeachingTurnReviewPayload,
  ProjectTeachingTurnReviewPayload
} from '../../src/shared/teaching-types/teaching-turn-review-ipc'

const GENERATED_AT = '2026-07-21T12:00:00.000Z'

function sampleBundle(overrides?: Record<string, unknown>) {
  return {
    turnId: 'turn-ipc-1',
    generatedAt: GENERATED_AT,
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary: 'soft gap',
        requiresHumanApproval: true,
        payload: { signal: 'gap', diagnosticOnly: true }
      },
      {
        id: 'review:skill_pack_hint:v1',
        kind: 'skill_pack_hint',
        title: 'Skill-pack hint',
        summary: 'soft hint',
        requiresHumanApproval: true
      }
    ],
    ...overrides
  }
}

describe('parseProjectTeachingTurnReviewPayload', () => {
  it('accepts bundle without decision', () => {
    const parsed = parseProjectTeachingTurnReviewPayload({ bundle: sampleBundle() })
    expect(parsed.bundle.turnId).toBe('turn-ipc-1')
    expect(parsed.bundle.candidates).toHaveLength(2)
    expect(parsed.decision).toBeUndefined()
  })

  it('accepts optional decision', () => {
    const parsed = parseProjectTeachingTurnReviewPayload({
      bundle: sampleBundle(),
      decision: {
        decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'defer' }]
      }
    })
    expect(parsed.decision?.decisions[0]?.action).toBe('defer')
  })

  it('rejects unknown payload keys fail-closed', () => {
    expect(() =>
      parseProjectTeachingTurnReviewPayload({
        bundle: sampleBundle(),
        autoApply: true
      })
    ).toThrow(/only "bundle"/)
  })

  it('rejects candidate without requiresHumanApproval true', () => {
    expect(() =>
      parseProjectTeachingTurnReviewPayload({
        bundle: sampleBundle({
          candidates: [
            {
              id: 'x',
              kind: 'other',
              title: 't',
              summary: 's',
              requiresHumanApproval: false
            }
          ]
        })
      })
    ).toThrow(/requiresHumanApproval must be true/)
  })

  it('rejects unknown candidate object keys', () => {
    expect(() =>
      parseProjectTeachingTurnReviewPayload({
        bundle: sampleBundle({
          candidates: [
            {
              id: 'x',
              kind: 'other',
              title: 't',
              summary: 's',
              requiresHumanApproval: true,
              applyPlan: []
            }
          ]
        })
      })
    ).toThrow(/TeachingTurnReviewCandidate\[0\]/)
  })
})

describe('parseDecideTeachingTurnReviewPayload', () => {
  it('requires decision', () => {
    expect(() => parseDecideTeachingTurnReviewPayload({ bundle: sampleBundle() })).toThrow(
      /requires "decision"/
    )
  })

  it('accepts exact decide payload', () => {
    const parsed = parseDecideTeachingTurnReviewPayload({
      bundle: sampleBundle(),
      decision: {
        turnId: 'turn-ipc-1',
        decidedAt: '2026-07-21T12:05:00.000Z',
        decisions: [
          { candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'ok' },
          { candidateId: 'review:skill_pack_hint:v1', action: 'reject' }
        ]
      }
    })
    expect(parsed.decision.decisions).toHaveLength(2)
    expect(parsed.decision.decisions[0]?.note).toBe('ok')
  })

  it('rejects forbidden action string at parser boundary', () => {
    expect(() =>
      parseDecideTeachingTurnReviewPayload({
        bundle: sampleBundle(),
        decision: {
          decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'auto_apply' }]
        }
      })
    ).toThrow(/approve\|reject\|defer/)
  })

  it('rejects oversized note at parser boundary', () => {
    expect(() =>
      parseDecideTeachingTurnReviewPayload({
        bundle: sampleBundle(),
        decision: {
          decisions: [
            {
              candidateId: 'review:lesson_gap:v1',
              action: 'approve',
              note: 'n'.repeat(501)
            }
          ]
        }
      })
    ).toThrow(/at most 500/)
  })
})

describe('runProjectTeachingTurnReviewIpc / runDecideTeachingTurnReviewIpc', () => {
  it('projects without decision → pending decisions, empty approved list', () => {
    const payload: ProjectTeachingTurnReviewPayload = {
      bundle: sampleBundle() as ProjectTeachingTurnReviewPayload['bundle']
    }
    const result = runProjectTeachingTurnReviewIpc(payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection.candidates.every((c) => c.decision === 'pending')).toBe(true)
    expect(result.projection.approvedCandidateIds).toEqual([])
    expect(result.projection.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
    for (const c of result.projection.candidates) {
      expect(c).not.toHaveProperty('payload')
      expect(c).not.toHaveProperty('applyPlan')
      expect(c).not.toHaveProperty('skillFileContent')
    }
  })

  it('decide approve known id → approvedCandidateIds contains id; requiresHumanApproval true', () => {
    const payload: DecideTeachingTurnReviewPayload = {
      bundle: sampleBundle() as DecideTeachingTurnReviewPayload['bundle'],
      decision: {
        decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'ship later via consent' }]
      }
    }
    const result = runDecideTeachingTurnReviewIpc(payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection.approvedCandidateIds).toEqual(['review:lesson_gap:v1'])
    const approved = result.projection.candidates.find((c) => c.id === 'review:lesson_gap:v1')
    expect(approved?.decision).toBe('approve')
    expect(approved?.requiresHumanApproval).toBe(true)
    expect(approved?.note).toBe('ship later via consent')
  })

  it('unknown candidate id → ok false', () => {
    const result = runDecideTeachingTurnReviewIpc({
      bundle: sampleBundle() as DecideTeachingTurnReviewPayload['bundle'],
      decision: {
        decisions: [{ candidateId: 'review:does_not_exist:v1', action: 'approve' }]
      }
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/Unknown review candidate id/)
  })

  it('forbidden action string → ok false (when bypassing parser)', () => {
    const result = runDecideTeachingTurnReviewIpc({
      bundle: sampleBundle() as DecideTeachingTurnReviewPayload['bundle'],
      decision: {
        decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'auto_apply' as 'approve' }]
      }
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/Forbidden or unknown decision action/)
  })

  it('projection never contains applyPlan / skillFileContent / autoApply', () => {
    const result = runDecideTeachingTurnReviewIpc({
      bundle: sampleBundle() as DecideTeachingTurnReviewPayload['bundle'],
      decision: {
        decisions: [
          { candidateId: 'review:lesson_gap:v1', action: 'approve' },
          { candidateId: 'review:skill_pack_hint:v1', action: 'reject' }
        ]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const serialized = JSON.stringify(result.projection)
    expect(serialized).not.toMatch(
      /applyPlan|autoApply|skillFileContent|writePath|profilePatch|mutations|installSkill|createMemory/i
    )
    // Approved ids are ids only — not an apply plan field name.
    expect(result.projection.approvedCandidateIds).toEqual(['review:lesson_gap:v1'])
    expect(result.projection).not.toHaveProperty('applyPlan')
    expect(result.projection).not.toHaveProperty('autoApply')
  })

  it('auto-apply shaped source payload → ok false via pure assert', () => {
    const result = runProjectTeachingTurnReviewIpc({
      bundle: {
        generatedAt: GENERATED_AT,
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
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/applyPlan|auto-apply|forbidden/i)
  })
})
