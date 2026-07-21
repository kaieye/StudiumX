import { describe, expect, it } from 'vitest'

import {
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES,
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS,
  parseTeachingTurnReviewLastBundleSnapshot,
  toTeachingTurnReviewLastBundleSnapshot,
  type TeachingTurnReviewLastBundleSnapshot
} from '../../src/shared/teaching-turn-review-last-bundle'
import {
  buildTeachingTurnReviewBundle,
  type TeachingTurnReviewBundle,
  type TeachingTurnReviewHumanDecision
} from '../../src/shared/teaching-turn-review'

function sampleBundle(overrides?: Partial<TeachingTurnReviewBundle>): TeachingTurnReviewBundle {
  return buildTeachingTurnReviewBundle({
    turnId: 'turn-last-1',
    generatedAt: '2026-07-21T16:00:00.000Z',
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
        requiresHumanApproval: true
      }
    ],
    ...overrides
  })
}

describe('toTeachingTurnReviewLastBundleSnapshot', () => {
  it('builds version:1 snapshot with bundle and asserts no auto-apply', () => {
    const snapshot = toTeachingTurnReviewLastBundleSnapshot({
      bundle: sampleBundle(),
      source: 'finalize_hook',
      savedAt: '2026-07-21T16:05:00.000Z'
    })

    expect(snapshot.version).toBe(1)
    expect(snapshot.source).toBe('finalize_hook')
    expect(snapshot.savedAt).toBe('2026-07-21T16:05:00.000Z')
    expect(snapshot.bundle.turnId).toBe('turn-last-1')
    expect(snapshot.bundle.candidates).toHaveLength(2)
    expect(snapshot.bundle.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
    expect(snapshot.decision).toBeUndefined()

    const serialized = JSON.stringify(snapshot)
    expect(serialized.length).toBeLessThan(MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS)
    expect(serialized).not.toMatch(
      /autoApply|applyPlan|skillFileContent|profilePatch|writePath|mutations|fsWrite/i
    )
  })

  it('includes optional decision metadata (ids only, not apply plan)', () => {
    const decision: TeachingTurnReviewHumanDecision = {
      turnId: 'turn-last-1',
      decidedAt: '2026-07-21T16:06:00.000Z',
      decisions: [
        { candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'ok' },
        { candidateId: 'review:skill_pack_hint:v1', action: 'defer' }
      ]
    }
    const snapshot = toTeachingTurnReviewLastBundleSnapshot({
      bundle: sampleBundle(),
      decision,
      source: 'settings_demo',
      savedAt: '2026-07-21T16:06:00.000Z'
    })

    expect(snapshot.decision?.decisions).toEqual([
      { candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'ok' },
      { candidateId: 'review:skill_pack_hint:v1', action: 'defer' }
    ])
    expect(snapshot).not.toHaveProperty('applyPlan')
    expect(snapshot).not.toHaveProperty('autoApply')
  })

  it('defaults source to unknown and stamps savedAt when omitted', () => {
    const before = Date.now()
    const snapshot = toTeachingTurnReviewLastBundleSnapshot({ bundle: sampleBundle() })
    const after = Date.now()
    expect(snapshot.source).toBe('unknown')
    expect(snapshot.version).toBe(1)
    const savedMs = Date.parse(snapshot.savedAt)
    expect(Number.isFinite(savedMs)).toBe(true)
    expect(savedMs).toBeGreaterThanOrEqual(before - 1000)
    expect(savedMs).toBeLessThanOrEqual(after + 1000)
  })

  it('rejects bundle candidates missing requiresHumanApproval true', () => {
    const evil = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: [
        {
          id: 'evil',
          kind: 'lesson_gap' as const,
          title: 't',
          summary: 's',
          requiresHumanApproval: false as unknown as true
        }
      ]
    } as TeachingTurnReviewBundle

    expect(() => toTeachingTurnReviewLastBundleSnapshot({ bundle: evil })).toThrow(
      /requiresHumanApproval|auto apply/i
    )
  })

  it('rejects auto-apply shaped payload keys on source bundle', () => {
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
    expect(() => toTeachingTurnReviewLastBundleSnapshot({ bundle: evil })).toThrow(
      /applyPlan|auto-apply|forbidden/i
    )
  })

  it('rejects illegal decision action strings', () => {
    const decision = {
      decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'auto_apply' }]
    } as unknown as TeachingTurnReviewHumanDecision

    expect(() =>
      toTeachingTurnReviewLastBundleSnapshot({
        bundle: sampleBundle(),
        decision
      })
    ).toThrow(/approve\|reject\|defer|action/i)
  })
})

describe('parseTeachingTurnReviewLastBundleSnapshot', () => {
  it('round-trips a valid plain object', () => {
    const original = toTeachingTurnReviewLastBundleSnapshot({
      bundle: sampleBundle(),
      source: 'manual',
      savedAt: '2026-07-21T17:00:00.000Z',
      decision: {
        decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'reject' }]
      }
    })
    const parsed = parseTeachingTurnReviewLastBundleSnapshot(
      JSON.parse(JSON.stringify(original)) as unknown
    )
    expect(parsed).toEqual(original)
  })

  it('rejects wrong version', () => {
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 2,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: sampleBundle()
      })
    ).toThrow(/version must be 1/)
  })

  it('rejects unknown source', () => {
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'remote_sync',
        bundle: sampleBundle()
      })
    ).toThrow(/source must be/)
  })

  it('rejects top-level autoApply / applyPlan keys', () => {
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: sampleBundle(),
        autoApply: true
      })
    ).toThrow(/autoApply|forbidden|unknown key/i)

    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: sampleBundle(),
        applyPlan: []
      })
    ).toThrow(/applyPlan|forbidden|unknown key/i)
  })

  it('rejects skillFileContent / profilePatch on raw snapshot', () => {
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: sampleBundle(),
        skillFileContent: '---\nname: evil'
      })
    ).toThrow(/skillFileContent|forbidden|unknown key/i)

    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: sampleBundle(),
        profilePatch: { remember: true }
      })
    ).toThrow(/profilePatch|forbidden|unknown key/i)
  })

  it('rejects candidate requiresHumanApproval !== true', () => {
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: {
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
        }
      })
    ).toThrow(/requiresHumanApproval must be true/)
  })

  it('rejects too many candidates (IPC-aligned soft cap)', () => {
    const candidates = Array.from({ length: MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES + 1 }, (_, i) => ({
      id: `review:other:${i}`,
      kind: 'other' as const,
      title: 't',
      summary: 's',
      requiresHumanApproval: true as const
    }))
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: {
          generatedAt: '2026-07-21T00:00:00.000Z',
          candidates
        }
      })
    ).toThrow(new RegExp(`at most ${MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES}`))
  })

  it('rejects non-object / missing bundle', () => {
    expect(() => parseTeachingTurnReviewLastBundleSnapshot(null)).toThrow(/plain object/)
    expect(() => parseTeachingTurnReviewLastBundleSnapshot([])).toThrow(/plain object/)
    expect(() =>
      parseTeachingTurnReviewLastBundleSnapshot({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual'
      })
    ).toThrow(/requires "bundle"/)
  })

  it('sanitizes decision notes on parse', () => {
    const snapshot = parseTeachingTurnReviewLastBundleSnapshot({
      version: 1,
      savedAt: '2026-07-21T00:00:00.000Z',
      source: 'manual',
      bundle: sampleBundle(),
      decision: {
        decisions: [
          {
            candidateId: 'review:lesson_gap:v1',
            action: 'approve',
            note: 'hello\u0000world\u0007'
          }
        ]
      }
    })
    expect(snapshot.decision?.decisions[0]?.note).toBe('helloworld')
  })

  it('type surface: snapshot is not an apply plan', () => {
    const snapshot: TeachingTurnReviewLastBundleSnapshot = toTeachingTurnReviewLastBundleSnapshot({
      bundle: sampleBundle(),
      source: 'unknown'
    })
    // Compile-time shape check via runtime absence.
    expect('autoApply' in snapshot).toBe(false)
    expect('applyPlan' in snapshot).toBe(false)
    expect('skillFileContent' in snapshot).toBe(false)
    expect('profilePatch' in snapshot).toBe(false)
  })
})
