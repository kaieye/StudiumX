import type {
  LearningOutcomeKind,
  LearningSessionScanResult,
  LearningSessionSnapshot
} from '../shared/teaching-types/learning-session'
import type {
  NextTeachingStepDurableOutcome,
  NextTeachingStepEvidenceStatus,
  NextTeachingStepResourceReadiness
} from '../shared/teaching-types/next-teaching-step'
import type {
  TeachingLoopFacts,
  TeachingLoopIntegrityCode
} from '../shared/teaching-types/teaching-loop'

export type TeachingLoopMissionInput = {
  id: string
  nextGoal: TeachingLoopFacts['mission']['nextGoal']
}

export type TeachingLoopCourseInput = {
  id: string
}

export type TeachingLoopResourceInput = {
  readiness: NextTeachingStepResourceReadiness
  availableCount: number
  provenanceIds: readonly string[]
}

/**
 * Optional no-record settlement marker (needs_practice / not_evidenced).
 * Terminal established/misconception_corrected outcomes live on session.outcomeRef.
 * Paths, digests, and operation ids are intentionally not projected.
 */
export type TeachingLoopSettlementInput = {
  sessionId: string
  outcomeId: string
  kind: LearningOutcomeKind
  evidenceEventIds: readonly string[]
}

/**
 * Already-read durable inputs only. This normalizer never opens files, writes
 * status, or talks to IPC. Callers own Mission/session/resource filesystem reads.
 */
export type TeachingLoopFactSource = {
  mission: TeachingLoopMissionInput
  course: TeachingLoopCourseInput
  sessions: LearningSessionScanResult
  resources: TeachingLoopResourceInput
  /**
   * Settlement for the selected session only, when callers already read
   * outcome-settlement.json. Unknown/invalid markers must be omitted by the caller
   * and reported via integrity instead.
   */
  settlement?: TeachingLoopSettlementInput | null
  /**
   * When set, project facts for this session only (command-scoped / explicit
   * sessionId). When omitted, prefer most recently updated canonical session
   * (scan-latest). Settlement must target the same selected session.
   */
  selectedSessionId?: string
  /** Optional spaced-review facts (ADR-0154). Callers own derivation; count only. */
  review?: {
    dueCount: number
  }
}

/**
 * Projects durable ledger/scan facts into the pure TeachingLoopFacts shape.
 *
 * Session selection:
 * - selectedSessionId present: bind that exact session from the scan (fail-closed
 *   to null when absent — never silently fall back to scan-latest).
 * - selectedSessionId absent: prefer most recently updated canonical session,
 *   then fall back to id order for ties; legacy only when no canonical exists.
 */
export function buildTeachingLoopFacts(source: TeachingLoopFactSource): TeachingLoopFacts {
  const integrityCodes = integrityFromScan(source.sessions)
  const latestSession = source.selectedSessionId
    ? selectScopedSession(source.sessions, source.selectedSessionId)
    : selectLatestSession(source.sessions)
  const { durableOutcome, evidence, outcomeIntegrity } = projectOutcome(latestSession, source.settlement ?? null)

  return {
    mission: {
      id: source.mission.id,
      nextGoal: source.mission.nextGoal
    },
    course: {
      id: source.course.id
    },
    latestSession: latestSession
      ? {
          id: latestSession.id,
          source: latestSession.source,
          readOnly: latestSession.readOnly,
          status: latestSession.status,
          eventCount: latestSession.eventCount
        }
      : null,
    durableOutcome,
    evidence,
    resources: {
      readiness: source.resources.readiness,
      availableCount: source.resources.availableCount,
      provenanceIds: [...source.resources.provenanceIds]
    },
    ...(source.review ? { review: { dueCount: source.review.dueCount } } : {}),
    integrity: {
      codes: stableCodes([...integrityCodes, ...outcomeIntegrity])
    }
  }
}

function selectScopedSession(
  scan: LearningSessionScanResult,
  sessionId: string
): LearningSessionSnapshot | null {
  const canonical = scan.canonicalSessions.find((session) => session.id === sessionId)
  if (canonical) return canonical
  const legacy = scan.legacySessions.find((session) => session.id === sessionId)
  if (legacy) return legacy
  // Prefer typed partitions; fall back to full sessions list for partial scans.
  return scan.sessions.find((session) => session.id === sessionId) ?? null
}

function selectLatestSession(scan: LearningSessionScanResult): LearningSessionSnapshot | null {
  if (scan.canonicalSessions.length > 0) {
    return [...scan.canonicalSessions].sort(compareSessionsDesc)[0] ?? null
  }
  if (scan.legacySessions.length > 0) {
    return [...scan.legacySessions].sort(compareSessionsDesc)[0] ?? null
  }
  return null
}

function compareSessionsDesc(left: LearningSessionSnapshot, right: LearningSessionSnapshot): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }
  return right.id.localeCompare(left.id)
}

function integrityFromScan(scan: LearningSessionScanResult): TeachingLoopIntegrityCode[] {
  const codes: TeachingLoopIntegrityCode[] = []
  if (scan.diagnostics.length > 0) codes.push('session_scan_diagnostics')
  if (scan.quarantined.length > 0) codes.push('session_quarantined')
  for (const diagnostic of scan.diagnostics) {
    if (diagnostic.code === 'invalid_session_outcome') codes.push('outcome_review_required')
    if (diagnostic.code === 'unknown_session_schema') codes.push('outcome_unknown_schema')
  }
  return codes
}

function projectOutcome(
  session: LearningSessionSnapshot | null,
  settlement: TeachingLoopSettlementInput | null
): {
  durableOutcome: NextTeachingStepDurableOutcome
  evidence: { status: NextTeachingStepEvidenceStatus }
  outcomeIntegrity: TeachingLoopIntegrityCode[]
} {
  if (!session || session.source === 'legacy_lesson') {
    return {
      durableOutcome: { status: 'absent' },
      evidence: { status: 'unavailable' },
      outcomeIntegrity: []
    }
  }

  if (session.status === 'completed' && !session.outcomeRef) {
    return {
      durableOutcome: { status: 'absent' },
      evidence: { status: 'unavailable' },
      outcomeIntegrity: ['missing_completed_outcome']
    }
  }

  if (session.outcomeRef) {
    // Ledger load/scan already validates outcome envelope digests when present.
    return {
      durableOutcome: {
        status: 'trusted',
        id: session.outcomeRef.outcomeId,
        kind: session.outcomeRef.kind,
        evidenceEventIds: session.outcomeRef.evidenceEventIds
      },
      evidence: { status: 'verified' },
      outcomeIntegrity: []
    }
  }

  if (settlement) {
    if (settlement.sessionId !== session.id) {
      return {
        durableOutcome: { status: 'review_required' },
        evidence: { status: 'review_required' },
        outcomeIntegrity: ['outcome_review_required']
      }
    }
    return {
      durableOutcome: {
        status: 'trusted',
        id: settlement.outcomeId,
        kind: settlement.kind,
        evidenceEventIds: [...settlement.evidenceEventIds]
      },
      // Settlement markers for needs_practice/not_evidenced are durable enough for
      // planner recommendations, but they are not terminal completion envelopes.
      evidence: { status: settlement.kind === 'not_evidenced' ? 'not_evidenced' : 'verified' },
      outcomeIntegrity: []
    }
  }

  return {
    durableOutcome: { status: 'absent' },
    evidence: { status: 'unavailable' },
    outcomeIntegrity: []
  }
}

function stableCodes(codes: readonly TeachingLoopIntegrityCode[]): TeachingLoopIntegrityCode[] {
  return [...new Set(codes)].sort()
}
