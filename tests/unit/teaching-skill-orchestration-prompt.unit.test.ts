import { describe, expect, it } from 'vitest'
import {
  buildSessionStablePrefix,
  buildSkillOrchestrationPlanPromptLines,
  composeTeachingUserTurn,
  DYNAMIC_SKILL_PROMPT_BODY_BUDGET_CHARS,
  projectSkillPromptBudget,
  TEACHING_KERNEL_PROMPT_BODY_BUDGET_CHARS
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

describe('teaching skill orchestration prompt contract (ADR-0014)', () => {
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

    const skillReferences = [
      ...activeBodyRefsFromPlan(orchestration),
      {
        id: 'course-ebook-publishing',
        name: 'Course Ebook Publishing',
        source: 'builtin',
        content: '# Ebook\nINACTIVE_EBOOK_BODY'
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

    expect(prefix).toContain('KERNEL_BODY_MARKER')
    expect(turn).not.toContain('KERNEL_BODY_MARKER')
    expect(turn).toContain('ACTIVE_ASSESSOR_BODY')
    expect(turn).not.toContain('INACTIVE_EBOOK_BODY')
    expect(turn).toContain('<skill-orchestration-plan>')
    expect(turn).toContain('status=active_now')
    expect(turn).toContain('skillId=learning-assessor')
    expect(turn).not.toContain(`skillId=course-ebook-publishing; status=${ebookDecision!.status}`)
    expect(turn).toContain('zero settlement authority')
    expect(turn).toContain('do not execute uninstalled child skills')
  })

  it('keeps plan projection out of stable prefix (ADR-0008)', () => {
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
    expect(prefix).toContain('FULL KERNEL')
    expect(prefix).not.toContain('FULL ASSESSOR')
    expect(prefix).not.toContain('<skill-orchestration-plan>')
    expect(prefix).toContain('<skill-index>')
    expect(turn).not.toContain('FULL KERNEL')
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

  it('enforces aggregate kernel/dynamic budgets and fairly represents large current-stage bodies', () => {
    const references = [
      {
        id: 'teach',
        name: 'Teach',
        source: 'builtin',
        content: `# Teach
KERNEL_START
${'K'.repeat(25_000)}`
      },
      {
        id: 'learning-assessor',
        name: 'Assessor',
        source: 'builtin',
        content: `# Assessor
ASSESSOR_START
${'A'.repeat(20_000)}`
      },
      {
        id: 'course-content-authoring',
        name: 'Authoring',
        source: 'builtin',
        content: `# Authoring
AUTHORING_START
${'B'.repeat(20_000)}`
      }
    ]
    const projected = projectSkillPromptBudget(references)
    const turn = composeTeachingUserTurn({
      mode: 'teaching',
      lessonToolEnabled: true,
      skillReferences: references
    })
    const prefix = buildSessionStablePrefix({
      mode: 'teaching',
      lessonToolEnabled: true,
      skillReferences: references
    })

    expect(projected.kernelIncludedChars).toBeLessThanOrEqual(TEACHING_KERNEL_PROMPT_BODY_BUDGET_CHARS)
    expect(projected.dynamicIncludedChars).toBeLessThanOrEqual(DYNAMIC_SKILL_PROMPT_BODY_BUDGET_CHARS)
    expect(projected.truncatedBodyCount).toBe(3)
    expect(prefix).toContain('KERNEL_START')
    expect(prefix).toContain('skill truncated by stable Teaching Kernel budget')
    expect(turn).toContain('ASSESSOR_START')
    expect(turn).toContain('AUTHORING_START')
    expect(turn.match(/skill truncated by dynamic prompt budget/g)).toHaveLength(2)
  })

})
