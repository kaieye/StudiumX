/**
 * Product IPC payload / result types for teaching-turn review human projection
 * and decision submit (ADOPTION S-09 residual / ADR-0087), plus post-approve
 * handoff projection (ADR-0110), plus durable last-bundle get/save (ADR-0114).
 *
 * Gateway and preload expose closed-set channels only. Main-side pure mapper
 * calls ADR-0085 / ADR-0109 / ADR-0113 APIs; never auto-applies candidates or
 * mutates skill/memory/profile.
 */

import type {
  TeachingTurnReviewApprovalProjection,
  TeachingTurnReviewHumanDecision
} from '../teaching-turn-review-approve'
import type { TeachingTurnReviewBundle } from '../teaching-turn-review'
import type { TeachingTurnReviewHandoffProjection } from '../teaching-turn-review-handoff'
import type {
  TeachingTurnReviewLastBundleSnapshot,
  TeachingTurnReviewLastBundleSource
} from '../teaching-turn-review-last-bundle'

/** projectTeachingTurnReview: bundle required; decision optional. */
export type ProjectTeachingTurnReviewPayload = {
  bundle: TeachingTurnReviewBundle
  decision?: TeachingTurnReviewHumanDecision
}

/** decideTeachingTurnReview: bundle + decision both required. */
export type DecideTeachingTurnReviewPayload = {
  bundle: TeachingTurnReviewBundle
  decision: TeachingTurnReviewHumanDecision
}

/**
 * Structured result for both project and decide IPC paths.
 * Validation failures from pure assert/project map to `{ ok: false, reason }`.
 * Parser rejections throw (existing gateway error path).
 */
export type ProjectTeachingTurnReviewResult =
  | { ok: true; projection: TeachingTurnReviewApprovalProjection }
  | { ok: false; reason: string }

export type DecideTeachingTurnReviewResult = ProjectTeachingTurnReviewResult

/**
 * projectTeachingTurnReviewHandoff: either approval projection OR bundle+decision.
 * Exactly one shape; mixed / empty rejected by parser (fail-closed).
 */
export type ProjectTeachingTurnReviewHandoffPayload =
  | { projection: TeachingTurnReviewApprovalProjection }
  | { bundle: TeachingTurnReviewBundle; decision: TeachingTurnReviewHumanDecision }

/**
 * Structured handoff result. Pure assert throws → `{ ok: false, reason }`.
 * Never an apply plan / skill body / profile patch.
 */
export type ProjectTeachingTurnReviewHandoffResult =
  | { ok: true; handoff: TeachingTurnReviewHandoffProjection }
  | { ok: false; reason: string }

/**
 * getTeachingTurnReviewLastBundle: empty / no payload (read-only durable cache).
 * Result may be null when no valid snapshot is present.
 */
export type GetTeachingTurnReviewLastBundleResult =
  | { ok: true; snapshot: TeachingTurnReviewLastBundleSnapshot | null }
  | { ok: false; reason: string }

/**
 * saveTeachingTurnReviewLastBundle: fail-closed payload only.
 * Never auto-applies after save; durable cache only.
 */
export type SaveTeachingTurnReviewLastBundlePayload = {
  bundle: TeachingTurnReviewBundle
  decision?: TeachingTurnReviewHumanDecision
  source?: Extract<TeachingTurnReviewLastBundleSource, 'settings_demo' | 'manual' | 'unknown'>
}

export type SaveTeachingTurnReviewLastBundleResult =
  | { ok: true }
  | { ok: false; reason: string }

// Re-export snapshot type for product surface consumers.
export type { TeachingTurnReviewLastBundleSnapshot }
