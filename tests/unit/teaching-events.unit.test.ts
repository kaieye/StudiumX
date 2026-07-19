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
  parseTeachingTurnCommand,
  teachingEventPayloadTypes,
  teachingTurnCommandTypes,
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
      const durability =
        type === 'session_opened' ||
        type === 'session_resumed' ||
        type === 'evidence_recorded' ||
        type === 'outcome_committed' ||
        type === 'outcome_already_committed'
          ? 'durable'
          : 'ephemeral'
      const result = parseTeachingEvent({
        schemaVersion: 1,
        ...baseFields(),
        durability,
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
    expect(mapCommitStatusToTerminal('retryable_failure')).toBeNull()
    expect(mapCommitStatusToTerminal('non_retryable_failure')).toBe('failed')
  })


  it('rejects free-form terminal reasonCode and durability policy violations', () => {
    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'ephemeral',
      payload: { type: 'turn_terminal', outcome: 'failed', reasonCode: 'not_a_real_reason' }
    })).toMatchObject({ ok: false, code: 'invalid_terminal_reason' })

    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'ephemeral',
      payload: samplePayload('session_opened')
    })).toMatchObject({ ok: false, code: 'invalid_durability' })

    expect(parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      durability: 'durable',
      payload: samplePayload('turn_progress')
    })).toMatchObject({ ok: false, code: 'invalid_durability' })
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

  it('rejects payload sessionId mismatch with envelope', () => {
    const result = parseTeachingEvent({
      schemaVersion: 1,
      ...baseFields(),
      sessionId: 'session-envelope',
      durability: 'durable',
      payload: {
        type: 'session_opened',
        sessionId: 'session-OTHER',
        courseId: 'course-1',
        status: 'active',
        source: 'canonical'
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid_payload')
      expect(result.field).toBe('payload.sessionId')
    }
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

describe('parseTeachingTurnCommand runtime coverage', () => {
  const envelope = {
    turnId: 'turn-1',
    eventId: 'event-1',
    operationId: 'op-1',
    workspaceId: 'workspace-1'
  }

  const evidence = {
    schemaVersion: 1,
    eventId: 'evidence-1',
    kind: 'quiz_answered' as const,
    workspaceId: 'workspace-1',
    courseId: 'course-1',
    sessionId: 'session-1',
    lessonId: 'lesson-1',
    itemId: 'item-1',
    attempt: 1,
    observedAt: '2026-07-18T10:00:00.000Z',
    artifactDigest: 'a'.repeat(64),
    surface: 'lesson_preview' as const,
    selectedOptionIds: ['a'],
    correct: false
  }

  const facts = {
    mission: { id: 'mission-1', nextGoal: 'available' as const },
    course: { id: 'course-1' },
    latestSession: { id: 'session-1', source: 'canonical' as const, readOnly: false },
    durableOutcome: { status: 'absent' as const },
    evidence: { status: 'not_evidenced' as const },
    resources: { readiness: 'ready' as const, availableCount: 1, provenanceIds: ['r1'] }
  }

  it('parses all closed command variants successfully', () => {
    const variants: unknown[] = [
      {
        type: 'open_session',
        ...envelope,
        open: {
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      },
      {
        type: 'open_session',
        ...envelope,
        eventId: 'event-open-with-session',
        operationId: 'op-open-with-session',
        open: {
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      },
      { type: 'resume_session', ...envelope, eventId: 'event-resume', operationId: 'op-resume', sessionId: 'session-1' },
      {
        type: 'record_evidence',
        ...envelope,
        eventId: 'event-evidence',
        operationId: 'op-evidence',
        evidence
      },
      {
        type: 'commit_outcome',
        ...envelope,
        eventId: 'event-commit',
        operationId: 'op-commit',
        request: { sessionId: 'session-1', operationId: 'op-commit' }
      },
      {
        type: 'plan_next_step',
        ...envelope,
        eventId: 'event-plan',
        operationId: 'op-plan',
        sessionId: 'session-1',
        facts
      },
      {
        type: 'project_snapshot',
        ...envelope,
        eventId: 'event-snap',
        operationId: 'op-snap',
        factInput: {
          mission: { id: 'mission-1', nextGoal: 'available' },
          course: { id: 'course-1' },
          resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] },
          sessionId: 'session-1'
        }
      },
      { type: 'recover_session', ...envelope, eventId: 'event-recover', operationId: 'op-recover', sessionId: 'session-1' },
      {
        type: 'cancel_turn',
        ...envelope,
        eventId: 'event-cancel',
        operationId: 'op-cancel',
        sessionId: 'session-1',
        reasonCode: 'user_cancel'
      }
    ]

    const types = teachingTurnCommandTypes()
    expect(types).toEqual(
      expect.arrayContaining([
        'open_session',
        'resume_session',
        'record_evidence',
        'commit_outcome',
        'plan_next_step',
        'project_snapshot',
        'recover_session',
        'cancel_turn'
      ])
    )
    expect(types).toHaveLength(8)

    for (const value of variants) {
      const result = parseTeachingTurnCommand(value)
      expect(result.ok, JSON.stringify(value)).toBe(true)
      if (result.ok) {
        expect(types).toContain(result.value.type)
      }
    }
  })

  it('fail-closes unknown type, envelope id gaps, nested identity mismatches, and free-form cancel reason', () => {
    expect(parseTeachingTurnCommand(null).ok).toBe(false)
    expect(parseTeachingTurnCommand([]).ok).toBe(false)
    expect(parseTeachingTurnCommand({ type: 'not_a_command', ...envelope }).ok).toBe(false)
    expect(parseTeachingTurnCommand({ type: 'resume_session', ...envelope, turnId: '' }).ok).toBe(false)
    expect(parseTeachingTurnCommand({ type: 'resume_session', ...envelope, sessionId: 'session-1', eventId: 'bad id' }).ok).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'open_session',
        ...envelope,
        open: {
          workspaceId: 'workspace-OTHER',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'record_evidence',
        ...envelope,
        evidence: { ...evidence, workspaceId: 'workspace-OTHER' }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'commit_outcome',
        ...envelope,
        request: { sessionId: 'session-1', operationId: 'op-OTHER' }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'plan_next_step',
        ...envelope,
        sessionId: 'session-1',
        facts: {
          ...facts,
          latestSession: { ...facts.latestSession, id: 'session-OTHER' }
        }
      }).ok
    ).toBe(false)

    // project_snapshot must not accept missing sessionId (no course.id fallback)
    expect(
      parseTeachingTurnCommand({
        type: 'project_snapshot',
        ...envelope,
        factInput: {
          mission: { id: 'mission-1', nextGoal: 'available' },
          course: { id: 'course-1' },
          resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] }
        }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'cancel_turn',
        ...envelope,
        sessionId: 'session-1',
        reasonCode: 'free_form_reason'
      }).ok
    ).toBe(false)
  })
})


describe('round6: H2 closed-set runtime schema adversarial parse', () => {
  const envelope = {
    turnId: 'turn-1',
    eventId: 'event-1',
    operationId: 'op-1',
    workspaceId: 'workspace-1'
  }

  it('rejects invalid LearningOutcomeKind and evidenceEventIds item IDs', () => {
    const baseFacts = {
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      latestSession: { id: 'session-1', source: 'canonical', readOnly: false },
      durableOutcome: {
        status: 'trusted',
        id: 'outcome-1',
        kind: 'established',
        evidenceEventIds: ['ev-1']
      },
      evidence: { status: 'verified' },
      resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] }
    }

    expect(
      parseTeachingTurnCommand({
        type: 'plan_next_step',
        ...envelope,
        sessionId: 'session-1',
        facts: {
          ...baseFacts,
          durableOutcome: { ...baseFacts.durableOutcome, kind: 'mastered_magic' }
        }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'plan_next_step',
        ...envelope,
        sessionId: 'session-1',
        facts: {
          ...baseFacts,
          durableOutcome: {
            ...baseFacts.durableOutcome,
            evidenceEventIds: ['good-id', '../evil', 'also-good']
          }
        }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'plan_next_step',
        ...envelope,
        sessionId: 'session-1',
        facts: {
          ...baseFacts,
          evidence: { status: 'totally_invalid' }
        }
      }).ok
    ).toBe(false)

    expect(
      parseTeachingTurnCommand({
        type: 'plan_next_step',
        ...envelope,
        sessionId: 'session-1',
        facts: {
          ...baseFacts,
          resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['ok', 'bad id with space'] }
        }
      }).ok
    ).toBe(false)
  })

  it('rejects incomplete or cast-through readyResources descriptors fail-closed', () => {
    const factInput = {
      mission: { id: 'mission-1', nextGoal: 'available' },
      course: { id: 'course-1' },
      resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] },
      sessionId: 'session-1'
    }

    // sourceId only — prior cast-through hole
    expect(
      parseTeachingTurnCommand({
        type: 'project_snapshot',
        ...envelope,
        factInput,
        readyResources: [{ sourceId: 'src-1' }]
      }).ok
    ).toBe(false)

    // Missing authority/provenance enums
    expect(
      parseTeachingTurnCommand({
        type: 'project_snapshot',
        ...envelope,
        factInput,
        readyResources: [
          {
            schemaVersion: 1,
            sourceId: 'src-1',
            relativePath: 'resources/a.md',
            contentSha256: 'c'.repeat(64),
            priority: 'required',
            authority: { kind: 'untrusted', authorityId: 'auth-1' },
            provenance: { kind: 'workspace_resource', resourceId: 'r1', revisionId: 'rev-1' }
          }
        ]
      }).ok
    ).toBe(false)

    // Path traversal
    expect(
      parseTeachingTurnCommand({
        type: 'project_snapshot',
        ...envelope,
        factInput,
        readyResources: [
          {
            schemaVersion: 1,
            sourceId: 'src-1',
            relativePath: '../secrets/a.md',
            contentSha256: 'c'.repeat(64),
            priority: 'required',
            authority: { kind: 'trusted_teaching_resource', authorityId: 'auth-1' },
            provenance: { kind: 'workspace_resource', resourceId: 'r1', revisionId: 'rev-1' }
          }
        ]
      }).ok
    ).toBe(false)

    // Bad digest
    expect(
      parseTeachingTurnCommand({
        type: 'project_snapshot',
        ...envelope,
        factInput,
        readyResources: [
          {
            schemaVersion: 1,
            sourceId: 'src-1',
            relativePath: 'resources/a.md',
            contentSha256: 'NOT-A-DIGEST',
            priority: 'required',
            authority: { kind: 'trusted_teaching_resource', authorityId: 'auth-1' },
            provenance: { kind: 'workspace_resource', resourceId: 'r1', revisionId: 'rev-1' }
          }
        ]
      }).ok
    ).toBe(false)

    // Valid full descriptor accepted
    const ok = parseTeachingTurnCommand({
      type: 'project_snapshot',
      ...envelope,
      factInput,
      readyResources: [
        {
          schemaVersion: 1,
          sourceId: 'src-1',
          relativePath: 'resources/a.md',
          contentSha256: 'c'.repeat(64),
          priority: 'recommended',
          authority: { kind: 'trusted_teaching_resource', authorityId: 'auth-1' },
          provenance: { kind: 'workspace_resource', resourceId: 'r1', revisionId: 'rev-1' }
        }
      ]
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.value.type).toBe('project_snapshot')
      expect(ok.value.readyResources?.[0]?.priority).toBe('recommended')
    }
  })
})

