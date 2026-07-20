import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { readContainedRegularFileBounded } from './path-access'
import { requireSafeTeachingRelativePath } from '../shared/teaching-placement'
import {
  GROUNDING_PACK_SCHEMA_VERSION,
  TRUSTED_TEACHING_RESOURCE_SCHEMA_VERSION,
  type GroundedTeachingResource,
  type GroundingExclusion,
  type GroundingExclusionCode,
  type GroundingFreshness,
  type GroundingPack,
  type GroundingTrust,
  type GroundingUseFor,
  type TrustedTeachingResourceDescriptor
} from '../shared/teaching-types/grounding'

export type ResourceGrounderOptions = {
  workspaceRoot: string
  trustedAuthorityId: string
  maxBytes: number
  maxSourceBytes?: number
}

export interface ResourceGrounder {
  ground(descriptors: readonly TrustedTeachingResourceDescriptor[]): Promise<GroundingPack>
}

/**
 * Unified seam for every grounding source. Each adapter still produces the
 * same GroundingPack; the multi-source grounder merges them deterministically.
 * Adapters are read-only relative to the teaching workspace: they never write
 * external content into the workspace.
 */
export interface GroundingSourceAdapter {
  readonly kind: string
  ground(): Promise<GroundingPack>
}

export type GroundingMergeOptions = {
  maxBytes: number
}

type ValidatedDescriptor = TrustedTeachingResourceDescriptor & {
  relativePath: string
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PRIORITY_ORDER: Record<TrustedTeachingResourceDescriptor['priority'], number> = {
  required: 0,
  recommended: 1,
  supplemental: 2
}

const WORKSPACE_USE_FOR: readonly GroundingUseFor[] = ['lesson_context', 'source_preview']

/**
 * The grounder is read-only: it only performs contained, bounded reads through
 * path-access and exposes no filesystem write, provider, or clock capability.
 * External adapters may be composed via createMultiSourceResourceGrounder.
 */
export function createResourceGrounder(options: ResourceGrounderOptions): ResourceGrounder {
  const configuration = validateOptions(options)
  const adapter = createWorkspaceResourceAdapter(configuration)
  return {
    async ground(descriptors): Promise<GroundingPack> {
      return adapter.groundDescriptors(descriptors)
    }
  }
}

export function createWorkspaceResourceAdapter(
  options: ResourceGrounderOptions
): GroundingSourceAdapter & {
  groundDescriptors(descriptors: readonly TrustedTeachingResourceDescriptor[]): Promise<GroundingPack>
} {
  const configuration = validateOptions(options)
  return {
    kind: 'workspace_resource',
    async ground(): Promise<GroundingPack> {
      return groundWorkspaceDescriptors([], configuration)
    },
    async groundDescriptors(descriptors): Promise<GroundingPack> {
      return groundWorkspaceDescriptors(descriptors, configuration)
    }
  }
}

/**
 * Merge packs from multiple adapters with explicit dedupe, budget, and gap
 * handling. External content remains in-memory only.
 */
export async function groundWithAdapters(
  adapters: readonly GroundingSourceAdapter[],
  options: GroundingMergeOptions
): Promise<GroundingPack> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new Error('Resource grounding maxBytes must be a non-negative safe integer.')
  }

  if (adapters.length === 0) {
    return finalizePack({
      sources: [],
      exclusions: [exclusion(null, null, 'resource_absent')],
      maxBytes: options.maxBytes,
      availableBytes: 0,
      usedBytes: 0,
      sawBudgetExhausted: false,
      sawSourceOverLimit: false
    })
  }

  const packs: GroundingPack[] = []
  for (const adapter of adapters) {
    try {
      packs.push(await adapter.ground())
    } catch {
      packs.push(finalizePack({
        sources: [],
        exclusions: [exclusion(null, null, 'resource_gap')],
        maxBytes: options.maxBytes,
        availableBytes: 0,
        usedBytes: 0,
        sawBudgetExhausted: false,
        sawSourceOverLimit: false
      }))
    }
  }

  return mergeGroundingPacks(packs, options)
}

export function createMultiSourceResourceGrounder(
  adapters: readonly GroundingSourceAdapter[],
  options: GroundingMergeOptions
): { ground(): Promise<GroundingPack> } {
  return {
    async ground(): Promise<GroundingPack> {
      return groundWithAdapters(adapters, options)
    }
  }
}

export function mergeGroundingPacks(
  packs: readonly GroundingPack[],
  options: GroundingMergeOptions
): GroundingPack {
  const exclusions: GroundingExclusion[] = []
  const candidates: GroundedTeachingResource[] = []
  let availableBytes = 0
  let sawSourceOverLimit = false
  let sawBudgetExhausted = false

  for (const pack of packs) {
    exclusions.push(...pack.exclusions)
    candidates.push(...pack.sources)
    availableBytes += pack.budget.availableBytes
    if (pack.budget.truncationReason === 'source_over_limit') sawSourceOverLimit = true
    if (pack.budget.truncationReason === 'budget_exhausted') sawBudgetExhausted = true
  }

  candidates.sort(compareGroundedSources)

  const accepted: GroundedTeachingResource[] = []
  const seenSourceIds = new Set<string>()
  const seenChunkHashes = new Set<string>()
  let usedBytes = 0

  for (const source of candidates) {
    if (seenSourceIds.has(source.sourceId)) {
      exclusions.push(exclusion(source.sourceId, locationPath(source), 'duplicate_source_id'))
      continue
    }
    seenSourceIds.add(source.sourceId)

    if (seenChunkHashes.has(source.contentSha256)) {
      exclusions.push(exclusion(source.sourceId, locationPath(source), 'duplicate_chunk'))
      continue
    }
    seenChunkHashes.add(source.contentSha256)

    if (source.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) > options.maxBytes - usedBytes) {
      sawBudgetExhausted = true
      exclusions.push(exclusion(source.sourceId, locationPath(source), 'budget_exhausted'))
      continue
    }

    usedBytes += source.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    accepted.push(source)
  }

  if (accepted.length === 0 && exclusions.length === 0) {
    exclusions.push(exclusion(null, null, 'resource_absent'))
  }
  if (accepted.length === 0 && !exclusions.some((item) => item.code === 'resource_absent' || item.code === 'resource_gap')) {
    exclusions.push(exclusion(null, null, 'resource_gap'))
  }

  return finalizePack({
    sources: accepted,
    exclusions,
    maxBytes: options.maxBytes,
    availableBytes,
    usedBytes,
    sawBudgetExhausted,
    sawSourceOverLimit
  })
}

async function groundWorkspaceDescriptors(
  descriptors: readonly TrustedTeachingResourceDescriptor[],
  configuration: Required<ResourceGrounderOptions>
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

  const candidates = descriptors
    .map((descriptor) => validateDescriptor(descriptor, configuration.trustedAuthorityId))
    .sort(compareCandidates)

  for (const candidate of candidates) {
    if ('exclusion' in candidate) {
      exclusions.push(candidate.exclusion)
      continue
    }

    const descriptor = candidate.descriptor
    if (seenSourceIds.has(descriptor.sourceId)) {
      exclusions.push(exclusion(descriptor.sourceId, descriptor.relativePath, 'duplicate_source_id'))
      continue
    }
    seenSourceIds.add(descriptor.sourceId)

    let safeRelativePath: string
    try {
      safeRelativePath = requireSafeTeachingRelativePath(descriptor.relativePath, 'Trusted resource location')
    } catch {
      exclusions.push(exclusion(descriptor.sourceId, descriptor.relativePath, 'unsafe_location'))
      continue
    }

    const targetPath = resolve(configuration.workspaceRoot, safeRelativePath)
    let file: Awaited<ReturnType<typeof readContainedRegularFileBounded>>
    try {
      file = await readContainedRegularFileBounded(
        configuration.workspaceRoot,
        targetPath,
        configuration.maxSourceBytes
      )
    } catch (error) {
      exclusions.push(exclusion(
        descriptor.sourceId,
        safeRelativePath,
        isContainmentFailure(error) ? 'unsafe_location' : 'source_unavailable'
      ))
      continue
    }

    if (file.status === 'over_limit') {
      sawSourceOverLimit = true
      exclusions.push(exclusion(descriptor.sourceId, safeRelativePath, 'source_over_limit'))
      continue
    }

    const contentSha256 = sha256(file.content)
    if (contentSha256 !== descriptor.contentSha256) {
      exclusions.push(exclusion(descriptor.sourceId, safeRelativePath, 'stale_source'))
      continue
    }

    if (seenChunkHashes.has(contentSha256)) {
      exclusions.push(exclusion(descriptor.sourceId, safeRelativePath, 'duplicate_chunk'))
      continue
    }
    seenChunkHashes.add(contentSha256)
    availableBytes += file.content.byteLength

    if (file.content.byteLength > configuration.maxBytes - usedBytes) {
      sawBudgetExhausted = true
      exclusions.push(exclusion(descriptor.sourceId, safeRelativePath, 'budget_exhausted'))
      continue
    }

    usedBytes += file.content.byteLength
    accepted.push(buildGroundedResource({
      sourceId: descriptor.sourceId,
      location: { kind: 'workspace_relative_path', relativePath: safeRelativePath },
      provenance: {
        kind: descriptor.provenance.kind,
        resourceId: descriptor.provenance.resourceId,
        revisionId: descriptor.provenance.revisionId
      },
      contentSha256,
      trust: 'trusted_workspace',
      useFor: WORKSPACE_USE_FOR,
      freshness: { kind: 'revision_matched', revisionId: descriptor.provenance.revisionId },
      priority: descriptor.priority,
      text: file.content.toString('utf8'),
      byteLength: file.content.byteLength
    }))
  }

  return finalizePack({
    sources: accepted,
    exclusions,
    maxBytes: configuration.maxBytes,
    availableBytes,
    usedBytes,
    sawBudgetExhausted,
    sawSourceOverLimit
  })
}

export function buildGroundedResource(input: {
  sourceId: string
  location: GroundedTeachingResource['location']
  provenance: GroundedTeachingResource['provenance']
  contentSha256: string
  trust: GroundingTrust
  useFor: readonly GroundingUseFor[]
  freshness: GroundingFreshness
  priority: TrustedTeachingResourceDescriptor['priority']
  text: string
  byteLength: number
}): GroundedTeachingResource {
  return {
    sourceId: input.sourceId,
    location: input.location,
    provenance: input.provenance,
    contentSha256: input.contentSha256,
    digest: input.contentSha256,
    trust: input.trust,
    useFor: input.useFor,
    freshness: input.freshness,
    priority: input.priority,
    chunks: [{
      chunkId: `sha256:${input.contentSha256}`,
      contentSha256: input.contentSha256,
      text: input.text,
      byteLength: input.byteLength
    }]
  }
}

function finalizePack(input: {
  sources: readonly GroundedTeachingResource[]
  exclusions: readonly GroundingExclusion[]
  maxBytes: number
  availableBytes: number
  usedBytes: number
  sawBudgetExhausted: boolean
  sawSourceOverLimit: boolean
}): GroundingPack {
  const packWithoutIdentity = {
    schemaVersion: GROUNDING_PACK_SCHEMA_VERSION,
    status: groundingStatus(input.sources.length, input.exclusions.length),
    sources: input.sources,
    exclusions: input.exclusions,
    budget: {
      maxBytes: input.maxBytes,
      availableBytes: input.availableBytes,
      usedBytes: input.usedBytes,
      remainingBytes: input.maxBytes - input.usedBytes,
      truncated: input.sawBudgetExhausted || input.sawSourceOverLimit,
      truncationReason: input.sawBudgetExhausted
        ? 'budget_exhausted' as const
        : input.sawSourceOverLimit
          ? 'source_over_limit' as const
          : null
    }
  }

  return {
    ...packWithoutIdentity,
    identity: sha256(stableJson(packWithoutIdentity))
  }
}

function validateOptions(options: ResourceGrounderOptions): Required<ResourceGrounderOptions> {
  if (!options.workspaceRoot.trim()) throw new Error('Resource grounder requires a workspace root.')
  if (!options.trustedAuthorityId.trim()) throw new Error('Resource grounder requires a trusted authority ID.')
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new Error('Resource grounding maxBytes must be a non-negative safe integer.')
  }
  const maxSourceBytes = options.maxSourceBytes ?? options.maxBytes
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 0) {
    throw new Error('Resource grounding maxSourceBytes must be a non-negative safe integer.')
  }
  return {
    workspaceRoot: options.workspaceRoot,
    trustedAuthorityId: options.trustedAuthorityId,
    maxBytes: options.maxBytes,
    maxSourceBytes
  }
}

function validateDescriptor(
  candidate: TrustedTeachingResourceDescriptor,
  trustedAuthorityId: string
): { descriptor: ValidatedDescriptor } | { exclusion: GroundingExclusion } {
  const record = isRecord(candidate) ? candidate : null
  const sourceId = typeof record?.sourceId === 'string' ? record.sourceId : null
  const relativePath = typeof record?.relativePath === 'string' ? record.relativePath : null

  if (record?.schemaVersion !== TRUSTED_TEACHING_RESOURCE_SCHEMA_VERSION) {
    return { exclusion: exclusion(sourceId, relativePath, 'unknown_schema') }
  }

  if (
    !sourceId ||
    !SOURCE_ID_PATTERN.test(sourceId) ||
    typeof record.contentSha256 !== 'string' ||
    !SHA256_PATTERN.test(record.contentSha256) ||
    !isPriority(record.priority) ||
    !isTrustedAuthority(record.authority, trustedAuthorityId) ||
    !isWorkspaceProvenance(record.provenance) ||
    !relativePath
  ) {
    return { exclusion: exclusion(sourceId, relativePath, 'unauthorized_resource') }
  }

  return { descriptor: candidate as ValidatedDescriptor }
}

function compareCandidates(
  left: ReturnType<typeof validateDescriptor>,
  right: ReturnType<typeof validateDescriptor>
): number {
  if ('descriptor' in left && 'descriptor' in right) {
    return PRIORITY_ORDER[left.descriptor.priority] - PRIORITY_ORDER[right.descriptor.priority] ||
      compareText(left.descriptor.sourceId, right.descriptor.sourceId) ||
      compareText(left.descriptor.relativePath, right.descriptor.relativePath)
  }
  if ('descriptor' in left) return -1
  if ('descriptor' in right) return 1
  return compareText(exclusionKey(left.exclusion), exclusionKey(right.exclusion))
}

function compareGroundedSources(left: GroundedTeachingResource, right: GroundedTeachingResource): number {
  return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
    compareText(left.sourceId, right.sourceId) ||
    compareText(locationPath(left) ?? '', locationPath(right) ?? '')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPriority(value: unknown): value is TrustedTeachingResourceDescriptor['priority'] {
  return value === 'required' || value === 'recommended' || value === 'supplemental'
}

function isTrustedAuthority(value: unknown, authorityId: string): boolean {
  return isRecord(value) &&
    value.kind === 'trusted_teaching_resource' &&
    value.authorityId === authorityId
}

function isWorkspaceProvenance(value: unknown): value is TrustedTeachingResourceDescriptor['provenance'] {
  return isRecord(value) &&
    value.kind === 'workspace_resource' &&
    typeof value.resourceId === 'string' && value.resourceId.length > 0 &&
    typeof value.revisionId === 'string' && value.revisionId.length > 0
}

function groundingStatus(sourceCount: number, exclusionCount: number): GroundingPack['status'] {
  if (sourceCount === 0) return 'unavailable'
  return exclusionCount === 0 ? 'ready' : 'degraded'
}

function exclusion(sourceId: string | null, relativePath: string | null, code: GroundingExclusionCode): GroundingExclusion {
  return { sourceId, relativePath, code }
}

function exclusionKey(value: GroundingExclusion): string {
  return `${value.sourceId ?? ''}\u0000${value.relativePath ?? ''}\u0000${value.code}`
}

function locationPath(source: GroundedTeachingResource): string | null {
  if (source.location.kind === 'workspace_relative_path') return source.location.relativePath
  return source.location.url
}

function isContainmentFailure(error: unknown): boolean {
  return error instanceof Error && /escape|containment|configured root|unsafe/i.test(error.message)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}
