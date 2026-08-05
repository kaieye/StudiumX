import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  assertProjectionReportRedacted,
  buildRequestContextProjectionReport,
  buildTeachingContextProjectionReport
} from '../../src/main/ai/context-projection-report'
import type { GroundingPack } from '../../src/shared/teaching-types/grounding'
import type { TeachingContext } from '../../src/shared/teaching-types/teaching-context'
import type { ChatMessage, ToolDefinition } from '../../src/main/ai/provider-adapter'
import { RequestContextProjector } from '../../src/main/ai/request-context-projection'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

const groundingWithoutIdentity = {
  schemaVersion: 1 as const,
  status: 'degraded' as const,
  sources: [
    {
      sourceId: 'source-required',
      location: { kind: 'workspace_relative_path' as const, relativePath: 'resources/required.txt' },
      provenance: { kind: 'workspace_resource' as const, resourceId: 'resource-required', revisionId: 'rev-1' },
      contentSha256: sha256('required-bytes'),
      priority: 'required' as const,
      chunks: [{
        chunkId: 'sha256:required',
        contentSha256: sha256('required-bytes'),
        text: 'RAW_GROUNDING_TEXT_MUST_NOT_APPEAR_IN_REPORT',
        byteLength: 20
      }]
    }
  ],
  exclusions: [
    { sourceId: 'source-supplemental', relativePath: 'resources/supplemental.txt', code: 'budget_exhausted' as const }
  ],
  budget: {
    maxBytes: 24,
    availableBytes: 40,
    usedBytes: 20,
    remainingBytes: 4,
    truncated: true,
    truncationReason: 'budget_exhausted' as const
  }
}
const grounding: GroundingPack = {
  ...groundingWithoutIdentity,
  identity: sha256(JSON.stringify(groundingWithoutIdentity))
}

const contextWithoutIdentity = {
  schemaVersion: 1 as const,
  mission: { id: 'mission-fixture', goalStatus: 'available' as const },
  course: { id: 'course-fixture' },
  currentSession: { id: 'session-fixture', source: 'canonical' as const, readOnly: false },
  outcome: { status: 'trusted' as const, id: 'outcome-fixture', kind: 'needs_practice' as const },
  nextStep: { action: 'contrast_and_retry' as const, reason: 'needs_practice' as const },
  grounding: {
    identity: grounding.identity,
    status: grounding.status,
    sourceIds: ['source-required'],
    exclusionCount: 1
  }
}
const context: TeachingContext = {
  ...contextWithoutIdentity,
  identity: sha256(JSON.stringify(contextWithoutIdentity))
}

const teachingA = buildTeachingContextProjectionReport({ context, grounding })
const teachingB = buildTeachingContextProjectionReport({ context, grounding })
assert.equal(teachingA.fingerprint, teachingB.fingerprint, 'teaching report fingerprint must be deterministic')
assert.equal(teachingA.truncation.reason, 'budget_exhausted')
assert.ok(teachingA.budget.overBudget, 'over-budget must be diagnosable')
assert.ok(teachingA.omitted.some((item) => item.reason === 'budget_exhausted'))
assert.ok(teachingA.included.some((item) => item.kind === 'mission' && item.id === 'mission-fixture'))
assert.ok(teachingA.included.some((item) => item.kind === 'session' && item.id === 'session-fixture'))
assert.doesNotMatch(JSON.stringify(teachingA), /RAW_GROUNDING_TEXT_MUST_NOT_APPEAR_IN_REPORT/)
assertProjectionReportRedacted(teachingA)

const tool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup',
    description: 'lookup',
    parameters: { type: 'object', properties: { query: { type: 'string' } } }
  }
}

const transcript: ChatMessage[] = [
  { role: 'system', content: 'SYSTEM_PROMPT_PRIVATE_TEXT' },
  { role: 'user', content: 'LEARNER_PRIVATE_QUESTION' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'old-tool',
      type: 'function',
      function: { name: 'lookup', arguments: JSON.stringify({ query: 'old', payload: 'x'.repeat(12_000) }) }
    }]
  },
  {
    role: 'tool',
    tool_call_id: 'old-tool',
    content: `${Array.from({ length: 310 }, (_, index) => `historical tool output ${index} ${'x'.repeat(80)}`).join('\n')}\n`
  },
  { role: 'user', content: 'CURRENT_REQUEST_ONLY' }
]

const projector = new RequestContextProjector({
  modelId: 'fixture-model',
  compaction: { enabled: false, contextWindowTokens: 8_000 },
  summarize: async () => 'unused'
})
const projected = await projector.project(transcript, [tool])
assert.ok(projected.report, 'projector must emit report')
assert.equal(projected.report.source, 'request_context_projection')
assert.match(projected.report.fingerprint, /^[a-f0-9]{64}$/)
assert.doesNotMatch(JSON.stringify(projected.report), /SYSTEM_PROMPT_PRIVATE_TEXT|LEARNER_PRIVATE_QUESTION|CURRENT_REQUEST_ONLY/)
assertProjectionReportRedacted(projected.report)

const again = await projector.project(transcript, [tool])
assert.equal(again.report.fingerprint, projected.report.fingerprint, 'request report fingerprint must be deterministic')

const overBudget = buildRequestContextProjectionReport({
  transcriptLength: transcript.length,
  projectedMessages: projected.messages,
  tools: [tool],
  estimate: { messageTokens: 9_000, toolSchemaTokens: 100, framingTokens: 0, outputReserveTokens: 0, extraTokens: 0, overheadTokens: 100, totalTokens: 9_100, source: 'local' },
  contextWindowTokens: 1_000,
  contextWindowSource: 'configured',
  trace: projected.trace
})
assert.equal(overBudget.budget.overBudget, true)
assert.equal(overBudget.truncation.reason, 'budget_exhausted')

console.log('context projection report runtime fixture ok')
