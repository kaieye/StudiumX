import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  ConversationLaneKey,
  SubmitConversationTurnDisposition,
  SubmitConversationTurnIntent,
  CancelConversationTurnDisposition,
  CancelConversationTurnIntent
} from '../../src/shared/teaching-types/agent'
import type { TeachingSystemApi } from '../../src/shared/teaching-types/system-api'

type ExpectedConversationLaneKey =
  | {
      kind: 'canonical'
      workspaceId: string
      scope: 'workspace' | 'temporary'
      conversationId: string
    }
  | {
      kind: 'pending'
      workspaceId: string
      scope: 'workspace' | 'temporary'
      pendingConversationId: string
    }

type ExpectedSubmitConversationTurnIntent = {
  target: ExpectedConversationLaneKey
  clientRequestId: string
  text: string
  mode: 'teaching' | 'temporary'
  delivery: 'follow_up' | 'steer'
  expectedBranchRevision?: number
  expectedActiveTurnId?: string
  skillIds?: string[]
}

type ExpectedSubmitConversationTurnDisposition =
  | { code: 'started'; activeTurnId: string; streamId: string; conversationId?: string }
  | { code: 'queued'; queuePosition: number; activeTurnId: string }
  | { code: 'steered'; activeTurnId: string; streamId: string }
  | {
      code: 'duplicate'
      originalCode: 'started' | 'queued' | 'steered' | 'refresh_required' | 'rejected'
    }
  | {
      code: 'refresh_required'
      reason: 'stale_branch' | 'active_turn_mismatch' | 'pending_promoted'
    }
  | { code: 'rejected'; reason: 'invalid_intent' | 'queue_full' | 'branch_unavailable' }


type ExpectedCancelConversationTurnIntent = {
  target: ExpectedConversationLaneKey
  clientRequestId: string
  expectedActiveTurnId: string
}

type ExpectedCancelConversationTurnDisposition =
  | { code: 'cancelled'; cancelledActiveTurnId: string; clearedQueuedCount: number }
  | { code: 'duplicate'; originalCode: 'cancelled' | 'refresh_required' | 'rejected' }
  | { code: 'refresh_required'; reason: 'active_turn_mismatch' | 'pending_promoted' }
  | { code: 'rejected'; reason: 'invalid_intent' | 'lane_unavailable' }

type ForbiddenIntentKeys =
  | 'workspaceId'
  | 'scope'
  | 'conversationId'
  | 'pendingConversationId'
  | 'messages'
  | 'turns'
  | 'transcript'
  | 'context'
  | 'toolCalls'
  | 'toolResults'
  | 'secret'
  | 'token'

type HasNoForbiddenFields<T, Forbidden extends PropertyKey> = T extends unknown
  ? Extract<keyof T, Forbidden> extends never
    ? true
    : false
  : never
type IntentHasNoForbiddenFields = HasNoForbiddenFields<SubmitConversationTurnIntent, ForbiddenIntentKeys>
type DispositionHasNoForbiddenFields = HasNoForbiddenFields<
  SubmitConversationTurnDisposition,
  'status' | 'turns' | 'transcript' | 'runId' | 'toolResults' | 'secret' | 'token'
>
type CancelIntentHasNoForbiddenFields = HasNoForbiddenFields<
  CancelConversationTurnIntent,
  ForbiddenIntentKeys | 'text' | 'mode' | 'delivery' | 'expectedBranchRevision' | 'skillIds'
>
type CancelDispositionHasNoForbiddenFields = HasNoForbiddenFields<
  CancelConversationTurnDisposition,
  'status' | 'turns' | 'transcript' | 'runId' | 'toolResults' | 'provider' | 'secret' | 'token'
>

const intentHasNoForbiddenFields: IntentHasNoForbiddenFields = true
const dispositionHasNoForbiddenFields: DispositionHasNoForbiddenFields = true
const cancelIntentHasNoForbiddenFields: CancelIntentHasNoForbiddenFields = true
const cancelDispositionHasNoForbiddenFields: CancelDispositionHasNoForbiddenFields = true

const canonicalFollowUp: SubmitConversationTurnIntent = {
  target: {
    kind: 'canonical',
    workspaceId: 'workspace-1',
    scope: 'workspace',
    conversationId: 'conversation-1'
  },
  clientRequestId: 'request-1',
  text: 'Explain momentum.',
  mode: 'teaching',
  delivery: 'follow_up',
  expectedBranchRevision: 4,
  skillIds: ['physics-basics']
}

const pendingSteer: SubmitConversationTurnIntent = {
  target: {
    kind: 'pending',
    workspaceId: 'workspace-1',
    scope: 'temporary',
    pendingConversationId: 'pending-1'
  },
  clientRequestId: 'request-2',
  text: 'Focus on conservation of momentum.',
  mode: 'temporary',
  delivery: 'steer',
  expectedActiveTurnId: 'turn-1'
}

describe('SubmitConversationTurn public DTOs', () => {
  it('freezes ADR-0170 §3–4 lane, intent, and learner-safe disposition protocol', () => {
    expectTypeOf<ConversationLaneKey>().toEqualTypeOf<ExpectedConversationLaneKey>()
    expectTypeOf<SubmitConversationTurnIntent>().toEqualTypeOf<ExpectedSubmitConversationTurnIntent>()
    expectTypeOf<SubmitConversationTurnDisposition>().toEqualTypeOf<ExpectedSubmitConversationTurnDisposition>()
    expectTypeOf<CancelConversationTurnIntent>().toEqualTypeOf<ExpectedCancelConversationTurnIntent>()
    expectTypeOf<CancelConversationTurnDisposition>().toEqualTypeOf<ExpectedCancelConversationTurnDisposition>()
    expectTypeOf<TeachingSystemApi['submitConversationTurn']>().toEqualTypeOf<
      (intent: SubmitConversationTurnIntent) => Promise<SubmitConversationTurnDisposition>
    >()
    expectTypeOf<TeachingSystemApi['cancelConversationTurn']>().toEqualTypeOf<
      (intent: CancelConversationTurnIntent) => Promise<CancelConversationTurnDisposition>
    >()

    expect(intentHasNoForbiddenFields).toBe(true)
    expect(dispositionHasNoForbiddenFields).toBe(true)
    expect(cancelIntentHasNoForbiddenFields).toBe(true)
    expect(cancelDispositionHasNoForbiddenFields).toBe(true)
    expect(canonicalFollowUp.target.kind).toBe('canonical')
    expect(pendingSteer.target).toMatchObject({ kind: 'pending', pendingConversationId: 'pending-1' })
  })
})
