/**
 * Pure post-approve handoff intents for teaching-turn review candidates
 * (ADOPTION S-09 residual / ADR-0001).
 *
 * After a human approve projection (ADR-0001), map approved candidate ids to
 * **non-executable** display/routing DTOs that describe which existing consent
 * surface a product UI may open next. Still no write / no install / no durable
 * review store / no auto-apply.
 *
 * Callers that later act on these intents MUST route through existing
 * consent-gated product paths (memory consent, skill-pack authoring + verifier,
 * lesson follow-up). This module never invents skill file content, profile
 * patches, or apply plans.
 */

import {
  projectTeachingTurnReviewForHuman,
  type TeachingTurnReviewApprovalProjection,
  type TeachingTurnReviewHumanDecision
} from './teaching-turn-review-approve'
import type { TeachingTurnReviewBundle } from './teaching-turn-review'

/** Existing product consent / authoring surfaces (routing hints only). */
export type TeachingTurnReviewHandoffTarget =
  | 'memory_consent' // existing learner-profile / memory consent flow
  | 'skill_pack_authoring' // human authoring / skill-pack verifier path — not auto install
  | 'lesson_followup' // lesson gap follow-up UX — not settlement rewrite
  | 'none' // approved but no product path yet

/**
 * Display/routing DTO only. Never an apply payload / file body / profile patch.
 * `requiresConsent` is always true — handoff still requires a product consent gate.
 */
export type TeachingTurnReviewHandoffIntent = {
  candidateId: string
  /** Echo of candidate kind (string for fail-closed unknown kinds). */
  kind: string
  target: TeachingTurnReviewHandoffTarget
  /** Display-only; never an apply payload / file body / profile patch. */
  reason: string
  /** Always true — handoff still requires product consent gate. */
  requiresConsent: true
}

export type TeachingTurnReviewHandoffProjection = {
  turnId?: string
  approvedCandidateIds: string[]
  intents: TeachingTurnReviewHandoffIntent[]
  /** Ids approved but not mapped to a known product path (unknown kind). */
  unmappedCandidateIds: string[]
}

/** Soft cap for fixed reason strings (display only). */
export const MAX_TEACHING_TURN_REVIEW_HANDOFF_REASON_LENGTH = 200 as const

const KIND_TO_TARGET = {
  memory_candidate: 'memory_consent',
  skill_pack_hint: 'skill_pack_authoring',
  lesson_gap: 'lesson_followup'
} as const satisfies Record<string, TeachingTurnReviewHandoffTarget>

const KIND_TO_REASON = {
  memory_candidate:
    'Approved memory candidate — open existing memory / learner-profile consent flow (no silent write).',
  skill_pack_hint:
    'Approved skill-pack hint — open human skill-pack authoring / verifier path (no auto install).',
  lesson_gap:
    'Approved lesson gap — open lesson follow-up UX only (no settlement rewrite).'
} as const satisfies Record<keyof typeof KIND_TO_TARGET, string>

/**
 * Pure: build handoff intents from an approval projection.
 * Only considers approvedCandidateIds; ignores reject/defer.
 * Never invents skill file content / profile patches / auto-apply.
 *
 * Defense in depth: an id must appear in both `approvedCandidateIds` and
 * `candidates` with `decision === 'approve'` to emit an intent.
 * Unknown kinds land in `unmappedCandidateIds` with no intent.
 */
export function projectTeachingTurnReviewHandoff(
  projection: TeachingTurnReviewApprovalProjection
): TeachingTurnReviewHandoffProjection {
  if (!projection || typeof projection !== 'object') {
    throw new Error('TeachingTurnReviewApprovalProjection is required')
  }
  if (!Array.isArray(projection.approvedCandidateIds)) {
    throw new Error('approvedCandidateIds must be an array')
  }
  if (!Array.isArray(projection.candidates)) {
    throw new Error('candidates must be an array')
  }

  const candidateById = new Map(
    projection.candidates
      .filter((c) => c && typeof c === 'object' && typeof c.id === 'string')
      .map((c) => [c.id, c] as const)
  )

  // Preserve order of approvedCandidateIds (stable UI ordering); de-dupe.
  const orderedApprovedIds: string[] = []
  const seen = new Set<string>()
  for (const id of projection.approvedCandidateIds) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    orderedApprovedIds.push(id)
  }

  const intents: TeachingTurnReviewHandoffIntent[] = []
  const unmappedCandidateIds: string[] = []

  for (const candidateId of orderedApprovedIds) {
    const candidate = candidateById.get(candidateId)
    // Defense in depth: must also be marked approve on the candidate row.
    if (!candidate || candidate.decision !== 'approve') {
      unmappedCandidateIds.push(candidateId)
      continue
    }

    const kind = typeof candidate.kind === 'string' ? candidate.kind : 'other'
    const target = KIND_TO_TARGET[kind as keyof typeof KIND_TO_TARGET]
    if (!target) {
      // Fail-closed: unknown kind → unmapped list + no intent (never implies execute).
      unmappedCandidateIds.push(candidateId)
      continue
    }

    const reason = clipReason(KIND_TO_REASON[kind as keyof typeof KIND_TO_REASON])

    intents.push({
      candidateId,
      kind,
      target,
      reason,
      requiresConsent: true
    })
  }

  const result: TeachingTurnReviewHandoffProjection = {
    approvedCandidateIds: [...orderedApprovedIds],
    intents,
    unmappedCandidateIds
  }
  if (projection.turnId !== undefined) {
    result.turnId = projection.turnId
  }
  return result
}

/**
 * Convenience: bundle + human decision → handoff projection.
 * Routes through {@link projectTeachingTurnReviewForHuman} (which asserts no
 * auto-apply) then {@link projectTeachingTurnReviewHandoff}.
 */
export function projectTeachingTurnReviewHandoffFromBundle(
  bundle: TeachingTurnReviewBundle,
  decision: TeachingTurnReviewHumanDecision
): TeachingTurnReviewHandoffProjection {
  const approval = projectTeachingTurnReviewForHuman(bundle, decision)
  return projectTeachingTurnReviewHandoff(approval)
}

function clipReason(reason: string): string {
  if (typeof reason !== 'string') return ''
  const cleaned = reason.trim()
  if (cleaned.length <= MAX_TEACHING_TURN_REVIEW_HANDOFF_REASON_LENGTH) return cleaned
  return cleaned.slice(0, MAX_TEACHING_TURN_REVIEW_HANDOFF_REASON_LENGTH)
}
