import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  assertProjectionReportRedacted,
  buildRequestContextProjectionReport,
  buildTeachingContextProjectionReport,
  fingerprintProjectionReport
} from '../../src/main/ai/context-projection-report'
import type { ContextProjectionReport } from '../../src/shared/teaching-types/context-projection-report'
import type { GroundingPack } from '../../src/shared/teaching-types/grounding'
import type { TeachingContext } from '../../src/shared/teaching-types/teaching-context'
import type { ChatMessage, ToolDefinition } from '../../src/main/ai/provider-adapter'

function teachingFixture(overrides: {
  maxBytes?: number
  usedBytes?: number
  truncated?: boolean
  truncationReason?: GroundingPack['budget']['truncationReason']
  includeSupplemental?: boolean
} = {}): { context: TeachingContext; grounding: GroundingPack } {
  const maxBytes = overrides.maxBytes ?? 256
  const usedBytes = overrides.usedBytes ?? 24
  const sources: GroundingPack['sources'] = [
    {
      sourceId: 'source-required',
      location: { kind: 'workspace_relative_path', relativePath: 'resources/required.txt' },
      provenance: { kind: 'workspace_resource', resourceId: 'resource-required', revisionId: 'rev-1' },
      contentSha256: sha256('required'),
      priority: 'required',
      chunks: [{
        chunkId: 'sha256:required',
        contentSha256: sha256('required'),
        text: 'required theorem text that must never appear in the report',
        byteLength: 16
      }]
    }
  ]
  if (overrides.includeSupplemental) {
    sources.push({
      sourceId: 'source-recommended',
      location: { kind: 'workspace_relative_path', relativePath: 'resources/recommended.txt' },
      provenance: { kind: 'workspace_resource', resourceId: 'resource-recommended', revisionId: 'rev-1' },
      contentSha256: sha256('recommended'),
      priority: 'recommended',
      chunks: [{
        chunkId: 'sha256:recommended',
        contentSha256: sha256('recommended'),
        text: 'recommended example text private',
        byteLength: 8
      }]
    })
  }

  const exclusions: GroundingPack['exclusions'] = overrides.truncated
    ? [{ sourceId: 'source-supplemental', relativePath: 'resources/supplemental.txt', code: 'budget_exhausted' }]
    : []

  const groundingWithoutIdentity = {
    schemaVersion: 1 as const,
    status: (exclusions.length === 0 ? 'ready' : 'degraded') as GroundingPack['status'],
    sources,
    exclusions,
    budget: {
      maxBytes,
      availableBytes: usedBytes + (overrides.truncated ? 32 : 0),
      usedBytes,
      remainingBytes: maxBytes - usedBytes,
      truncated: overrides.truncated === true,
      truncationReason: overrides.truncationReason ?? (overrides.truncated ? 'budget_exhausted' as const : null)
    }
  }
  const grounding: GroundingPack = {
    ...groundingWithoutIdentity,
    identity: sha256(JSON.stringify(groundingWithoutIdentity))
  }

  const contextWithoutIdentity = {
    schemaVersion: 1 as const,
    mission: { id: 'mission-algebra', goalStatus: 'available' as const },
    course: { id: 'course-algebra' },
    currentSession: { id: 'session-1', source: 'canonical' as const, readOnly: false },
    outcome: { status: 'trusted' as const, id: 'outcome-1', kind: 'needs_practice' as const },
    nextStep: { action: 'contrast_and_retry' as const, reason: 'needs_practice' as const },
    grounding: {
      identity: grounding.identity,
      status: grounding.status,
      sourceIds: grounding.sources.map((source) => source.sourceId),
      exclusionCount: grounding.exclusions.length
    }
  }
  const context: TeachingContext = {
    ...contextWithoutIdentity,
    identity: sha256(JSON.stringify(contextWithoutIdentity))
  }
  return { context, grounding }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('ContextProjectionReport', () => {
  it('emits the same fingerprint for identical teaching facts/config', () => {
    const a = buildTeachingContextProjectionReport(teachingFixture({ includeSupplemental: true }))
    const b = buildTeachingContextProjectionReport(teachingFixture({ includeSupplemental: true }))

    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(a.included.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['mission', 'course', 'session', 'outcome', 'next_step', 'grounding_source'])
    )
    expect(a.provenance.some((item) => item.kind === 'teaching_context_identity')).toBe(true)
  })

  it('changes fingerprint when budget truncation or included sources change', () => {
    const full = buildTeachingContextProjectionReport(teachingFixture({ includeSupplemental: true }))
    const truncated = buildTeachingContextProjectionReport(teachingFixture({
      maxBytes: 20,
      usedBytes: 16,
      truncated: true,
      truncationReason: 'budget_exhausted'
    }))

    expect(full.fingerprint).not.toBe(truncated.fingerprint)
    expect(truncated.truncation.applied).toBe(true)
    expect(truncated.truncation.reason).toBe('budget_exhausted')
    expect(truncated.budget.overBudget).toBe(true)
    expect(truncated.omitted.some((item) => item.reason === 'budget_exhausted')).toBe(true)
  })

  it('never records raw resource text, learner answers, or provider payloads', () => {
    const report = buildTeachingContextProjectionReport(teachingFixture({ includeSupplemental: true, truncated: true }))
    const json = JSON.stringify(report)

    expect(json).not.toContain('required theorem text that must never appear in the report')
    expect(json).not.toContain('recommended example text private')
    expect(json).not.toContain('learnerAnswer')
    expect(json).not.toContain('providerResponse')
    expect(json).not.toContain('rawEvidenceText')
    expect(() => assertProjectionReportRedacted(report)).not.toThrow()
  })

  it('keeps mission/session provenance while recording over-budget omissions as diagnosable reasons', () => {
    const report = buildTeachingContextProjectionReport(teachingFixture({
      truncated: true,
      truncationReason: 'budget_exhausted',
      usedBytes: 16,
      maxBytes: 16
    }))

    expect(report.included.find((item) => item.kind === 'mission')?.id).toBe('mission-algebra')
    expect(report.included.find((item) => item.kind === 'session')?.id).toBe('session-1')
    expect(report.omitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'source-supplemental',
          reason: 'budget_exhausted',
          kind: 'grounding_source'
        })
      ])
    )
    expect(report.budget).toMatchObject({ unit: 'bytes', overBudget: true, max: 16, used: 16 })
  })

  it('builds a deterministic redacted request-context report without prompt text', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SECRET_SYSTEM_PROMPT_SHOULD_NOT_LEAK' },
      { role: 'user', content: 'PRIVATE_LEARNER_QUESTION with answer key 42' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'lookup', arguments: '{"secret":"x"}' } }]
      },
      { role: 'tool', tool_call_id: 'tool-1', content: 'PRIVATE_TOOL_RESULT_PAYLOAD' }
    ]
    const tools: ToolDefinition[] = [{
      type: 'function',
      function: {
        name: 'lookup',
        description: 'lookup',
        parameters: { type: 'object', properties: {} }
      }
    }]

    const input = {
      transcriptLength: 8,
      projectedMessages: messages,
      tools,
      estimate: { messageTokens: 120, overheadTokens: 20, totalTokens: 140, source: 'local' as const },
      contextWindowTokens: 100,
      trace: [
        {
          type: 'context_hygiene_applied' as const,
          compactedToolResults: 2,
          digestedToolResults: 1,
          compactedToolCallArgs: 1
        },
        {
          type: 'context_compaction_completed' as const,
          replacedMessages: 4,
          sourceDigest: 'ctx_digest_fixture'
        },
        { type: 'context_estimated' as const }
      ]
    }

    const first = buildRequestContextProjectionReport(input)
    const second = buildRequestContextProjectionReport(input)
    expect(first.fingerprint).toBe(second.fingerprint)

    const json = JSON.stringify(first)
    expect(json).not.toContain('SECRET_SYSTEM_PROMPT_SHOULD_NOT_LEAK')
    expect(json).not.toContain('PRIVATE_LEARNER_QUESTION')
    expect(json).not.toContain('PRIVATE_TOOL_RESULT_PAYLOAD')
    expect(json).not.toContain('answer key 42')
    expect(first.budget.overBudget).toBe(true)
    expect(first.truncation.reason).toBe('budget_exhausted')
    expect(first.omitted.some((item) => item.reason === 'hygiene_compacted')).toBe(true)
    expect(first.omitted.some((item) => item.reason === 'compaction_replaced')).toBe(true)
    expect(first.source).toBe('request_context_projection')
  })

  it('fingerprint helper is stable for the same body and differs when omitted reasons change', () => {
    const base = buildTeachingContextProjectionReport(teachingFixture())
    const body = {
      schemaVersion: base.schemaVersion,
      source: base.source,
      included: base.included,
      omitted: base.omitted,
      truncation: base.truncation,
      budget: base.budget,
      provenance: base.provenance
    }
    expect(fingerprintProjectionReport(body)).toBe(base.fingerprint)

    const altered = {
      ...body,
      omitted: [
        ...body.omitted,
        { id: 'extra', kind: 'grounding_source' as const, reason: 'source_over_limit' as const }
      ]
    }
    expect(fingerprintProjectionReport(altered)).not.toBe(base.fingerprint)
  })

  it('rejects reports that smuggle raw content fields', () => {
    const report = buildTeachingContextProjectionReport(teachingFixture()) as ContextProjectionReport & {
      smuggled?: { content: string }
    }
    const polluted = {
      ...report,
      smuggled: { content: 'raw prompt text' }
    }
    expect(() => assertProjectionReportRedacted(polluted as ContextProjectionReport)).toThrow(/privacy violation/)
  })
})
