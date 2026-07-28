import { describe, expect, it } from 'vitest'

import { resolveActiveRoleCardinality } from '../../src/main/skill-orchestration-cardinality'
import type { ActiveCardinalityCandidate } from '../../src/main/skill-orchestration-cardinality'

function strategy(
  skillId: string,
  priority: number,
  userSelected = true,
  preferredNextStepActions: string[] = []
): ActiveCardinalityCandidate {
  return {
    skillId,
    userSelected,
    policy: {
      role: 'teaching_strategy',
      stages: ['diagnose', 'elicit'],
      priority,
      admission: {
        allowedModes: ['teaching_turn'],
        slot: 'primary_teaching_strategy',
        exclusiveGroup: 'primary_teaching_strategy',
        maxActivePerStage: 1,
        ...(preferredNextStepActions.length > 0 ? { preferredNextStepActions } : {}),
        trustLevel: 'host_governed',
        selectionSurface: 'default'
      }
    }
  }
}

describe('resolveActiveRoleCardinality', () => {
  it('keeps exactly one primary strategy per overlapping teaching stage with stable ordering', () => {
    const input = {
      mode: 'teaching_turn' as const,
      candidates: [strategy('strategy-beta', 70), strategy('strategy-alpha', 70)]
    }
    const first = resolveActiveRoleCardinality(input)
    const second = resolveActiveRoleCardinality(input)

    expect(first).toEqual(second)
    expect(first).toEqual([
      expect.objectContaining({
        skillId: 'strategy-beta',
        winnerSkillId: 'strategy-alpha',
        exclusiveGroup: 'primary_teaching_strategy',
        stage: 'diagnose'
      })
    ])
  })

  it('ranks next-step affinity before selection provenance and host priority', () => {
    const result = resolveActiveRoleCardinality({
      mode: 'teaching_turn',
      nextStepAction: 'assess',
      candidates: [
        strategy('explicit-high-priority', 99, true),
        strategy('next-step-fit', 1, false, ['assess'])
      ]
    })

    expect(result).toEqual([
      expect.objectContaining({
        skillId: 'explicit-high-priority',
        winnerSkillId: 'next-step-fit',
        exclusiveGroup: 'primary_teaching_strategy',
        stage: 'diagnose'
      })
    ])
  })

  it('does not exclude multiple parallel read-only verifiers', () => {
    const result = resolveActiveRoleCardinality({
      mode: 'artifact_workflow',
      candidates: [
        {
          skillId: 'verify-a',
          userSelected: true,
          policy: {
            role: 'verifier',
            stages: ['verify'],
            priority: 1,
            admission: {
              allowedModes: ['artifact_workflow'],
              slot: 'verification',
              trustLevel: 'host_governed',
              selectionSurface: 'default'
            }
          }
        },
        {
          skillId: 'verify-b',
          userSelected: true,
          policy: {
            role: 'verifier',
            stages: ['verify'],
            priority: 99,
            admission: {
              allowedModes: ['artifact_workflow'],
              slot: 'verification',
              trustLevel: 'host_governed',
              selectionSurface: 'default'
            }
          }
        }
      ]
    })
    expect(result).toEqual([])
  })
})
