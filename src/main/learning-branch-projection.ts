import { createHash } from 'node:crypto'

import { planNextTeachingStep } from './next-teaching-step-planner'
import type {
  NextTeachingStepAction,
  NextTeachingStepDecision,
  NextTeachingStepFacts,
  NextTeachingStepReason
} from '../shared/teaching-types/next-teaching-step'
import {
  LEARNING_BRANCH_PROJECTION_SCHEMA_VERSION,
  type LearningBranchHistorySessionSummary,
  type LearningBranchNode,
  type LearningBranchNodeKind,
  type LearningBranchNodeReason,
  type LearningBranchProjection,
  type LearningBranchProjectionFacts
} from '../shared/teaching-types/learning-branch-projection'

/**
 * Read-only Learning Branch Projection (P2-1).
 *
 * Derives primary + alternate branch views from durable session/planner facts.
 * Never performs I/O, never writes outcome/session/ledger, and never invents
 * canonical truth for counterfactual alternate paths.
 */
export interface LearningBranchProjector {
  project(facts: LearningBranchProjectionFacts): LearningBranchProjection
}

export type ProjectLearningBranchOptions = {
  /** Injected clock for optional generatedAt; fingerprint never includes it. */
  now?: () => string
}

export function createLearningBranchProjector(
  options: ProjectLearningBranchOptions = {}
): LearningBranchProjector {
  const now = options.now
  return {
    project(facts) {
      return projectLearningBranch(facts, now ? { now } : undefined)
    }
  }
}

/**
 * Pure projector. Deterministic for the same facts; no random state, no I/O.
 */
export function projectLearningBranch(
  facts: LearningBranchProjectionFacts,
  options: ProjectLearningBranchOptions = {}
): LearningBranchProjection {
  const plannerFacts = toPlannerFacts(facts)
  const primaryDecision = planNextTeachingStep(plannerFacts)

  const sessionNodeId = nodeId('session', facts.latestSession.id)
  const primaryStepId = nodeId('primary', primaryDecision.action, primaryDecision.reason)

  const sessionNode: LearningBranchNode = {
    id: sessionNodeId,
    kind: 'primary',
    action: null,
    reason: 'session_anchor',
    parentNodeId: null,
    sessionId: facts.latestSession.id,
    canonical: true
  }

  const primaryStepNode: LearningBranchNode = {
    id: primaryStepId,
    kind: kindForAction(primaryDecision.action),
    action: primaryDecision.action,
    reason: primaryDecision.reason,
    parentNodeId: sessionNodeId,
    sessionId: facts.latestSession.id,
    canonical: true
  }

  const nodes: LearningBranchNode[] = [sessionNode, primaryStepNode]
  const primaryPath: string[] = [sessionNodeId, primaryStepId]
  const alternatePaths: string[][] = []

  // Counterfactual alternate branches — projections only, never canonical.
  for (const alternate of buildAlternateScenarios(facts, primaryDecision)) {
    const altId = nodeId('alt', alternate.kind, alternate.reason)
    nodes.push({
      id: altId,
      kind: alternate.kind,
      action: alternate.action,
      reason: alternate.reason,
      parentNodeId: sessionNodeId,
      sessionId: facts.latestSession.id,
      canonical: false
    })
    alternatePaths.push([sessionNodeId, altId])
  }

  // Optional historical session summaries (id/status/outcomeKind only).
  for (const history of stableHistory(facts.historySessions)) {
    const historyId = nodeId('history', history.id)
    nodes.push({
      id: historyId,
      kind: 'historical',
      action: null,
      reason: 'historical_session',
      parentNodeId: null,
      sessionId: history.id,
      canonical: false
    })
  }

  const body = {
    schemaVersion: LEARNING_BRANCH_PROJECTION_SCHEMA_VERSION,
    nodes: nodes.map(freezeNodeView),
    primaryPath: [...primaryPath],
    alternatePaths: alternatePaths.map((path) => [...path])
  }

  const projection: LearningBranchProjection = {
    ...body,
    fingerprint: fingerprintLearningBranchProjection(body)
  }

  if (options.now) {
    projection.generatedAt = options.now()
  }

  return projection
}

/**
 * Deterministic secret-free fingerprint over the projection body.
 * generatedAt is intentionally excluded so clocks never poison identity.
 */
export function fingerprintLearningBranchProjection(
  body: Omit<LearningBranchProjection, 'fingerprint' | 'generatedAt'>
): string {
  const digest = createHash('sha256').update(stableSerialize(body)).digest('hex')
  return `sha256:${digest}`
}

type AlternateScenario = {
  kind: Exclude<LearningBranchNodeKind, 'primary' | 'historical'>
  action: NextTeachingStepAction
  reason: LearningBranchNodeReason
}

function buildAlternateScenarios(
  facts: LearningBranchProjectionFacts,
  primary: NextTeachingStepDecision
): AlternateScenario[] {
  const alternates: AlternateScenario[] = []

  // Legacy / read-only sessions stay on clarification only — no remediation branches.
  if (facts.latestSession.readOnly || facts.latestSession.source === 'legacy_lesson') {
    return alternates
  }

  // What if the durable outcome were needs_practice with verified evidence?
  if (!(primary.action === 'contrast_and_retry' && primary.reason === 'needs_practice')) {
    alternates.push({
      kind: 'retry',
      action: 'contrast_and_retry',
      reason: 'alternate_needs_practice'
    })
  }

  // What if the durable outcome were not_evidenced?
  if (
    !(
      primary.action === 'request_goal_clarification' &&
      (primary.reason === 'insufficient_evidence' || primary.reason === 'outcome_unavailable')
    )
  ) {
    alternates.push({
      kind: 'clarification',
      action: 'request_goal_clarification',
      reason: 'alternate_not_evidenced'
    })
  }

  // What if required resources were not ready?
  if (!(primary.action === 'wait_for_resources' && primary.reason === 'resources_not_ready')) {
    alternates.push({
      kind: 'resource_wait',
      action: 'wait_for_resources',
      reason: 'alternate_resources_not_ready'
    })
  }

  return alternates
}

function toPlannerFacts(facts: LearningBranchProjectionFacts): NextTeachingStepFacts {
  return {
    mission: {
      id: facts.mission.id,
      nextGoal: facts.mission.nextGoal
    },
    course: {
      id: facts.course.id
    },
    latestSession: {
      id: facts.latestSession.id,
      source: facts.latestSession.source,
      readOnly: facts.latestSession.readOnly
    },
    durableOutcome: facts.durableOutcome,
    evidence: {
      status: facts.evidence.status
    },
    resources: {
      readiness: facts.resources.readiness,
      availableCount: facts.resources.availableCount,
      provenanceIds: facts.resources.provenanceIds
    }
  }
}

function kindForAction(action: NextTeachingStepAction): LearningBranchNodeKind {
  switch (action) {
    case 'contrast_and_retry':
      return 'retry'
    case 'continue_next_session':
      return 'primary'
    // ADR-0003: due review is the recommended forward branch (not remediation);
    // a dedicated branch node kind would extend the ADR-0001 closed union.
    case 'review_due':
      return 'primary'
    case 'request_goal_clarification':
      return 'clarification'
    case 'wait_for_resources':
      return 'resource_wait'
  }
}

function stableHistory(
  sessions: readonly LearningBranchHistorySessionSummary[] | undefined
): LearningBranchHistorySessionSummary[] {
  if (!sessions || sessions.length === 0) return []
  const byId = new Map<string, LearningBranchHistorySessionSummary>()
  for (const session of sessions) {
    if (!session?.id) continue
    // First-seen wins; keep deterministic by later sort.
    if (!byId.has(session.id)) {
      byId.set(session.id, {
        id: session.id,
        status: session.status,
        outcomeKind: session.outcomeKind
      })
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function freezeNodeView(node: LearningBranchNode): LearningBranchNode {
  return {
    id: node.id,
    kind: node.kind,
    action: node.action,
    reason: node.reason,
    parentNodeId: node.parentNodeId,
    sessionId: node.sessionId,
    canonical: node.canonical
  }
}

function nodeId(...parts: Array<string | NextTeachingStepAction | NextTeachingStepReason | LearningBranchNodeReason>): string {
  return parts.map((part) => String(part)).join(':')
}

/**
 * Stable JSON with sorted object keys so fingerprint does not depend on insertion order.
 */
function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key])
    }
    return out
  }
  return value
}
