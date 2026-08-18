/**
 * Pure human decision + approval projection for teaching-turn review candidates
 * (ADOPTION S-09 residual / ADR-0001).
 *
 * Display-only projection and non-executable approved-id lists for future UI/IPC.
 * Never auto-applies candidates, never writes skills/profile/memory, never touches settlement.
 *
 * Callers that later act on approved ids MUST route through existing consent-gated product
 * paths (skill-pack install, memory create, lesson follow-up) — this module only records ids.
 */

import {
  assertReviewNotAutoApplied,
  type TeachingTurnReviewBundle,
  type TeachingTurnReviewCandidateKind
} from './teaching-turn-review'

export type TeachingTurnReviewDecisionAction = 'approve' | 'reject' | 'defer'

export type TeachingTurnReviewCandidateDecision = {
  candidateId: string
  action: TeachingTurnReviewDecisionAction
  /** Optional free-text note; display only; sanitized (control chars stripped, length capped). */
  note?: string
}

export type TeachingTurnReviewHumanDecision = {
  turnId?: string
  decidedAt?: string
  decisions: TeachingTurnReviewCandidateDecision[]
}

/**
 * UI-safe projection. Display only — not an executable apply plan.
 * `approvedCandidateIds` are consent-gated handoff ids for downstream product paths only.
 */
export type TeachingTurnReviewApprovalProjection = {
  turnId?: string
  generatedAt: string
  candidates: Array<{
    id: string
    kind: TeachingTurnReviewCandidateKind
    title: string
    summary: string
    requiresHumanApproval: true
    decision: TeachingTurnReviewDecisionAction | 'pending'
    note?: string
  }>
  /** Candidate ids with action === 'approve' — NOT an apply plan. */
  approvedCandidateIds: string[]
  rejectedCandidateIds: string[]
  deferredCandidateIds: string[]
}

const ALLOWED_ACTIONS = new Set<TeachingTurnReviewDecisionAction>(['approve', 'reject', 'defer'])

/** Soft cap for free-text notes (display only). */
export const MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH = 500 as const

/**
 * Fail-closed validation of a human decision against a candidate bundle.
 * - Unknown candidate ids throw
 * - Duplicate candidate ids throw
 * - Forbidden / unknown actions throw
 * - Empty decisions is allowed
 * Also re-checks source bundle is not auto-apply shaped via {@link assertReviewNotAutoApplied}.
 */
export function assertTeachingTurnReviewDecision(
  bundle: TeachingTurnReviewBundle,
  decision: TeachingTurnReviewHumanDecision
): void {
  assertReviewNotAutoApplied(bundle)

  if (!decision || typeof decision !== 'object') {
    throw new Error('TeachingTurnReviewHumanDecision is required')
  }
  if (!Array.isArray(decision.decisions)) {
    throw new Error('TeachingTurnReviewHumanDecision.decisions must be an array')
  }

  const knownIds = new Set(bundle.candidates.map((c) => c.id))
  const seen = new Set<string>()

  for (const entry of decision.decisions) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Each decision entry must be an object')
    }
    const candidateId = entry.candidateId
    if (typeof candidateId !== 'string' || candidateId.length === 0) {
      throw new Error('Decision candidateId must be a non-empty string')
    }
    if (!knownIds.has(candidateId)) {
      throw new Error(
        `Unknown review candidate id "${candidateId}" — fail-closed (not in bundle)`
      )
    }
    if (seen.has(candidateId)) {
      throw new Error(`Duplicate decision for candidate id "${candidateId}"`)
    }
    seen.add(candidateId)

    if (!ALLOWED_ACTIONS.has(entry.action as TeachingTurnReviewDecisionAction)) {
      throw new Error(
        `Forbidden or unknown decision action for "${candidateId}": ${String(entry.action)}`
      )
    }

    if (entry.note !== undefined && typeof entry.note !== 'string') {
      throw new Error(`Decision note for "${candidateId}" must be a string when present`)
    }
  }
}

/**
 * Project a review bundle (+ optional human decision) into a UI-safe DTO.
 *
 * Invariants:
 * - Always runs {@link assertReviewNotAutoApplied} on the source bundle
 * - When a decision is provided, validates with {@link assertTeachingTurnReviewDecision}
 * - Never sets `requiresHumanApproval: false`
 * - Never invents executable apply / write / skill-body fields
 * - `approvedCandidateIds` are ids only — callers must use existing consent/skill/memory paths
 */
export function projectTeachingTurnReviewForHuman(
  bundle: TeachingTurnReviewBundle,
  decision?: TeachingTurnReviewHumanDecision
): TeachingTurnReviewApprovalProjection {
  assertReviewNotAutoApplied(bundle)

  if (decision !== undefined) {
    assertTeachingTurnReviewDecision(bundle, decision)
  }

  const decisionById = new Map<string, TeachingTurnReviewCandidateDecision>()
  if (decision) {
    for (const entry of decision.decisions) {
      decisionById.set(entry.candidateId, entry)
    }
  }

  const approvedCandidateIds: string[] = []
  const rejectedCandidateIds: string[] = []
  const deferredCandidateIds: string[] = []

  const candidates = bundle.candidates.map((candidate) => {
    const entry = decisionById.get(candidate.id)
    const action: TeachingTurnReviewDecisionAction | 'pending' = entry?.action ?? 'pending'
    const note = entry?.note !== undefined ? sanitizeDecisionNote(entry.note) : undefined

    if (action === 'approve') approvedCandidateIds.push(candidate.id)
    else if (action === 'reject') rejectedCandidateIds.push(candidate.id)
    else if (action === 'defer') deferredCandidateIds.push(candidate.id)

    const projected: TeachingTurnReviewApprovalProjection['candidates'][number] = {
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      requiresHumanApproval: true,
      decision: action
    }
    if (note !== undefined && note.length > 0) {
      projected.note = note
    }
    // Intentionally omit candidate.payload — UI may request diagnostic payload separately;
    // projection stays free of any auto-apply-shaped nested keys.
    return projected
  })

  const projection: TeachingTurnReviewApprovalProjection = {
    generatedAt: bundle.generatedAt,
    candidates,
    // Approved ids only — NOT an apply plan. Downstream must re-consent via product paths.
    approvedCandidateIds,
    rejectedCandidateIds,
    deferredCandidateIds
  }

  if (bundle.turnId !== undefined) {
    projection.turnId = bundle.turnId
  } else if (decision?.turnId !== undefined) {
    projection.turnId = decision.turnId
  }

  return projection
}

/**
 * Strip NULs / C0 control chars (except common whitespace TAB/LF/CR), cap length.
 * Display sanitization only — not a security boundary for executable content.
 */
export function sanitizeDecisionNote(note: string): string {
  if (typeof note !== 'string') return ''
  // Remove NULs and other C0 controls except \t \n \r; also strip DEL and C1.
  const cleaned = note
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim()
  if (cleaned.length <= MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH) return cleaned
  return cleaned.slice(0, MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH)
}
