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
  const match = input.match(/^\/(?:skill:)?([^\s/]*)$/i)
  return match ? (match[1] ?? '').toLocaleLowerCase() : null
}

/**
 * Return every installed match by default. The slash menu is scrollable, so a
 * personal catalogue is never silently hidden after an arbitrary first eight.
 * Callers that need a compact projection may pass an explicit limit.
 */
export function filterSkillSlashMatches(input: string, skills: SkillSummary[], limit?: number): SkillSummary[] {
  const query = skillSlashQuery(input)
  if (query === null) return []
  return skills
    .filter((skill) => skill.installed)
    .filter((skill) => {
      if (!query) return true
      return `${skill.name} ${skill.description} ${skill.id}`.toLocaleLowerCase().includes(query)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit === undefined ? undefined : Math.max(1, limit))
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

/**
 * Collect consecutive leading slash skill tokens (`/a /b rest` → [a,b]).
 * Stops at the first non-skill token or non-slash word. Phase 4 multi-select
 * can feed the same shape via explicit skillIds; this keeps slash parity.
 */
export function leadingSkillIdSequence(input: string, skills: SkillSummary[], limit = 8): string[] {
  const tokens = String(input ?? '').trimStart().split(/\s+/)
  const found: string[] = []
  const seen = new Set<string>()
  const max = Math.max(1, Math.min(limit, 8))
  for (const raw of tokens) {
    const match = /^\/([a-z0-9][a-z0-9._-]{0,63})$/i.exec(raw)
    if (!match) break
    const token = (match[1] ?? '').toLocaleLowerCase()
    const skill = skills.find(
      (candidate) => candidate.installed && candidate.id.toLocaleLowerCase() === token
    )
    if (!skill) break
    if (seen.has(token)) continue
    seen.add(token)
    found.push(skill.id)
    if (found.length >= max) break
  }
  return found
}

/** Canonical renderer output for ADR-0168; catalog command remains display-only legacy data. */
export function skillCommandValue(skill: SkillSummary): string {
  return `/skill:${skill.id} `
}
