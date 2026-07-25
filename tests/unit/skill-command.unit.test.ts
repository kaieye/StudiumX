import { describe, expect, it } from 'vitest'
import { leadingSkillIdSequence, leadingSkillIds } from '../../src/shared/skill-command'
import type { SkillSummary } from '../../src/shared/teaching-types'

function skill(id: string, installed = true): SkillSummary {
  return {
    id,
    name: id,
    description: id,
    category: 'other',
    icon: 'sparkles',
    author: 'test',
    command: `/${id}`,
    source: 'personal',
    installed
  }
}

describe('leadingSkillIdSequence', () => {
  const skills = [skill('teaching-site'), skill('learning-assessor'), skill('web-content-audit', false)]

  it('collects consecutive installed slash skills', () => {
    expect(leadingSkillIdSequence('/teaching-site /learning-assessor rest of message', skills)).toEqual([
      'teaching-site',
      'learning-assessor'
    ])
  })

  it('stops at uninstalled or non-slash token', () => {
    expect(leadingSkillIdSequence('/teaching-site /web-content-audit more', skills)).toEqual(['teaching-site'])
    expect(leadingSkillIdSequence('/teaching-site please help', skills)).toEqual(['teaching-site'])
  })

  it('keeps leadingSkillIds as first-only helper', () => {
    expect(leadingSkillIds('/teaching-site /learning-assessor x', skills)).toEqual(['teaching-site'])
  })
})
