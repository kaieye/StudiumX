/**
 * Host-side skill orchestration seams (ADR-0151).
 * Pure helpers only — no ledger, tools, or settlement authority.
 * Runtime / workspace assemble catalog readiness + mode; planner remains pure plan().
 */

import { getBuiltinSkillOrchestrationPolicy } from './builtin-skill-orchestration-policy'
import { leadingSkillIdSequence } from '../shared/skill-command'
import type { InstalledSkillReference, SkillSummary } from '../shared/teaching-types'
import type {
  SkillOrchestrationInput,
  SkillOrchestrationMode,
  SkillOrchestrationPlan,
  SkillOrchestrationReadiness
} from '../shared/teaching-types/skill-orchestration'

const CORE_KERNEL_ID = 'teach' as const

const ARTIFACT_ROLE_HINTS = new Set([
  'workflow_router',
  'artifact_producer',
  'cross_cutting_enhancer',
  'verifier',
  'variant_producer',
  'packager'
])

function normalizeId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLocaleLowerCase()
}

/**
 * Resolve orchestration mode for the host.
 * Artifact-oriented selections win over teaching_turn so course/site workflows
 * do not inherit formal learner-outcome teaching mode (solution §6.1).
 */
export function resolveHostSkillOrchestrationMode(input: {
  isTeachingConversation: boolean
  conversationMode: string
  selectedSkillIds: string[]
  preferArtifactProfile?: boolean
}): SkillOrchestrationMode {
  const selected = [...new Set(input.selectedSkillIds.map(normalizeId).filter(Boolean))]
  if (input.preferArtifactProfile) {
    return 'artifact_workflow'
  }
  for (const id of selected) {
    const policy = getBuiltinSkillOrchestrationPolicy(id)
    if (!policy) continue
    if (ARTIFACT_ROLE_HINTS.has(policy.role)) {
      return 'artifact_workflow'
    }
  }
  if (input.isTeachingConversation || input.conversationMode === 'teaching') {
    return 'teaching_turn'
  }
  return 'instant_help'
}

/**
 * Stable allow-listed context identity for planId (no secrets).
 */
export function buildSkillOrchestrationContextIdentity(input: {
  conversationId?: string
  workspaceId?: string
  mode: string
}): string {
  const parts = [
    String(input.mode ?? ''),
    String(input.workspaceId ?? ''),
    String(input.conversationId ?? '')
  ]
  let hash = 0x811c9dc5
  const payload = parts.join('\u001f')
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return `ctx:${hex}`
}

/** Cap objective text for plan input / planId stability. */
export function sanitizeOrchestrationObjective(raw: string, maxLen = 240): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/** Allow-listed enum-like token (snake_case / alnum underscore only). */
export function sanitizeAuthorityToken(raw: string | undefined, maxLen = 64): string | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLocaleLowerCase()
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) return undefined
  return value.slice(0, maxLen) || undefined
}

/** @deprecated Prefer sanitizeAuthorityToken — same allow-list for next-step action. */
export function sanitizeNextStepAction(raw: string | undefined, maxLen = 120): string | undefined {
  return sanitizeAuthorityToken(raw, Math.min(maxLen, 64))
}

/**
 * Allow-listed artifact type names only (e.g. CourseOutline).
 * Rejects paths and free-form prose.
 */
export function sanitizeAvailableArtifacts(raw: string[] | undefined, maxItems = 16): string[] {
  if (!raw?.length) return []
  const out: string[] = []
  for (const item of raw) {
    const token = String(item ?? '').trim()
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)) continue
    out.push(token)
    if (out.length >= maxItems) break
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b))
}

/**
 * Build readiness from skill catalog facts.
 * - Kernel `teach`: always trusted + ready (body load is separate fail-closed path).
 * - Host builtins: ready only when catalog marks installed (personal install) and policy exists.
 * - Unknown ids: not ready / not trusted (planner fail-closes).
 * Also includes auto-schedulable requires so dependency expansion sees real install state.
 */
export function buildSkillOrchestrationReadinessFromCatalog(input: {
  selectedSkillIds: string[]
  catalogSkills?: readonly Pick<SkillSummary, 'id' | 'installed' | 'source'>[]
}): SkillOrchestrationReadiness[] {
  const selected = [...new Set(input.selectedSkillIds.map(normalizeId).filter(Boolean))]
  const byId = new Map(
    (input.catalogSkills ?? []).map((skill) => [normalizeId(skill.id), skill] as const)
  )

  const ids = new Set(selected)
  for (const id of selected) {
    const policy = getBuiltinSkillOrchestrationPolicy(id)
    if (!policy) continue
    for (const dep of policy.requires) {
      const depId = normalizeId(dep)
      if (depId) ids.add(depId)
    }
  }
  ids.add(CORE_KERNEL_ID)

  return [...ids]
    .sort((a, b) => a.localeCompare(b))
    .map((skillId) => {
      if (skillId === CORE_KERNEL_ID) {
        return {
          skillId,
          installed: true,
          trustedBuiltin: true,
          ready: true
        }
      }
      const policy = getBuiltinSkillOrchestrationPolicy(skillId)
      const catalog = byId.get(skillId)
      const installed = Boolean(catalog?.installed)
      const trustedBuiltin = policy !== null
      const catalogAvailable = (input.catalogSkills?.length ?? 0) > 0
      const ready = trustedBuiltin && (catalogAvailable ? installed : true)
      return {
        skillId,
        installed: catalogAvailable ? installed : trustedBuiltin,
        trustedBuiltin,
        ready
      }
    })
}

/**
 * Merge explicit payload skillIds with leading slash sequence before plan().
 * Order: explicit ids first (stable), then slash-inferred ids not already present.
 */
export function mergeSelectedSkillIds(input: {
  explicitSkillIds?: string[]
  userInput: string
  catalogSkills?: readonly Pick<SkillSummary, 'id' | 'installed'>[]
}): string[] {
  const explicit = [
    ...new Set((input.explicitSkillIds ?? []).map(normalizeId).filter(Boolean))
  ]
  const catalog = input.catalogSkills ?? []
  if (!catalog.length) return explicit
  const asSummaries: SkillSummary[] = catalog.map((skill) => ({
    id: skill.id,
    name: skill.id,
    description: '',
    category: 'other',
    icon: 'sparkles',
    author: 'builtin',
    command: `/${skill.id}`,
    source: 'builtin',
    installed: Boolean(skill.installed)
  }))
  const inferred = leadingSkillIdSequence(input.userInput, asSummaries).map(normalizeId)
  const seen = new Set(explicit)
  const merged = [...explicit]
  for (const id of inferred) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}

/**
 * Skill ids whose full bodies may be loaded for this turn (ADR-0151 §3.1):
 * - `active_now`
 * - kernel `advisory_only` (instant_help)
 * - teaching conversation always includes `teach`
 * - non-kernel `advisory_only` / later / blocked / excluded → no full body
 */
export function skillIdsForBodyLoad(input: {
  plan: SkillOrchestrationPlan
  isTeachingConversation: boolean
}): string[] {
  const allowed = new Set<string>()
  for (const d of input.plan.decisions) {
    const id = normalizeId(d.skillId)
    if (!id) continue
    if (d.status === 'active_now') {
      allowed.add(id)
      continue
    }
    if (d.status === 'advisory_only' && id === CORE_KERNEL_ID) {
      allowed.add(id)
    }
  }
  if (input.isTeachingConversation) {
    allowed.add(CORE_KERNEL_ID)
  }
  if (
    input.plan.mode === 'teaching_turn' ||
    (input.plan.mode === 'artifact_workflow' &&
      input.plan.decisions.some((d) => normalizeId(d.skillId) === CORE_KERNEL_ID && d.status === 'active_now'))
  ) {
    allowed.add(CORE_KERNEL_ID)
  }
  return [...allowed]
}

/**
 * Keep stage-appropriate full bodies only.
 * Temporary slash-inferred refs with no plan row are kept on non-teaching paths.
 */
export function filterSkillReferencesToActiveBodies(input: {
  references: InstalledSkillReference[]
  plan: SkillOrchestrationPlan
  isTeachingConversation: boolean
}): InstalledSkillReference[] {
  const allowed = new Set(
    skillIdsForBodyLoad({
      plan: input.plan,
      isTeachingConversation: input.isTeachingConversation
    })
  )
  const byId = new Map(input.plan.decisions.map((d) => [normalizeId(d.skillId), d]))
  return input.references.filter((ref) => {
    const id = normalizeId(ref.id)
    if (allowed.has(id)) return true
    const decision = byId.get(id)
    if (!decision) {
      return !input.isTeachingConversation
    }
    return false
  })
}

/** Assemble pure planner input from host turn facts. */
export function buildSkillOrchestrationPlanInput(input: {
  selectedSkillIds: string[]
  mode: SkillOrchestrationMode
  objective: string
  contextIdentity: string
  readiness: SkillOrchestrationReadiness[]
  nextStepAction?: string
  nextStepReason?: string
  resourceReadiness?: string
  evidenceStatus?: string
  availableArtifacts?: string[]
  budgetConstrained?: boolean
  preferArtifactProfile?: boolean
}): SkillOrchestrationInput {
  const nextStepAction = sanitizeAuthorityToken(input.nextStepAction)
  const nextStepReason = sanitizeAuthorityToken(input.nextStepReason)
  const resourceReadiness = sanitizeAuthorityToken(input.resourceReadiness)
  const evidenceStatus = sanitizeAuthorityToken(input.evidenceStatus)
  const availableArtifacts = sanitizeAvailableArtifacts(input.availableArtifacts)
  return {
    selectedSkillIds: input.selectedSkillIds,
    mode: input.mode,
    objective: sanitizeOrchestrationObjective(input.objective),
    contextIdentity: input.contextIdentity,
    readiness: input.readiness,
    ...(nextStepAction ? { nextStepAction } : {}),
    ...(nextStepReason ? { nextStepReason } : {}),
    ...(resourceReadiness ? { resourceReadiness } : {}),
    ...(evidenceStatus ? { evidenceStatus } : {}),
    ...(availableArtifacts.length ? { availableArtifacts } : {}),
    ...(input.budgetConstrained ? { budgetConstrained: true } : {}),
    ...(input.preferArtifactProfile ? { preferArtifactProfile: true } : {})
  }
}

/**
 * Map Authority Plane next-step / loop projection into skill orchestration facts.
 * Fail-soft: missing fields simply omit echoes (never invents settlement).
 */
export function skillOrchestrationFactsFromAuthority(input: {
  nextStepAction?: string | null
  nextStepReason?: string | null
  resourceReadiness?: string | null
  evidenceStatus?: string | null
  availableArtifacts?: string[]
  budgetConstrained?: boolean
  preferArtifactProfile?: boolean
}): {
  nextStepAction?: string
  nextStepReason?: string
  resourceReadiness?: string
  evidenceStatus?: string
  availableArtifacts?: string[]
  budgetConstrained?: boolean
  preferArtifactProfile?: boolean
} {
  const nextStepAction = sanitizeAuthorityToken(input.nextStepAction ?? undefined)
  const nextStepReason = sanitizeAuthorityToken(input.nextStepReason ?? undefined)
  const resourceReadiness = sanitizeAuthorityToken(input.resourceReadiness ?? undefined)
  const evidenceStatus = sanitizeAuthorityToken(input.evidenceStatus ?? undefined)
  const availableArtifacts = sanitizeAvailableArtifacts(input.availableArtifacts)
  return {
    ...(nextStepAction ? { nextStepAction } : {}),
    ...(nextStepReason ? { nextStepReason } : {}),
    ...(resourceReadiness ? { resourceReadiness } : {}),
    ...(evidenceStatus ? { evidenceStatus } : {}),
    ...(availableArtifacts.length ? { availableArtifacts } : {}),
    ...(input.budgetConstrained ? { budgetConstrained: true } : {}),
    ...(input.preferArtifactProfile ? { preferArtifactProfile: true } : {})
  }
}
