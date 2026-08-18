import { describe, expect, it } from 'vitest'
import {
  getBuiltinSkillOrchestrationPolicy,
  getSkillOrchestrationEligibility,
  listBuiltinSkillOrchestrationPolicies,
  SKILL_ORCHESTRATION_POLICY_VERSION
} from '../../src/main/builtin-skill-orchestration-policy'
import { plan, createSkillOrchestrationPlanner } from '../../src/main/skill-orchestration-planner'
import { BUILTIN_SKILL_IDS } from '../../src/main/skill-library'
import type { SkillOrchestrationInput } from '../../src/shared/teaching-types/skill-orchestration'

function baseInput(overrides: Partial<SkillOrchestrationInput> = {}): SkillOrchestrationInput {
  return {
    selectedSkillIds: [],
    contextIdentity: 'ctx:test-session-1',
    objective: 'test objective',
    ...overrides
  }
}

function readyAll(ids: string[]) {
  return ids.map((skillId) => ({
    skillId,
    installed: true,
    trustedBuiltin: true,
    ready: true
  }))
}

describe('builtin skill orchestration policy (host authority)', () => {
  it('registers every BUILTIN_SKILL_IDS entry exactly once', () => {
    const policies = listBuiltinSkillOrchestrationPolicies()
    expect(policies).toHaveLength(BUILTIN_SKILL_IDS.length)
    for (const id of BUILTIN_SKILL_IDS) {
      expect(getBuiltinSkillOrchestrationPolicy(id)).not.toBeNull()
    }
  })

  it('marks quiz/assessment authoring as non-learner-outcome teachingImpact', () => {
    const assessor = getBuiltinSkillOrchestrationPolicy('learning-assessor')
    expect(assessor?.teachingImpact).toBe('teaching_strategy')
    expect(assessor?.teachingImpact).not.toBe('kernel_principles')

    const contentAudit = getBuiltinSkillOrchestrationPolicy('web-content-audit')
    expect(contentAudit?.teachingImpact).toBe('verifier_only')

    const content = getBuiltinSkillOrchestrationPolicy('course-content-authoring')
    expect(content?.teachingImpact).toBe('artifact_only')
  })

  it('exports a stable policy version for planId', () => {
    expect(SKILL_ORCHESTRATION_POLICY_VERSION).toMatch(/^builtin-orch-v/)
  })

  it('projects formal admission from host policy and fails closed for personal entries', () => {
    expect(getSkillOrchestrationEligibility({ id: 'teach', source: 'builtin' })).toMatchObject({
      trustLevel: 'host_governed',
      selectionSurface: 'hidden',
      slot: 'kernel',
      formalTeachingEligible: false
    })
    expect(getSkillOrchestrationEligibility({ id: 'learning-assessor', source: 'builtin' })).toMatchObject({
      trustLevel: 'host_governed',
      selectionSurface: 'default',
      slot: 'primary_teaching_strategy',
      formalTeachingEligible: true
    })
    expect(getSkillOrchestrationEligibility({ id: 'personal-study-style', source: 'personal' })).toMatchObject({
      trustLevel: 'advisory_only',
      selectionSurface: 'advanced',
      formalTeachingEligible: false
    })
  })
})

describe('SkillOrchestrationPlanner.plan', () => {
  it('is pure and available via createSkillOrchestrationPlanner', () => {
    const planner = createSkillOrchestrationPlanner()
    const a = planner.plan(baseInput({ selectedSkillIds: ['learning-assessor'], mode: 'teaching_turn' }))
    const b = plan(baseInput({ selectedSkillIds: ['learning-assessor'], mode: 'teaching_turn' }))
    expect(a).toEqual(b)
  })

  it('gives every selection a decision with status + reason (no silent drop)', () => {
    const selected = ['learning-assessor', 'course-ebook-publishing', 'not-a-real-skill']
    const result = plan(
      baseInput({
        selectedSkillIds: selected,
        mode: 'teaching_turn',
        readiness: readyAll(['learning-assessor', 'course-ebook-publishing'])
      })
    )
    for (const id of selected) {
      const d = result.decisions.find((x) => x.skillId === id)
      expect(d, `missing decision for ${id}`).toBeTruthy()
      expect(d!.status).toBeTruthy()
      expect(d!.reason.length).toBeGreaterThan(0)
    }
    expect(result.decisions.find((d) => d.skillId === 'not-a-real-skill')?.status).toBe('excluded')
  })

  it('always includes kernel in plan.kernel; teaching_turn activates teach', () => {
    const result = plan(
      baseInput({
        selectedSkillIds: ['learning-assessor'],
        mode: 'teaching_turn'
      })
    )
    expect(result.kernel).toEqual({ skillId: 'teach', profile: 'interactive' })
    expect(result.decisions.find((d) => d.skillId === 'teach')?.status).toBe('active_now')
    expect(result.mode).toBe('teaching_turn')
  })

  it('instant_help keeps kernel advisory_only (no settlement implied)', () => {
    const result = plan(
      baseInput({
        selectedSkillIds: [],
        mode: 'instant_help'
      })
    )
    expect(result.mode).toBe('instant_help')
    expect(result.kernel.skillId).toBe('teach')
    expect(result.decisions.find((d) => d.skillId === 'teach')?.status).toBe('advisory_only')
  })

  it('orders stages: producer before enhance before verify before package', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: [
          'course-content-authoring',
          'static-spa-interactions',
          'web-content-audit',
          'course-ebook-publishing'
        ],
        readiness: readyAll([
          'course-content-authoring',
          'course-outline-design',
          'static-spa-interactions',
          'static-spa-conversion',
          'web-content-audit',
          'course-ebook-publishing'
        ]),
        availableArtifacts: ['CourseOutline']
      })
    )
    const kinds = result.stages.map((s) => s.kind)
    const idx = (k: string) => kinds.indexOf(k as never)
    // Only assert relative order among stages that exist
    const present = ['artifact_authoring', 'enhance', 'verify', 'package'].filter((k) => kinds.includes(k as never))
    for (let i = 1; i < present.length; i++) {
      expect(idx(present[i]!)).toBeGreaterThan(idx(present[i - 1]!))
    }
  })

  it('expands predeclared trusted builtin dependencies', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['course-content-authoring'],
        readiness: readyAll(['course-content-authoring', 'course-outline-design']),
        availableArtifacts: []
      })
    )
    const outline = result.decisions.find((d) => d.skillId === 'course-outline-design')
    expect(outline).toBeTruthy()
    expect(['scheduled_later', 'active_now']).toContain(outline!.status)
    expect(outline!.reason.toLowerCase()).toMatch(/depend|auto-schedul/)
  })

  it('orders a dependency before its dependent within one sequential stage', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['course-content-authoring'],
        readiness: readyAll(['course-content-authoring', 'course-outline-design'])
      })
    )
    const authoring = result.stages.find((stage) => stage.kind === 'artifact_authoring')

    expect(authoring?.execution).toBe('sequential')
    expect(authoring?.skillIds).toEqual(['course-outline-design', 'course-content-authoring'])
  })

  it('blocks when required dependency cannot be auto-scheduled', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['course-content-authoring'],
        readiness: [
          {
            skillId: 'course-content-authoring',
            installed: true,
            trustedBuiltin: true,
            ready: true
          },
          {
            skillId: 'course-outline-design',
            installed: false,
            trustedBuiltin: true,
            ready: false
          }
        ]
      })
    )
    const content = result.decisions.find((d) => d.skillId === 'course-content-authoring')
    expect(content?.status).toBe('blocked')
    expect(result.diagnostics.some((d) => d.code === 'missing_dependency' || d.code === 'skill_not_ready')).toBe(
      true
    )
  })

  it('resolves dual writers on the same artifact scope (one lead)', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['course-content-authoring', 'teaching-resource-generator'],
        readiness: readyAll([
          'course-content-authoring',
          'course-outline-design',
          'teaching-resource-generator'
        ]),
        availableArtifacts: ['CourseOutline']
      })
    )
    expect(result.diagnostics.some((d) => d.code === 'artifact_scope_conflict')).toBe(true)
    const content = result.decisions.find((d) => d.skillId === 'course-content-authoring')
    const resources = result.decisions.find((d) => d.skillId === 'teaching-resource-generator')
    // Higher priority course-content-authoring (60) wins over teaching-resource-generator (55).
    expect(content?.status === 'active_now' || content?.status === 'scheduled_later').toBe(true)
    expect(resources?.status).toBe('excluded')
    expect(resources?.reason).toMatch(/conflict on artifact scope/i)
  })

  it('marks parallel_readonly for multiple verifiers on verify stage', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['web-content-audit', 'web-visual-verification'],
        readiness: readyAll(['web-content-audit', 'web-visual-verification'])
      })
    )
    const verify = result.stages.find((s) => s.kind === 'verify')
    expect(verify).toBeTruthy()
    expect(verify!.execution).toBe('parallel_readonly')
    expect(verify!.skillIds.sort()).toEqual(['web-content-audit', 'web-visual-verification'].sort())
    for (const id of ['web-content-audit', 'web-visual-verification']) {
      const d = result.decisions.find((x) => x.skillId === id)
      expect(d?.teachingImpact).toBe('verifier_only')
      expect(d?.reason.toLowerCase()).toMatch(/not learner|audit|verifier/)
    }
  })

  it('defers packager/enhancer under budgetConstrained', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        budgetConstrained: true,
        selectedSkillIds: [
          'course-content-authoring',
          'web-visual-assets',
          'course-ebook-publishing',
          'learning-assessor'
        ],
        readiness: readyAll([
          'course-content-authoring',
          'course-outline-design',
          'web-visual-assets',
          'course-ebook-publishing',
          'learning-assessor'
        ]),
        availableArtifacts: ['CourseOutline']
      })
    )
    expect(result.decisions.find((d) => d.skillId === 'course-ebook-publishing')?.status).toBe(
      'scheduled_later'
    )
    expect(result.decisions.find((d) => d.skillId === 'web-visual-assets')?.status).toBe('scheduled_later')
    expect(result.diagnostics.some((d) => d.code === 'budget_defer')).toBe(true)
    // teaching strategy not cut in favor of packager — still classified
    const assessor = result.decisions.find((d) => d.skillId === 'learning-assessor')
    expect(assessor).toBeTruthy()
    expect(assessor!.status).not.toBe('blocked')
  })

  it('is deterministic: same input → same planId and deep equality', () => {
    const input = baseInput({
      mode: 'artifact_workflow',
      selectedSkillIds: ['teaching-site', 'web-content-audit'],
      readiness: readyAll(['teaching-site', 'web-content-audit']),
      nextStepAction: 'continue_next_session',
      availableArtifacts: ['CourseContent']
    })
    const a = plan(input)
    const b = plan(input)
    expect(a.planId).toBe(b.planId)
    expect(a).toEqual(b)
    expect(a.planId).toMatch(/^sop1_[0-9a-f]{8}$/)
  })

  it('changes planId when selection or readiness changes', () => {
    const a = plan(
      baseInput({
        mode: 'teaching_turn',
        selectedSkillIds: ['learning-assessor'],
        readiness: readyAll(['learning-assessor'])
      })
    )
    const b = plan(
      baseInput({
        mode: 'teaching_turn',
        selectedSkillIds: ['learning-assessor', 'teaching-resource-generator'],
        readiness: readyAll(['learning-assessor', 'teaching-resource-generator'])
      })
    )
    expect(a.planId).not.toBe(b.planId)
  })

  it('keeps plan identity to allow-listed facts, not objective text or unknown payloads', () => {
    const base = baseInput({
      mode: 'teaching_turn',
      selectedSkillIds: ['learning-assessor'],
      readiness: readyAll(['learning-assessor']),
      contextIdentity: 'ctx:allow-listed'
    })
    const a = plan({ ...base, objective: 'Explain fractions; secret=not-an-identity-input' })
    const b = plan({
      ...base,
      objective: 'A different user-facing objective must not re-key the same orchestration facts.',
      // Runtime callers can carry unrelated properties; plan() must never hash them.
      untrustedPayload: 'sk-not-a-plan-identity-input'
    } as SkillOrchestrationInput)

    expect(a.planId).toBe(b.planId)
    expect(a.objective).not.toBe(b.objective)
  })

  it('keeps exactly one active workflow router with a deterministic excluded loser', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['course-designer', 'teaching-site'],
        readiness: readyAll(['course-designer', 'teaching-site'])
      })
    )

    expect(result.decisions.find((d) => d.skillId === 'teaching-site')?.status).toBe('active_now')
    const loser = result.decisions.find((d) => d.skillId === 'course-designer')
    expect(loser?.status).toBe('excluded')
    expect(loser?.reason).toMatch(/workflow_router/i)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'role_cardinality_conflict',
      severity: 'warning'
    }))
    expect(result.stages.find((stage) => stage.kind === 'ground')?.skillIds).toEqual(['teaching-site'])
  })

  it('uses teaching-site as workflow router without activating all children at once', () => {
    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['teaching-site', 'static-spa-conversion', 'web-visual-verification'],
        readiness: readyAll(['teaching-site', 'static-spa-conversion', 'web-visual-verification'])
      })
    )
    expect(result.decisions.find((d) => d.skillId === 'teaching-site')?.status).toBe('active_now')
    expect(result.kernel.profile).toBe('artifact')
    // Children are staged; not all active_now necessarily
    const childStatuses = ['static-spa-conversion', 'web-visual-verification'].map(
      (id) => result.decisions.find((d) => d.skillId === id)!.status
    )
    expect(childStatuses.every((s) => s === 'active_now' || s === 'scheduled_later')).toBe(true)
  })

  it('exposes learning-assessor teachingImpact for Phase 5 metadata (not learner outcome)', () => {
    const result = plan(
      baseInput({
        mode: 'teaching_turn',
        selectedSkillIds: ['learning-assessor'],
        readiness: readyAll(['learning-assessor'])
      })
    )
    const d = result.decisions.find((x) => x.skillId === 'learning-assessor')
    expect(d?.role).toBe('teaching_strategy')
    expect(d?.teachingImpact).toBe('teaching_strategy')
    expect(d?.status).toBe('active_now')
  })

  /**
   * Evidence inequality (ADR-0014): host policy teachingImpact must never treat
   * assessor / content-audit / visual-verification as learner Evidence writers.
   * Settlement remains TeachingTurnCoordinator sole-writer path only.
   */
  it('does not treat assessor/audit/visual-verification as learner Evidence writers', () => {
    const assessor = getBuiltinSkillOrchestrationPolicy('learning-assessor')
    const contentAudit = getBuiltinSkillOrchestrationPolicy('web-content-audit')
    const visual = getBuiltinSkillOrchestrationPolicy('web-visual-verification')

    for (const policy of [assessor, contentAudit, visual]) {
      expect(policy, `missing policy`).toBeTruthy()
      // No host impact value means "learner_outcome" writer — none exist on the type.
      expect(policy!.teachingImpact).not.toBe('kernel_principles')
      expect(['teaching_strategy', 'verifier_only', 'artifact_only', 'workflow_routing', 'none']).toContain(
        policy!.teachingImpact
      )
    }
    expect(assessor!.teachingImpact).toBe('teaching_strategy')
    expect(contentAudit!.teachingImpact).toBe('verifier_only')
    expect(visual!.teachingImpact).toBe('verifier_only')

    const result = plan(
      baseInput({
        mode: 'artifact_workflow',
        selectedSkillIds: ['learning-assessor', 'web-content-audit', 'web-visual-verification'],
        readiness: readyAll(['learning-assessor', 'web-content-audit', 'web-visual-verification'])
      })
    )
    for (const id of ['learning-assessor', 'web-content-audit', 'web-visual-verification']) {
      const d = result.decisions.find((x) => x.skillId === id)
      expect(d?.teachingImpact).toBeTruthy()
      expect(d!.teachingImpact).not.toMatch(/learner|outcome|evidence/i)
      // Planner reasons may mention Evidence only to deny settlement authority.
      if (d?.reason) {
        expect(d.reason.toLowerCase()).not.toMatch(/writes learner evidence|settle learner outcomes as evidence/)
      }
    }
    // Documented product floor: planner has zero settlement authority (pure plan only).
    expect(typeof plan).toBe('function')
  })
})

describe('SkillOrchestrationPlanner authority echoes', () => {
  it('embeds allow-listed next-step tokens in plan and planId', () => {
    const a = plan(
      baseInput({
        mode: 'teaching_turn',
        selectedSkillIds: ['learning-assessor'],
        readiness: readyAll(['learning-assessor']),
        nextStepAction: 'continue_next_session',
        nextStepReason: 'established_with_next_goal',
        resourceReadiness: 'ready',
        evidenceStatus: 'verified'
      })
    )
    const b = plan(
      baseInput({
        mode: 'teaching_turn',
        selectedSkillIds: ['learning-assessor'],
        readiness: readyAll(['learning-assessor']),
        nextStepAction: 'request_goal_clarification',
        nextStepReason: 'insufficient_evidence',
        resourceReadiness: 'ready',
        evidenceStatus: 'not_evidenced'
      })
    )
    expect(a.authorityEcho?.nextStepAction).toBe('continue_next_session')
    expect(a.planId).not.toBe(b.planId)
  })
})

