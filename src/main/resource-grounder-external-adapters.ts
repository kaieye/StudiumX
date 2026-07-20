import { createHash } from 'node:crypto'
import { assertSafeFetchUrl } from './ai/search-runtime'
import {
  buildGroundedResource,
  type GroundingSourceAdapter
} from './resource-grounder'
import {
  EXTERNAL_SEARCH_GROUNDING_SCHEMA_VERSION,
  EXTERNAL_URL_GROUNDING_SCHEMA_VERSION,
  GROUNDING_PACK_SCHEMA_VERSION,
  type ExternalSearchSnippetDescriptor,
  type ExternalUrlGroundingDescriptor,
  type GroundedTeachingResource,
  type GroundingExclusion,
  type GroundingExclusionCode,
  type GroundingPack,
  type GroundingUseFor
} from '../shared/teaching-types/grounding'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DEFAULT_EXTERNAL_USE_FOR: readonly GroundingUseFor[] = ['external_supplement', 'source_preview']

export type ExternalUrlGroundingAdapterOptions = {
  maxBytes: number
  maxSourceBytes?: number
  /**
   * Optional synchronous safe-URL checker. Defaults to assertSafeFetchUrl.
   * Injected for unit tests; production uses the search-runtime guard.
   */
  assertSafeUrl?: (url: string) => string
}

export type ExternalSearchGroundingAdapterOptions = {
  maxBytes: number
  maxSourceBytes?: number
  assertSafeUrl?: (url: string) => string
}

/**
 * Thin teaching-scenario adapter for pre-fetched external URL bodies.
 * Does not fetch, does not write to the workspace, and marks trust as
 * external_untrusted. Failures become typed exclusions / resource gaps.
 */
export function createExternalUrlGroundingAdapter(
  descriptors: readonly ExternalUrlGroundingDescriptor[],
  options: ExternalUrlGroundingAdapterOptions
): GroundingSourceAdapter {
  const maxBytes = requireNonNegativeSafeInteger(options.maxBytes, 'maxBytes')
  const maxSourceBytes = requireNonNegativeSafeInteger(
    options.maxSourceBytes ?? options.maxBytes,
    'maxSourceBytes'
  )
  const assertSafeUrl = options.assertSafeUrl ?? assertSafeFetchUrl

  return {
    kind: 'external_url',
    async ground(): Promise<GroundingPack> {
      return groundExternalUrlDescriptors(descriptors, { maxBytes, maxSourceBytes, assertSafeUrl })
    }
  }
}

/**
 * Thin adapter for pre-fetched web_search snippets. Only validates the URL and
 * packages short text into an external_untrusted grounding contribution.
 */
export function createExternalSearchGroundingAdapter(
  descriptors: readonly ExternalSearchSnippetDescriptor[],
  options: ExternalSearchGroundingAdapterOptions
): GroundingSourceAdapter {
  const maxBytes = requireNonNegativeSafeInteger(options.maxBytes, 'maxBytes')
  const maxSourceBytes = requireNonNegativeSafeInteger(
    options.maxSourceBytes ?? options.maxBytes,
    'maxSourceBytes'
  )
  const assertSafeUrl = options.assertSafeUrl ?? assertSafeFetchUrl

  return {
    kind: 'external_search',
    async ground(): Promise<GroundingPack> {
      const exclusions: GroundingExclusion[] = []
      const valid: ExternalUrlGroundingDescriptor[] = []

      for (const original of descriptors) {
        const sourceId = typeof original.sourceId === 'string' ? original.sourceId : null
        if (original.schemaVersion !== EXTERNAL_SEARCH_GROUNDING_SCHEMA_VERSION) {
          exclusions.push(exclusion(sourceId, null, 'unknown_schema'))
          continue
        }
        const snippet = typeof original.snippet === 'string' ? original.snippet : ''
        const digest = typeof original.contentSha256 === 'string' && SHA256_PATTERN.test(original.contentSha256)
          ? original.contentSha256
          : sha256(snippet)
        valid.push({
          schemaVersion: EXTERNAL_URL_GROUNDING_SCHEMA_VERSION,
          sourceId: original.sourceId,
          url: original.url,
          contentText: snippet,
          contentSha256: digest,
          priority: original.priority ?? 'supplemental',
          useFor: original.useFor ?? DEFAULT_EXTERNAL_USE_FOR,
          provider: original.provider ?? 'web_search',
          retrievedAt: original.retrievedAt
        })
      }

      const pack = await groundExternalUrlDescriptors(valid, { maxBytes, maxSourceBytes, assertSafeUrl })
      if (exclusions.length === 0) return pack

      const mergedExclusions = [...pack.exclusions, ...exclusions]
      const status = pack.sources.length === 0 ? 'unavailable' as const : 'degraded' as const
      const packWithoutIdentity = {
        schemaVersion: pack.schemaVersion,
        status,
        sources: pack.sources,
        exclusions: mergedExclusions,
        budget: pack.budget
      }
      return {
        ...packWithoutIdentity,
        identity: sha256(stableJson(packWithoutIdentity))
      }
    }
  }
}

async function groundExternalUrlDescriptors(
  descriptors: readonly ExternalUrlGroundingDescriptor[],
  options: {
    maxBytes: number
    maxSourceBytes: number
    assertSafeUrl: (url: string) => string
  }
): Promise<GroundingPack> {
  const exclusions: GroundingExclusion[] = []
  const accepted: GroundedTeachingResource[] = []
  const seenSourceIds = new Set<string>()
  const seenChunkHashes = new Set<string>()
  let availableBytes = 0
  let usedBytes = 0
  let sawSourceOverLimit = false
  let sawBudgetExhausted = false

  if (descriptors.length === 0) {
    exclusions.push(exclusion(null, null, 'resource_absent'))
  }

  for (const descriptor of descriptors) {
    const sourceId = typeof descriptor.sourceId === 'string' ? descriptor.sourceId : null
    const url = typeof descriptor.url === 'string' ? descriptor.url : null

    if (descriptor.schemaVersion !== EXTERNAL_URL_GROUNDING_SCHEMA_VERSION) {
      exclusions.push(exclusion(sourceId, null, 'unknown_schema'))
      continue
    }

    if (
      !sourceId ||
      !SOURCE_ID_PATTERN.test(sourceId) ||
      !url ||
      typeof descriptor.contentText !== 'string' ||
      typeof descriptor.contentSha256 !== 'string' ||
      !SHA256_PATTERN.test(descriptor.contentSha256) ||
      !isPriority(descriptor.priority)
    ) {
      exclusions.push(exclusion(sourceId, null, 'unauthorized_resource'))
      continue
    }

    if (seenSourceIds.has(sourceId)) {
      exclusions.push(exclusion(sourceId, url, 'duplicate_source_id'))
      continue
    }
    seenSourceIds.add(sourceId)

    let safeUrl: string
    try {
      safeUrl = options.assertSafeUrl(url)
    } catch {
      exclusions.push(exclusion(sourceId, url, 'unsafe_url'))
      continue
    }

    // Dead reference: empty body with a declared URL is treated as a dead ref.
    if (descriptor.contentText.length === 0) {
      exclusions.push(exclusion(sourceId, safeUrl, 'dead_reference'))
      continue
    }

    const contentBuffer = Buffer.from(descriptor.contentText, 'utf8')
    if (contentBuffer.byteLength > options.maxSourceBytes) {
      sawSourceOverLimit = true
      exclusions.push(exclusion(sourceId, safeUrl, 'source_over_limit'))
      continue
    }

    const contentSha256 = sha256(contentBuffer)
    if (contentSha256 !== descriptor.contentSha256) {
      exclusions.push(exclusion(sourceId, safeUrl, 'stale_source'))
      continue
    }

    if (seenChunkHashes.has(contentSha256)) {
      exclusions.push(exclusion(sourceId, safeUrl, 'duplicate_chunk'))
      continue
    }
    seenChunkHashes.add(contentSha256)
    availableBytes += contentBuffer.byteLength

    if (contentBuffer.byteLength > options.maxBytes - usedBytes) {
      sawBudgetExhausted = true
      exclusions.push(exclusion(sourceId, safeUrl, 'budget_exhausted'))
      continue
    }

    usedBytes += contentBuffer.byteLength
    const useFor = normalizeUseFor(descriptor.useFor)
    const provider = typeof descriptor.provider === 'string' && descriptor.provider.length > 0
      ? descriptor.provider
      : 'external_url'
    const retrievedAt = typeof descriptor.retrievedAt === 'string' && descriptor.retrievedAt.length > 0
      ? descriptor.retrievedAt
      : undefined

    accepted.push(buildGroundedResource({
      sourceId,
      location: { kind: 'http_url', url: safeUrl },
      provenance: {
        kind: 'external_resource',
        resourceId: sourceId,
        provider,
        ...(retrievedAt ? { retrievedAt } : {})
      },
      contentSha256,
      trust: 'external_untrusted',
      useFor,
      freshness: retrievedAt
        ? { kind: 'retrieved_at', retrievedAt }
        : { kind: 'content_digest_matched', digest: contentSha256 },
      priority: descriptor.priority,
      text: descriptor.contentText,
      byteLength: contentBuffer.byteLength
    }))
  }

  const packWithoutIdentity = {
    schemaVersion: GROUNDING_PACK_SCHEMA_VERSION,
    status: groundingStatus(accepted.length, exclusions.length),
    sources: accepted,
    exclusions,
    budget: {
      maxBytes: options.maxBytes,
      availableBytes,
      usedBytes,
      remainingBytes: options.maxBytes - usedBytes,
      truncated: sawBudgetExhausted || sawSourceOverLimit,
      truncationReason: sawBudgetExhausted
        ? 'budget_exhausted' as const
        : sawSourceOverLimit
          ? 'source_over_limit' as const
          : null
    }
  }

  return {
    ...packWithoutIdentity,
    identity: sha256(stableJson(packWithoutIdentity))
  }
}

function normalizeUseFor(value: readonly GroundingUseFor[] | undefined): readonly GroundingUseFor[] {
  if (!value || value.length === 0) return DEFAULT_EXTERNAL_USE_FOR
  const allowed = new Set<GroundingUseFor>(['lesson_context', 'source_preview', 'external_supplement'])
  const filtered = value.filter((item): item is GroundingUseFor => allowed.has(item as GroundingUseFor))
  return filtered.length > 0 ? filtered : DEFAULT_EXTERNAL_USE_FOR
}

function isPriority(value: unknown): value is ExternalUrlGroundingDescriptor['priority'] {
  return value === 'required' || value === 'recommended' || value === 'supplemental'
}

function groundingStatus(sourceCount: number, exclusionCount: number): GroundingPack['status'] {
  if (sourceCount === 0) return 'unavailable'
  return exclusionCount === 0 ? 'ready' : 'degraded'
}

function exclusion(sourceId: string | null, relativePath: string | null, code: GroundingExclusionCode): GroundingExclusion {
  return { sourceId, relativePath, code }
}

function requireNonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Resource grounding ${label} must be a non-negative safe integer.`)
  }
  return value
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

