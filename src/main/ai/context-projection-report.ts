import { createHash } from 'node:crypto'
import type {
  ContextProjectionReport,
  ContextProjectionReportSource,
  ProjectionBudgetSnapshot,
  ProjectionIncludedItem,
  ProjectionOmittedItem,
  ProjectionOmissionReason,
  ProjectionProvenanceRef,
  ProjectionTruncation,
  RequestFitSnapshot
} from '../../shared/teaching-types/context-projection-report'
import { CONTEXT_PROJECTION_REPORT_SCHEMA_VERSION } from '../../shared/teaching-types/context-projection-report'
import type { GroundingExclusionCode, GroundingPack } from '../../shared/teaching-types/grounding'
import type { TeachingContext } from '../../shared/teaching-types/teaching-context'
import type { ChatMessage, ToolDefinition } from './provider-adapter'
import type { TokenEstimate } from './context-estimator'

export type { ContextProjectionReport } from '../../shared/teaching-types/context-projection-report'
export { CONTEXT_PROJECTION_REPORT_SCHEMA_VERSION } from '../../shared/teaching-types/context-projection-report'

export type TeachingProjectionReportInput = {
  context: TeachingContext
  grounding: GroundingPack
}

/**
 * Minimal redacted trace shape used by request-context projection reports.
 * Intentionally decoupled from RequestContextProjectionTrace to avoid cycles.
 */
export type RequestProjectionTraceEvent =
  | {
      type: 'context_hygiene_applied'
      compactedToolResults: number
      digestedToolResults: number
      compactedToolCallArgs: number
    }
  | {
      type: 'context_compaction_started'
      sourceDigest: string
    }
  | {
      type: 'context_compaction_completed'
      replacedMessages: number
      sourceDigest: string
    }
  | {
      type: 'context_compaction_failed'
      sourceDigest: string
    }
  | {
      type: 'context_estimated'
    }
  | {
      type: string
      [key: string]: unknown
    }

export type RequestProjectionReportInput = {
  transcriptLength: number
  projectedMessages: readonly ChatMessage[]
  tools: readonly ToolDefinition[]
  estimate: TokenEstimate
  contextWindowTokens: number
  contextWindowSource: RequestFitSnapshot['contextWindowSource']
  trace: readonly RequestProjectionTraceEvent[]
}

type FingerprintableReport = Omit<ContextProjectionReport, 'fingerprint'>

/**
 * Builds a privacy-safe projection report for teaching context assembly.
 * Only IDs, counts, budget numbers, and reason codes are retained.
 */
export function buildTeachingContextProjectionReport(
  input: TeachingProjectionReportInput
): ContextProjectionReport {
  const { context, grounding } = input
  const included: ProjectionIncludedItem[] = [
    {
      id: context.mission.id,
      kind: 'mission',
      provenance: { kind: 'mission', id: context.mission.id }
    },
    {
      id: context.course.id,
      kind: 'course',
      provenance: { kind: 'course', id: context.course.id }
    },
    {
      id: context.currentSession.id,
      kind: 'session',
      provenance: { kind: 'session', id: context.currentSession.id }
    },
    {
      id: context.outcome.status === 'trusted' ? context.outcome.id : `outcome:${context.outcome.status}`,
      kind: 'outcome',
      provenance:
        context.outcome.status === 'trusted'
          ? { kind: 'outcome', id: context.outcome.id }
          : { kind: 'outcome_status', id: context.outcome.status }
    },
    {
      id: `next_step:${context.nextStep.action}`,
      kind: 'next_step',
      provenance: { kind: 'next_step_action', id: context.nextStep.action }
    },
    ...grounding.sources.map((source) => ({
      id: source.sourceId,
      kind: 'grounding_source' as const,
      estimatedBytes: source.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      provenance: {
        kind: source.provenance.kind,
        id: source.provenance.resourceId
      },
      priority: source.priority
    }))
  ]

  const omitted: ProjectionOmittedItem[] = grounding.exclusions.map((exclusion, index) => ({
    id: exclusion.sourceId ?? `exclusion:${index}:${exclusion.code}`,
    kind: 'grounding_source',
    reason: mapGroundingExclusion(exclusion.code),
    provenance: exclusion.sourceId
      ? { kind: 'grounding_exclusion', id: exclusion.sourceId }
      : { kind: 'grounding_exclusion_code', id: exclusion.code }
  }))

  const budget: ProjectionBudgetSnapshot = {
    unit: 'bytes',
    max: grounding.budget.maxBytes,
    used: grounding.budget.usedBytes,
    remaining: grounding.budget.remainingBytes,
    overBudget: grounding.budget.truncated || grounding.budget.usedBytes > grounding.budget.maxBytes
  }

  const truncation: ProjectionTruncation = {
    applied: grounding.budget.truncated,
    reason: grounding.budget.truncationReason
      ? mapGroundingExclusion(grounding.budget.truncationReason)
      : null,
    truncatedCount: omitted.filter((item) =>
      item.reason === 'budget_exhausted' || item.reason === 'source_over_limit'
    ).length
  }

  const provenance: ProjectionProvenanceRef[] = [
    { kind: 'teaching_context_identity', id: context.identity },
    { kind: 'grounding_identity', id: grounding.identity },
    ...context.grounding.sourceIds.map((sourceId) => ({
      kind: 'grounding_source_id' as const,
      id: sourceId
    }))
  ]

  return finalizeReport({
    schemaVersion: CONTEXT_PROJECTION_REPORT_SCHEMA_VERSION,
    source: 'teaching_context_assembler',
    included: sortIncluded(included),
    omitted: sortOmitted(omitted),
    truncation,
    budget,
    provenance: sortProvenance(provenance)
  })
}

/**
 * Builds a privacy-safe projection report for request-context (provider) projection.
 * Message content and tool payloads are never copied into the report.
 */
export function buildRequestContextProjectionReport(
  input: RequestProjectionReportInput
): ContextProjectionReport {
  const { projectedMessages, tools, estimate, contextWindowTokens, contextWindowSource, trace, transcriptLength } = input
  const included: ProjectionIncludedItem[] = projectedMessages.map((message, index) => {
    if (message.role === 'system' && isCompactionSummary(message.content)) {
      return {
        id: `message:${index}:compaction_summary`,
        kind: 'compaction_summary' as const,
        estimatedTokens: estimateMessageTokensRough(message)
      }
    }
    if (message.role === 'tool') {
      return {
        id: `message:${index}:tool:${message.tool_call_id}`,
        kind: 'message' as const,
        estimatedTokens: estimateMessageTokensRough(message),
        provenance: { kind: 'tool_call_id', id: message.tool_call_id }
      }
    }
    return {
      id: `message:${index}:${message.role}`,
      kind: 'message' as const,
      estimatedTokens: estimateMessageTokensRough(message)
    }
  })

  if (tools.length > 0) {
    included.push({
      id: `tools:${tools.length}`,
      kind: 'tool_schema',
      estimatedTokens: estimate.toolSchemaTokens
    })
  }

  const omitted: ProjectionOmittedItem[] = []
  let hygieneCompacted = 0
  let hygieneDigested = 0
  let compactionReplaced = 0
  let compactionReason: ProjectionOmissionReason | null = null

  for (const event of trace) {
    if (event.type === 'context_hygiene_applied') {
      const hygiene = event as {
        type: 'context_hygiene_applied'
        compactedToolResults: number
        digestedToolResults: number
        compactedToolCallArgs: number
      }
      hygieneCompacted = hygiene.compactedToolResults + hygiene.compactedToolCallArgs
      hygieneDigested = hygiene.digestedToolResults
      if (hygiene.compactedToolResults > 0) {
        omitted.push({
          id: `hygiene:tool_results:${hygiene.compactedToolResults}`,
          kind: 'hygiene_signal',
          reason: 'hygiene_compacted'
        })
      }
      if (hygiene.digestedToolResults > 0) {
        omitted.push({
          id: `hygiene:digested:${hygiene.digestedToolResults}`,
          kind: 'hygiene_signal',
          reason: 'hygiene_digested'
        })
      }
      if (hygiene.compactedToolCallArgs > 0) {
        omitted.push({
          id: `hygiene:tool_call_args:${hygiene.compactedToolCallArgs}`,
          kind: 'hygiene_signal',
          reason: 'hygiene_compacted'
        })
      }
    }
    if (event.type === 'context_compaction_completed') {
      const completed = event as {
        type: 'context_compaction_completed'
        replacedMessages: number
        sourceDigest: string
      }
      compactionReplaced = completed.replacedMessages
      compactionReason = 'compaction_replaced'
      omitted.push({
        id: `compaction:replaced:${completed.replacedMessages}`,
        kind: 'message',
        reason: 'compaction_replaced',
        provenance: { kind: 'source_digest', id: completed.sourceDigest }
      })
    }
  }

  const projectedCount = projectedMessages.length
  const droppedByProjection = Math.max(0, transcriptLength - projectedCount)
  if (droppedByProjection > 0 && compactionReplaced === 0) {
    omitted.push({
      id: `projection:count_delta:${droppedByProjection}`,
      kind: 'message',
      reason: 'not_projected'
    })
  }

  const overBudget = estimate.totalTokens > contextWindowTokens
  const budget: ProjectionBudgetSnapshot = {
    unit: 'tokens',
    max: contextWindowTokens,
    used: estimate.totalTokens,
    remaining: Math.max(0, contextWindowTokens - estimate.totalTokens),
    overBudget
  }

  const truncatedCount =
    (hygieneCompacted > 0 ? 1 : 0) +
    (hygieneDigested > 0 ? 1 : 0) +
    (compactionReplaced > 0 ? compactionReplaced : 0)

  const truncation: ProjectionTruncation = {
    applied: truncatedCount > 0 || overBudget,
    reason: overBudget
      ? 'budget_exhausted'
      : compactionReason ??
        (hygieneDigested > 0
          ? 'hygiene_digested'
          : hygieneCompacted > 0
            ? 'hygiene_compacted'
            : null),
    truncatedCount
  }

  const provenance: ProjectionProvenanceRef[] = [
    { kind: 'request_message_count', id: String(projectedCount) },
    { kind: 'transcript_message_count', id: String(transcriptLength) }
  ]
  for (const event of trace) {
    if (
      event.type === 'context_compaction_completed' ||
      event.type === 'context_compaction_started' ||
      event.type === 'context_compaction_failed'
    ) {
      const digest = typeof event.sourceDigest === 'string' ? event.sourceDigest : ''
      if (digest) provenance.push({ kind: 'source_digest', id: digest })
    }
  }

  return finalizeReport({
    schemaVersion: CONTEXT_PROJECTION_REPORT_SCHEMA_VERSION,
    source: 'request_context_projection',
    included: sortIncluded(included),
    omitted: sortOmitted(omitted),
    truncation,
    budget,
    requestFit: {
      inputMessageTokens: estimate.messageTokens,
      toolSchemaTokens: estimate.toolSchemaTokens,
      framingTokens: estimate.framingTokens,
      outputReserveTokens: estimate.outputReserveTokens,
      extraTokens: estimate.extraTokens,
      projectedTokens: estimate.totalTokens,
      effectiveContextWindowTokens: contextWindowTokens,
      contextWindowSource,
      estimateSource: estimate.source
    },
    provenance: sortProvenance(dedupeProvenance(provenance))
  })
}

/**
 * Deterministic fingerprint over the redacted report body (without fingerprint).
 * Same facts/config always yield the same hex digest.
 */
export function fingerprintProjectionReport(body: FingerprintableReport): string {
  return createHash('sha256').update(stableSerialize(body)).digest('hex')
}

/** Asserts a report never contains known privacy-sensitive field names or raw prompt markers. */
export function assertProjectionReportRedacted(report: ContextProjectionReport): void {
  const json = JSON.stringify(report)
  const forbidden = [
    /"content"\s*:/,
    /"learnerAnswer"\s*:/,
    /"transcript"\s*:/,
    /"rawEvidenceText"\s*:/,
    /"assessmentPayload"\s*:/,
    /"providerResponse"\s*:/,
    /"selectedOptionIds"\s*:/,
    /"apiKey"\s*:/,
    /"authorization"\s*:/,
    /\[CONTEXT COMPACTION/
  ]
  for (const pattern of forbidden) {
    if (pattern.test(json)) {
      throw new Error(`ProjectionReport privacy violation: matched ${pattern}`)
    }
  }
}

function finalizeReport(body: FingerprintableReport): ContextProjectionReport {
  const fingerprint = fingerprintProjectionReport(body)
  const report: ContextProjectionReport = { ...body, fingerprint }
  assertProjectionReportRedacted(report)
  return report
}

function mapGroundingExclusion(code: GroundingExclusionCode | string): ProjectionOmissionReason {
  switch (code) {
    case 'budget_exhausted':
      return 'budget_exhausted'
    case 'source_over_limit':
      return 'source_over_limit'
    case 'unauthorized_resource':
      return 'unauthorized_resource'
    case 'unsafe_location':
      return 'unsafe_location'
    case 'stale_source':
      return 'stale_source'
    case 'duplicate_source_id':
      return 'duplicate_source_id'
    case 'duplicate_chunk':
      return 'duplicate_chunk'
    case 'resource_absent':
      return 'resource_absent'
    case 'unknown_schema':
      return 'unknown_schema'
    case 'source_unavailable':
      return 'source_unavailable'
    default:
      return 'not_projected'
  }
}

function isCompactionSummary(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.includes('[CONTEXT COMPACTION - REFERENCE ONLY]')
}

/** Rough token estimate without storing message content in the report. */
function estimateMessageTokensRough(message: ChatMessage): number {
  let length = message.role.length + 4
  if (message.role === 'assistant') {
    length += (message.content ?? '').length
    if (message.tool_calls?.length) {
      try {
        length += JSON.stringify(message.tool_calls).length
      } catch {
        length += 32
      }
    }
  } else if (message.role === 'tool') {
    length += message.tool_call_id.length + message.content.length
  } else {
    length += message.content.length
  }
  return Math.max(1, Math.ceil(length / 4))
}

function sortIncluded(items: ProjectionIncludedItem[]): ProjectionIncludedItem[] {
  return [...items].sort((left, right) => compareText(left.kind, right.kind) || compareText(left.id, right.id))
}

function sortOmitted(items: ProjectionOmittedItem[]): ProjectionOmittedItem[] {
  return [...items].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.reason, right.reason) ||
      compareText(left.id, right.id)
  )
}

function sortProvenance(items: ProjectionProvenanceRef[]): ProjectionProvenanceRef[] {
  return [...items].sort((left, right) => compareText(left.kind, right.kind) || compareText(left.id, right.id))
}

function dedupeProvenance(items: ProjectionProvenanceRef[]): ProjectionProvenanceRef[] {
  const seen = new Set<string>()
  const out: ProjectionProvenanceRef[] = []
  for (const item of items) {
    const key = `${item.kind}\0${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Stable JSON with sorted object keys so fingerprint does not depend on insertion order.
 */
function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key])
    }
    return out
  }
  return value
}

export type { ContextProjectionReportSource }
