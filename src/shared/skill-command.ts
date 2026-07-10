import type { SkillSummary } from './teaching-types/skill'

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function isSafeSkillId(value: unknown): value is string {
  return typeof value === 'string' && SKILL_ID_PATTERN.test(value.trim())
}

/**
 * Reasonix-style slash discovery: suggestions stay open only while the entire
 * input is a single `/token` without arguments or line breaks.
 */
export function skillSlashQuery(input: string): string | null {
  const match = input.match(/^\/([^\s/]*)$/)
  return match ? (match[1] ?? '').toLocaleLowerCase() : null
}

export function filterSkillSlashMatches(input: string, skills: SkillSummary[], limit = 8): SkillSummary[] {
  const query = skillSlashQuery(input)
  if (query === null) return []
  return skills
    .filter((skill) => skill.installed)
    .filter((skill) => {
      if (!query) return true
      return `${skill.name} ${skill.description} ${skill.id}`.toLocaleLowerCase().includes(query)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit))
}

export function leadingSkillIds(input: string, skills: SkillSummary[]): string[] {
  const match = input.match(/^\/([a-z0-9][a-z0-9._-]{0,63})(?:\s|$)/i)
  if (!match) return []
  const token = (match[1] ?? '').toLocaleLowerCase()
  const skill = skills.find((candidate) =>
    candidate.installed && candidate.id.toLocaleLowerCase() === token
  )
  return skill ? [skill.id] : []
}

export function skillCommandValue(skill: SkillSummary): string {
  return `${skill.command} `
}
