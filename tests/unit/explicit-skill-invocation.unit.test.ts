import { describe, expect, it } from 'vitest'

import {
  EXPLICIT_SKILL_INVOCATION_HARD_MAX_BODY_CHARS,
  parseExplicitSkillInvocation,
  stripSkillFrontmatter
} from '../../src/shared/explicit-skill-invocation'
import { resolveExplicitSkillInvocation } from '../../src/main/explicit-skill-invocation'

describe('parseExplicitSkillInvocation', () => {
  it('parses canonical Pi-compatible invocations and trims only argument boundaries', () => {
    expect(parseExplicitSkillInvocation('/skill:Learning-Assessor   assess\n  this answer  ')).toEqual({
      kind: 'candidate',
      syntax: 'pi_compatible_v1',
      skillId: 'learning-assessor',
      args: 'assess\n  this answer'
    })
  })

  it('keeps the bounded legacy parser and rejects malformed canonical syntax', () => {
    expect(parseExplicitSkillInvocation('/learning-assessor  assess this')).toEqual({
      kind: 'candidate', syntax: 'legacy', skillId: 'learning-assessor', args: 'assess this'
    })
    expect(parseExplicitSkillInvocation('/skill:')).toEqual({ kind: 'invalid', reason: 'malformed' })
    expect(parseExplicitSkillInvocation('/skill:../escape')).toEqual({ kind: 'invalid', reason: 'malformed' })
    expect(parseExplicitSkillInvocation('please /skill:learning-assessor')).toEqual({ kind: 'none' })
  })
})

describe('resolveExplicitSkillInvocation', () => {
  const source = {
    skillId: 'learning-assessor',
    displayName: 'Learning & Assessor',
    filePath: '/private/skills/learning-assessor/SKILL.md',
    baseDir: '/private/skills/learning-assessor',
    content: '---\nname: Learning Assessor\n---\n# Assess\n\nUse evidence.\n'
  }

  it('creates the exact virtual-location user overlay and redacted presentation', async () => {
    const result = await resolveExplicitSkillInvocation({
      input: '/skill:learning-assessor  assess the latest answer ',
      findSkill: async () => source,
      now: () => new Date('2026-08-01T02:03:04.000Z')
    })

    expect(result).toMatchObject({ kind: 'resolved' })
    if (result.kind !== 'resolved') return
    expect(result.value.expandedUserText).toBe(
      '<skill name="Learning &amp; Assessor" location="skill://learning-assessor/SKILL.md">\n' +
      'References are relative to skill://learning-assessor/.\n\n' +
      '# Assess\n\nUse evidence.\n' +
      '</skill>\n\nassess the latest answer'
    )
    expect(result.value.presentation).toEqual({
      skillId: 'learning-assessor',
      displayName: 'Learning & Assessor',
      args: 'assess the latest answer',
      bodySha256: 'cfd96c35bebccf34a1110719f8bf3f0944c91ac60c0d808b1d2ed7add2ba6646',
      bodyChars: 23,
      invokedAt: '2026-08-01T02:03:04.000Z',
      bodyTruncated: false,
      state: 'applied'
    })
    expect(result.value.invocation).toMatchObject({
      syntax: 'pi_compatible_v1',
      skillId: 'learning-assessor',
      bodyChars: 23,
      invokedAt: '2026-08-01T02:03:04.000Z'
    })
    expect(JSON.stringify(result.value.presentation)).not.toContain('/private')
    expect(JSON.stringify(result.value.presentation)).not.toContain('Use evidence')
  })

  it('does not add an args block when none was supplied', async () => {
    const result = await resolveExplicitSkillInvocation({ input: '/skill:learning-assessor', findSkill: async () => source })
    expect(result).toMatchObject({ kind: 'resolved' })
    if (result.kind !== 'resolved') return
    expect(result.value.expandedUserText).toBe(
      '<skill name="Learning &amp; Assessor" location="skill://learning-assessor/SKILL.md">\n' +
      'References are relative to skill://learning-assessor/.\n\n# Assess\n\nUse evidence.\n</skill>'
    )
  })

  it('fails closed for missing/read-error/empty/over-budget sources without truncation', async () => {
    await expect(resolveExplicitSkillInvocation({ input: '/skill:missing', findSkill: async () => null }))
      .resolves.toMatchObject({ kind: 'rejected', presentation: { state: 'rejected', reason: 'not_installed', bodyTruncated: false } })
    await expect(resolveExplicitSkillInvocation({ input: '/skill:broken', findSkill: async () => { throw new Error('read') } }))
      .resolves.toMatchObject({ kind: 'rejected', presentation: { state: 'failed', reason: 'read_failed', bodyTruncated: false } })
    await expect(resolveExplicitSkillInvocation({ input: '/skill:empty', findSkill: async () => ({ ...source, content: '---\nname: empty\n---\n' }) }))
      .resolves.toMatchObject({ kind: 'rejected', presentation: { state: 'failed', reason: 'empty_body', bodyTruncated: false } })
    await expect(resolveExplicitSkillInvocation({
      input: '/skill:large',
      hardMaxBodyChars: 3,
      findSkill: async () => ({ ...source, content: 'abcd' })
    })).resolves.toMatchObject({
      kind: 'rejected',
      presentation: { state: 'rejected', reason: 'budget_exceeded', bodyChars: 4, bodyTruncated: false }
    })
    expect(EXPLICIT_SKILL_INVOCATION_HARD_MAX_BODY_CHARS).toBe(48_000)
  })
})

describe('stripSkillFrontmatter', () => {
  it('strips one leading YAML document and preserves the trimmed body', () => {
    expect(stripSkillFrontmatter('---\r\nname: test\r\n---\r\n\r\n# Body\r\n')).toBe('# Body')
    expect(stripSkillFrontmatter('# Already a body\n')).toBe('# Already a body')
  })
})
