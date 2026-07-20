import { describe, expect, it } from 'vitest'

import {
  AgentRunStateMachine,
  AGENT_RUN_STATES,
  LEGAL_AGENT_RUN_EDGES,
  cancelAgentRun,
  createAgentRunStateMachine,
  isActiveAgentRunState,
  isTerminalAgentRunState,
  projectCheckpointStatusToRunState,
  projectRunStateToCheckpointStatuses,
  recoverAgentRun,
  resumeAfterRecovery,
  transition,
  type AgentRunState,
  type AgentRunTrigger,
  type TransitionResult
} from '../../src/main/agent-run-state-machine'
import type { AgentRunCheckpointStatus } from '../../src/main/ai/agent-run-types'

const ACTIVE: AgentRunState[] = ['running', 'awaiting_user', 'cancelling']
const TERMINAL: AgentRunState[] = ['completed', 'failed', 'interrupted']

function applied(from: AgentRunState, to: AgentRunState, type: AgentRunTrigger['type']): Partial<TransitionResult> {
  return { ok: true, kind: 'applied', from, to, trigger: { type } }
}

function illegal(from: AgentRunState, type: AgentRunTrigger['type']): Partial<TransitionResult> {
  return { ok: false, kind: 'illegal', from, to: from, trigger: { type } }
}

function idempotent(from: AgentRunState, type: AgentRunTrigger['type']): Partial<TransitionResult> {
  return { ok: true, kind: 'idempotent', from, to: from, trigger: { type } }
}

describe('AgentRunStateMachine legal edges', () => {
  it('exposes the seven explicit states from the plan', () => {
    expect([...AGENT_RUN_STATES]).toEqual([
      'waiting',
      'running',
      'awaiting_user',
      'cancelling',
      'completed',
      'failed',
      'interrupted'
    ])
  })

  it.each([
    ['waiting', 'start', 'running'],
    ['waiting', 'request_cancel', 'cancelling'],
    ['running', 'await_user', 'awaiting_user'],
    ['running', 'request_cancel', 'cancelling'],
    ['running', 'complete', 'completed'],
    ['running', 'fail', 'failed'],
    ['running', 'interrupt', 'interrupted'],
    ['awaiting_user', 'resume', 'running'],
    ['awaiting_user', 'request_cancel', 'cancelling'],
    ['awaiting_user', 'complete', 'completed'],
    ['awaiting_user', 'fail', 'failed'],
    ['awaiting_user', 'interrupt', 'interrupted'],
    ['cancelling', 'complete', 'completed'],
    ['cancelling', 'fail', 'failed'],
    ['cancelling', 'interrupt', 'interrupted'],
    ['interrupted', 'recover', 'waiting']
  ] as const)('%s --%s--> %s is legal and applied', (from, type, to) => {
    expect(transition(from, { type })).toMatchObject(applied(from, to, type))
    expect(LEGAL_AGENT_RUN_EDGES[`${from}|${type}`]).toBe(to)
  })

  it('classifies active vs terminal states without SessionLedger fields', () => {
    for (const state of ACTIVE) expect(isActiveAgentRunState(state)).toBe(true)
    for (const state of TERMINAL) expect(isTerminalAgentRunState(state)).toBe(true)
    expect(isActiveAgentRunState('waiting')).toBe(false)
    expect(isTerminalAgentRunState('waiting')).toBe(false)
  })
})

describe('AgentRunStateMachine illegal transitions are recorded not fixed', () => {
  it.each([
    ['waiting', 'resume'],
    ['waiting', 'complete'],
    ['waiting', 'fail'],
    ['waiting', 'interrupt'],
    ['waiting', 'await_user'],
    ['running', 'start'],
    ['running', 'resume'],
    ['running', 'recover'],
    ['awaiting_user', 'start'],
    ['awaiting_user', 'await_user'],
    ['awaiting_user', 'recover'],
    ['cancelling', 'start'],
    ['cancelling', 'resume'],
    ['cancelling', 'await_user'],
    ['cancelling', 'recover'],
    ['completed', 'start'],
    ['completed', 'fail'],
    ['completed', 'interrupt'],
    ['completed', 'recover'],
    ['failed', 'start'],
    ['failed', 'complete'],
    ['failed', 'recover'],
    ['interrupted', 'start'],
    ['interrupted', 'complete'],
    ['interrupted', 'fail']
  ] as const)('%s --%s--> is illegal and leaves state unchanged', (from, type) => {
    const result = transition(from, { type })
    expect(result).toMatchObject(illegal(from, type))
    expect(result.reason).toMatch(/Illegal agent run transition/)
    expect(result.to).toBe(from)
  })

  it('never silently coerces an illegal move to a different state', () => {
    const result = transition('completed', { type: 'start' })
    expect(result.ok).toBe(false)
    expect(result.to).toBe('completed')
    expect(result.kind).toBe('illegal')
  })
})

describe('AgentRunStateMachine idempotent cancel and recover helpers', () => {
  it('settles active runs to completed via cancel helper', () => {
    expect(cancelAgentRun('waiting')).toMatchObject({
      ok: true,
      kind: 'applied',
      from: 'waiting',
      to: 'completed'
    })
    expect(cancelAgentRun('running')).toMatchObject({
      ok: true,
      kind: 'applied',
      from: 'running',
      to: 'completed'
    })
    expect(cancelAgentRun('awaiting_user')).toMatchObject({
      ok: true,
      kind: 'applied',
      from: 'awaiting_user',
      to: 'completed'
    })
  })

  it('is idempotent when cancel is repeated on cancelling or terminals', () => {
    expect(cancelAgentRun('cancelling')).toMatchObject({
      ok: true,
      kind: 'applied',
      from: 'cancelling',
      to: 'completed'
    })
    expect(cancelAgentRun('completed')).toMatchObject(idempotent('completed', 'request_cancel'))
    expect(cancelAgentRun('failed')).toMatchObject(idempotent('failed', 'request_cancel'))
    expect(cancelAgentRun('interrupted')).toMatchObject(idempotent('interrupted', 'request_cancel'))

    // Double-cancel after the helper already settled.
    const again = cancelAgentRun(cancelAgentRun('running').to)
    expect(again).toMatchObject(idempotent('completed', 'request_cancel'))
  })

  it('marks in-flight runs interrupted for recovery and is idempotent thereafter', () => {
    for (const state of ['running', 'awaiting_user', 'cancelling'] as const) {
      expect(recoverAgentRun(state)).toMatchObject(applied(state, 'interrupted', 'interrupt'))
    }
    expect(recoverAgentRun('interrupted')).toMatchObject(idempotent('interrupted', 'interrupt'))
    expect(recoverAgentRun('completed')).toMatchObject(idempotent('completed', 'interrupt'))
    expect(recoverAgentRun('failed')).toMatchObject(idempotent('failed', 'interrupt'))
  })

  it('does not invent recovery for a never-started waiting run', () => {
    expect(recoverAgentRun('waiting')).toMatchObject(illegal('waiting', 'interrupt'))
  })

  it('returns interrupted runs to waiting after recovery acknowledgement', () => {
    expect(resumeAfterRecovery('interrupted')).toMatchObject(applied('interrupted', 'waiting', 'recover'))
    expect(resumeAfterRecovery('waiting')).toMatchObject(idempotent('waiting', 'recover'))
    expect(resumeAfterRecovery('running')).toMatchObject(illegal('running', 'recover'))
  })

  it('treats repeated terminal settles as idempotent via transition()', () => {
    expect(transition('completed', { type: 'complete' })).toMatchObject(idempotent('completed', 'complete'))
    expect(transition('failed', { type: 'fail' })).toMatchObject(idempotent('failed', 'fail'))
    expect(transition('interrupted', { type: 'interrupt' })).toMatchObject(idempotent('interrupted', 'interrupt'))
    expect(transition('cancelling', { type: 'request_cancel' })).toMatchObject(
      idempotent('cancelling', 'request_cancel')
    )
  })
})

describe('checkpoint projection without SessionLedger merge', () => {
  it.each([
    ['running', 'running'],
    ['awaiting_conversation_save', 'running'],
    ['waiting_for_permission', 'awaiting_user'],
    ['waiting_for_elicitation', 'awaiting_user'],
    ['completed', 'completed'],
    ['canceled', 'completed'],
    ['failed', 'failed'],
    ['interrupted', 'interrupted']
  ] as const)('projects durable %s to run state %s', (checkpoint, runState) => {
    expect(projectCheckpointStatusToRunState(checkpoint)).toBe(runState)
  })

  it('maps run states back to durable checkpoint candidates only', () => {
    expect(projectRunStateToCheckpointStatuses('waiting')).toEqual([])
    expect(projectRunStateToCheckpointStatuses('running')).toEqual([
      'running',
      'awaiting_conversation_save'
    ])
    expect(projectRunStateToCheckpointStatuses('awaiting_user')).toEqual([
      'waiting_for_permission',
      'waiting_for_elicitation'
    ])
    expect(projectRunStateToCheckpointStatuses('completed')).toEqual(['completed', 'canceled'])
    expect(projectRunStateToCheckpointStatuses('failed')).toEqual(['failed'])
    expect(projectRunStateToCheckpointStatuses('interrupted')).toEqual(['interrupted'])
  })

  it('keeps Session correlation ID-only (type shape smoke)', () => {
    const machine = createAgentRunStateMachine()
    const correlation = {
      runId: 'run-1',
      streamId: 'stream-1',
      conversationId: 'conversation-1',
      learningSessionId: 'session-1'
    }
    // Machine APIs accept only run state + trigger — no session fields.
    const result = machine.transition('waiting', { type: 'start' })
    expect(result.to).toBe('running')
    expect(correlation).toEqual(expect.objectContaining({ runId: 'run-1', learningSessionId: 'session-1' }))
    expect(Object.keys(result).sort()).toEqual(['from', 'kind', 'ok', 'to', 'trigger'].sort())
  })

  it('round-trips every durable checkpoint status through the machine facade', () => {
    const machine = new AgentRunStateMachine()
    const statuses: AgentRunCheckpointStatus[] = [
      'running',
      'waiting_for_permission',
      'waiting_for_elicitation',
      'awaiting_conversation_save',
      'completed',
      'failed',
      'canceled',
      'interrupted'
    ]
    for (const status of statuses) {
      const projected = machine.projectCheckpoint(status)
      expect(AGENT_RUN_STATES).toContain(projected)
      const candidates = projectRunStateToCheckpointStatuses(projected)
      expect(candidates).toContain(status)
    }
  })
})

describe('happy path sequences', () => {
  it('supports waiting -> running -> awaiting_user -> running -> completed', () => {
    let state: AgentRunState = 'waiting'
    for (const step of [
      { type: 'start' as const, to: 'running' },
      { type: 'await_user' as const, to: 'awaiting_user' },
      { type: 'resume' as const, to: 'running' },
      { type: 'complete' as const, to: 'completed' }
    ]) {
      const result = transition(state, { type: step.type })
      expect(result).toMatchObject(applied(state, step.to, step.type))
      state = result.to
    }
    expect(state).toBe('completed')
  })

  it('supports cancel mid-run and recovery after crash', () => {
    const midCancel = transition('running', { type: 'request_cancel' })
    expect(midCancel.to).toBe('cancelling')
    expect(transition(midCancel.to, { type: 'complete' }).to).toBe('completed')

    const recovered = recoverAgentRun('awaiting_user')
    expect(recovered.to).toBe('interrupted')
    expect(resumeAfterRecovery(recovered.to).to).toBe('waiting')
    expect(transition('waiting', { type: 'start' }).to).toBe('running')
  })
})
