/**
 * Composition-edge factory: optional finalize-hook save of last teaching-turn review bundle
 * (ADOPTION S-09 residual / ADR-0117).
 *
 * Default OFF. Fail-soft. Candidates-only durable cache — never auto-applies,
 * never writes skills / profile / settlement / memory.
 */

import type { TeachingTurnReviewFinalizeHook } from '../shared/teaching-turn-review'
import { toTeachingTurnReviewLastBundleSnapshot } from '../shared/teaching-turn-review-last-bundle'
import { saveTeachingTurnReviewLastBundleToRoot } from './teaching-turn-review-last-bundle-fs'

export type CreateSaveTeachingTurnReviewLastBundleFinalizeHookOptions = Readonly<{
  /** Absolute caller root (userData / test temp). Required when enabled. */
  rootPath: string
  /**
   * Opt-in. Default false / undefined => returned hook is a no-op (zero FS I/O).
   * Product must pass enabled: true to persist.
   */
  enabled?: boolean
  relativePath?: string
}>

/**
 * Composition-edge factory for ADR-0117.
 * Returns a TeachingTurnReviewFinalizeHook suitable for orchestrator.onTeachingTurnReview.
 * - enabled !== true => no-op
 * - enabled => toTeachingTurnReviewLastBundleSnapshot({ bundle, source: 'finalize_hook' })
 *             then saveTeachingTurnReviewLastBundleToRoot({ rootPath, snapshot, relativePath? })
 * - never auto-applies; never throws (catch all, return void)
 * - ignores mode for save content (bundle already mode-aware); pure snapshot has no mode field
 */
export function createSaveTeachingTurnReviewLastBundleFinalizeHook(
  options: CreateSaveTeachingTurnReviewLastBundleFinalizeHookOptions
): TeachingTurnReviewFinalizeHook {
  const enabled = options?.enabled === true
  const rootPath =
    typeof options?.rootPath === 'string' ? options.rootPath.trim() : ''
  const relativePath =
    typeof options?.relativePath === 'string' && options.relativePath.trim().length > 0
      ? options.relativePath
      : undefined

  if (!enabled || !rootPath) {
    return async () => {}
  }

  return async (input) => {
    try {
      if (!input || typeof input !== 'object' || !input.bundle) {
        return
      }
      const snapshot = toTeachingTurnReviewLastBundleSnapshot({
        bundle: input.bundle,
        source: 'finalize_hook'
      })
      await saveTeachingTurnReviewLastBundleToRoot({
        rootPath,
        snapshot,
        ...(relativePath ? { relativePath } : {})
      })
      // Save result ignored: fail-soft; caller must not observe throw / apply.
    } catch {
      // Never throw out of the finalize hook (defensive; orchestrator also swallows).
    }
  }
}
