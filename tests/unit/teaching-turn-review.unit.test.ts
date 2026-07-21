import { describe, expect, it } from 'vitest'

import {
  MAX_TEACHING_TURN_REVIEW_CANDIDATES,
  assertReviewNotAutoApplied,
  buildTeachingTurnReviewBundle,
  buildTeachingTurnReviewCandidates,
  type TeachingTurnReviewBundle,
  type TeachingTurnReviewCandidate
} from '../../src/shared/teaching-turn-review'

describe('buildTeachingTurnReviewCandidates', () => {
  it('returns empty for synthetic mode always', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'synthetic',
      assistantText: 'tool failed with path_rejected; 还没讲清概念',
      userText: '请记住我是研究生，下次做成 skill pack checklist',
      toolNames: ['write_workspace_file_error']
    })
    expect(candidates).toEqual([])
  })

  it('returns empty when no soft signals in visible mode', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      assistantText: '今天我们继续学习分数加法。',
      userText: '好的',
      toolNames: ['read_workspace_file']
    })
    expect(candidates).toEqual([])
  })

  it('emits at most MAX candidates and every candidate requires human approval', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      userText: '请记住我每周只有两小时；下次都按固定流程 checklist 来教',
      assistantText: '工具调用失败：path_rejected。这节还没讲清分母通分。',
      toolNames: ['write_workspace_file', 'tool_error_probe']
    })
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(MAX_TEACHING_TURN_REVIEW_CANDIDATES)
    for (const candidate of candidates) {
      expect(candidate.requiresHumanApproval).toBe(true)
      expect(candidate.id).toMatch(/^review:/)
      expect(['memory_candidate', 'skill_pack_hint', 'lesson_gap', 'other']).toContain(candidate.kind)
    }
  })

  it('emits lesson_gap on tool-failure text without inventing skill files', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      assistantText: 'Tool call failed: request_rejected while writing the draft.',
      toolNames: ['write_workspace_file']
    })
    expect(candidates.some((c) => c.kind === 'lesson_gap')).toBe(true)
    for (const candidate of candidates) {
      assertNoAutoSkillOrProfilePayload(candidate)
    }
  })

  it('emits skill_pack_hint only as display payload, never skill file content', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      userText: '以后都按这个固定流程 checklist 来讲吧，可复用。',
      assistantText: '可以，我们先列步骤。'
    })
    const hint = candidates.find((c) => c.kind === 'skill_pack_hint')
    expect(hint).toBeDefined()
    expect(hint!.requiresHumanApproval).toBe(true)
    assertNoAutoSkillOrProfilePayload(hint!)
    expect(hint!.payload).not.toHaveProperty('skillFileContent')
    expect(hint!.payload).not.toHaveProperty('writePath')
  })

  it('does not emit memory_candidate when memory consent patterns are already in flight', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      userText: '请记住我是医学生',
      assistantText: '要记录到用户记忆吗？ <!-- studiumx:learner-profile-consent:v1:abc -->'
    })
    expect(candidates.every((c) => c.kind !== 'memory_candidate')).toBe(true)
  })

  it('may emit memory_candidate for explicit remember request without consent marker', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      userText: '请记住 我每周只有两小时可学习'
    })
    const memory = candidates.find((c) => c.kind === 'memory_candidate')
    expect(memory).toBeDefined()
    expect(memory!.requiresHumanApproval).toBe(true)
    assertNoAutoSkillOrProfilePayload(memory!)
    expect(memory!.payload).not.toHaveProperty('profilePatch')
    expect(memory!.payload).not.toHaveProperty('learnerProfilePatch')
  })
})

describe('assertReviewNotAutoApplied', () => {
  it('accepts bundles where every candidate is human-gated', () => {
    const bundle = buildTeachingTurnReviewBundle({
      turnId: 'turn-1',
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: [
        {
          id: 'review:lesson_gap:v1',
          kind: 'lesson_gap',
          title: 'gap',
          summary: 'soft',
          requiresHumanApproval: true,
          payload: { signal: 'x' }
        }
      ]
    })
    expect(() => assertReviewNotAutoApplied(bundle)).not.toThrow()
    expect(bundle.candidates[0]!.requiresHumanApproval).toBe(true)
  })

  it('rejects candidates missing requiresHumanApproval true', () => {
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
    expect(() => assertReviewNotAutoApplied(bad)).toThrow(/requiresHumanApproval/)
  })

  it('rejects forbidden auto-apply looking payload keys', () => {
    const bad: TeachingTurnReviewBundle = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      candidates: [
        {
          id: 'evil',
          kind: 'skill_pack_hint',
          title: 't',
          summary: 's',
          requiresHumanApproval: true,
          payload: { skillFileContent: '#!/bin/sh\nrm -rf /' }
        }
      ]
    }
    expect(() => assertReviewNotAutoApplied(bad)).toThrow(/skillFileContent|auto-apply|forbidden/i)
  })

  it('documents no automatic skill creation in built candidates', () => {
    const candidates = buildTeachingTurnReviewCandidates({
      mode: 'visible',
      userText: '做成 skill pack 以后都用',
      assistantText: '工具超时 failed'
    })
    const bundle = buildTeachingTurnReviewBundle({
      turnId: 't2',
      generatedAt: '2026-07-21T12:00:00.000Z',
      candidates
    })
    assertReviewNotAutoApplied(bundle)
    for (const candidate of bundle.candidates) {
      assertNoAutoSkillOrProfilePayload(candidate)
    }
  })
})

function assertNoAutoSkillOrProfilePayload(candidate: TeachingTurnReviewCandidate): void {
  const payload = candidate.payload ?? {}
  const keys = Object.keys(payload)
  expect(keys).not.toContain('autoApply')
  expect(keys).not.toContain('auto_apply')
  expect(keys).not.toContain('skillFileContent')
  expect(keys).not.toContain('skill_file_content')
  expect(keys).not.toContain('skillContent')
  expect(keys).not.toContain('profilePatch')
  expect(keys).not.toContain('profile_patch')
  expect(keys).not.toContain('learnerProfilePatch')
  expect(keys).not.toContain('writePath')
  expect(keys).not.toContain('write_path')
  expect(keys).not.toContain('applyPlan')
  expect(keys).not.toContain('mutations')
  const serialized = JSON.stringify(payload)
  expect(serialized).not.toMatch(/"path"\s*:\s*"[^"]*\.md"/i)
  expect(serialized).not.toMatch(/auto.?apply/i)
}
