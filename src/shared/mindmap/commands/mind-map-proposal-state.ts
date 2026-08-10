/**
 * Pure lifecycle state for a reviewable mind-map AI proposal.
 *
 * The command proposal itself stays in the command layer and is applied through
 * `applyMindMapProposal`. This module only records the review lifecycle, so it
 * can be used by a renderer before any provider or persistence wiring exists.
 * In particular, a terminal proposal cannot be accepted again after it has been
 * rejected or cancelled.
 */
import type {
  MindMapProposalDecision,
  MindMapProposalItem
} from './mind-map-proposal'

export const MIND_MAP_PROPOSAL_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'cancelled'
] as const

export type MindMapProposalStatus = (typeof MIND_MAP_PROPOSAL_STATUSES)[number]

export type MindMapProposalState = {
  /** Correlates this review state with one proposal, not with a provider run. */
  proposalId: string
  /** Stable proposal item ids in the original diff order. */
  itemIds: readonly string[]
  /** Explicit per-item review choices; absent means not reviewed yet. */
  decisions: Readonly<Record<string, MindMapProposalDecision>>
  status: MindMapProposalStatus
}

export type MindMapProposalTrigger =
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'cancel' }

export type MindMapProposalTransitionKind = 'applied' | 'idempotent' | 'illegal'

export type MindMapProposalTransitionResult = {
  ok: boolean
  kind: MindMapProposalTransitionKind
  from: MindMapProposalStatus
  to: MindMapProposalStatus
  trigger: MindMapProposalTrigger
  state: MindMapProposalState
  /** Present only when the trigger is denied; never silently coerces status. */
  reason?: string
}

/** Explicit legal lifecycle edges. */
export const LEGAL_MIND_MAP_PROPOSAL_EDGES: Readonly<Record<string, MindMapProposalStatus>> = Object.freeze({
  'pending|accept': 'accepted',
  'pending|reject': 'rejected',
  'pending|cancel': 'cancelled'
})

const STATUS_SET = new Set<string>(MIND_MAP_PROPOSAL_STATUSES)
const TRIGGER_TO_TERMINAL_STATUS: Readonly<Record<MindMapProposalTrigger['type'], MindMapProposalStatus>> = {
  accept: 'accepted',
  reject: 'rejected',
  cancel: 'cancelled'
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isProposalStatus(value: unknown): value is MindMapProposalStatus {
  return typeof value === 'string' && STATUS_SET.has(value)
}

function cloneState(state: MindMapProposalState): MindMapProposalState {
  return {
    proposalId: state.proposalId,
    itemIds: [...state.itemIds],
    decisions: { ...state.decisions },
    status: state.status
  }
}

function assertItemIds(itemIds: readonly string[]): void {
  const seen = new Set<string>()
  for (const itemId of itemIds) {
    if (!isNonEmptyId(itemId)) {
      throw new Error('Mind-map proposal item ids must not be empty')
    }
    if (seen.has(itemId)) {
      throw new Error(`Duplicate mind-map proposal item id "${itemId}"`)
    }
    seen.add(itemId)
  }
}

function assertState(state: MindMapProposalState): void {
  if (!isNonEmptyId(state.proposalId)) {
    throw new Error('Mind-map proposal id must not be empty')
  }
  if (!isProposalStatus(state.status)) {
    throw new Error(`Unknown mind-map proposal status: ${String(state.status)}`)
  }
  assertItemIds(state.itemIds)

  const itemIds = new Set(state.itemIds)
  for (const [itemId, decision] of Object.entries(state.decisions)) {
    if (!itemIds.has(itemId)) {
      throw new Error(`Decision references unknown mind-map proposal item "${itemId}"`)
    }
    if (decision !== 'accept' && decision !== 'reject') {
      throw new Error(`Unknown mind-map proposal decision for "${itemId}"`)
    }
  }
}

/** Create a pending review state without invoking a provider or mutating items. */
export function createMindMapProposalState(
  proposalId: string,
  items: readonly MindMapProposalItem[]
): MindMapProposalState {
  const itemIds = items.map((item) => item.id)
  const state: MindMapProposalState = {
    proposalId,
    itemIds,
    decisions: {},
    status: 'pending'
  }
  assertState(state)
  return state
}

/**
 * Record one review decision while the proposal is still pending.
 *
 * This helper is deliberately separate from lifecycle settlement: choosing an
 * item is not the same as applying the resulting command transaction.
 */
export function setMindMapProposalDecision(
  state: MindMapProposalState,
  itemId: string,
  decision: MindMapProposalDecision
): MindMapProposalState {
  assertState(state)
  if (state.status !== 'pending') {
    throw new Error(`Cannot review a ${state.status} mind-map proposal`)
  }
  if (!state.itemIds.includes(itemId)) {
    throw new Error(`Unknown mind-map proposal item "${itemId}"`)
  }
  if (decision !== 'accept' && decision !== 'reject') {
    throw new Error(`Unknown mind-map proposal decision for "${itemId}"`)
  }

  return {
    ...cloneState(state),
    decisions: { ...state.decisions, [itemId]: decision }
  }
}

/**
 * Advance a proposal through its one-way review lifecycle.
 *
 * Repeating the same terminal action is an idempotent no-op, while trying to
 * change a terminal outcome is illegal. The returned state is always a fresh
 * value, so callers can safely keep immutable renderer snapshots.
 */
export function transitionMindMapProposal(
  state: MindMapProposalState,
  trigger: MindMapProposalTrigger
): MindMapProposalTransitionResult {
  assertState(state)
  const from = state.status
  const terminalStatus = TRIGGER_TO_TERMINAL_STATUS[trigger.type]

  if (from !== 'pending' && terminalStatus === from) {
    return {
      ok: true,
      kind: 'idempotent',
      from,
      to: from,
      trigger,
      state: cloneState(state)
    }
  }

  const next = LEGAL_MIND_MAP_PROPOSAL_EDGES[`${from}|${trigger.type}`]
  if (!next) {
    return {
      ok: false,
      kind: 'illegal',
      from,
      to: from,
      trigger,
      state: cloneState(state),
      reason: `Illegal mind-map proposal transition: ${from} --${trigger.type}--> (denied)`
    }
  }

  return {
    ok: true,
    kind: 'applied',
    from,
    to: next,
    trigger,
    state: { ...cloneState(state), status: next }
  }
}

type SerializedMindMapProposalState = {
  schemaVersion: 1
  proposalId: string
  itemIds: string[]
  decisions: Record<string, MindMapProposalDecision>
  status: MindMapProposalStatus
}

/** Serialize only review state; command payloads remain outside this boundary. */
export function serializeMindMapProposalState(state: MindMapProposalState): string {
  assertState(state)
  const serialized: SerializedMindMapProposalState = {
    schemaVersion: 1,
    proposalId: state.proposalId,
    itemIds: [...state.itemIds],
    decisions: Object.fromEntries(
      Object.entries(state.decisions).sort(([left], [right]) => left.localeCompare(right))
    ),
    status: state.status
  }
  return JSON.stringify(serialized)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fail-closed parser for persisted/replayed review state.
 *
 * Unknown keys, malformed decisions, duplicate ids and unsupported schema
 * versions return null rather than being guessed into an executable outcome.
 */
export function deserializeMindMapProposalState(
  serialized: string
): MindMapProposalState | null {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }
  if (!isPlainRecord(value) || value.schemaVersion !== 1) return null

  const allowedKeys = new Set(['schemaVersion', 'proposalId', 'itemIds', 'decisions', 'status'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null
  if (!isNonEmptyId(value.proposalId) || !isProposalStatus(value.status)) return null
  if (!Array.isArray(value.itemIds) || !value.itemIds.every(isNonEmptyId)) return null
  if (!isPlainRecord(value.decisions)) return null

  const itemIds = value.itemIds as string[]
  try {
    assertItemIds(itemIds)
  } catch {
    return null
  }

  const decisions: Record<string, MindMapProposalDecision> = {}
  const itemIdSet = new Set(itemIds)
  for (const [itemId, decision] of Object.entries(value.decisions)) {
    if (!itemIdSet.has(itemId)) return null
    if (decision !== 'accept' && decision !== 'reject') return null
    decisions[itemId] = decision
  }

  const state: MindMapProposalState = {
    proposalId: value.proposalId,
    itemIds: [...itemIds],
    decisions,
    status: value.status
  }
  try {
    assertState(state)
  } catch {
    return null
  }
  return state
}
