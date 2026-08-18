import { createHash } from 'node:crypto'

import type { InstalledSkillReference } from '../shared/teaching-types'
import {
  EXPLICIT_SKILL_INVOCATION_HARD_MAX_BODY_CHARS,
  parseExplicitSkillInvocation,
  stripSkillFrontmatter,
  type SkillInvocationPresentation
} from '../shared/explicit-skill-invocation'

export type ExplicitSkillInvocation = {
  syntax: 'pi_compatible_v1' | 'legacy'
  requestedToken: string
  skillId: string
  displayName: string
  /** Main-process only; never attach this to an IPC/public DTO. */
  filePath: string
  /** Main-process only; never attach this to an IPC/public DTO. */
  baseDir: string
  bodySha256: string
  bodyChars: number
  invokedAt: string
  args?: string
}

export type ExplicitSkillInvocationSource = {
  skillId: string
  displayName: string
  filePath: string
  baseDir: string
  content: string
  /** Verified resource root available only to the existing read_skill_resource tool. */
  resourceReference?: InstalledSkillReference
}

export type ResolvedExplicitSkillInvocation = {
  invocation: ExplicitSkillInvocation
  expandedUserText: string
  presentation: SkillInvocationPresentation
  resourceReference?: InstalledSkillReference
}

export type ExplicitSkillInvocationResolution =
  | { kind: 'none' }
  | { kind: 'invalid'; presentation: SkillInvocationPresentation; message: string }
  | { kind: 'rejected'; presentation: SkillInvocationPresentation; message: string }
  | { kind: 'resolved'; value: ResolvedExplicitSkillInvocation }

/**
 * Main-only resolver for ADR-0014. Lookup must return only a previously verified
 * catalogue entry; this module deliberately accepts no renderer-controlled path.
 */
export async function resolveExplicitSkillInvocation(options: {
  input: string
  findSkill: (skillId: string) => Promise<ExplicitSkillInvocationSource | null>
  now?: () => Date
  hardMaxBodyChars?: number
}): Promise<ExplicitSkillInvocationResolution> {
  const parsed = parseExplicitSkillInvocation(options.input)
  if (parsed.kind === 'none') return { kind: 'none' }
  if (parsed.kind === 'invalid') {
    return {
      kind: 'invalid',
      message: 'Skill 调用格式无效。请使用 /skill:<skill-id> [任务]。',
      presentation: { bodyTruncated: false, state: 'rejected', reason: 'malformed' }
    }
  }

  let source: ExplicitSkillInvocationSource | null
  try {
    source = await options.findSkill(parsed.skillId)
  } catch {
    return failed(parsed.skillId, parsed.args, '无法读取该 Skill。', 'read_failed')
  }
  if (!source) {
    return {
      kind: 'rejected',
      message: `Skill "${parsed.skillId}" 未安装或不存在。`,
      presentation: {
        skillId: parsed.skillId,
        args: parsed.args || undefined,
        bodyTruncated: false,
        state: 'rejected',
        reason: 'not_installed'
      }
    }
  }

  const body = stripSkillFrontmatter(source.content)
  if (!body) return failed(source.skillId, parsed.args, `Skill "${source.skillId}" 没有可用正文。`, 'empty_body', source.displayName)
  const hardMaxBodyChars = options.hardMaxBodyChars ?? EXPLICIT_SKILL_INVOCATION_HARD_MAX_BODY_CHARS
  if (body.length > hardMaxBodyChars) {
    return {
      kind: 'rejected',
      message: `Skill "${source.skillId}" 正文超过本地硬限制（${hardMaxBodyChars} 字符），未启动本轮。`,
      presentation: {
        skillId: source.skillId,
        displayName: source.displayName,
        args: parsed.args || undefined,
        bodyChars: body.length,
        bodyTruncated: false,
        state: 'rejected',
        reason: 'budget_exceeded'
      }
    }
  }

  const canonicalId = source.skillId.toLocaleLowerCase()
  const location = `skill://${canonicalId}/SKILL.md`
  const baseDir = `skill://${canonicalId}/`
  const expandedUserText = [
    `<skill name="${escapeXmlAttribute(source.displayName)}" location="${location}">`,
    `References are relative to ${baseDir}.`,
    '',
    body,
    '</skill>',
    ...(parsed.args ? ['', parsed.args] : [])
  ].join('\n')
  const invocation: ExplicitSkillInvocation = {
    syntax: parsed.syntax,
    requestedToken: `skill:${parsed.skillId}`,
    skillId: canonicalId,
    displayName: source.displayName,
    filePath: source.filePath,
    baseDir: source.baseDir,
    bodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    bodyChars: body.length,
    invokedAt: (options.now ?? (() => new Date()))().toISOString(),
    ...(parsed.args ? { args: parsed.args } : {})
  }
  return {
    kind: 'resolved',
    value: {
      invocation,
      expandedUserText,
      presentation: {
        skillId: canonicalId,
        displayName: source.displayName,
        args: parsed.args || undefined,
        bodySha256: invocation.bodySha256,
        bodyChars: body.length,
        invokedAt: invocation.invokedAt,
        bodyTruncated: false,
        state: 'applied'
      },
      ...(source.resourceReference ? { resourceReference: source.resourceReference } : {})
    }
  }
}

function failed(
  skillId: string,
  args: string,
  message: string,
  reason: Extract<NonNullable<SkillInvocationPresentation['reason']>, 'read_failed' | 'empty_body'>,
  displayName?: string
): ExplicitSkillInvocationResolution {
  return {
    kind: 'rejected',
    message,
    presentation: {
      skillId,
      ...(displayName ? { displayName } : {}),
      args: args || undefined,
      bodyTruncated: false,
      state: 'failed',
      reason
    }
  }
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
