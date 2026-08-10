import { describe, expect, it } from 'vitest'

import {
  createMindMapProposalState,
  deserializeMindMapProposalState,
  serializeMindMapProposalState,
  setMindMapProposalDecision,
  transitionMindMapProposal,
  type MindMapProposalItem,
  type MindMapProposalState
} from '../../src/shared/mindmap/commands'

function proposalItems(): MindMapProposalItem[] {
  return [
    {
      id: 'rename-b',
      command: {
        type: 'topic.update',
        sheetId: 'sheet-1',
        topicId: 'root',
        patch: { title: 'B' }
      }
    },
    {
      id: 'rename-a',
      command: {
        type: 'topic.update',
        sheetId: 'sheet-1',
        topicId: 'root',
        patch: { title: 'A' }
      }
    }
  ]
}

function pendingState(): MindMapProposalState {
  return createMindMapProposalState('proposal-1', proposalItems())
}

describe('mind-map proposal lifecycle state', () => {
  it('starts pending, records item decisions, and settles each terminal status', () => {
    const pending = pendingState()
    expect(pending).toEqual({
      proposalId: 'proposal-1',
      itemIds: ['rename-b', 'rename-a'],
      decisions: {},
      status: 'pending'
    })

    const reviewed = setMindMapProposalDecision(pending, 'rename-a', 'accept')
    expect(reviewed.status).toBe('pending')
    expect(reviewed.decisions).toEqual({ 'rename-a': 'accept' })
    expect(pending.decisions).toEqual({})

    for (const status of ['accepted', 'rejected', 'cancelled'] as const) {
      const result = transitionMindMapProposal(pending, {
        type: status === 'accepted' ? 'accept' : status === 'rejected' ? 'reject' : 'cancel'
      })
      expect(result).toMatchObject({
        ok: true,
        kind: 'applied',
        from: 'pending',
        to: status,
        state: { ...pending, status }
      })
    }
  })

  it('makes repeated terminal settlement idempotent and blocks changing the outcome', () => {
    const accepted = transitionMindMapProposal(pendingState(), { type: 'accept' })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    const repeated = transitionMindMapProposal(accepted.state, { type: 'accept' })
    expect(repeated).toMatchObject({
      ok: true,
      kind: 'idempotent',
      from: 'accepted',
      to: 'accepted'
    })

    const changed = transitionMindMapProposal(accepted.state, { type: 'reject' })
    expect(changed).toMatchObject({
      ok: false,
      kind: 'illegal',
      from: 'accepted',
      to: 'accepted'
    })
    expect(accepted.state.status).toBe('accepted')
  })

  it('round-trips review state with stable serialization and fails closed on bad data', () => {
    const reviewed = setMindMapProposalDecision(
      setMindMapProposalDecision(pendingState(), 'rename-b', 'reject'),
      'rename-a',
      'accept'
    )
    const cancelled = transitionMindMapProposal(reviewed, { type: 'cancel' })
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return

    const serialized = serializeMindMapProposalState(cancelled.state)
    expect(serialized).toBe(
      '{"schemaVersion":1,"proposalId":"proposal-1","itemIds":["rename-b","rename-a"],"decisions":{"rename-a":"accept","rename-b":"reject"},"status":"cancelled"}'
    )
    expect(deserializeMindMapProposalState(serialized)).toEqual(cancelled.state)

    expect(deserializeMindMapProposalState('{"schemaVersion":2}')).toBeNull()
    expect(
      deserializeMindMapProposalState(
        serialized.replace('"status":"cancelled"', '"status":"unknown"')
      )
    ).toBeNull()
    expect(
      deserializeMindMapProposalState(
        serialized.replace('"rename-a":"accept"', '"stale":"accept"')
      )
    ).toBeNull()
    expect(deserializeMindMapProposalState('{not-json}')).toBeNull()
  })

  it('rejects malformed local state instead of guessing a transition', () => {
    expect(() =>
      createMindMapProposalState('proposal-1', [proposalItems()[0]!, proposalItems()[0]!])
    ).toThrow('Duplicate mind-map proposal item id "rename-b"')

    expect(() => setMindMapProposalDecision(pendingState(), 'stale', 'accept')).toThrow(
      'Unknown mind-map proposal item "stale"'
    )
  })
})
