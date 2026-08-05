import { randomUUID } from 'node:crypto'

/**
 * Process-local, main-only host lane for serializing conversation-turn intents.
 *
 * The lane reserves active identities and owns a bounded FIFO plus process-local
 * idempotency receipts. It deliberately does not start models, read canonical
 * conversation state, perform CAS, or settle teaching outcomes.
 */

export type ConversationLaneScope = 'workspace' | 'temporary'

/**
 * ADR-0170 §3.1 identity. Canonical and pending identities are deliberately
 * discriminated: they must never be guessed from one shared optional field.
 */
export type ConversationLaneKey =
  | Readonly<{
      kind: 'canonical'
      workspaceId: string
      scope: ConversationLaneScope
      conversationId: string
    }>
  | Readonly<{
      kind: 'pending'
      workspaceId: string
      scope: ConversationLaneScope
      pendingConversationId: string
    }>

export type SubmitConversationTurnIntent = Readonly<{
  target: ConversationLaneKey
  clientRequestId: string
  text: string
  mode: 'teaching' | 'temporary'
  delivery: 'follow_up' | 'steer'
  expectedBranchRevision?: number
  expectedActiveTurnId?: string
  skillIds?: string[]
}>

export type SubmitConversationTurnDisposition =
  | Readonly<{ code: 'started'; activeTurnId: string; streamId: string; conversationId?: string }>
  | Readonly<{ code: 'queued'; queuePosition: number; activeTurnId: string }>
  | Readonly<{ code: 'steered'; activeTurnId: string; streamId: string }>
  | Readonly<{
      code: 'duplicate'
      originalCode: 'started' | 'queued' | 'steered' | 'refresh_required' | 'rejected'
    }>
  | Readonly<{
      code: 'refresh_required'
      reason: 'stale_branch' | 'active_turn_mismatch' | 'pending_promoted'
    }>
  | Readonly<{ code: 'rejected'; reason: 'invalid_intent' | 'queue_full' | 'branch_unavailable' }>

export type CancelConversationTurnIntent = Readonly<{
  target: ConversationLaneKey
  clientRequestId: string
  expectedActiveTurnId: string
}>

export type CancelConversationTurnDisposition =
  | Readonly<{ code: 'cancelled'; cancelledActiveTurnId: string; clearedQueuedCount: number }>
  | Readonly<{ code: 'duplicate'; originalCode: 'cancelled' | 'refresh_required' | 'rejected' }>
  | Readonly<{ code: 'refresh_required'; reason: 'active_turn_mismatch' | 'pending_promoted' }>
  | Readonly<{ code: 'rejected'; reason: 'invalid_intent' | 'lane_unavailable' }>

/** Active reservation handed to the gateway when a queued follow-up drains. */
export type AgentConversationTurnLaneActiveReservation = Readonly<{
  target: ConversationLaneKey
  activeTurnId: string
  streamId: string
  intent: SubmitConversationTurnIntent
}>

export type AgentConversationTurnLaneRelease =
  | Readonly<{ code: 'released'; next?: AgentConversationTurnLaneActiveReservation }>
  | Readonly<{ code: 'not_active' | 'active_turn_mismatch' | 'stream_mismatch' | 'invalid_intent' }>

export type PromotePendingConversationLaneDisposition =
  | Readonly<{ code: 'rekeyed'; target: Extract<ConversationLaneKey, { kind: 'canonical' }> }>
  | Readonly<{ code: 'rejected'; reason: 'invalid_intent' | 'lane_unavailable' | 'canonical_lane_occupied' }>

export type AgentConversationTurnLaneActiveSnapshot = Readonly<{
  activeTurnId: string
  streamId: string
  cancelRequested: boolean
}>

export type AgentConversationTurnLaneSnapshot = Readonly<{
  key: ConversationLaneKey
  phase: 'idle' | 'active' | 'canceling'
  queueDepth: number
  queueCapacity: number
  active?: AgentConversationTurnLaneActiveSnapshot
}>

export type AgentConversationTurnLanesSnapshot = Readonly<{
  queueCapacity: number
  lanes: readonly AgentConversationTurnLaneSnapshot[]
}>

/** ADR-0170 §4.3: queued follow-ups only; an active turn is not counted. */
export const AGENT_CONVERSATION_TURN_LANE_QUEUE_HARD_CAP = 32

type SubmitReceipt = Readonly<{
  code: 'started' | 'queued' | 'steered' | 'refresh_required' | 'rejected'
}>

type CancelReceipt = Readonly<{
  code: 'cancelled' | 'refresh_required' | 'rejected'
}>

type Active = {
  activeTurnId: string
  streamId: string
  intent: SubmitConversationTurnIntent
  cancelRequested: boolean
}

type Lane = {
  key: ConversationLaneKey
  active?: Active
  queued: SubmitConversationTurnIntent[]
  submitReceipts: Map<string, SubmitReceipt>
  cancelReceipts: Map<string, CancelReceipt>
}

let nextActiveTurnNumber = 0

function defaultActiveTurnId(): string {
  nextActiveTurnNumber += 1
  return `conversation-active-turn-${nextActiveTurnNumber}`
}

function defaultStreamId(): string {
  // streamId is also the durable AgentRun id, so process-local counters would
  // collide with checkpoints left by an earlier application process.
  return `conversation-stream-${randomUUID()}`
}

/**
 * Normalizes exactly one ADR identity variant without changing identifier case.
 * Whitespace around opaque ids is not meaningful; all other bytes remain exact.
 */
export function normalizeConversationLaneKey(input: unknown): ConversationLaneKey | null {
  if (!isRecord(input) || (input.scope !== 'workspace' && input.scope !== 'temporary')) return null
  const workspaceId = normalizedNonEmpty(input.workspaceId)
  if (!workspaceId || (input.kind !== 'canonical' && input.kind !== 'pending')) return null

  if (input.kind === 'canonical') {
    if (Object.hasOwn(input, 'pendingConversationId')) return null
    const conversationId = normalizedNonEmpty(input.conversationId)
    return conversationId
      ? Object.freeze({ kind: 'canonical', workspaceId, scope: input.scope, conversationId })
      : null
  }

  if (Object.hasOwn(input, 'conversationId')) return null
  const pendingConversationId = normalizedNonEmpty(input.pendingConversationId)
  return pendingConversationId
    ? Object.freeze({ kind: 'pending', workspaceId, scope: input.scope, pendingConversationId })
    : null
}

/**
 * Main-only synchronous serialization seam. Each method linearizes its own
 * state change in one JavaScript turn; gateways must handle all awaits and
 * canonical read/CAS/settlement outside this pure state machine.
 */
export class AgentConversationTurnLane {
  private readonly lanes = new Map<string, Lane>()
  /** Only lives while the rekeyed lane is retained in this process. */
  private readonly pendingPromotions = new Map<string, ConversationLaneKey>()
  private readonly activeTurnIdFactory: () => string
  private readonly streamIdFactory: () => string

  constructor(options: { activeTurnIdFactory?: () => string; streamIdFactory?: () => string } = {}) {
    this.activeTurnIdFactory = options.activeTurnIdFactory ?? defaultActiveTurnId
    this.streamIdFactory = options.streamIdFactory ?? defaultStreamId
  }

  submit(input: SubmitConversationTurnIntent): SubmitConversationTurnDisposition {
    const target = normalizeConversationLaneKey(input?.target)
    const clientRequestId = normalizedNonEmpty(input?.clientRequestId)
    if (!target || !clientRequestId || !isValidSubmitIntent(input, target)) {
      return { code: 'rejected', reason: 'invalid_intent' }
    }

    const promotedTarget = target.kind === 'pending' ? this.pendingPromotions.get(keyId(target)) : undefined
    if (promotedTarget) {
      const promotedLane = this.lanes.get(keyId(promotedTarget))
      const prior = promotedLane?.submitReceipts.get(clientRequestId)
      if (prior) return { code: 'duplicate', originalCode: prior.code }
      promotedLane?.submitReceipts.set(clientRequestId, { code: 'refresh_required' })
      return { code: 'refresh_required', reason: 'pending_promoted' }
    }

    const lane = this.laneFor(target)
    const prior = lane.submitReceipts.get(clientRequestId)
    if (prior) return { code: 'duplicate', originalCode: prior.code }

    if (input.delivery === 'steer') {
      const expectedActiveTurnId = normalizedNonEmpty(input.expectedActiveTurnId)
      const active = lane.active
      if (!expectedActiveTurnId || !active || active.activeTurnId !== expectedActiveTurnId) {
        lane.submitReceipts.set(clientRequestId, { code: 'refresh_required' })
        return { code: 'refresh_required', reason: 'active_turn_mismatch' }
      }
      lane.submitReceipts.set(clientRequestId, { code: 'steered' })
      return { code: 'steered', activeTurnId: active.activeTurnId, streamId: active.streamId }
    }

    if (!lane.active) {
      const active = this.reserve(input)
      lane.active = active
      lane.submitReceipts.set(clientRequestId, { code: 'started' })
      return {
        code: 'started',
        activeTurnId: active.activeTurnId,
        streamId: active.streamId,
        ...(target.kind === 'canonical' ? { conversationId: target.conversationId } : {})
      }
    }

    if (lane.queued.length >= AGENT_CONVERSATION_TURN_LANE_QUEUE_HARD_CAP) {
      lane.submitReceipts.set(clientRequestId, { code: 'rejected' })
      return { code: 'rejected', reason: 'queue_full' }
    }

    lane.queued.push(input)
    lane.submitReceipts.set(clientRequestId, { code: 'queued' })
    return { code: 'queued', queuePosition: lane.queued.length, activeTurnId: lane.active.activeTurnId }
  }

  /**
   * Cancels only the exact active reservation and clears only this lane's queued
   * follow-ups. The gateway aborts/settles the runtime, then calls complete/fail.
   */
  cancel(input: CancelConversationTurnIntent): CancelConversationTurnDisposition {
    const target = normalizeConversationLaneKey(input?.target)
    const clientRequestId = normalizedNonEmpty(input?.clientRequestId)
    const expectedActiveTurnId = normalizedNonEmpty(input?.expectedActiveTurnId)
    if (!target || !clientRequestId || !expectedActiveTurnId) {
      return { code: 'rejected', reason: 'invalid_intent' }
    }

    const promotedTarget = target.kind === 'pending' ? this.pendingPromotions.get(keyId(target)) : undefined
    if (promotedTarget) {
      const promotedLane = this.lanes.get(keyId(promotedTarget))
      const prior = promotedLane?.cancelReceipts.get(clientRequestId)
      if (prior) return { code: 'duplicate', originalCode: prior.code }
      promotedLane?.cancelReceipts.set(clientRequestId, { code: 'refresh_required' })
      return { code: 'refresh_required', reason: 'pending_promoted' }
    }

    const lane = this.lanes.get(keyId(target))
    if (!lane) return { code: 'rejected', reason: 'lane_unavailable' }
    const prior = lane.cancelReceipts.get(clientRequestId)
    if (prior) return { code: 'duplicate', originalCode: prior.code }

    const active = lane.active
    if (!active || active.activeTurnId !== expectedActiveTurnId) {
      lane.cancelReceipts.set(clientRequestId, { code: 'refresh_required' })
      return { code: 'refresh_required', reason: 'active_turn_mismatch' }
    }

    const clearedQueuedCount = lane.queued.length
    lane.queued.splice(0, lane.queued.length)
    active.cancelRequested = true
    lane.cancelReceipts.set(clientRequestId, { code: 'cancelled' })
    return { code: 'cancelled', cancelledActiveTurnId: active.activeTurnId, clearedQueuedCount }
  }

  /** Complete an exact active turn and atomically promote the next FIFO follow-up. */
  complete(input: { target: ConversationLaneKey; activeTurnId: string; streamId: string }): AgentConversationTurnLaneRelease {
    return this.release(input)
  }

  /** Failures release the lane identically to a normal completion. */
  fail(input: { target: ConversationLaneKey; activeTurnId: string; streamId: string }): AgentConversationTurnLaneRelease {
    return this.release(input)
  }

  /** Resource terminals release the active reservation without auto-starting queued turns. */
  suspend(input: { target: ConversationLaneKey; activeTurnId: string; streamId: string }): AgentConversationTurnLaneRelease {
    return this.release(input, false)
  }

  /**
   * Atomically promotes a pending lane after its first canonical record exists.
   * Queued intents remain on the same lane object and retain their FIFO order.
   */
  promotePending(input: {
    pendingTarget: ConversationLaneKey
    canonicalTarget: ConversationLaneKey
  }): PromotePendingConversationLaneDisposition {
    const pendingTarget = normalizeConversationLaneKey(input?.pendingTarget)
    const canonicalTarget = normalizeConversationLaneKey(input?.canonicalTarget)
    if (
      !pendingTarget ||
      !canonicalTarget ||
      pendingTarget.kind !== 'pending' ||
      canonicalTarget.kind !== 'canonical' ||
      pendingTarget.workspaceId !== canonicalTarget.workspaceId ||
      pendingTarget.scope !== canonicalTarget.scope
    ) return { code: 'rejected', reason: 'invalid_intent' }

    const pendingId = keyId(pendingTarget)
    const lane = this.lanes.get(pendingId)
    if (!lane) return { code: 'rejected', reason: 'lane_unavailable' }
    if (this.lanes.has(keyId(canonicalTarget))) return { code: 'rejected', reason: 'canonical_lane_occupied' }

    this.lanes.delete(pendingId)
    lane.key = canonicalTarget
    if (lane.active) lane.active.intent = retargetIntent(lane.active.intent, canonicalTarget)
    lane.queued = lane.queued.map((intent) => retargetIntent(intent, canonicalTarget))
    this.lanes.set(keyId(canonicalTarget), lane)
    this.pendingPromotions.set(pendingId, canonicalTarget)
    return { code: 'rekeyed', target: canonicalTarget }
  }

  /** Explicit bounded-housekeeping hook; only idle lanes and their receipts are removed. */
  evictIdle(): number {
    let removed = 0
    for (const [id, lane] of this.lanes) {
      if (lane.active || lane.queued.length) continue
      this.lanes.delete(id)
      for (const [pendingId, canonicalTarget] of this.pendingPromotions) {
        if (keyId(canonicalTarget) === id) this.pendingPromotions.delete(pendingId)
      }
      removed += 1
    }
    return removed
  }

  /** Read-only projection: never exposes text, skill ids, request ids, or receipts. */
  snapshot(): AgentConversationTurnLanesSnapshot {
    const lanes = [...this.lanes.values()]
      .sort((left, right) => keyId(left.key).localeCompare(keyId(right.key)))
      .map(freezeLaneSnapshot)
    return Object.freeze({
      queueCapacity: AGENT_CONVERSATION_TURN_LANE_QUEUE_HARD_CAP,
      lanes: Object.freeze(lanes)
    })
  }

  private release(input: { target: ConversationLaneKey; activeTurnId: string; streamId: string }, continueQueued = true): AgentConversationTurnLaneRelease {
    const target = normalizeConversationLaneKey(input?.target)
    const activeTurnId = normalizedNonEmpty(input?.activeTurnId)
    const streamId = normalizedNonEmpty(input?.streamId)
    if (!target || !activeTurnId || !streamId) return { code: 'invalid_intent' }

    const lane = this.lanes.get(keyId(this.resolveInternalTarget(target)))
    const active = lane?.active
    if (!active) return { code: 'not_active' }
    if (active.activeTurnId !== activeTurnId) return { code: 'active_turn_mismatch' }
    if (active.streamId !== streamId) return { code: 'stream_mismatch' }

    lane.active = undefined
    if (!continueQueued) {
      lane.queued.splice(0, lane.queued.length)
      return { code: 'released' }
    }
    const nextIntent = lane.queued.shift()
    if (!nextIntent) return { code: 'released' }

    const next = this.reserve(nextIntent)
    lane.active = next
    return { code: 'released', next: toActiveReservation(lane.key, next) }
  }

  private laneFor(key: ConversationLaneKey): Lane {
    const id = keyId(key)
    const existing = this.lanes.get(id)
    if (existing) return existing
    const created: Lane = {
      key,
      queued: [],
      submitReceipts: new Map(),
      cancelReceipts: new Map()
    }
    this.lanes.set(id, created)
    return created
  }

  private reserve(intent: SubmitConversationTurnIntent): Active {
    return {
      activeTurnId: this.activeTurnIdFactory(),
      streamId: this.streamIdFactory(),
      intent,
      cancelRequested: false
    }
  }

  private resolveInternalTarget(target: ConversationLaneKey): ConversationLaneKey {
    return target.kind === 'pending' ? this.pendingPromotions.get(keyId(target)) ?? target : target
  }
}

function retargetIntent(intent: SubmitConversationTurnIntent, target: ConversationLaneKey): SubmitConversationTurnIntent {
  return Object.freeze({ ...intent, target })
}

function toActiveReservation(target: ConversationLaneKey, active: Active): AgentConversationTurnLaneActiveReservation {
  return Object.freeze({
    target,
    activeTurnId: active.activeTurnId,
    streamId: active.streamId,
    intent: active.intent
  })
}

function freezeLaneSnapshot(lane: Lane): AgentConversationTurnLaneSnapshot {
  const active = lane.active
  return Object.freeze({
    key: lane.key,
    phase: active ? (active.cancelRequested ? 'canceling' : 'active') : 'idle',
    queueDepth: lane.queued.length,
    queueCapacity: AGENT_CONVERSATION_TURN_LANE_QUEUE_HARD_CAP,
    ...(active
      ? {
          active: Object.freeze({
            activeTurnId: active.activeTurnId,
            streamId: active.streamId,
            cancelRequested: active.cancelRequested
          })
        }
      : {})
  })
}

function isValidSubmitIntent(input: SubmitConversationTurnIntent, target: ConversationLaneKey): boolean {
  if (!isRecord(input) || typeof input.text !== 'string' || !input.text.trim()) return false
  if (input.delivery !== 'follow_up' && input.delivery !== 'steer') return false
  if (input.delivery === 'steer' && !normalizedNonEmpty(input.expectedActiveTurnId)) return false
  if (input.mode !== (target.scope === 'workspace' ? 'teaching' : 'temporary')) return false
  if (input.expectedBranchRevision !== undefined && !isRevision(input.expectedBranchRevision)) return false
  if (input.expectedActiveTurnId !== undefined && !normalizedNonEmpty(input.expectedActiveTurnId)) return false
  return input.skillIds === undefined || (Array.isArray(input.skillIds) && input.skillIds.every((skillId) => Boolean(normalizedNonEmpty(skillId))))
}

function keyId(key: ConversationLaneKey): string {
  return key.kind === 'canonical'
    ? JSON.stringify([key.workspaceId, key.scope, 'conversation', key.conversationId])
    : JSON.stringify([key.workspaceId, key.scope, 'pending', key.pendingConversationId])
}

function normalizedNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
