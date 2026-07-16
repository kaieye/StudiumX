export const TRUSTED_TEACHING_RESOURCE_SCHEMA_VERSION = 1 as const
export const GROUNDING_PACK_SCHEMA_VERSION = 1 as const

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

export type GroundingSourceLocation = {
  kind: 'workspace_relative_path'
  relativePath: string
}

export type GroundingSourceProvenance = TrustedTeachingResourceDescriptor['provenance']

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
  priority: TrustedTeachingResourceDescriptor['priority']
  chunks: readonly GroundingChunk[]
}

export type GroundingExclusionCode =
  | 'resource_absent'
  | 'unknown_schema'
  | 'unauthorized_resource'
  | 'unsafe_location'
  | 'source_unavailable'
  | 'stale_source'
  | 'duplicate_source_id'
  | 'duplicate_chunk'
  | 'source_over_limit'
  | 'budget_exhausted'

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
