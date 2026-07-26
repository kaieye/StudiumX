/**
 * Fail-soft bridge: Teaching Authority Plane (loop snapshot) → skill orchestration facts.
 * Read-only; never writes settlement / Evidence / ledger.
 *
 * ADR-0151 §5.0 + ADR-0154/0156: the bridge derives *real* allow-listed facts
 * (mission goal readiness, resource readiness, due-review count, available
 * artifacts) from bounded durable reads instead of placeholder seeds, so the
 * pure planner's producer/review branches stop sleeping on the chat path.
 * Fact bodies never enter the plan — enums, counts, and artifact tokens only.
 */

import { readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { createLearningSessionLedger } from './learning-session-ledger'
import { loadTeachingLoopFactSource } from './teaching-loop-fact-source'
import { skillOrchestrationFactsFromAuthority } from './skill-orchestration-host'
import { deriveWorkspaceArtifactFacts } from './skill-orchestration-artifact-facts'
import { deriveReviewScheduleFromScan } from './review-schedule-facts'
import type { TeachingLoopMissionInput, TeachingLoopResourceInput } from './teaching-loop-facts'

export type SkillOrchestrationAuthorityFacts = ReturnType<typeof skillOrchestrationFactsFromAuthority>

const MAX_DURABLE_TEXT_BYTES = 256 * 1024
const MISSION_FILE = 'MISSION.md'
const RESOURCES_FILE = 'RESOURCES.md'

/**
 * Best-effort load of allow-listed loop echoes for a teaching workspace chat turn.
 * Returns empty object when workspace root is missing or any durable read fails.
 */
export async function loadSkillOrchestrationAuthorityFactsForWorkspace(
  workspaceRoot: string | null | undefined,
  options?: { now?: string }
): Promise<SkillOrchestrationAuthorityFacts> {
  const root = String(workspaceRoot ?? '').trim()
  if (!root) return {}

  try {
    const [mission, resources, availableArtifacts] = await Promise.all([
      readMissionGoalFacts(root),
      readResourceFacts(root),
      deriveWorkspaceArtifactFacts(root)
    ])

    const ledger = createLearningSessionLedger({ workspaceRoot: root })
    const scan = await ledger.scan({})
    const now = options?.now ?? new Date().toISOString()
    const reviewSchedule = deriveReviewScheduleFromScan({ scan: { canonicalSessions: scan.canonicalSessions }, now })

    const loaded = await loadTeachingLoopFactSource(
      {
        // Reuse the completed scan — never a second catalog walk.
        ledger: { scan: async () => scan },
        workspaceRoot: root
      },
      {
        mission,
        course: { id: 'course' },
        resources,
        ...(reviewSchedule.dueCount > 0 ? { review: { dueCount: reviewSchedule.dueCount } } : {})
      }
    )

    const next = loaded.snapshot.nextStep
    const safe = loaded.snapshot.safeProjection
    return skillOrchestrationFactsFromAuthority({
      nextStepAction: next?.action,
      nextStepReason: next?.reason,
      resourceReadiness: safe.resources?.readiness,
      evidenceStatus: safe.evidence?.status,
      ...(availableArtifacts.length ? { availableArtifacts } : {})
    })
  } catch {
    return {}
  }
}

/**
 * Mission goal readiness from a bounded MISSION.md read. Presence of real
 * content → 'available'; missing/empty → 'absent'. Body text never leaves
 * this function — only the allow-listed enum does.
 */
async function readMissionGoalFacts(root: string): Promise<TeachingLoopMissionInput> {
  const content = await readBoundedTextFile(join(root, MISSION_FILE))
  const nextGoal = content !== null && content.trim().length > 0 ? 'available' : 'absent'
  return {
    // Stable allow-listed id only — never mission body text.
    id: 'mission',
    nextGoal
  }
}

/**
 * Resource readiness from a bounded RESOURCES.md read: counts top-level list
 * bullets the same way the learning-assets catalog does. At least one bullet →
 * 'ready'; a present-but-empty (or missing) file → 'not_ready'.
 */
async function readResourceFacts(root: string): Promise<TeachingLoopResourceInput> {
  const content = await readBoundedTextFile(join(root, RESOURCES_FILE))
  if (content === null) {
    return { readiness: 'not_ready', availableCount: 0, provenanceIds: [] }
  }
  let count = 0
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('- ') && line.slice(2).trim().length > 0) count += 1
  }
  return {
    readiness: count > 0 ? 'ready' : 'not_ready',
    availableCount: count,
    provenanceIds: []
  }
}

/** Bounded, symlink-refusing text read; null on any failure (fail-soft). */
async function readBoundedTextFile(absolutePath: string): Promise<string | null> {
  try {
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_DURABLE_TEXT_BYTES) return null
    return await readFile(absolutePath, 'utf8')
  } catch {
    return null
  }
}
