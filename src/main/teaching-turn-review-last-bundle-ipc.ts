/**
 * Main-side mapper for teaching-turn review last-bundle get/save product IPC
 * (ADOPTION S-09 residual / ADR-0001).
 *
 * Calls only ADR-0001 pure + FS helpers with a provided rootPath.
 * Never auto-applies, never installs skills, never writes memory/profile,
 * never touches settlement.
 */

import {
  loadTeachingTurnReviewLastBundleFromRoot,
  saveTeachingTurnReviewLastBundleToRoot
} from './teaching-turn-review-last-bundle-fs'
import {
  toTeachingTurnReviewLastBundleSnapshot
} from '../shared/teaching-turn-review-last-bundle'
import type {
  GetTeachingTurnReviewLastBundleResult,
  SaveTeachingTurnReviewLastBundlePayload,
  SaveTeachingTurnReviewLastBundleResult
} from '../shared/teaching-types/teaching-turn-review-ipc'

/**
 * Load last durable review snapshot from a caller-supplied root (userData).
 * Missing / invalid → `{ ok: true, snapshot: null }`.
 * Never auto-applies the loaded snapshot.
 */
export async function runGetTeachingTurnReviewLastBundleIpc(input: {
  rootPath: string
}): Promise<GetTeachingTurnReviewLastBundleResult> {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) {
    return { ok: false, reason: 'userData rootPath is unavailable' }
  }
  try {
    const snapshot = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath })
    return { ok: true, snapshot }
  } catch (error) {
    return { ok: false, reason: errorMessage(error) }
  }
}

/**
 * Save last durable review snapshot under a caller-supplied root (userData).
 * Fail-closed payload → pure snapshot → FS write.
 * Never auto-applies after save.
 */
export async function runSaveTeachingTurnReviewLastBundleIpc(
  payload: SaveTeachingTurnReviewLastBundlePayload,
  input: { rootPath: string }
): Promise<SaveTeachingTurnReviewLastBundleResult> {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) {
    return { ok: false, reason: 'userData rootPath is unavailable' }
  }
  try {
    const snapshot = toTeachingTurnReviewLastBundleSnapshot({
      bundle: payload.bundle,
      decision: payload.decision,
      source: payload.source ?? 'unknown'
    })
    const saved = await saveTeachingTurnReviewLastBundleToRoot({ rootPath, snapshot })
    if (!saved.ok) {
      return { ok: false, reason: saved.reason }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: errorMessage(error) }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }
  return 'Teaching turn review last-bundle operation failed'
}
