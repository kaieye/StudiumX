import { describe, expect, it } from 'vitest'
import { filterSkillSlashMatches, leadingSkillIdSequence, leadingSkillIds, skillCommandValue, skillSlashQuery } from '../../src/shared/skill-command'
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

describe('filterSkillSlashMatches', () => {
  it('returns every installed match by default, including a catalogue larger than eight Skills', () => {
    const skills = Array.from({ length: 9 }, (_, index) => skill(`personal-skill-${index + 1}`))

    expect(filterSkillSlashMatches('/', skills)).toHaveLength(9)
  })

  it('still supports an explicit compact limit', () => {
    const skills = Array.from({ length: 3 }, (_, index) => skill(`personal-skill-${index + 1}`))

    expect(filterSkillSlashMatches('/', skills, 2)).toHaveLength(2)
  })
})

describe('Pi-compatible canonical Skill command syntax', () => {
  it('discovers /skill: prefixes and only emits the canonical command value', () => {
    const learningAssessor = skill('learning-assessor')
    expect(skillSlashQuery('/skill:lea')).toBe('lea')
    expect(filterSkillSlashMatches('/skill:lea', [learningAssessor])).toEqual([learningAssessor])
    expect(skillCommandValue(learningAssessor)).toBe('/skill:learning-assessor ')
  })
})
