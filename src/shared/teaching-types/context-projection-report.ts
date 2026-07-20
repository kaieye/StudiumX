/**
 * Privacy-safe Context Projection Report (P1-6 / ADR-0013 deepen).
 *
 * Records what was included or omitted during teaching / request context
 * assembly, with budget and provenance diagnostics. Never carries raw prompt
 * text, learner answers, provider payloads, or full absolute paths.
 */
export const CONTEXT_PROJECTION_REPORT_SCHEMA_VERSION = 1 as const

export type ContextProjectionReportSource =
  | 'teaching_context_assembler'
  | 'request_context_projection'

export type ProjectionItemKind =
  | 'mission'
  | 'course'
  | 'session'
  | 'outcome'
  | 'next_step'
  | 'grounding_source'
  | 'message'
  | 'tool_schema'
  | 'compaction_summary'
  | 'hygiene_signal'

export type ProjectionOmissionReason =
  | 'budget_exhausted'
  | 'source_over_limit'
  | 'unauthorized_resource'
  | 'unsafe_location'
  | 'stale_source'
  | 'duplicate_source_id'
  | 'duplicate_chunk'
  | 'resource_absent'
  | 'unknown_schema'
  | 'source_unavailable'
  | 'hygiene_compacted'
  | 'hygiene_digested'
  | 'compaction_replaced'
  | 'not_projected'

export type ProjectionProvenanceRef = {
  kind: string
  id: string
}

export type ProjectionIncludedItem = {
  id: string
  kind: ProjectionItemKind
  estimatedTokens?: number
  estimatedBytes?: number
  provenance?: ProjectionProvenanceRef
  priority?: string
}

export type ProjectionOmittedItem = {
  id: string
  kind: ProjectionItemKind
  reason: ProjectionOmissionReason
  provenance?: ProjectionProvenanceRef
  priority?: string
}

export type ProjectionTruncation = {
  applied: boolean
  reason: ProjectionOmissionReason | null
  truncatedCount: number
}

export type ProjectionBudgetSnapshot = {
  unit: 'tokens' | 'bytes'
  max: number
  used: number
  remaining: number
  overBudget: boolean
}

/**
 * Stable, redacted projection audit. Fingerprint is deterministic for the same
 * facts/config and never derived from raw prompt text.
 */
export type ContextProjectionReport = {
  schemaVersion: typeof CONTEXT_PROJECTION_REPORT_SCHEMA_VERSION
  source: ContextProjectionReportSource
  included: readonly ProjectionIncludedItem[]
  omitted: readonly ProjectionOmittedItem[]
  truncation: ProjectionTruncation
  budget: ProjectionBudgetSnapshot
  provenance: readonly ProjectionProvenanceRef[]
  fingerprint: string
}
