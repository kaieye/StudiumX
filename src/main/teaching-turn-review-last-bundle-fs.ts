/**
 * Contained FS load/save for teaching-turn review last-bundle snapshot
 * (ADOPTION S-09 residual / ADR-0113 FS layer).
 *
 * Caller-supplied absolute root only (typically Electron userData).
 * Fail closed: missing / invalid / oversize / path-escape → null or { ok:false }.
 * Never auto-applies after load; never installs skills / writes memory.
 */

import { resolve } from 'node:path'

import { isLexicallyInsideRoot, readContainedRegularFileBounded } from './path-access'
import { replaceDurably } from './persistence/durable-file'
import {
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS,
  parseTeachingTurnReviewLastBundleSnapshot,
  type TeachingTurnReviewLastBundleSnapshot
} from '../shared/teaching-turn-review-last-bundle'
import { normalizeManagedRelativePath } from './teaching-managed-config-fs'

/** Relative-path normalizer (fail-closed); aliases managed-config normalizer. */
export const normalizeTeachingTurnReviewLastBundleRelativePath =
  normalizeManagedRelativePath

/** Conventional relative path under the caller root (e.g. app userData). */
export const DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH =
  'studiumx-teaching-turn-review-last-bundle.json'

/** Max bytes accepted for last-bundle document (aligned with pure JSON char budget). */
export const TEACHING_TURN_REVIEW_LAST_BUNDLE_MAX_BYTES =
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS

export async function loadTeachingTurnReviewLastBundleFromRoot(input: {
  rootPath: string
  relativePath?: string
  maxBytes?: number
}): Promise<TeachingTurnReviewLastBundleSnapshot | null> {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) return null

  const relativeRaw =
    typeof input.relativePath === 'string' && input.relativePath.trim()
      ? input.relativePath
      : DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH

  const normalizedRelative = normalizeManagedRelativePath(relativeRaw)
  if (!normalizedRelative) return null

  const absoluteTarget = resolve(rootPath, ...normalizedRelative.split('/'))
  if (!isLexicallyInsideRoot(rootPath, absoluteTarget)) return null

  const maxBytes =
    typeof input.maxBytes === 'number' && Number.isSafeInteger(input.maxBytes) && input.maxBytes >= 0
      ? input.maxBytes
      : TEACHING_TURN_REVIEW_LAST_BUNDLE_MAX_BYTES

  let bounded: Awaited<ReturnType<typeof readContainedRegularFileBounded>>
  try {
    bounded = await readContainedRegularFileBounded(rootPath, absoluteTarget, maxBytes)
  } catch {
    return null
  }
  if (bounded.status === 'over_limit') return null

  const text = bounded.content.toString('utf8')
  if (text.length > MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS) return null

  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    return null
  }

  try {
    return parseTeachingTurnReviewLastBundleSnapshot(raw)
  } catch {
    return null
  }
}

export async function saveTeachingTurnReviewLastBundleToRoot(input: {
  rootPath: string
  snapshot: TeachingTurnReviewLastBundleSnapshot
  relativePath?: string
  maxBytes?: number
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) {
    return { ok: false, reason: 'rootPath is required' }
  }

  let snapshot: TeachingTurnReviewLastBundleSnapshot
  try {
    // Defense in depth: re-parse through pure fail-closed path.
    snapshot = parseTeachingTurnReviewLastBundleSnapshot(input.snapshot)
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Invalid last-bundle snapshot'
    }
  }

  const relativeRaw =
    typeof input.relativePath === 'string' && input.relativePath.trim()
      ? input.relativePath
      : DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH

  const normalizedRelative = normalizeManagedRelativePath(relativeRaw)
  if (!normalizedRelative) {
    return { ok: false, reason: 'relativePath escapes root or is invalid' }
  }

  const absoluteTarget = resolve(rootPath, ...normalizedRelative.split('/'))
  if (!isLexicallyInsideRoot(rootPath, absoluteTarget)) {
    return { ok: false, reason: 'relativePath escapes root' }
  }

  const maxBytes =
    typeof input.maxBytes === 'number' && Number.isSafeInteger(input.maxBytes) && input.maxBytes >= 0
      ? input.maxBytes
      : TEACHING_TURN_REVIEW_LAST_BUNDLE_MAX_BYTES

  const content = `${JSON.stringify(snapshot)}\n`
  if (
    content.length > maxBytes ||
    content.length > MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS
  ) {
    return { ok: false, reason: 'last-bundle snapshot exceeds size budget' }
  }

  try {
    await replaceDurably({ path: absoluteTarget, content })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Failed to write last-bundle snapshot'
    }
  }
}
