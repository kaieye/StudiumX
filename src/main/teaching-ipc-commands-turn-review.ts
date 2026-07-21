/**
 * Fail-closed IPC parsers for teaching-turn-review product channels
 * (ADR-0087 / ADR-0110 / ADR-0114). Peeled from teaching-ipc-commands
 * by ADR-0119 (S-03 residual by-touch). Behavior byte-identical.
 */
import type {
  DecideTeachingTurnReviewPayload,
  ProjectTeachingTurnReviewHandoffPayload,
  ProjectTeachingTurnReviewPayload,
  SaveTeachingTurnReviewLastBundlePayload
} from '../shared/teaching-types/teaching-turn-review-ipc'
import {
  MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH,
  type TeachingTurnReviewApprovalProjection,
  type TeachingTurnReviewDecisionAction,
  type TeachingTurnReviewHumanDecision,
  type TeachingTurnReviewCandidateDecision
} from '../shared/teaching-turn-review-approve'
import type {
  TeachingTurnReviewBundle,
  TeachingTurnReviewCandidate,
  TeachingTurnReviewCandidateKind
} from '../shared/teaching-turn-review'
import { requireRecord, requireString } from './teaching-ipc-commands'

/** Soft cap for review candidates over IPC (fail-closed; pure product max is lower). */
const MAX_TEACHING_TURN_REVIEW_IPC_CANDIDATES = 8
/** Soft cap for decision entries over IPC. */
const MAX_TEACHING_TURN_REVIEW_IPC_DECISIONS = 8
const TEACHING_TURN_REVIEW_CANDIDATE_KINDS = new Set<TeachingTurnReviewCandidateKind>([
  'memory_candidate',
  'skill_pack_hint',
  'lesson_gap',
  'other'
])
const TEACHING_TURN_REVIEW_DECISION_ACTIONS = new Set<TeachingTurnReviewDecisionAction>([
  'approve',
  'reject',
  'defer'
])

/**
 * Fail-closed parser for projectTeachingTurnReview IPC (ADR-0087).
 * Exact keys: bundle (required), decision (optional).
 */
export function parseProjectTeachingTurnReviewPayload(payload: unknown): ProjectTeachingTurnReviewPayload {
  const record = requireRecord(payload)
  const allowed = new Set(['bundle', 'decision'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC projectTeachingTurnReview payload must contain only "bundle" and optional "decision".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'bundle')) {
    throw new Error('IPC projectTeachingTurnReview payload requires "bundle".')
  }
  const bundle = parseTeachingTurnReviewBundle(record.bundle)
  if (!Object.prototype.hasOwnProperty.call(record, 'decision')) {
    return { bundle }
  }
  const decision = parseTeachingTurnReviewHumanDecision(record.decision, {
    required: false,
    candidateCount: bundle.candidates.length
  })
  return { bundle, decision }
}

/**
 * Fail-closed parser for decideTeachingTurnReview IPC (ADR-0087).
 * Exact keys: bundle + decision (both required).
 */
export function parseDecideTeachingTurnReviewPayload(payload: unknown): DecideTeachingTurnReviewPayload {
  const record = requireRecord(payload)
  const allowed = new Set(['bundle', 'decision'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC decideTeachingTurnReview payload must contain only "bundle" and "decision".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'bundle')) {
    throw new Error('IPC decideTeachingTurnReview payload requires "bundle".')
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'decision')) {
    throw new Error('IPC decideTeachingTurnReview payload requires "decision".')
  }
  const bundle = parseTeachingTurnReviewBundle(record.bundle)
  const decision = parseTeachingTurnReviewHumanDecision(record.decision, {
    required: true,
    candidateCount: bundle.candidates.length
  })
  return { bundle, decision }
}


/**
 * Fail-closed parser for projectTeachingTurnReviewHandoff IPC (ADR-0110).
 * Exactly one shape:
 *   A) { projection } — light validation (candidates[] + approvedCandidateIds[])
 *   B) { bundle, decision } — reuses bundle/decision parsers (decision required)
 * Rejects mixed shapes, empty payloads, and unknown keys.
 */
export function parseProjectTeachingTurnReviewHandoffPayload(
  payload: unknown
): ProjectTeachingTurnReviewHandoffPayload {
  const record = requireRecord(payload)
  const allowed = new Set(['projection', 'bundle', 'decision'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC projectTeachingTurnReviewHandoff payload must contain only "projection", or "bundle"+"decision".'
      )
    }
  }

  const hasProjection = Object.prototype.hasOwnProperty.call(record, 'projection')
  const hasBundle = Object.prototype.hasOwnProperty.call(record, 'bundle')
  const hasDecision = Object.prototype.hasOwnProperty.call(record, 'decision')

  if (hasProjection && (hasBundle || hasDecision)) {
    throw new Error(
      'IPC projectTeachingTurnReviewHandoff payload must not mix "projection" with "bundle"/"decision".'
    )
  }
  if (!hasProjection && !hasBundle) {
    throw new Error(
      'IPC projectTeachingTurnReviewHandoff payload requires either "projection" or "bundle"+"decision".'
    )
  }

  if (hasProjection) {
    return { projection: parseTeachingTurnReviewApprovalProjectionLight(record.projection) }
  }

  // Shape B: bundle + required decision
  if (!hasDecision) {
    throw new Error(
      'IPC projectTeachingTurnReviewHandoff payload requires "decision" when using "bundle".'
    )
  }
  const bundle = parseTeachingTurnReviewBundle(record.bundle)
  const decision = parseTeachingTurnReviewHumanDecision(record.decision, {
    required: true,
    candidateCount: bundle.candidates.length
  })
  return { bundle, decision }
}

/**
 * Light fail-closed validation of an approval projection for handoff IPC.
 * Does not reimplement the full approve projector — only structural gates.
 */
function parseTeachingTurnReviewApprovalProjectionLight(
  value: unknown
): TeachingTurnReviewApprovalProjection {
  const record = requireRecord(value)
  const allowed = new Set([
    'turnId',
    'generatedAt',
    'candidates',
    'approvedCandidateIds',
    'rejectedCandidateIds',
    'deferredCandidateIds'
  ])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC TeachingTurnReviewApprovalProjection must contain only "turnId?", "generatedAt?", "candidates", "approvedCandidateIds", "rejectedCandidateIds?", and "deferredCandidateIds?".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'candidates')) {
    throw new Error('IPC TeachingTurnReviewApprovalProjection requires "candidates".')
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'approvedCandidateIds')) {
    throw new Error('IPC TeachingTurnReviewApprovalProjection requires "approvedCandidateIds".')
  }
  if (!Array.isArray(record.candidates)) {
    throw new Error('IPC TeachingTurnReviewApprovalProjection.candidates must be an array.')
  }
  if (!Array.isArray(record.approvedCandidateIds)) {
    throw new Error(
      'IPC TeachingTurnReviewApprovalProjection.approvedCandidateIds must be an array.'
    )
  }
  if (record.candidates.length > MAX_TEACHING_TURN_REVIEW_IPC_CANDIDATES) {
    throw new Error(
      `IPC TeachingTurnReviewApprovalProjection.candidates must contain at most ${MAX_TEACHING_TURN_REVIEW_IPC_CANDIDATES} items.`
    )
  }

  const candidates = record.candidates.map((entry, index) =>
    parseTeachingTurnReviewApprovalCandidateLight(entry, index)
  )
  const approvedCandidateIds = record.approvedCandidateIds.map((id, index) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(
        `IPC TeachingTurnReviewApprovalProjection.approvedCandidateIds[${index}] must be a non-empty string.`
      )
    }
    return id
  })

  const projection: TeachingTurnReviewApprovalProjection =
    {
      generatedAt:
        typeof record.generatedAt === 'string' && record.generatedAt.length > 0
          ? record.generatedAt
          : '1970-01-01T00:00:00.000Z',
      candidates,
      approvedCandidateIds,
      rejectedCandidateIds: parseOptionalIdArray(record.rejectedCandidateIds, 'rejectedCandidateIds'),
      deferredCandidateIds: parseOptionalIdArray(record.deferredCandidateIds, 'deferredCandidateIds')
    }
  if (Object.prototype.hasOwnProperty.call(record, 'turnId')) {
    if (typeof record.turnId !== 'string' || record.turnId.length === 0) {
      throw new Error(
        'IPC TeachingTurnReviewApprovalProjection.turnId must be a non-empty string when present.'
      )
    }
    projection.turnId = record.turnId
  }
  if (
    Object.prototype.hasOwnProperty.call(record, 'generatedAt') &&
    (typeof record.generatedAt !== 'string' || record.generatedAt.length === 0)
  ) {
    throw new Error(
      'IPC TeachingTurnReviewApprovalProjection.generatedAt must be a non-empty string when present.'
    )
  }
  if (typeof record.generatedAt === 'string' && record.generatedAt.length > 0) {
    projection.generatedAt = record.generatedAt
  }
  return projection
}

function parseTeachingTurnReviewApprovalCandidateLight(
  value: unknown,
  index: number
): TeachingTurnReviewApprovalProjection["candidates"][number] {
  const record = requireRecord(value)
  const allowed = new Set([
    'id',
    'kind',
    'title',
    'summary',
    'requiresHumanApproval',
    'decision',
    'note'
  ])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `IPC TeachingTurnReviewApprovalProjection.candidates[${index}] must contain only "id", "kind", "title", "summary", "requiresHumanApproval", "decision", and optional "note".`
      )
    }
  }
  for (const required of ['id', 'kind', 'title', 'summary', 'requiresHumanApproval', 'decision'] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, required)) {
      throw new Error(
        `IPC TeachingTurnReviewApprovalProjection.candidates[${index}] requires "${required}".`
      )
    }
  }
  const id = requireString(record.id, `projection.candidates[${index}].id`)
  if (id.length === 0) {
    throw new Error(
      `IPC TeachingTurnReviewApprovalProjection.candidates[${index}].id must be a non-empty string.`
    )
  }
  if (
    typeof record.kind !== 'string' ||
    !TEACHING_TURN_REVIEW_CANDIDATE_KINDS.has(record.kind as TeachingTurnReviewCandidateKind)
  ) {
    throw new Error(
      `IPC TeachingTurnReviewApprovalProjection.candidates[${index}].kind must be one of memory_candidate|skill_pack_hint|lesson_gap|other.`
    )
  }
  const title = requireString(record.title, `projection.candidates[${index}].title`)
  const summary = requireString(record.summary, `projection.candidates[${index}].summary`)
  if (record.requiresHumanApproval !== true) {
    throw new Error(
      `IPC TeachingTurnReviewApprovalProjection.candidates[${index}].requiresHumanApproval must be true (no auto apply).`
    )
  }
  const decisionRaw = record.decision
  if (
    decisionRaw !== 'approve' &&
    decisionRaw !== 'reject' &&
    decisionRaw !== 'defer' &&
    decisionRaw !== 'pending'
  ) {
    throw new Error(
      `IPC TeachingTurnReviewApprovalProjection.candidates[${index}].decision must be approve|reject|defer|pending.`
    )
  }
  const entry: TeachingTurnReviewApprovalProjection["candidates"][number] =
    {
      id,
      kind: record.kind as TeachingTurnReviewCandidateKind,
      title,
      summary,
      requiresHumanApproval: true,
      decision: decisionRaw
    }
  if (Object.prototype.hasOwnProperty.call(record, 'note')) {
    if (typeof record.note !== 'string') {
      throw new Error(
        `IPC TeachingTurnReviewApprovalProjection.candidates[${index}].note must be a string when present.`
      )
    }
    entry.note = record.note
  }
  return entry
}

function parseOptionalIdArray(value: unknown, key: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`IPC TeachingTurnReviewApprovalProjection.${key} must be an array when present.`)
  }
  return value.map((id, index) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(
        `IPC TeachingTurnReviewApprovalProjection.${key}[${index}] must be a non-empty string.`
      )
    }
    return id
  })
}

function parseTeachingTurnReviewBundle(value: unknown): TeachingTurnReviewBundle {
  const record = requireRecord(value)
  const allowed = new Set(['turnId', 'candidates', 'generatedAt'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC TeachingTurnReviewBundle must contain only optional "turnId", "candidates", and "generatedAt".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'candidates')) {
    throw new Error('IPC TeachingTurnReviewBundle requires "candidates".')
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'generatedAt')) {
    throw new Error('IPC TeachingTurnReviewBundle requires "generatedAt".')
  }
  if (typeof record.generatedAt !== 'string' || record.generatedAt.length === 0) {
    throw new Error('IPC TeachingTurnReviewBundle.generatedAt must be a non-empty string.')
  }
  if (!Array.isArray(record.candidates)) {
    throw new Error('IPC TeachingTurnReviewBundle.candidates must be an array.')
  }
  if (record.candidates.length > MAX_TEACHING_TURN_REVIEW_IPC_CANDIDATES) {
    throw new Error(
      `IPC TeachingTurnReviewBundle.candidates must contain at most ${MAX_TEACHING_TURN_REVIEW_IPC_CANDIDATES} items.`
    )
  }
  const candidates = record.candidates.map((entry, index) =>
    parseTeachingTurnReviewCandidate(entry, index)
  )
  const bundle: TeachingTurnReviewBundle = {
    candidates,
    generatedAt: record.generatedAt
  }
  if (Object.prototype.hasOwnProperty.call(record, 'turnId')) {
    if (typeof record.turnId !== 'string' || record.turnId.length === 0) {
      throw new Error('IPC TeachingTurnReviewBundle.turnId must be a non-empty string when present.')
    }
    bundle.turnId = record.turnId
  }
  return bundle
}

function parseTeachingTurnReviewCandidate(
  value: unknown,
  index: number
): TeachingTurnReviewCandidate {
  const record = requireRecord(value)
  const allowed = new Set(['id', 'kind', 'title', 'summary', 'requiresHumanApproval', 'payload'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `IPC TeachingTurnReviewCandidate[${index}] must contain only "id", "kind", "title", "summary", "requiresHumanApproval", and optional "payload".`
      )
    }
  }
  for (const required of ['id', 'kind', 'title', 'summary', 'requiresHumanApproval'] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, required)) {
      throw new Error(`IPC TeachingTurnReviewCandidate[${index}] requires "${required}".`)
    }
  }
  const id = requireString(record.id, `candidates[${index}].id`)
  if (id.length === 0) {
    throw new Error(`IPC TeachingTurnReviewCandidate[${index}].id must be a non-empty string.`)
  }
  if (typeof record.kind !== 'string' || !TEACHING_TURN_REVIEW_CANDIDATE_KINDS.has(record.kind as TeachingTurnReviewCandidateKind)) {
    throw new Error(
      `IPC TeachingTurnReviewCandidate[${index}].kind must be one of memory_candidate|skill_pack_hint|lesson_gap|other.`
    )
  }
  const title = requireString(record.title, `candidates[${index}].title`)
  const summary = requireString(record.summary, `candidates[${index}].summary`)
  if (record.requiresHumanApproval !== true) {
    throw new Error(
      `IPC TeachingTurnReviewCandidate[${index}].requiresHumanApproval must be true (no auto apply).`
    )
  }
  const candidate: TeachingTurnReviewCandidate = {
    id,
    kind: record.kind as TeachingTurnReviewCandidateKind,
    title,
    summary,
    requiresHumanApproval: true
  }
  if (Object.prototype.hasOwnProperty.call(record, 'payload')) {
    if (
      record.payload == null ||
      typeof record.payload !== 'object' ||
      Array.isArray(record.payload)
    ) {
      throw new Error(
        `IPC TeachingTurnReviewCandidate[${index}].payload must be a plain object when present.`
      )
    }
    // Accept diagnostic payload for pure assert path; projection omits it (ADR-0085).
    candidate.payload = record.payload as Record<string, unknown>
  }
  return candidate
}

function parseTeachingTurnReviewHumanDecision(
  value: unknown,
  options: { required: boolean; candidateCount: number }
): TeachingTurnReviewHumanDecision {
  void options.required
  const record = requireRecord(value)
  const allowed = new Set(['turnId', 'decidedAt', 'decisions'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC TeachingTurnReviewHumanDecision must contain only optional "turnId", optional "decidedAt", and "decisions".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'decisions')) {
    throw new Error('IPC TeachingTurnReviewHumanDecision requires "decisions".')
  }
  if (!Array.isArray(record.decisions)) {
    throw new Error('IPC TeachingTurnReviewHumanDecision.decisions must be an array.')
  }
  // Cap decision count ≤ candidates or ≤ 8 (soft product bound).
  const decisionCap =
    options.candidateCount > 0
      ? Math.min(MAX_TEACHING_TURN_REVIEW_IPC_DECISIONS, options.candidateCount)
      : MAX_TEACHING_TURN_REVIEW_IPC_DECISIONS
  if (record.decisions.length > decisionCap) {
    throw new Error(
      `IPC TeachingTurnReviewHumanDecision.decisions must contain at most ${decisionCap} items.`
    )
  }
  const decisions: TeachingTurnReviewCandidateDecision[] = record.decisions.map((entry, index) =>
    parseTeachingTurnReviewCandidateDecision(entry, index)
  )
  const decision: TeachingTurnReviewHumanDecision = { decisions }
  if (Object.prototype.hasOwnProperty.call(record, 'turnId')) {
    if (typeof record.turnId !== 'string' || record.turnId.length === 0) {
      throw new Error('IPC TeachingTurnReviewHumanDecision.turnId must be a non-empty string when present.')
    }
    decision.turnId = record.turnId
  }
  if (Object.prototype.hasOwnProperty.call(record, 'decidedAt')) {
    if (typeof record.decidedAt !== 'string' || record.decidedAt.length === 0) {
      throw new Error(
        'IPC TeachingTurnReviewHumanDecision.decidedAt must be a non-empty string when present.'
      )
    }
    decision.decidedAt = record.decidedAt
  }
  return decision
}

function parseTeachingTurnReviewCandidateDecision(
  value: unknown,
  index: number
): TeachingTurnReviewCandidateDecision {
  const record = requireRecord(value)
  const allowed = new Set(['candidateId', 'action', 'note'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `IPC TeachingTurnReviewCandidateDecision[${index}] must contain only "candidateId", "action", and optional "note".`
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'candidateId')) {
    throw new Error(`IPC TeachingTurnReviewCandidateDecision[${index}] requires "candidateId".`)
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'action')) {
    throw new Error(`IPC TeachingTurnReviewCandidateDecision[${index}] requires "action".`)
  }
  const candidateId = requireString(record.candidateId, `decisions[${index}].candidateId`)
  if (candidateId.length === 0) {
    throw new Error(`IPC TeachingTurnReviewCandidateDecision[${index}].candidateId must be non-empty.`)
  }
  if (
    typeof record.action !== 'string' ||
    !TEACHING_TURN_REVIEW_DECISION_ACTIONS.has(record.action as TeachingTurnReviewDecisionAction)
  ) {
    throw new Error(
      `IPC TeachingTurnReviewCandidateDecision[${index}].action must be one of approve|reject|defer.`
    )
  }
  const entry: TeachingTurnReviewCandidateDecision = {
    candidateId,
    action: record.action as TeachingTurnReviewDecisionAction
  }
  if (Object.prototype.hasOwnProperty.call(record, 'note')) {
    if (typeof record.note !== 'string') {
      throw new Error(`IPC TeachingTurnReviewCandidateDecision[${index}].note must be a string when present.`)
    }
    if (record.note.length > MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH) {
      throw new Error(
        `IPC TeachingTurnReviewCandidateDecision[${index}].note must be at most ${MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH} characters.`
      )
    }
    entry.note = record.note
  }
  return entry
}

/**
 * Fail-closed parser for getTeachingTurnReviewLastBundle IPC (ADR-0114).
 * Empty / no payload only — reject unknown keys if an object is provided.
 */
export function parseGetTeachingTurnReviewLastBundlePayload(payload: unknown): undefined {
  if (payload === undefined || payload === null) {
    return undefined
  }
  const record = requireRecord(payload)
  if (Object.keys(record).length > 0) {
    throw new Error(
      'IPC getTeachingTurnReviewLastBundle payload must be empty (no keys).'
    )
  }
  return undefined
}

/**
 * Fail-closed parser for saveTeachingTurnReviewLastBundle IPC (ADR-0114).
 * Exact keys: bundle (required), decision? , source? (settings_demo|manual|unknown).
 * Never accepts autoApply / applyPlan.
 */
export function parseSaveTeachingTurnReviewLastBundlePayload(
  payload: unknown
): SaveTeachingTurnReviewLastBundlePayload {
  const record = requireRecord(payload)
  const allowed = new Set(['bundle', 'decision', 'source'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC saveTeachingTurnReviewLastBundle payload must contain only "bundle", optional "decision", and optional "source".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'bundle')) {
    throw new Error('IPC saveTeachingTurnReviewLastBundle payload requires "bundle".')
  }
  const bundle = parseTeachingTurnReviewBundle(record.bundle)
  const result: SaveTeachingTurnReviewLastBundlePayload = { bundle }

  if (Object.prototype.hasOwnProperty.call(record, 'decision')) {
    result.decision = parseTeachingTurnReviewHumanDecision(record.decision, {
      required: false,
      candidateCount: bundle.candidates.length
    })
  }

  if (Object.prototype.hasOwnProperty.call(record, 'source')) {
    const source = record.source
    if (source !== 'settings_demo' && source !== 'manual' && source !== 'unknown') {
      throw new Error(
        'IPC saveTeachingTurnReviewLastBundle payload.source must be settings_demo|manual|unknown when present.'
      )
    }
    result.source = source
  }

  return result
}
