import { describe, expect, it } from 'vitest'

import {
  TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
  TEACHING_AUDIT_DENIED_FIELD_NAMES,
  buildTeachingAuditMetadataForToolOperation,
  buildTeachingAuditMetadataFromCommand,
  createAuditCorrelation,
  formatTeachingAuditSafeLogLine,
  isTeachingAuditSafeMetadata,
  projectSafeTeachingAuditMetadata,
  redactTeachingAuditForExport,
  redactTeachingAuditText,
  teachingAuditDeniedFieldName,
  type TeachingAuditSafeMetadata
} from '../../src/main/teaching-audit-correlation'

describe('teaching audit correlation', () => {
  it('creates AuditCorrelation from opaque session/turn IDs and optional effect links', () => {
    const correlation = createAuditCorrelation({
      sessionId: 'session-algebra-1',
      turnId: 'turn-12',
      eventId: 'event-ev-1',
      operationId: 'op-commit-1',
      effectId: 'effect-tool-9'
    })

    expect(correlation).toEqual({
      sessionId: 'session-algebra-1',
      turnId: 'turn-12',
      eventId: 'event-ev-1',
      operationId: 'op-commit-1',
      effectId: 'effect-tool-9'
    })
  })

  it('fails closed on missing or malformed required correlation IDs', () => {
    expect(createAuditCorrelation({ sessionId: '', turnId: 'turn-1' })).toBeNull()
    expect(createAuditCorrelation({ sessionId: 'session-1', turnId: 'bad id with space' })).toBeNull()
    expect(createAuditCorrelation({
      sessionId: 'session-1',
      turnId: 'turn-1',
      eventId: '../../etc/passwd'
    })).toEqual({ sessionId: 'session-1', turnId: 'turn-1' })
  })

  it('projects only allowlisted safe metadata and drops denied payload fields', () => {
    const projected = projectSafeTeachingAuditMetadata({
      schemaVersion: TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
      kind: 'teaching_audit',
      correlation: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        operationId: 'op-1',
        effectId: 'effect-1'
      },
      commandType: 'commit_outcome',
      toolName: 'web_search',
      effectClass: 'read',
      evidenceEventId: 'evidence-9',
      outcomeKind: 'needs_practice',
      disposition: 'first_execution',
      resultBytes: 128,
      isError: false,
      // Denied / free-form fields must never survive projection.
      providerPayload: { messages: [{ role: 'user', content: 'secret answer' }] },
      learnerAnswer: 'the full learner free-text answer',
      reasoning: 'chain of thought',
      apiKey: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      prompt: 'system prompt',
      content: 'raw body'
    })

    expect(projected).toEqual({
      schemaVersion: 1,
      kind: 'teaching_audit',
      correlation: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        operationId: 'op-1',
        effectId: 'effect-1'
      },
      commandType: 'commit_outcome',
      toolName: 'web_search',
      effectClass: 'read',
      evidenceEventId: 'evidence-9',
      outcomeKind: 'needs_practice',
      disposition: 'first_execution',
      resultBytes: 128,
      isError: false
    })
    expect(JSON.stringify(projected)).not.toMatch(/secret answer|chain of thought|sk-proj|system prompt|raw body/)
    expect(isTeachingAuditSafeMetadata(projected)).toBe(true)
    expect(isTeachingAuditSafeMetadata({ kind: 'teaching_audit' })).toBe(false)
  })

  it('builds command and tool operation hook metadata without retaining raw payloads', () => {
    const fromCommand = buildTeachingAuditMetadataFromCommand({
      sessionId: 'session-cmd',
      turnId: 'turn-cmd',
      eventId: 'evt-cmd',
      operationId: 'op-cmd',
      commandType: 'record_evidence',
      evidenceEventId: 'ev-42',
      outcomeKind: 'established'
    })
    expect(fromCommand?.correlation).toEqual({
      sessionId: 'session-cmd',
      turnId: 'turn-cmd',
      eventId: 'evt-cmd',
      operationId: 'op-cmd'
    })
    expect(fromCommand?.commandType).toBe('record_evidence')
    expect(fromCommand?.evidenceEventId).toBe('ev-42')

    const fromTool = buildTeachingAuditMetadataForToolOperation({
      sessionId: 'session-tool',
      turnId: 'turn-tool',
      operationId: 'op-tool',
      effectId: 'effect-tool',
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      disposition: 'first_execution',
      resultBytes: 4096,
      isError: true,
      providerPayload: { choices: [{ text: 'model dump' }] },
      learnerAnswer: 'I think the answer is 42',
      reasoning: 'because ...',
      secret: 'sk-live-should-not-appear',
      prompt: 'do not log me',
      content: 'full tool result body',
      raw: Buffer.from('binary'),
      transcript: 'child transcript'
    })

    expect(fromTool).toEqual({
      schemaVersion: 1,
      kind: 'teaching_audit',
      correlation: {
        sessionId: 'session-tool',
        turnId: 'turn-tool',
        operationId: 'op-tool',
        effectId: 'effect-tool'
      },
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      disposition: 'first_execution',
      resultBytes: 4096,
      isError: true
    })
    expect(JSON.stringify(fromTool)).not.toMatch(/model dump|answer is 42|sk-live|do not log me|full tool result|child transcript/)
  })

  it('redacts secrets and denied fields on export while keeping correlation IDs', () => {
    const secret = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
    const metadata: TeachingAuditSafeMetadata = {
      schemaVersion: 1,
      kind: 'teaching_audit',
      correlation: {
        sessionId: 'session-export',
        turnId: 'turn-export',
        operationId: 'op-export',
        effectId: 'effect-export'
      },
      toolName: 'web_fetch',
      effectClass: 'read',
      evidenceEventId: 'ev-export',
      outcomeKind: 'needs_practice'
    }

    const exported = redactTeachingAuditForExport({
      ...metadata,
      providerPayload: { apiKey: secret, messages: ['raw'] },
      learnerAnswer: 'full free text learner answer that must not export',
      reasoning: 'internal chain of thought',
      note: `Authorization: Bearer ${secret}`,
      nested: {
        sessionId: 'session-export',
        turnId: 'turn-export',
        answer: 'should be redacted by key',
        apiKey: secret
      }
    }) as Record<string, unknown>

    expect(exported.correlation).toEqual(metadata.correlation)
    expect(exported.toolName).toBe('web_fetch')
    expect(exported.effectClass).toBe('read')
    expect(exported.providerPayload).toBe('[redacted]')
    expect(exported.learnerAnswer).toBe('[redacted]')
    expect(exported.reasoning).toBe('[redacted]')
    expect(String(exported.note)).toContain('[redacted]')
    expect(String(exported.note)).not.toContain(secret)

    const nested = exported.nested as Record<string, unknown>
    expect(nested.sessionId).toBe('session-export')
    expect(nested.turnId).toBe('turn-export')
    expect(nested.answer).toBe('[redacted]')
    expect(nested.apiKey).toBe('[redacted]')

    const asText = JSON.stringify(exported)
    expect(asText).not.toMatch(/sk-proj|full free text learner answer|chain of thought|Bearer sk/)
    expect(asText).toContain('session-export')
    expect(asText).toContain('effect-export')
  })

  it('formats only projected safe metadata for log lines', () => {
    const safe = buildTeachingAuditMetadataFromCommand({
      sessionId: 'session-log',
      turnId: 'turn-log',
      operationId: 'op-log',
      commandType: 'commit_outcome',
      outcomeKind: 'established'
    })
    const line = formatTeachingAuditSafeLogLine(safe)
    expect(line).toContain('"kind":"teaching_audit"')
    expect(line).toContain('session-log')
    expect(formatTeachingAuditSafeLogLine(null)).toBeNull()
    expect(formatTeachingAuditSafeLogLine({ kind: 'teaching_audit' } as TeachingAuditSafeMetadata)).toBeNull()
  })

  it('redacts mixed diagnostic text without inventing free-form payloads', () => {
    const text = redactTeachingAuditText(
      'Provider failed Authorization: Bearer sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 for session-1'
    )
    expect(text).toContain('[redacted]')
    expect(text).not.toContain('sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')
    expect(text).toContain('session-1')
  })

  it('documents denied field names used by the privacy allowlist', () => {
    for (const name of [
      'providerPayload',
      'learnerAnswer',
      'reasoning',
      'apiKey',
      'secret',
      'prompt',
      'transcript'
    ]) {
      expect(teachingAuditDeniedFieldName(name)).toBe(true)
    }
    expect(TEACHING_AUDIT_DENIED_FIELD_NAMES).toContain('providerPayload')
    expect(teachingAuditDeniedFieldName('sessionId')).toBe(false)
    expect(teachingAuditDeniedFieldName('effectId')).toBe(false)
  })

  it('traces an outcome to evidence/effect IDs without raw reasoning', () => {
    // Acceptance: outcome → evidence/effect via IDs only.
    const outcomeAudit = buildTeachingAuditMetadataFromCommand({
      sessionId: 'session-outcome',
      turnId: 'turn-outcome',
      eventId: 'evt-outcome-terminal',
      operationId: 'op-commit-outcome',
      commandType: 'commit_outcome',
      evidenceEventId: 'ev-lesson-interaction-3',
      outcomeKind: 'misconception_corrected'
    })
    const effectAudit = buildTeachingAuditMetadataForToolOperation({
      sessionId: 'session-outcome',
      turnId: 'turn-outcome',
      operationId: 'op-commit-outcome',
      effectId: 'effect-ground-resources',
      toolName: 'web_search',
      effectClass: 'read',
      disposition: 'first_execution',
      reasoning: 'should never appear',
      providerPayload: { raw: true }
    })

    expect(outcomeAudit?.evidenceEventId).toBe('ev-lesson-interaction-3')
    expect(outcomeAudit?.correlation.operationId).toBe('op-commit-outcome')
    expect(effectAudit?.correlation.effectId).toBe('effect-ground-resources')
    expect(outcomeAudit?.correlation.sessionId).toBe(effectAudit?.correlation.sessionId)
    expect(outcomeAudit?.correlation.turnId).toBe(effectAudit?.correlation.turnId)
    expect(JSON.stringify([outcomeAudit, effectAudit])).not.toMatch(/should never appear|"raw":true/)
  })
})
