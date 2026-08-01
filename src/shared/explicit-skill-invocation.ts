import { isSafeSkillId } from './skill-command'

export const EXPLICIT_SKILL_INVOCATION_HARD_MAX_BODY_CHARS = 48_000

export type ParsedExplicitSkillInvocation =
  | { kind: 'none' }
  | { kind: 'candidate'; syntax: 'pi_compatible_v1' | 'legacy'; skillId: string; args: string }
  | { kind: 'invalid'; reason: 'malformed' }

/**
 * Parse one leading explicit invocation. The canonical syntax is `/skill:<id>`;
 * `/id` remains a deliberately bounded migration parser through 2026-12-31.
 */
export function parseExplicitSkillInvocation(input: string): ParsedExplicitSkillInvocation {
  const text = String(input ?? '')
  if (!text.startsWith('/')) return { kind: 'none' }

  const canonical = /^\/skill:([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text)
  if (canonical) {
    const skillId = canonical[1]?.trim().toLocaleLowerCase() ?? ''
    if (!isSafeSkillId(skillId)) return { kind: 'invalid', reason: 'malformed' }
    return { kind: 'candidate', syntax: 'pi_compatible_v1', skillId, args: canonical[2]?.trim() ?? '' }
  }
  if (text.startsWith('/skill:')) return { kind: 'invalid', reason: 'malformed' }

  const legacy = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!legacy) return { kind: 'none' }
  const skillId = legacy[1]?.trim().toLocaleLowerCase() ?? ''
  if (!isSafeSkillId(skillId)) return { kind: 'none' }
  return { kind: 'candidate', syntax: 'legacy', skillId, args: legacy[2]?.trim() ?? '' }
}

/** Strip a leading YAML frontmatter document without changing Skill body semantics. */
export function stripSkillFrontmatter(content: string): string {
  const normalized = String(content ?? '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return normalized.trim()
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return normalized.trim()
  const afterMarker = end + 4
  const bodyStart = normalized[afterMarker] === '\n' ? afterMarker + 1 : afterMarker
  return normalized.slice(bodyStart).trim()
}

export type SkillInvocationPresentation = {
  skillId?: string
  displayName?: string
  args?: string
  /** Audit-only digest of the verified body; never the body itself. */
  bodySha256?: string
  bodyChars?: number
  /** Host resolver timestamp for an applied invocation. */
  invokedAt?: string
  bodyTruncated: false
  state: 'applied' | 'rejected' | 'failed'
  reason?: 'malformed' | 'not_installed' | 'read_failed' | 'empty_body' | 'budget_exceeded'
}
