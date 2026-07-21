/**
 * Fail-soft TeachingDoctor session + outcome crash-window facts collector
 * (B-11 residual / ADR-0104).
 *
 * Thin adapter: calls injected `loadScan()` once (typically active workspace +
 * `createLearningSessionLedger(...).scan()`) and maps the scan into both
 * `sessionCrashWindow` and `outcomeCrashWindow` facts. One scan load — no
 * double I/O. Never embeds absolute home paths, secrets, or free-form renderer
 * facts.
 *
 * Non-claims:
 * - no auto-repair / clear marker / upload / remote telemetry / OTEL
 * - no LearningOutcomeCommitter.reconcile (mutates/repairs — doctor is read-only)
 * - no free-form renderer facts (IPC payload remains ADR-0084 closed)
 * - no peel of learning-session-ledger / teaching-workspace / teaching-turn-coordinator
 * - no source-gap collector (separate residual)
 */

import type {
  TeachingDoctorFacts,
  TeachingDoctorOutcomeCrashWindowFacts,
  TeachingDoctorSessionCrashWindowFacts
} from '../../shared/teaching-types/teaching-doctor'
import type { TeachingDoctorFactsCollector } from './teaching-doctor-facts-assemble'

/** Hard-cap for unique diagnostic codes retained in session crash-window facts. */
export const TEACHING_DOCTOR_SESSION_DIAGNOSTIC_CODE_HARD_CAP = 16

/**
 * Known diagnostic codes that require manual outcome/session review.
 * Minimum set from LearningSessionDiagnosticCode + any code containing "outcome".
 */
const REVIEW_REQUIRED_DIAGNOSTIC_CODES = new Set([
  'invalid_session_outcome',
  'unknown_session_schema',
  'canonical_identity_conflict'
])

export type TeachingDoctorSessionScanSource = {
  /**
   * Return LearningSessionScanResult for active workspace; null/undefined = no active workspace.
   * May throw — collector catches — fail-soft empty partial.
   */
  loadScan(): Promise<LearningSessionScanResultLike | null | undefined>
}

/**
 * Minimal structural type — do not import ledger implementation into pure mapper.
 * Mirrors LearningSessionScanResult fields used for doctor facts only.
 */
export type LearningSessionScanResultLike = {
  stages: readonly { kind: string; state: string }[]
  quarantined: readonly unknown[]
  recoveries: readonly unknown[]
  diagnostics: readonly { code?: string }[]
  canonicalSessions?: readonly {
    status?: string
    outcomeRef?: unknown | null
  }[]
  sessions?: readonly {
    source?: string
    status?: string
    outcomeRef?: unknown | null
    readOnly?: boolean
  }[]
}

/**
 * Factory for a main-side session+outcome crash-window facts collector.
 * Composition root / gateway injects this into runProductTeachingDoctor deps.
 *
 * Decision (ADR-0104): no active workspace / null scan → empty `{}` partial so
 * pure session/outcome checks stay `skipped`. Throw → `{}`. One scan maps both
 * fact keys (no double I/O).
 */
export function createTeachingDoctorSessionOutcomeScanFactsCollector(
  source: TeachingDoctorSessionScanSource
): TeachingDoctorFactsCollector {
  return {
    id: 'session-outcome-scan',
    async collect(): Promise<Partial<TeachingDoctorFacts>> {
      try {
        const scan = await source.loadScan()
        if (scan == null) {
          // Prefer empty partial so both pure checks stay skipped when no workspace.
          return {}
        }
        return {
          sessionCrashWindow: mapScanToSessionCrashWindowFacts(scan),
          outcomeCrashWindow: mapScanToOutcomeCrashWindowFacts(scan)
        }
      } catch {
        // Fail-soft: skip facts (doctor shows skipped), never rethrow secrets/paths.
        return {}
      }
    }
  }
}

/**
 * Map a LearningSession scan into export-safe session crash-window facts.
 * Counts only; diagnostic codes are unique non-empty strings, hard-capped at 16.
 * Never retains absolute paths, secrets, or free-form messages.
 */
export function mapScanToSessionCrashWindowFacts(
  scan: LearningSessionScanResultLike
): TeachingDoctorSessionCrashWindowFacts {
  const stages = Array.isArray(scan.stages) ? scan.stages : []
  let pendingStageCount = 0
  let unsafeStageCount = 0
  let eventManifestGapCount = 0

  for (const stage of stages) {
    if (stage == null || typeof stage !== 'object') continue
    const state = typeof stage.state === 'string' ? stage.state : ''
    const kind = typeof stage.kind === 'string' ? stage.kind : ''

    if (state === 'pending') pendingStageCount += 1
    if (state === 'unsafe') unsafeStageCount += 1

    // Staged event/manifest residuals that may outrun cleaned projections.
    if (
      (kind === 'event' || kind === 'manifest') &&
      (state === 'pending' || state === 'unsafe')
    ) {
      eventManifestGapCount += 1
    }
  }

  const quarantinedSessionCount = Array.isArray(scan.quarantined) ? scan.quarantined.length : 0
  const recoveryCount = Array.isArray(scan.recoveries) ? scan.recoveries.length : 0
  const diagnosticCodes = collectUniqueDiagnosticCodes(scan.diagnostics)

  return {
    pendingStageCount,
    unsafeStageCount,
    quarantinedSessionCount,
    recoveryCount,
    diagnosticCodes,
    eventManifestGapCount
  }
}

/**
 * Map a LearningSession scan into export-safe outcome crash-window facts.
 *
 * Scan-derived heuristic only — never calls reconcile / mutate repair.
 * Prefer `canonicalSessions` when present; else non-legacy sessions from `sessions`.
 */
export function mapScanToOutcomeCrashWindowFacts(
  scan: LearningSessionScanResultLike
): TeachingDoctorOutcomeCrashWindowFacts {
  const sessionRows = selectOutcomeSessionRows(scan)

  let settledCount = 0
  let needsProjectionRepairCount = 0
  for (const row of sessionRows) {
    const hasOutcome = row.outcomeRef != null
    if (hasOutcome) {
      settledCount += 1
    } else if (row.status === 'completed') {
      // Completed without outcomeRef → projection/settlement gap (scan heuristic).
      needsProjectionRepairCount += 1
    }
  }

  const stages = Array.isArray(scan.stages) ? scan.stages : []
  let pendingSettlementCount = 0
  for (const stage of stages) {
    if (stage == null || typeof stage !== 'object') continue
    if (stage.kind === 'session' && stage.state === 'pending') {
      pendingSettlementCount += 1
    }
  }

  const reviewRequiredCount = countReviewRequiredDiagnostics(scan.diagnostics)

  return {
    pendingSettlementCount,
    needsProjectionRepairCount,
    reviewRequiredCount,
    settledCount
  }
}

function selectOutcomeSessionRows(
  scan: LearningSessionScanResultLike
): readonly { status?: string; outcomeRef?: unknown | null }[] {
  if (Array.isArray(scan.canonicalSessions)) {
    return scan.canonicalSessions
  }

  const sessions = Array.isArray(scan.sessions) ? scan.sessions : []
  // Prefer non-legacy rows when falling back to mixed `sessions`.
  return sessions.filter((row) => {
    if (row == null || typeof row !== 'object') return false
    if (row.source === 'legacy_lesson') return false
    if (row.readOnly === true) return false
    return true
  })
}

function collectUniqueDiagnosticCodes(
  diagnostics: readonly { code?: string }[] | null | undefined
): string[] {
  if (!Array.isArray(diagnostics)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of diagnostics) {
    if (item == null || typeof item !== 'object') continue
    const code = typeof item.code === 'string' ? item.code.trim() : ''
    if (code.length === 0) continue
    // Codes are closed enums / short tokens — still reject path-like noise.
    if (looksLikePathOrSecret(code)) continue
    if (seen.has(code)) continue
    seen.add(code)
    out.push(code)
    if (out.length >= TEACHING_DOCTOR_SESSION_DIAGNOSTIC_CODE_HARD_CAP) break
  }
  return out
}

function countReviewRequiredDiagnostics(
  diagnostics: readonly { code?: string }[] | null | undefined
): number {
  if (!Array.isArray(diagnostics)) return 0
  let count = 0
  for (const item of diagnostics) {
    if (item == null || typeof item !== 'object') continue
    const code = typeof item.code === 'string' ? item.code.trim() : ''
    if (code.length === 0) continue
    if (REVIEW_REQUIRED_DIAGNOSTIC_CODES.has(code)) {
      count += 1
      continue
    }
    // Also count any diagnostic whose code mentions "outcome" (case-insensitive).
    if (code.toLowerCase().includes('outcome')) {
      count += 1
    }
  }
  return count
}

/**
 * Reject diagnostic code tokens that look like paths or secrets so facts stay closed.
 */
function looksLikePathOrSecret(value: string): boolean {
  if (!value) return true
  if (value.includes('/') || value.includes('\\')) return true
  if (/^[A-Za-z]:/.test(value)) return true
  if (value.includes('://')) return true
  if (value.length > 128) return true
  // Common secret-shaped prefixes.
  if (/^(sk-|Bearer\s|api[_-]?key=)/i.test(value)) return true
  return false
}
