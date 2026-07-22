/**
 * Long-session Resume Picker (P2-2).
 *
 * Pure, read-only projection over an already-scanned LearningSession ledger
 * result. Callers own ledger.scan I/O; this module never reads the filesystem
 * and never projects raw event payloads or learner answers.
 */

import type { LearningSessionLedger } from './learning-session-ledger'
import type {
  LearningOutcomeKind,
  LearningSessionDiagnostic,
  LearningSessionScanInput,
  LearningSessionScanResult,
  LearningSessionSnapshot,
  LearningSessionStatus
} from '../shared/teaching-types/learning-session'
import {
  SESSION_RESUME_PICKER_SCHEMA_VERSION,
  type ResumeCandidate,
  type ResumeEligibility,
  type ResumePickerDiagnostics,
  type ResumePickerQuery,
  type ResumePickerReport
} from '../shared/teaching-types/session-resume-picker'

export const DEFAULT_RESUME_PICKER_LIMIT = 20
export const MAX_RESUME_PICKER_LIMIT = 100

/** Ranking tiers — lower is better (active/recent before completed/legacy). */
const ELIGIBILITY_RANK: Record<ResumeEligibility, number> = {
  ready: 0,
  completed_read_only: 1,
  legacy_read_only: 2,
  quarantined: 3,
  corrupt: 4
}

const CORRUPT_DIAGNOSTIC_CODES = new Set([
  'invalid_session_manifest',
  'invalid_session_event',
  'invalid_session_outcome',
  'unknown_session_schema',
  'event_sequence_conflict'
])

export type BuildSessionResumeCandidatesOptions = {
  /** Injected clock for deterministic reports in tests. */
  now?: () => string
}

/**
 * Pure builder: rank and filter durable scan results into resume candidates.
 * Does not mutate `scan` and never reads event payloads.
 */
export function buildSessionResumeCandidates(
  scan: LearningSessionScanResult,
  query: ResumePickerQuery = {},
  options: BuildSessionResumeCandidatesOptions = {}
): ResumePickerReport {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))()
  const limit = normalizeLimit(query.limit)
  const statusFilter = normalizeStatusFilter(query.statusFilter)
  const courseId = normalizeOptionalText(query.courseId)
  const queryText = normalizeQueryText(query.queryText)

  const quarantineById = indexQuarantines(scan.quarantined)
  const sessionIds = new Set(scan.sessions.map((session) => session.id))

  const candidates: ResumeCandidate[] = []
  for (const session of scan.sessions) {
    const quarantine = quarantineById.get(session.id) ?? null
    candidates.push(projectSession(session, quarantine))
  }

  // Quarantined identities that never produced a loadable snapshot still appear.
  for (const entry of scan.quarantined) {
    if (sessionIds.has(entry.sessionId)) continue
    candidates.push(projectQuarantineOnly(entry.sessionId, entry.diagnostic))
  }

  const diagnosticsBase = countEligibility(candidates)
  const totalScanned = candidates.length

  const filtered = candidates.filter((candidate) => matchesQuery(candidate, courseId, statusFilter, queryText))
  filtered.sort(compareCandidates)

  const returned = filtered.slice(0, limit)
  const diagnostics: ResumePickerDiagnostics = {
    ...diagnosticsBase,
    matchedCount: filtered.length,
    returnedCount: returned.length,
    filteredOutCount: Math.max(0, totalScanned - filtered.length)
  }

  return {
    schemaVersion: SESSION_RESUME_PICKER_SCHEMA_VERSION,
    candidates: returned,
    totalScanned,
    generatedAt,
    diagnostics
  }
}

/**
 * Optional thin adapter: callers that already hold a ledger can scan + build
 * in one step. The pure builder remains the primary unit-testable surface.
 */
export async function listSessionResumeCandidates(
  ledger: Pick<LearningSessionLedger, 'scan'>,
  query: ResumePickerQuery = {},
  scanInput: LearningSessionScanInput = {},
  options: BuildSessionResumeCandidatesOptions = {}
): Promise<ResumePickerReport> {
  const scan = await ledger.scan(scanInput)
  return buildSessionResumeCandidates(scan, query, options)
}

function projectSession(
  session: LearningSessionSnapshot,
  quarantine: LearningSessionDiagnostic | null
): ResumeCandidate {
  if (quarantine) {
    const eligibility = classifyQuarantine(quarantine)
    return {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      status: session.status,
      source: session.source,
      courseId: session.courseRef.courseId,
      courseName: session.courseRef.courseName,
      lessonTitle: session.lessonRef?.title ?? null,
      eventCount: session.eventCount,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt,
      outcomeKind: outcomeKindOf(session),
      resumeEligibility: eligibility,
      reason: reasonForEligibility(eligibility, quarantine.message),
      rankScore: scoreCandidate(eligibility, session.updatedAt)
    }
  }

  if (session.source === 'legacy_lesson') {
    const eligibility: ResumeEligibility = 'legacy_read_only'
    return {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      status: session.status,
      source: session.source,
      courseId: session.courseRef.courseId,
      courseName: session.courseRef.courseName,
      lessonTitle: session.lessonRef?.title ?? null,
      eventCount: session.eventCount,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt,
      outcomeKind: null,
      resumeEligibility: eligibility,
      reason: reasonForEligibility(eligibility),
      rankScore: scoreCandidate(eligibility, session.updatedAt)
    }
  }

  if (session.status === 'completed') {
    const outcomeKind = outcomeKindOf(session)
    const trusted = outcomeKind !== null
    const eligibility: ResumeEligibility = 'completed_read_only'
    return {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      status: session.status,
      source: session.source,
      courseId: session.courseRef.courseId,
      courseName: session.courseRef.courseName,
      lessonTitle: session.lessonRef?.title ?? null,
      eventCount: session.eventCount,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt,
      outcomeKind,
      resumeEligibility: eligibility,
      reason: trusted
        ? reasonForEligibility(eligibility, `trusted outcome ${outcomeKind}`)
        : reasonForEligibility(eligibility, 'completed without trusted outcome'),
      rankScore: scoreCandidate(eligibility, session.updatedAt, trusted ? 0 : 1)
    }
  }

  // Active canonical sessions are the primary resume targets.
  const eligibility: ResumeEligibility = 'ready'
  return {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    status: session.status,
    source: session.source,
    courseId: session.courseRef.courseId,
    courseName: session.courseRef.courseName,
    lessonTitle: session.lessonRef?.title ?? null,
    eventCount: session.eventCount,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    outcomeKind: outcomeKindOf(session),
    resumeEligibility: eligibility,
    reason: reasonForEligibility(eligibility),
    rankScore: scoreCandidate(eligibility, session.updatedAt)
  }
}

function projectQuarantineOnly(sessionId: string, diagnostic: LearningSessionDiagnostic): ResumeCandidate {
  const eligibility = classifyQuarantine(diagnostic)
  return {
    sessionId,
    workspaceId: null,
    status: 'active',
    source: 'canonical',
    courseId: '',
    courseName: '',
    lessonTitle: null,
    eventCount: 0,
    updatedAt: '',
    completedAt: null,
    outcomeKind: null,
    resumeEligibility: eligibility,
    reason: reasonForEligibility(eligibility, diagnostic.message),
    rankScore: scoreCandidate(eligibility, '')
  }
}

function classifyQuarantine(diagnostic: LearningSessionDiagnostic): ResumeEligibility {
  if (CORRUPT_DIAGNOSTIC_CODES.has(diagnostic.code)) return 'corrupt'
  return 'quarantined'
}

function outcomeKindOf(session: LearningSessionSnapshot): LearningOutcomeKind | null {
  if (session.source !== 'canonical') return null
  return session.outcomeRef?.kind ?? null
}

function reasonForEligibility(eligibility: ResumeEligibility, detail?: string): string {
  const base = (() => {
    switch (eligibility) {
      case 'ready':
        return 'Active canonical session is eligible for resume'
      case 'completed_read_only':
        return 'Completed session is resume-visible as read-only'
      case 'legacy_read_only':
        return 'Legacy lesson projection is read-only and demoted'
      case 'quarantined':
        return 'Session identity is quarantined and demoted'
      case 'corrupt':
        return 'Session failed integrity checks and is demoted as corrupt'
    }
  })()
  if (!detail) return base
  const cleaned = detail.replace(/\s+/g, ' ').trim().slice(0, 160)
  return cleaned ? `${base}: ${cleaned}` : base
}

/**
 * rankScore = eligibilityTier * 1e15 - updatedAtMs + trustedPenalty
 * Lower scores rank first. Missing timestamps sort after dated peers in-tier.
 */
function scoreCandidate(eligibility: ResumeEligibility, updatedAt: string, trustedPenalty = 0): number {
  const tier = ELIGIBILITY_RANK[eligibility]
  const ms = Date.parse(updatedAt)
  const recency = Number.isFinite(ms) ? ms : 0
  return tier * 1_000_000_000_000_000 + trustedPenalty * 1_000_000_000_000 - recency
}

function compareCandidates(left: ResumeCandidate, right: ResumeCandidate): number {
  if (left.rankScore !== right.rankScore) return left.rankScore - right.rankScore
  // Stable tie-breakers: more recent updatedAt, then sessionId.
  const leftMs = Date.parse(left.updatedAt)
  const rightMs = Date.parse(right.updatedAt)
  const leftFinite = Number.isFinite(leftMs)
  const rightFinite = Number.isFinite(rightMs)
  if (leftFinite && rightFinite && leftMs !== rightMs) return rightMs - leftMs
  if (leftFinite !== rightFinite) return leftFinite ? -1 : 1
  return left.sessionId.localeCompare(right.sessionId)
}

function matchesQuery(
  candidate: ResumeCandidate,
  courseId: string | null,
  statusFilter: ReadonlySet<LearningSessionStatus> | null,
  queryText: string | null
): boolean {
  if (courseId && candidate.courseId !== courseId) return false
  if (statusFilter && !statusFilter.has(candidate.status)) return false
  if (queryText) {
    const haystack = `${candidate.courseName}\n${candidate.lessonTitle ?? ''}`.toLocaleLowerCase('en-US')
    if (!haystack.includes(queryText)) return false
  }
  return true
}

function countEligibility(candidates: readonly ResumeCandidate[]): Omit<
  ResumePickerDiagnostics,
  'matchedCount' | 'returnedCount' | 'filteredOutCount'
> {
  let activeCount = 0
  let completedCount = 0
  let legacyCount = 0
  let quarantinedCount = 0
  let corruptCount = 0
  let readyCount = 0
  let completedReadOnlyCount = 0

  for (const candidate of candidates) {
    if (candidate.status === 'active') activeCount += 1
    else if (candidate.status === 'completed') completedCount += 1
    else if (candidate.status === 'legacy_read_only') legacyCount += 1

    switch (candidate.resumeEligibility) {
      case 'ready':
        readyCount += 1
        break
      case 'completed_read_only':
        completedReadOnlyCount += 1
        break
      case 'legacy_read_only':
        // already counted via status; keep eligibility totals separate
        break
      case 'quarantined':
        quarantinedCount += 1
        break
      case 'corrupt':
        corruptCount += 1
        break
    }
  }

  // legacy_read_only eligibility may also appear on non-legacy status if readOnly,
  // so recount eligibility-based legacy demotions for accuracy.
  const legacyEligibilityCount = candidates.filter((c) => c.resumeEligibility === 'legacy_read_only').length

  return {
    activeCount,
    completedCount,
    legacyCount: Math.max(legacyCount, legacyEligibilityCount),
    quarantinedCount,
    corruptCount,
    readyCount,
    completedReadOnlyCount
  }
}

function indexQuarantines(
  quarantined: LearningSessionScanResult['quarantined']
): Map<string, LearningSessionDiagnostic> {
  const map = new Map<string, LearningSessionDiagnostic>()
  for (const entry of quarantined) {
    if (!map.has(entry.sessionId)) map.set(entry.sessionId, entry.diagnostic)
  }
  return map
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null) return DEFAULT_RESUME_PICKER_LIMIT
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return DEFAULT_RESUME_PICKER_LIMIT
  return Math.min(Math.floor(limit), MAX_RESUME_PICKER_LIMIT)
}

function normalizeStatusFilter(
  statusFilter: ResumePickerQuery['statusFilter']
): ReadonlySet<LearningSessionStatus> | null {
  if (statusFilter === undefined || statusFilter === null) return null
  if (typeof statusFilter === 'string') return new Set([statusFilter])
  if (Array.isArray(statusFilter)) {
    const set = new Set<LearningSessionStatus>()
    for (const status of statusFilter) {
      if (status === 'active' || status === 'completed' || status === 'legacy_read_only') set.add(status)
    }
    return set.size > 0 ? set : null
  }
  return null
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeQueryText(value: string | undefined): string | null {
  const text = normalizeOptionalText(value)
  return text ? text.toLocaleLowerCase('en-US') : null
}
