import { describe, expect, it } from 'vitest'
import {
  buildSessionStablePrefix,
  buildSkillOrchestrationPlanPromptLines,
  composeTeachingUserTurn
} from '../../src/main/teaching-conversation-prompt'
import { plan } from '../../src/main/skill-orchestration-planner'
import type { SkillOrchestrationPlan } from '../../src/shared/teaching-types/skill-orchestration'

function readyAll(ids: string[]) {
  return ids.map((skillId) => ({
    skillId,
    installed: true,
    trustedBuiltin: true,
    ready: true
  }))
}

function activeBodyRefsFromPlan(result: SkillOrchestrationPlan) {
  const activeIds = new Set(
    result.decisions.filter((d) => d.status === 'active_now').map((d) => d.skillId)
  )
  activeIds.add('teach')
  const refs = []
  if (activeIds.has('teach')) {
    refs.push({
      id: 'teach',
      name: 'Teach',
      source: 'builtin',
      content: '# Teach\nKERNEL_BODY_MARKER'
    })
  }
  if (activeIds.has('learning-assessor')) {
    refs.push({
      id: 'learning-assessor',
      name: 'Learning Assessor',
      source: 'builtin',
      content: '# Assessor\nACTIVE_ASSESSOR_BODY'
    })
  }
  return refs
}

describe('teaching skill orchestration prompt contract (ADR-0151 Phase 3)', () => {
  it('injects active skill bodies and omits inactive selected skill bodies', () => {
    const orchestration = plan({
      selectedSkillIds: ['learning-assessor', 'course-ebook-publishing'],
      mode: 'teaching_turn',
      readiness: readyAll(['learning-assessor', 'course-ebook-publishing']),
      contextIdentity: 'ctx:prompt-contract',
      objective: 'stage-scoped bodies'
    })

    const ebookDecision = orchestration.decisions.find((d) => d.skillId === 'course-ebook-publishing')
    const assessorDecision = orchestration.decisions.find((d) => d.skillId === 'learning-assessor')
    expect(assessorDecision?.status).toBe('active_now')
    expect(ebookDecision?.status).not.toBe('active_now')

    const skillReferences = activeBodyRefsFromPlan(orchestration)
    expect(skillReferences.some((r) => r.id === 'course-ebook-publishing')).toBe(false)

    const turn = composeTeachingUserTurn({
      mode: 'teaching',
      lessonToolEnabled: true,
      skillReferences,
      skillOrchestrationPlan: orchestration
    })

    expect(turn).toContain('KERNEL_BODY_MARKER')
    expect(turn).toContain('ACTIVE_ASSESSOR_BODY')
    expect(turn).not.toContain('INACTIVE_EBOOK_BODY')
    expect(turn).toContain('<skill-orchestration-plan>')
    expect(turn).toContain('status=active_now')
    expect(turn).toContain('skillId=learning-assessor')
    expect(turn).toContain(`skillId=course-ebook-publishing; status=${ebookDecision!.status}`)
    expect(turn).toContain('zero settlement authority')
    expect(turn).toContain('do not execute uninstalled child skills')
  })

  it('keeps plan projection out of stable prefix (ADR-0044)', () => {
    const orchestration = plan({
      selectedSkillIds: ['learning-assessor'],
      mode: 'teaching_turn',
      readiness: readyAll(['learning-assessor']),
      contextIdentity: 'ctx:prefix-stable'
    })
    const skillReferences = [
      {
        id: 'teach',
        name: 'Teach',
        source: 'builtin',
        content: '# Teach\nFULL KERNEL'
      },
      {
        id: 'learning-assessor',
        name: 'Assessor',
        source: 'builtin',
        content: '# Assessor\nFULL ASSESSOR'
      }
    ]
    const prefix = buildSessionStablePrefix({
      mode: 'teaching',
      lessonToolEnabled: true,
      skillReferences
    })
    const turn = composeTeachingUserTurn({
      mode: 'teaching',
      lessonToolEnabled: true,
      skillReferences,
      skillOrchestrationPlan: orchestration
    })
    expect(prefix).not.toContain('FULL KERNEL')
    expect(prefix).not.toContain('FULL ASSESSOR')
    expect(prefix).not.toContain('<skill-orchestration-plan>')
    expect(prefix).toContain('<skill-index>')
    expect(turn).toContain('FULL KERNEL')
    expect(turn).toContain('<skill-orchestration-plan>')
    expect(turn).toContain(orchestration.planId)
  })

  it('buildSkillOrchestrationPlanPromptLines is compact and body-free', () => {
    const orchestration = plan({
      selectedSkillIds: ['teaching-site'],
      mode: 'artifact_workflow',
      readiness: readyAll(['teaching-site']),
      contextIdentity: 'ctx:router'
    })
    const text = buildSkillOrchestrationPlanPromptLines(orchestration)
    expect(text).toContain('<skill-orchestration-plan>')
    expect(text).toContain('skillId=teaching-site')
    expect(text).not.toContain('# ')
    expect(text).not.toContain('SKILL.md')
  })

  it('projects authorityEcho tokens without skill bodies', () => {
    const orchestration = plan({
      selectedSkillIds: ['learning-assessor'],
      mode: 'teaching_turn',
      readiness: readyAll(['learning-assessor']),
      contextIdentity: 'ctx:authority',
      nextStepAction: 'continue_next_session',
      nextStepReason: 'established_with_next_goal',
      resourceReadiness: 'ready',
      evidenceStatus: 'verified'
    })
    expect(orchestration.authorityEcho?.nextStepAction).toBe('continue_next_session')
    const text = buildSkillOrchestrationPlanPromptLines(orchestration)
    expect(text).toContain('authorityEcho:')
    expect(text).toContain('nextStepAction=continue_next_session')
    expect(text).toContain('evidenceStatus=verified')
    expect(text).not.toContain('FULL')
  })
})
