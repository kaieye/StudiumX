import { describe, expect, it } from 'vitest'
import {
  TEACHING_EVENT_SCHEMA_VERSION,
  adaptLegacyAgentStreamEvent,
  createTeachingEvent,
  createUnknownRejectedEvent,
  isDurableTeachingEvent,
  isTeachingTurnTerminalPayload,
  mapCommitStatusToTerminal,
  parseTeachingEvent,
  teachingEventPayloadTypes,
  TeachingEventParseError
} from '../../src/shared/teaching-events'

function baseFields() {
  return {
    durability: 'durable' as const,
    occurredAt: '2026-07-18T10:00:00.000Z',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    eventId: 'event-1'
  }
}

describe('teaching-events schema and validation', () => {
  it('creates a schemaVersion=1 envelope with stable identity fields', () => {
    const event = createTeachingEvent({
      ...baseFields(),
      itemId: 'item-1',
      operationId: 'op-1',
      payload: {
        type: 'session_opened',
        sessionId: 'session-1',
        courseId: 'course-1',
        status: 'active',
        source: 'canonical'
      }
    })

    expect(event.schemaVersion).toBe(TEACHING_EVENT_SCHEMA_VERSION)
    expect(event).toMatchObject({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      eventId: 'event-1',
      itemId: 'item-1',
      operationId: 'op-1',
      durability: 'durable'
    })
    expect(isDurableTeachingEvent(event)).toBe(true)
  })

  it('parses all closed payload types without accepting free-form fields as required', () => {
    const types = teachingEventPayloadTypes()
    expect(types).toContain('turn_terminal')
    expect(types).toContain('evidence_recorded')
    expect(types).toContain('loop_snapshot')

    for (const type of types) {
      const payload = samplePayload(type)
      const result = parseTeachingEvent({
        schemaVersion: 1,
        ...baseFields(),
        durability: type === 'turn_terminal' || type === 'loop_snapshot' ? 'ephemeral' : 'durable',
        payload
      })
      expect(result.ok, type).toBe(true)
      if (result.ok) expect(result.event.payload.type).toBe(type)
    }
  })

  it('rejects unsupported schema versions and unrecognized payload types without leaking raw payloads', () => {
    const secret = 'RAW_SECRET_PAYLOAD_SHOULD_NOT_LEAK'
    const unsupported = parseTeachingEvent({
      schemaVersion: 99,
      ...baseFields(),
      payload: { type: 'session_opened', secret }
    })
    expect(unsupported).toMatchObject({ ok: false, code: 'unsupported_schema_version' })
    expect(JSON.stringify(unsupported)).not.toContain(secret)

    const unknown = parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      payload: { type: 'brand_new_author_event', secret }
    })
    expect(unknown).toMatchObject({ ok: false, code: 'unrecognized_payload_type' })
    expect(JSON.stringify(unknown)).not.toContain(secret)
    expect(unknown.ok === false && unknown.message).not.toContain(secret)
  })

  it('rejects malformed ids, timestamps, durability, and terminal outcomes', () => {
    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      sessionId: '../escape',
      payload: samplePayload('turn_progress')
    })).toMatchObject({ ok: false, code: 'invalid_id', field: 'sessionId' })

    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      occurredAt: 'not-a-timestamp',
      payload: samplePayload('turn_progress')
    })).toMatchObject({ ok: false, code: 'invalid_timestamp' })

    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'maybe',
      payload: samplePayload('turn_progress')
    })).toMatchObject({ ok: false, code: 'invalid_durability' })

    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'ephemeral',
      payload: { type: 'turn_terminal', outcome: 'mastered' }
    })).toMatchObject({ ok: false, code: 'invalid_terminal_outcome' })
  })

  it('throws TeachingEventParseError from createTeachingEvent on invalid input', () => {
    expect(() =>
      createTeachingEvent({
        ...baseFields(),
        payload: { type: 'turn_terminal', outcome: 'won' as 'completed' }
      })
    ).toThrow(TeachingEventParseError)
  })

  it('maps commit statuses to learner-safe terminal outcomes only', () => {
    expect(mapCommitStatusToTerminal('committed')).toBe('completed')
    expect(mapCommitStatusToTerminal('already_committed')).toBe('completed')
    expect(mapCommitStatusToTerminal('insufficient_evidence')).toBe('failed')
    expect(mapCommitStatusToTerminal('conflict')).toBe('conflict')
    expect(mapCommitStatusToTerminal('canceled')).toBe('canceled')
    expect(mapCommitStatusToTerminal('interrupted')).toBe('interrupted')
    expect(mapCommitStatusToTerminal('retryable_failure')).toBe('failed')
    expect(mapCommitStatusToTerminal('non_retryable_failure')).toBe('failed')
  })

  it('adapts legacy/unknown agent stream kinds through an explicit adapter only', () => {
    const adapted = adaptLegacyAgentStreamEvent({
      kind: 'chunk',
      summary: 'token delta',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      eventId: 'legacy-1',
      occurredAt: '2026-07-18T10:00:00.000Z'
    })
    expect(adapted.payload).toEqual({
      type: 'legacy_adapted',
      originalKind: 'chunk',
      summary: 'token delta'
    })
    expect(adapted.durability).toBe('ephemeral')
  })

  it('builds unknown-rejected envelopes without retaining raw input', () => {
    const rejected = createUnknownRejectedEvent({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      eventId: 'reject-1',
      occurredAt: '2026-07-18T10:00:00.000Z',
      reasonCode: 'unrecognized_payload_type'
    })
    expect(rejected.payload).toEqual({
      type: 'unknown_rejected',
      reasonCode: 'unrecognized_payload_type'
    })
    expect(isTeachingTurnTerminalPayload(rejected.payload)).toBe(false)
  })

  it('identifies terminal payloads', () => {
    const event = createTeachingEvent({
      ...baseFields(),
      durability: 'ephemeral',
      payload: { type: 'turn_terminal', outcome: 'completed' }
    })
    expect(isTeachingTurnTerminalPayload(event.payload)).toBe(true)
  })

  it('closed-validates unknown_rejected reason codes and strips extra payload fields', () => {
    const ok = parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'ephemeral',
      payload: {
        type: 'unknown_rejected',
        reasonCode: 'unrecognized_payload_type',
        extraLeak: 'RAW_SHOULD_STRIP'
      }
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.event.payload).toEqual({
        type: 'unknown_rejected',
        reasonCode: 'unrecognized_payload_type'
      })
      expect(JSON.stringify(ok.event)).not.toContain('RAW_SHOULD_STRIP')
      expect(JSON.stringify(ok.event)).not.toContain('extraLeak')
    }

    const bad = parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'ephemeral',
      payload: { type: 'unknown_rejected', reasonCode: 'not_a_real_code' }
    })
    expect(bad).toMatchObject({ ok: false, code: 'invalid_payload', field: 'payload.reasonCode' })
  })

})

function samplePayload(type: string) {
  switch (type) {
    case 'session_opened':
      return {
        type,
        sessionId: 'session-1',
        courseId: 'course-1',
        status: 'active',
        source: 'canonical'
      }
    case 'session_resumed':
      return { type, sessionId: 'session-1', status: 'active', eventCount: 2 }
    case 'evidence_recorded':
      return {
        type,
        sessionId: 'session-1',
        evidenceEventId: 'evidence-1',
        sequence: 1,
        duplicate: false,
        kind: 'quiz_answered'
      }
    case 'outcome_committed':
    case 'outcome_already_committed':
      return { type, sessionId: 'session-1', outcomeKind: 'established', recordSaved: true }
    case 'outcome_insufficient_evidence':
      return { type, sessionId: 'session-1', reason: 'not_evidenced' }
    case 'loop_snapshot':
      return {
        type,
        identity: 'a'.repeat(64),
        displayState: 'in_progress',
        sessionId: 'session-1',
        outcomeStatus: 'absent',
        integrityCodes: []
      }
    case 'next_step':
      return { type, action: 'contrast_and_retry', reason: 'needs_practice' }
    case 'turn_progress':
      return { type, stage: 'working' }
    case 'turn_terminal':
      return { type, outcome: 'completed' }
    case 'replay_gap':
      return { type, droppedEvents: 2, retainedFromSequence: 5 }
    case 'legacy_adapted':
      return { type, originalKind: 'status', summary: 'legacy status' }
    case 'unknown_rejected':
      return { type, reasonCode: 'invalid_payload' }
    case 'command_accepted':
      return { type, commandType: 'open_session' }
    case 'command_duplicate':
      return { type, commandType: 'open_session', originalEventId: 'event-1' }
    case 'recover_reconciled':
      return { type, sessionId: 'session-1', state: 'settled' }
    default:
      throw new Error(`missing sample for ${type}`)
  }
}
