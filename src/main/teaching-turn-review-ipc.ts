/**
 * Pure main-side mapper for teaching-turn review project / decide IPC
 * Human decision and post-approve handoff IPC remain projections under ADR-0001.
 *
 * Calls only ADR-0001 pure APIs. Never installs skills, writes
 * memory/profile, touches settlement, or invents auto-apply semantics.
 */

import {
  projectTeachingTurnReviewForHuman
} from '../shared/teaching-turn-review-approve'
import {
  projectTeachingTurnReviewHandoff,
  projectTeachingTurnReviewHandoffFromBundle
} from '../shared/teaching-turn-review-handoff'
import type {
  DecideTeachingTurnReviewPayload,
  DecideTeachingTurnReviewResult,
  ProjectTeachingTurnReviewHandoffPayload,
  ProjectTeachingTurnReviewHandoffResult,
  ProjectTeachingTurnReviewPayload,
  ProjectTeachingTurnReviewResult
} from '../shared/teaching-types/teaching-turn-review-ipc'

/**
 * Project a review bundle (+ optional decision) into a UI-safe DTO.
 * Pure assert/project throws become structured `{ ok: false, reason }`.
 */
export function runProjectTeachingTurnReviewIpc(
  payload: ProjectTeachingTurnReviewPayload
): ProjectTeachingTurnReviewResult {
  try {
    const projection = projectTeachingTurnReviewForHuman(payload.bundle, payload.decision)
    return { ok: true, projection }
  } catch (error) {
    return { ok: false, reason: errorMessage(error) }
  }
}

/**
 * Validate a required human decision against a bundle and project.
 * Same pure path as project; clearer product name for decision submit.
 * Never applies candidates — returns approved ids only.
 */
export function runDecideTeachingTurnReviewIpc(
  payload: DecideTeachingTurnReviewPayload
): DecideTeachingTurnReviewResult {
  try {
    const projection = projectTeachingTurnReviewForHuman(payload.bundle, payload.decision)
    return { ok: true, projection }
  } catch (error) {
    return { ok: false, reason: errorMessage(error) }
  }
}

/**
 * Project post-approve handoff intents from either an approval projection or
 * bundle + required decision (ADR-0001 pure APIs). Never applies candidates.
 */
export function runProjectTeachingTurnReviewHandoffIpc(
  payload: ProjectTeachingTurnReviewHandoffPayload
): ProjectTeachingTurnReviewHandoffResult {
  try {
    if ('projection' in payload) {
      const handoff = projectTeachingTurnReviewHandoff(payload.projection)
      return { ok: true, handoff }
    }
    const handoff = projectTeachingTurnReviewHandoffFromBundle(payload.bundle, payload.decision)
    return { ok: true, handoff }
  } catch (error) {
    return { ok: false, reason: errorMessage(error) }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }
  return 'Teaching turn review projection failed'
}
