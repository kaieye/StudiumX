/**
 * Pure durable snapshot for the last teaching-turn review bundle
 * (ADOPTION S-09 residual / ADR-0113 pure layer).
 *
 * Rebuildable projection cache only — NOT settlement SoT.
 * Never auto-applies candidates; never invents skill install / memory write plans.
 */

import {
  assertReviewNotAutoApplied,
  type TeachingTurnReviewBundle,
  type TeachingTurnReviewCandidate,
  type TeachingTurnReviewCandidateKind
} from './teaching-turn-review'
import {
  sanitizeDecisionNote,
  type TeachingTurnReviewDecisionAction,
  type TeachingTurnReviewHumanDecision
} from './teaching-turn-review-approve'

export type TeachingTurnReviewLastBundleSource =
  | 'finalize_hook'
  | 'settings_demo'
  | 'manual'
  | 'unknown'

/**
 * Versioned durable last-bundle snapshot.
 * `decision` is optional human decision metadata only — never an apply plan.
 */
export type TeachingTurnReviewLastBundleSnapshot = {
  version: 1
  /** ISO timestamp when snapshot was written */
  savedAt: string
  /** Source tag for diagnostics only */
  source: TeachingTurnReviewLastBundleSource
  bundle: TeachingTurnReviewBundle
  /** Optional last human decision if any; never an apply plan */
  decision?: TeachingTurnReviewHumanDecision
}

/** Soft JSON char budget for durable last-bundle file (256 KiB). */
export const MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS = 256_000 as const

/** Soft candidate cap aligned with product IPC (fail-closed). */
export const MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES = 8 as const

/** Soft decision entry cap aligned with product IPC. */
export const MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_DECISIONS = 8 as const

const ALLOWED_SOURCES = new Set<TeachingTurnReviewLastBundleSource>([
  'finalize_hook',
  'settings_demo',
  'manual',
  'unknown'
])

const ALLOWED_KINDS = new Set<TeachingTurnReviewCandidateKind>([
  'memory_candidate',
  'skill_pack_hint',
  'lesson_gap',
  'other'
])

const ALLOWED_ACTIONS = new Set<TeachingTurnReviewDecisionAction>([
  'approve',
  'reject',
  'defer'
])

const FORBIDDEN_TOP_KEYS = new Set([
  'autoApply',
  'auto_apply',
  'applyPlan',
  'apply_plan',
  'skillFileContent',
  'skill_file_content',
  'profilePatch',
  'profile_patch',
  'writePath',
  'write_path',
  'executable',
  'mutations',
  'fsWrite',
  'fs_write'
])

/**
 * Fail-closed pure parse from unknown JSON value.
 * Rejects auto-apply shaped fields and invalid structures.
 */
export function parseTeachingTurnReviewLastBundleSnapshot(
  raw: unknown
): TeachingTurnReviewLastBundleSnapshot {
  if (!isPlainObject(raw)) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot must be a plain object')
  }

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_TOP_KEYS.has(key)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot rejects forbidden key "${key}" (no auto-apply)`
      )
    }
  }

  const allowed = new Set(['version', 'savedAt', 'source', 'bundle', 'decision'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(
        'TeachingTurnReviewLastBundleSnapshot must contain only "version", "savedAt", "source", "bundle", and optional "decision".'
      )
    }
  }

  if (raw.version !== 1) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.version must be 1')
  }
  if (typeof raw.savedAt !== 'string' || raw.savedAt.trim().length === 0) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.savedAt must be a non-empty string')
  }
  if (typeof raw.source !== 'string' || !ALLOWED_SOURCES.has(raw.source as TeachingTurnReviewLastBundleSource)) {
    throw new Error(
      'TeachingTurnReviewLastBundleSnapshot.source must be finalize_hook|settings_demo|manual|unknown'
    )
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'bundle')) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot requires "bundle"')
  }

  const bundle = parseBundle(raw.bundle)
  assertReviewNotAutoApplied(bundle)

  const snapshot: TeachingTurnReviewLastBundleSnapshot = {
    version: 1,
    savedAt: raw.savedAt.trim(),
    source: raw.source as TeachingTurnReviewLastBundleSource,
    bundle
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'decision')) {
    snapshot.decision = parseDecision(raw.decision, bundle.candidates.length)
  }

  return snapshot
}

/**
 * Serialize to a plain JSON-safe snapshot object.
 * Calls assertReviewNotAutoApplied on the bundle (fail-closed).
 */
export function toTeachingTurnReviewLastBundleSnapshot(input: {
  bundle: TeachingTurnReviewBundle
  decision?: TeachingTurnReviewHumanDecision
  source?: TeachingTurnReviewLastBundleSource
  savedAt?: string
}): TeachingTurnReviewLastBundleSnapshot {
  if (!input || typeof input !== 'object') {
    throw new Error('toTeachingTurnReviewLastBundleSnapshot input is required')
  }
  assertReviewNotAutoApplied(input.bundle)

  if (input.bundle.candidates.length > MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.bundle.candidates must contain at most ${MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES} items`
    )
  }

  const source = input.source ?? 'unknown'
  if (!ALLOWED_SOURCES.has(source)) {
    throw new Error(
      'TeachingTurnReviewLastBundleSnapshot.source must be finalize_hook|settings_demo|manual|unknown'
    )
  }

  const savedAt =
    typeof input.savedAt === 'string' && input.savedAt.trim().length > 0
      ? input.savedAt.trim()
      : new Date().toISOString()

  const snapshot: TeachingTurnReviewLastBundleSnapshot = {
    version: 1,
    savedAt,
    source,
    bundle: normalizeBundle(input.bundle)
  }

  if (input.decision !== undefined) {
    snapshot.decision = normalizeDecision(input.decision, input.bundle.candidates.length)
  }

  // Defense in depth: re-enter pure parse.
  return parseTeachingTurnReviewLastBundleSnapshot(snapshot)
}

function parseBundle(value: unknown): TeachingTurnReviewBundle {
  if (!isPlainObject(value)) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.bundle must be a plain object')
  }
  const allowed = new Set(['turnId', 'candidates', 'generatedAt'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(
        'TeachingTurnReviewLastBundleSnapshot.bundle must contain only optional "turnId", "candidates", and "generatedAt".'
      )
    }
    if (FORBIDDEN_TOP_KEYS.has(key)) {
      throw new Error(`TeachingTurnReviewLastBundleSnapshot.bundle rejects forbidden key "${key}"`)
    }
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'candidates')) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.bundle requires "candidates"')
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'generatedAt')) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.bundle requires "generatedAt"')
  }
  if (typeof value.generatedAt !== 'string' || value.generatedAt.length === 0) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.bundle.generatedAt must be a non-empty string')
  }
  if (!Array.isArray(value.candidates)) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.bundle.candidates must be an array')
  }
  if (value.candidates.length > MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.bundle.candidates must contain at most ${MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES} items`
    )
  }

  const candidates = value.candidates.map((entry, index) => parseCandidate(entry, index))
  const bundle: TeachingTurnReviewBundle = {
    candidates,
    generatedAt: value.generatedAt
  }
  if (Object.prototype.hasOwnProperty.call(value, 'turnId')) {
    if (typeof value.turnId !== 'string' || value.turnId.length === 0) {
      throw new Error(
        'TeachingTurnReviewLastBundleSnapshot.bundle.turnId must be a non-empty string when present'
      )
    }
    bundle.turnId = value.turnId
  }
  return bundle
}

function parseCandidate(value: unknown, index: number): TeachingTurnReviewCandidate {
  if (!isPlainObject(value)) {
    throw new Error(`TeachingTurnReviewLastBundleSnapshot.candidates[${index}] must be a plain object`)
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_TOP_KEYS.has(key)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.candidates[${index}] rejects forbidden key "${key}" (no auto-apply)`
      )
    }
  }
  const allowed = new Set(['id', 'kind', 'title', 'summary', 'requiresHumanApproval', 'payload'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.candidates[${index}] must contain only "id", "kind", "title", "summary", "requiresHumanApproval", and optional "payload".`
      )
    }
  }
  for (const required of ['id', 'kind', 'title', 'summary', 'requiresHumanApproval'] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, required)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.candidates[${index}] requires "${required}"`
      )
    }
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].id must be a non-empty string`
    )
  }
  if (typeof value.kind !== 'string' || !ALLOWED_KINDS.has(value.kind as TeachingTurnReviewCandidateKind)) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].kind must be one of memory_candidate|skill_pack_hint|lesson_gap|other`
    )
  }
  if (typeof value.title !== 'string' || value.title.length === 0) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].title must be a non-empty string`
    )
  }
  if (typeof value.summary !== 'string' || value.summary.length === 0) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].summary must be a non-empty string`
    )
  }
  if (value.requiresHumanApproval !== true) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].requiresHumanApproval must be true (no auto apply)`
    )
  }

  const candidate: TeachingTurnReviewCandidate = {
    id: value.id,
    kind: value.kind as TeachingTurnReviewCandidateKind,
    title: value.title,
    summary: value.summary,
    requiresHumanApproval: true
  }
  if (Object.prototype.hasOwnProperty.call(value, 'payload')) {
    if (value.payload == null || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].payload must be a plain object when present`
      )
    }
    for (const key of Object.keys(value.payload as Record<string, unknown>)) {
      if (FORBIDDEN_TOP_KEYS.has(key)) {
        throw new Error(
          `TeachingTurnReviewLastBundleSnapshot.candidates[${index}].payload rejects forbidden key "${key}"`
        )
      }
    }
    candidate.payload = { ...(value.payload as Record<string, unknown>) }
  }
  return candidate
}

function parseDecision(value: unknown, candidateCount: number): TeachingTurnReviewHumanDecision {
  if (!isPlainObject(value)) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.decision must be a plain object')
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_TOP_KEYS.has(key)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.decision rejects forbidden key "${key}" (no auto-apply)`
      )
    }
  }
  const allowed = new Set(['turnId', 'decidedAt', 'decisions'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(
        'TeachingTurnReviewLastBundleSnapshot.decision must contain only optional "turnId", optional "decidedAt", and "decisions".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'decisions')) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.decision requires "decisions"')
  }
  if (!Array.isArray(value.decisions)) {
    throw new Error('TeachingTurnReviewLastBundleSnapshot.decision.decisions must be an array')
  }
  const decisionCap =
    candidateCount > 0
      ? Math.min(MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_DECISIONS, candidateCount)
      : MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_DECISIONS
  if (value.decisions.length > decisionCap) {
    throw new Error(
      `TeachingTurnReviewLastBundleSnapshot.decision.decisions must contain at most ${decisionCap} items`
    )
  }

  const decisions = value.decisions.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.decision.decisions[${index}] must be a plain object`
      )
    }
    for (const key of Object.keys(entry)) {
      if (FORBIDDEN_TOP_KEYS.has(key)) {
        throw new Error(
          `TeachingTurnReviewLastBundleSnapshot.decision.decisions[${index}] rejects forbidden key "${key}"`
        )
      }
    }
    const entryAllowed = new Set(['candidateId', 'action', 'note'])
    for (const key of Object.keys(entry)) {
      if (!entryAllowed.has(key)) {
        throw new Error(
          `TeachingTurnReviewLastBundleSnapshot.decision.decisions[${index}] must contain only "candidateId", "action", and optional "note".`
        )
      }
    }
    if (typeof entry.candidateId !== 'string' || entry.candidateId.length === 0) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.decision.decisions[${index}].candidateId must be a non-empty string`
      )
    }
    if (typeof entry.action !== 'string' || !ALLOWED_ACTIONS.has(entry.action as TeachingTurnReviewDecisionAction)) {
      throw new Error(
        `TeachingTurnReviewLastBundleSnapshot.decision.decisions[${index}].action must be approve|reject|defer`
      )
    }
    const next: TeachingTurnReviewHumanDecision['decisions'][number] = {
      candidateId: entry.candidateId,
      action: entry.action as TeachingTurnReviewDecisionAction
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'note')) {
      if (typeof entry.note !== 'string') {
        throw new Error(
          `TeachingTurnReviewLastBundleSnapshot.decision.decisions[${index}].note must be a string when present`
        )
      }
      const note = sanitizeDecisionNote(entry.note)
      if (note.length > 0) {
        next.note = note
      }
    }
    return next
  })

  const decision: TeachingTurnReviewHumanDecision = { decisions }
  if (Object.prototype.hasOwnProperty.call(value, 'turnId')) {
    if (typeof value.turnId !== 'string' || value.turnId.length === 0) {
      throw new Error(
        'TeachingTurnReviewLastBundleSnapshot.decision.turnId must be a non-empty string when present'
      )
    }
    decision.turnId = value.turnId
  }
  if (Object.prototype.hasOwnProperty.call(value, 'decidedAt')) {
    if (typeof value.decidedAt !== 'string' || value.decidedAt.length === 0) {
      throw new Error(
        'TeachingTurnReviewLastBundleSnapshot.decision.decidedAt must be a non-empty string when present'
      )
    }
    decision.decidedAt = value.decidedAt
  }
  return decision
}

function normalizeBundle(bundle: TeachingTurnReviewBundle): TeachingTurnReviewBundle {
  return parseBundle(bundle)
}

function normalizeDecision(
  decision: TeachingTurnReviewHumanDecision,
  candidateCount: number
): TeachingTurnReviewHumanDecision {
  return parseDecision(decision, candidateCount)
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
