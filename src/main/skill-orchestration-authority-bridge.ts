/**
 * Fail-soft bridge: Teaching Authority Plane (loop snapshot) → skill orchestration facts.
 * Read-only; never writes settlement / Evidence / ledger.
 */

import { createLearningSessionLedger } from './learning-session-ledger'
import { loadTeachingLoopFactSource } from './teaching-loop-fact-source'
import { skillOrchestrationFactsFromAuthority } from './skill-orchestration-host'
import { readMissionSummary } from './teaching-workspace/learning-assets-catalog'

export type SkillOrchestrationAuthorityFacts = ReturnType<typeof skillOrchestrationFactsFromAuthority>

/**
 * Best-effort load of allow-listed loop echoes for a teaching workspace chat turn.
 * Returns empty object when workspace root is missing or any durable read fails.
 */
export async function loadSkillOrchestrationAuthorityFactsForWorkspace(
  workspaceRoot: string | null | undefined
): Promise<SkillOrchestrationAuthorityFacts> {
  const root = String(workspaceRoot ?? '').trim()
  if (!root) return {}

  try {
    // Warm workspace mission read for side-effect-free path presence; body never enters plan.
    await readMissionSummary(root, 'workspace')
    const ledger = createLearningSessionLedger({ workspaceRoot: root })
    const loaded = await loadTeachingLoopFactSource(
      {
        ledger,
        workspaceRoot: root
      },
      {
        mission: {
          // Stable allow-listed id only — never mission body text.
          id: 'mission',
          nextGoal: 'unknown'
        },
        course: { id: 'course' },
        resources: {
          readiness: 'unknown',
          availableCount: 0,
          provenanceIds: []
        }
      }
    )

    const next = loaded.snapshot.nextStep
    const safe = loaded.snapshot.safeProjection
    return skillOrchestrationFactsFromAuthority({
      nextStepAction: next?.action,
      nextStepReason: next?.reason,
      resourceReadiness: safe.resources?.readiness,
      evidenceStatus: safe.evidence?.status
    })
  } catch {
    return {}
  }
}

