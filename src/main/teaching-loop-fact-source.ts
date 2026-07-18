/**
 * Read-only adapters that project existing durable modules into TeachingLoopFactSource.
 *
 * No second truth: ledger scan, settlement markers, and caller-supplied mission /
 * course / resource readiness remain the only inputs. This module never writes,
 * never plans, and never duplicates resolver logic.
 */

import { readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'

import type { LearningSessionLedger } from './learning-session-ledger'
import type { LearningOutcomeCommitter, OutcomeSettlementMarker } from './learning-outcome-committer'
import {
  buildTeachingLoopFacts,
  type TeachingLoopCourseInput,
  type TeachingLoopFactSource,
  type TeachingLoopMissionInput,
  type TeachingLoopResourceInput,
  type TeachingLoopSettlementInput
} from './teaching-loop-facts'
import type { TeachingLoopFacts } from '../shared/teaching-types/teaching-loop'
import { resolveTeachingLoop } from './teaching-loop-resolver'
import type { TeachingLoopSnapshot } from '../shared/teaching-types/teaching-loop'
import {
  LEARNING_SESSIONS_ROOT_RELATIVE_PATH,
  requireLearningSessionId,
  requireSafeTeachingRelativePath
} from '../shared/teaching-placement'

const OUTCOME_SETTLEMENT_FILE = 'outcome-settlement.json'

export type TeachingLoopFactSourceLoaderInput = {
  mission: TeachingLoopMissionInput
  course: TeachingLoopCourseInput
  resources: TeachingLoopResourceInput
  /**
   * Prefer loading settlement for this session. When omitted, settlement is loaded
   * for the selected latest canonical session after scan (if any).
   */
  sessionId?: string
}

export type TeachingLoopFactSourcePorts = {
  /** Existing ledger scan only — never a second catalog. */
  ledger: Pick<LearningSessionLedger, 'scan'>
  /**
   * Optional settlement reader. Defaults to a bounded filesystem read of
   * outcome-settlement.json under the session directory (read-only).
   */
  loadSettlement?: (sessionId: string) => Promise<TeachingLoopSettlementInput | null>
  /**
   * Optional committer reconcile used only as a read path when loadSettlement is
   * not provided and a committer is available. Never calls commit/evaluate.
   */
  committer?: Pick<LearningOutcomeCommitter, 'reconcile'>
  workspaceRoot?: string
}

export type LoadedTeachingLoopFactSource = {
  source: TeachingLoopFactSource
  facts: TeachingLoopFacts
  snapshot: TeachingLoopSnapshot
}

/**
 * Load a TeachingLoopFactSource from real durable modules, then project pure
 * facts + resolver snapshot. Pure projection only — no writes.
 */
export async function loadTeachingLoopFactSource(
  ports: TeachingLoopFactSourcePorts,
  input: TeachingLoopFactSourceLoaderInput
): Promise<LoadedTeachingLoopFactSource> {
  const sessions = await ports.ledger.scan({})
  const settlementSessionId =
    input.sessionId ??
    selectPreferredSessionId(sessions.canonicalSessions.map((session) => ({
      id: session.id,
      updatedAt: session.updatedAt
    })))

  let settlement: TeachingLoopSettlementInput | null = null
  if (settlementSessionId) {
    settlement = await resolveSettlement(ports, settlementSessionId)
  }

  const source: TeachingLoopFactSource = {
    mission: input.mission,
    course: input.course,
    sessions,
    resources: {
      readiness: input.resources.readiness,
      availableCount: input.resources.availableCount,
      provenanceIds: [...input.resources.provenanceIds]
    },
    settlement
  }

  const facts = buildTeachingLoopFacts(source)
  const snapshot = resolveTeachingLoop(facts)
  return { source, facts, snapshot }
}

/**
 * Project an already-loaded TeachingLoopFactSource without I/O.
 */
export function projectTeachingLoopFactSource(source: TeachingLoopFactSource): LoadedTeachingLoopFactSource {
  const facts = buildTeachingLoopFacts(source)
  const snapshot = resolveTeachingLoop(facts)
  return { source, facts, snapshot }
}

/**
 * Read-only settlement adapter from LearningOutcomeCommitter.reconcile.
 * Invalid/review_required markers become null (caller may still see integrity
 * via session scan diagnostics).
 */
export async function settlementFromCommitter(
  committer: Pick<LearningOutcomeCommitter, 'reconcile'>,
  sessionId: string
): Promise<TeachingLoopSettlementInput | null> {
  const reconciliation = await committer.reconcile(sessionId)
  if (!reconciliation.marker) return null
  if (reconciliation.state === 'review_required') return null
  return settlementFromMarker(reconciliation.marker)
}

/**
 * Bounded read of outcome-settlement.json for a session. Never writes, never
 * follows symlinks, and never invents settlement when the marker is invalid.
 */
export async function readSettlementMarkerFromFilesystem(
  workspaceRoot: string,
  sessionId: string
): Promise<TeachingLoopSettlementInput | null> {
  const safeSessionId = requireLearningSessionId(sessionId)
  const relativePath = requireSafeTeachingRelativePath(
    `${LEARNING_SESSIONS_ROOT_RELATIVE_PATH}/${safeSessionId}/${OUTCOME_SETTLEMENT_FILE}`,
    'Outcome settlement marker'
  )
  const absolutePath = join(workspaceRoot, relativePath)
  const info = await lstat(absolutePath).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isFile()) return null
  if (info.size > 64 * 1024) return null

  const content = await readFile(absolutePath, 'utf8').catch(() => null)
  if (content === null) return null

  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (record.schemaVersion !== 1) return null
    if (record.sessionId !== safeSessionId) return null
    if (typeof record.outcomeId !== 'string' || !SETTLEMENT_ID_PATTERN.test(record.outcomeId)) return null
    if (!isLearningOutcomeKind(record.kind)) return null
    if (!Array.isArray(record.evidenceEventIds)) return null
    const evidenceEventIds: string[] = []
    for (const id of record.evidenceEventIds) {
      // Reject the entire marker when any evidence id is missing or malformed.
      if (typeof id !== 'string' || !SETTLEMENT_ID_PATTERN.test(id)) return null
      evidenceEventIds.push(id)
    }
    return {
      sessionId: safeSessionId,
      outcomeId: record.outcomeId,
      kind: record.kind,
      evidenceEventIds
    }
  } catch {
    return null
  }
}

export function settlementFromMarker(marker: OutcomeSettlementMarker): TeachingLoopSettlementInput {
  return {
    sessionId: marker.sessionId,
    outcomeId: marker.outcomeId,
    kind: marker.kind,
    evidenceEventIds: [...marker.evidenceEventIds]
  }
}

async function resolveSettlement(
  ports: TeachingLoopFactSourcePorts,
  sessionId: string
): Promise<TeachingLoopSettlementInput | null> {
  if (ports.loadSettlement) {
    return ports.loadSettlement(sessionId)
  }
  if (ports.committer) {
    return settlementFromCommitter(ports.committer, sessionId)
  }
  if (ports.workspaceRoot) {
    return readSettlementMarkerFromFilesystem(ports.workspaceRoot, sessionId)
  }
  return null
}


const SETTLEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const LEARNING_OUTCOME_KINDS = new Set<TeachingLoopSettlementInput['kind']>([
  'established',
  'misconception_corrected',
  'needs_practice',
  'not_evidenced'
])

function isLearningOutcomeKind(value: unknown): value is TeachingLoopSettlementInput['kind'] {
  return typeof value === 'string' && LEARNING_OUTCOME_KINDS.has(value as TeachingLoopSettlementInput['kind'])
}

function selectPreferredSessionId(sessions: Array<{ id: string; updatedAt: string }>): string | null {
  if (sessions.length === 0) return null
  const sorted = [...sessions].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt)
    return right.id.localeCompare(left.id)
  })
  return sorted[0]?.id ?? null
}
