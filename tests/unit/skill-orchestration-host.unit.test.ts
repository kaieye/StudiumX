import { describe, expect, it } from 'vitest'

import {
  buildSkillOrchestrationPlanInput,
  buildSkillOrchestrationReadinessFromCatalog,
  deriveSkillOrchestrationBudgetPressure,
  filterSkillReferencesToActiveBodies,
  mergeSelectedSkillIds,
  resolveCurrentSkillOrchestrationStage,
  resolveHostSkillOrchestrationMode,
  sanitizeAvailableArtifacts,
  skillIdsForBodyLoad,
  skillOrchestrationFactsFromAuthority
} from '../../src/main/skill-orchestration-host'
import { plan } from '../../src/main/skill-orchestration-planner'
import type { SkillOrchestrationPlan } from '../../src/shared/teaching-types/skill-orchestration'

function planFor(selected: string[], mode?: 'teaching_turn' | 'artifact_workflow' | 'instant_help') {
  const readiness = buildSkillOrchestrationReadinessFromCatalog({
    selectedSkillIds: selected,
    catalogSkills: selected.map((id) => ({ id, installed: true, source: 'personal' as const }))
  })
  return plan(
    buildSkillOrchestrationPlanInput({
      selectedSkillIds: selected,
      mode: mode ?? resolveHostSkillOrchestrationMode({
        isTeachingConversation: true,
        conversationMode: 'teaching',
        selectedSkillIds: selected
      }),
      objective: 'unit test objective',
      contextIdentity: 'ctx:test',
      readiness
    })
  )
}



describe('deriveSkillOrchestrationBudgetPressure', () => {
  it('derives only a soft planner pressure signal from configured hard-budget headroom', () => {
    expect(deriveSkillOrchestrationBudgetPressure({
      maxTotalTokens: 10_000,
      warningThreshold: 0.5,
      selectedSkillCount: 2
    })).toBe(true)
    expect(deriveSkillOrchestrationBudgetPressure({
      maxTotalTokens: 500_000,
      warningThreshold: 0.8,
      selectedSkillCount: 8
    })).toBe(false)
  })
})

describe('resolveHostSkillOrchestrationMode', () => {
  it('uses artifact_workflow when a workflow router is selected even in teaching chat', () => {
    expect(
      resolveHostSkillOrchestrationMode({
        isTeachingConversation: true,
        conversationMode: 'teaching',
        selectedSkillIds: ['teaching-site']
      })
    ).toBe('artifact_workflow')
  })

  it('uses teaching_turn for teaching chat without artifact selections', () => {
    expect(
      resolveHostSkillOrchestrationMode({
        isTeachingConversation: true,
        conversationMode: 'teaching',
        selectedSkillIds: ['learning-assessor']
      })
    ).toBe('teaching_turn')
  })

  it('uses instant_help for temporary chat with no skills', () => {
    expect(
      resolveHostSkillOrchestrationMode({
        isTeachingConversation: false,
        conversationMode: 'temporary',
        selectedSkillIds: []
      })
    ).toBe('instant_help')
  })
})

describe('buildSkillOrchestrationReadinessFromCatalog', () => {
  it('marks uninstalled builtins as not ready when catalog is present', () => {
    const readiness = buildSkillOrchestrationReadinessFromCatalog({
      selectedSkillIds: ['course-content-authoring'],
      catalogSkills: [
        { id: 'course-content-authoring', installed: false, source: 'builtin' },
        { id: 'course-outline-design', installed: true, source: 'personal' }
      ]
    })
    const content = readiness.find((r) => r.skillId === 'course-content-authoring')
    expect(content).toMatchObject({ installed: false, ready: false, trustedBuiltin: true })
    const outline = readiness.find((r) => r.skillId === 'course-outline-design')
    expect(outline).toMatchObject({ installed: true, ready: true })
  })

  it('always treats teach kernel as ready', () => {
    const readiness = buildSkillOrchestrationReadinessFromCatalog({
      selectedSkillIds: [],
      catalogSkills: []
    })
    expect(readiness.find((r) => r.skillId === 'teach')).toMatchObject({
      ready: true,
      trustedBuiltin: true
    })
  })
})

describe('stage-scoped body load', () => {
  it('loads only current-stage active bodies plus the Teaching Kernel', () => {
    const orchestration: SkillOrchestrationPlan = planFor(
      ['teaching-site', 'course-content-authoring', 'static-spa-interactions'],
      'artifact_workflow'
    )
    const currentStage = resolveCurrentSkillOrchestrationStage(orchestration)
    const bodyIds = skillIdsForBodyLoad({
      plan: orchestration,
      isTeachingConversation: true
    })
    const expected = [
      'teach',
      ...(currentStage?.skillIds ?? []).filter((skillId) =>
        orchestration.decisions.some((decision) =>
          decision.skillId === skillId && decision.status === 'active_now'
        )
      )
    ].sort()

    expect(currentStage?.id).toBe(orchestration.stages[0]?.id)
    expect(bodyIds).toEqual(expected)
    for (const decision of orchestration.decisions) {
      if (decision.skillId !== 'teach' && !currentStage?.skillIds.includes(decision.skillId) && decision.status === 'active_now') {
        expect(bodyIds).not.toContain(decision.skillId)
      }
    }
  })

  it('uses the continuity cursor and never restarts an all-completed plan', () => {
    const base = planFor(['teaching-site', 'course-content-authoring'], 'artifact_workflow')
    const continuityPlan: SkillOrchestrationPlan = {
      ...base,
      currentStageId: base.stages[1]?.id,
      stages: base.stages.map((stage, index) => ({
        ...stage,
        status: index === 0 ? 'completed' : index === 1 ? 'current' : 'pending'
      }))
    }
    const currentStage = resolveCurrentSkillOrchestrationStage(continuityPlan)
    expect(currentStage?.id).toBe(base.stages[1]?.id)
    expect(skillIdsForBodyLoad({ plan: continuityPlan, isTeachingConversation: true })).toEqual([
      'teach',
      ...(currentStage?.skillIds ?? []).filter((skillId) =>
        continuityPlan.decisions.some((decision) =>
          decision.skillId === skillId && decision.status === 'active_now'
        )
      )
    ].sort())

    const completedPlan: SkillOrchestrationPlan = {
      ...continuityPlan,
      currentStageId: undefined,
      stages: continuityPlan.stages.map((stage) => ({ ...stage, status: 'completed' }))
    }
    expect(resolveCurrentSkillOrchestrationStage(completedPlan)).toBeUndefined()
    expect(skillIdsForBodyLoad({ plan: completedPlan, isTeachingConversation: false })).toEqual(['teach'])
  })

  it('filters references to active body set', () => {
    const planResult = planFor(['learning-assessor'], 'teaching_turn')
    const filtered = filterSkillReferencesToActiveBodies({
      plan: planResult,
      isTeachingConversation: true,
      references: [
        { id: 'teach', name: 'teach', source: 'builtin', content: 'kernel' },
        { id: 'learning-assessor', name: 'assessor', source: 'personal', content: 'strategy' },
        { id: 'web-content-audit', name: 'audit', source: 'personal', content: 'later' }
      ]
    })
    expect(filtered.map((r) => r.id).sort()).toEqual(['learning-assessor', 'teach'].sort())
  })
})

describe('sanitizeAvailableArtifacts', () => {
  it('keeps typed names and drops paths/prose', () => {
    expect(
      sanitizeAvailableArtifacts(['CourseOutline', '../etc/passwd', 'bad name', 'LearnerLevel'])
    ).toEqual(['CourseOutline', 'LearnerLevel'])
  })
})

describe('mergeSelectedSkillIds', () => {
  const catalog = [
    { id: 'teaching-site', installed: true, source: 'personal' as const },
    { id: 'learning-assessor', installed: true, source: 'personal' as const },
    { id: 'course-content-authoring', installed: false, source: 'builtin' as const }
  ]

  it('merges explicit ids with consecutive leading slash skills', () => {
    expect(
      mergeSelectedSkillIds({
        explicitSkillIds: ['learning-assessor'],
        userInput: '/teaching-site /learning-assessor outline a course',
        catalogSkills: catalog
      })
    ).toEqual(['learning-assessor', 'teaching-site'])
  })

  it('ignores uninstalled slash tokens', () => {
    expect(
      mergeSelectedSkillIds({
        explicitSkillIds: [],
        userInput: '/course-content-authoring write',
        catalogSkills: catalog
      })
    ).toEqual([])
  })
})

describe('skillOrchestrationFactsFromAuthority', () => {
  it('keeps allow-listed tokens only', () => {
    expect(
      skillOrchestrationFactsFromAuthority({
        nextStepAction: 'continue_next_session',
        nextStepReason: 'established_with_next_goal',
        resourceReadiness: 'ready',
        evidenceStatus: 'verified',
        availableArtifacts: ['CourseOutline', 'nope path']
      })
    ).toEqual({
      nextStepAction: 'continue_next_session',
      nextStepReason: 'established_with_next_goal',
      resourceReadiness: 'ready',
      evidenceStatus: 'verified',
      availableArtifacts: ['CourseOutline']
    })
  })

  it('drops free-form next-step strings', () => {
    expect(
      skillOrchestrationFactsFromAuthority({
        nextStepAction: 'do something evil <script>',
        nextStepReason: 'Needs Practice!!'
      })
    ).toEqual({})
  })
})

describe('host plan input → planner mode alignment', () => {
  it('plans artifact_workflow for teaching-site selection under teaching conversation host mode', () => {
    const mode = resolveHostSkillOrchestrationMode({
      isTeachingConversation: true,
      conversationMode: 'teaching',
      selectedSkillIds: ['teaching-site']
    })
    const readiness = buildSkillOrchestrationReadinessFromCatalog({
      selectedSkillIds: ['teaching-site'],
      catalogSkills: [{ id: 'teaching-site', installed: true, source: 'personal' }]
    })
    const result = plan(
      buildSkillOrchestrationPlanInput({
        selectedSkillIds: ['teaching-site'],
        mode,
        objective: 'build a course site',
        contextIdentity: 'ctx:site',
        readiness
      })
    )
    expect(result.mode).toBe('artifact_workflow')
    expect(result.kernel.profile).toBe('artifact')
    expect(result.decisions.find((d) => d.skillId === 'teaching-site')?.status).toBe('active_now')
  })

  it('blocks uninstalled producer when catalog says not installed', () => {
    const readiness = buildSkillOrchestrationReadinessFromCatalog({
      selectedSkillIds: ['course-content-authoring'],
      catalogSkills: [{ id: 'course-content-authoring', installed: false, source: 'builtin' }]
    })
    const result = plan(
      buildSkillOrchestrationPlanInput({
        selectedSkillIds: ['course-content-authoring'],
        mode: 'artifact_workflow',
        objective: 'author content',
        contextIdentity: 'ctx:block',
        readiness
      })
    )
    expect(result.decisions.find((d) => d.skillId === 'course-content-authoring')?.status).toBe(
      'blocked'
    )
  })
})
