/**
 * Pure host-policy cardinality resolver for orchestration roles.
 *
 * This module deliberately has no registry lookup, I/O, prompt assembly, or
 * settlement authority. The planner provides already-admitted active
 * candidates and applies the returned exclusions to its rebuildable plan.
 */

import type { BuiltinSkillOrchestrationEntry } from './builtin-skill-orchestration-policy'
import type { SkillOrchestrationMode, SkillOrchestrationStageKind } from '../shared/teaching-types/skill-orchestration'

export type ActiveCardinalityCandidate = {
  skillId: string
  policy: Pick<
    BuiltinSkillOrchestrationEntry,
    'role' | 'stages' | 'priority' | 'admission'
  >
  userSelected: boolean
}

export type CardinalityExclusion = {
  skillId: string
  winnerSkillId: string
  stage: SkillOrchestrationStageKind
  exclusiveGroup: string
  reason: string
}

/**
 * Enforce host-owned exclusive slot limits among candidates that have already
 * passed product/mode/readiness classification. Winner order is deterministic:
 * authoritative next-step affinity, explicit user/preset selection, host
 * priority, then skill id. Product hard boundaries and mode eligibility happen
 * before this resolver, so they always take precedence.
 */
export function resolveActiveRoleCardinality(input: {
  candidates: readonly ActiveCardinalityCandidate[]
  mode: SkillOrchestrationMode
  nextStepAction?: string
}): CardinalityExclusion[] {
  const nextStepAction = String(input.nextStepAction ?? '').trim().toLocaleLowerCase()
  const buckets = new Map<string, ActiveCardinalityCandidate[]>()

  for (const candidate of input.candidates) {
    const admission = candidate.policy.admission
    const group = admission.exclusiveGroup
    const maxActivePerStage = admission.maxActivePerStage
    if (!group || !maxActivePerStage || maxActivePerStage < 1) continue
    if (!admission.allowedModes.includes(input.mode)) continue

    for (const stage of candidate.policy.stages) {
      const key = `${group}\u0000${stage}`
      const bucket = buckets.get(key) ?? []
      bucket.push(candidate)
      buckets.set(key, bucket)
    }
  }

  const excluded = new Map<string, CardinalityExclusion>()
  for (const [key, bucket] of buckets) {
    const [exclusiveGroup, stage] = key.split('\u0000') as [string, SkillOrchestrationStageKind]
    const limit = Math.min(...bucket.map((candidate) => candidate.policy.admission.maxActivePerStage ?? 1))
    if (bucket.length <= limit) continue

    const sorted = [...bucket].sort((a, b) => {
      const aNextStepMatch = a.policy.admission.preferredNextStepActions?.includes(nextStepAction) ? 1 : 0
      const bNextStepMatch = b.policy.admission.preferredNextStepActions?.includes(nextStepAction) ? 1 : 0
      return (
        bNextStepMatch - aNextStepMatch ||
        Number(b.userSelected) - Number(a.userSelected) ||
        b.policy.priority - a.policy.priority ||
        a.skillId.localeCompare(b.skillId)
      )
    })
    const winner = sorted[0]!
    for (const loser of sorted.slice(limit)) {
      // A global decision cannot safely be active for only some body stages.
      // Excluding the candidate entirely is conservative and preserves the
      // current stage-scoped prompt contract.
      if (excluded.has(loser.skillId)) continue
      excluded.set(loser.skillId, {
        skillId: loser.skillId,
        winnerSkillId: winner.skillId,
        stage,
        exclusiveGroup,
        reason:
          `Excluded from ${exclusiveGroup} at stage "${stage}"; ` +
          `"${winner.skillId}" wins by authoritative next-step affinity, explicit selection, host priority, then stable id.`
      })
    }
  }

  return [...excluded.values()].sort((a, b) => a.skillId.localeCompare(b.skillId))
}
