export const TRUSTED_TEACHING_RESOURCE_SCHEMA_VERSION = 1 as const
export const GROUNDING_PACK_SCHEMA_VERSION = 1 as const
export const EXTERNAL_URL_GROUNDING_SCHEMA_VERSION = 1 as const
export const EXTERNAL_SEARCH_GROUNDING_SCHEMA_VERSION = 1 as const

export type TrustedTeachingResourceDescriptor = {
  schemaVersion: typeof TRUSTED_TEACHING_RESOURCE_SCHEMA_VERSION
  sourceId: string
  relativePath: string
  /** Expected SHA-256 of the source bytes; a mismatch is stale. */
  contentSha256: string
  priority: 'required' | 'recommended' | 'supplemental'
  authority: {
    kind: 'trusted_teaching_resource'
    authorityId: string
  }
  provenance: {
    kind: 'workspace_resource'
    resourceId: string
    revisionId: string
  }
}

/**
 * Pre-fetched external URL material for teaching scenarios. Adapters never
 * write the body into the workspace; content must be supplied by the caller.
 */
export type ExternalUrlGroundingDescriptor = {
  schemaVersion: typeof EXTERNAL_URL_GROUNDING_SCHEMA_VERSION
  sourceId: string
  url: string
  contentText: string
  contentSha256: string
  priority: TrustedTeachingResourceDescriptor['priority']
  useFor?: readonly GroundingUseFor[]
  provider?: string
  retrievedAt?: string
}

/**
 * Pre-fetched search-snippet material. Thin adapter only validates safe URL
 * and packages an external_untrusted GroundingPack contribution.
 */
export type ExternalSearchSnippetDescriptor = {
  schemaVersion: typeof EXTERNAL_SEARCH_GROUNDING_SCHEMA_VERSION
  sourceId: string
  url: string
  snippet: string
  title?: string
  contentSha256?: string
  priority?: TrustedTeachingResourceDescriptor['priority']
  useFor?: readonly GroundingUseFor[]
  provider?: string
  retrievedAt?: string
}

export type GroundingTrust = 'trusted_workspace' | 'external_untrusted'

export type GroundingUseFor =
  | 'lesson_context'
  | 'source_preview'
  | 'external_supplement'

export type GroundingFreshness =
  | { kind: 'revision_matched'; revisionId: string }
  | { kind: 'content_digest_matched'; digest: string }
  | { kind: 'retrieved_at'; retrievedAt: string }
  | { kind: 'unknown' }

export type GroundingSourceLocation =
  | {
      kind: 'workspace_relative_path'
      relativePath: string
    }
  | {
      kind: 'http_url'
      url: string
    }

export type GroundingSourceProvenance =
  | {
      kind: 'workspace_resource'
      resourceId: string
      revisionId: string
    }
  | {
      kind: 'external_resource'
      resourceId: string
      provider: string
      retrievedAt?: string
    }

export type GroundingChunk = {
  chunkId: string
  contentSha256: string
  text: string
  byteLength: number
}

export type GroundedTeachingResource = {
  sourceId: string
  location: GroundingSourceLocation
  provenance: GroundingSourceProvenance
  contentSha256: string
  /** Explicit content digest (SHA-256 hex); equals contentSha256 for byte-backed sources. */
  digest: string
  trust: GroundingTrust
  useFor: readonly GroundingUseFor[]
  freshness: GroundingFreshness
  priority: TrustedTeachingResourceDescriptor['priority']
  chunks: readonly GroundingChunk[]
}

export type GroundingExclusionCode =
  | 'resource_absent'
  | 'unknown_schema'
  | 'unauthorized_resource'
  | 'unsafe_location'
  | 'unsafe_url'
  | 'source_unavailable'
  | 'dead_reference'
  | 'stale_source'
  | 'duplicate_source_id'
  | 'duplicate_chunk'
  | 'source_over_limit'
  | 'budget_exhausted'
  | 'resource_gap'

export type GroundingExclusion = {
  sourceId: string | null
  relativePath: string | null
  code: GroundingExclusionCode
}

export type GroundingBudget = {
  maxBytes: number
  availableBytes: number
  usedBytes: number
  remainingBytes: number
  truncated: boolean
  truncationReason: 'budget_exhausted' | 'source_over_limit' | null
}

/**
 * Read-only, deterministic resource grounding output. It never contains
 * learner, assessment, transcript, or provider payloads.
 */
export type GroundingPack = {
  schemaVersion: typeof GROUNDING_PACK_SCHEMA_VERSION
  identity: string
  status: 'ready' | 'degraded' | 'unavailable'
  sources: readonly GroundedTeachingResource[]
  exclusions: readonly GroundingExclusion[]
  budget: GroundingBudget
}

/** True when the pack has no grounded sources (explicit resource gap). */
export function isResourceGap(pack: Pick<GroundingPack, 'sources' | 'status'>): boolean {
  return pack.sources.length === 0 || pack.status === 'unavailable'
}
