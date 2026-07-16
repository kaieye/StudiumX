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
  type GroundingPack,
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

/**
 * The grounder is read-only: it only performs contained, bounded reads through
 * path-access and exposes no filesystem, provider, or clock capability.
 */
export function createResourceGrounder(options: ResourceGrounderOptions): ResourceGrounder {
  const configuration = validateOptions(options)
  return {
    async ground(descriptors): Promise<GroundingPack> {
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
        accepted.push({
          sourceId: descriptor.sourceId,
          location: { kind: 'workspace_relative_path', relativePath: safeRelativePath },
          provenance: {
            kind: descriptor.provenance.kind,
            resourceId: descriptor.provenance.resourceId,
            revisionId: descriptor.provenance.revisionId
          },
          contentSha256,
          priority: descriptor.priority,
          chunks: [{
            chunkId: `sha256:${contentSha256}`,
            contentSha256,
            text: file.content.toString('utf8'),
            byteLength: file.content.byteLength
          }]
        })
      }

      const packWithoutIdentity = {
        schemaVersion: GROUNDING_PACK_SCHEMA_VERSION,
        status: groundingStatus(accepted.length, exclusions.length),
        sources: accepted,
        exclusions,
        budget: {
          maxBytes: configuration.maxBytes,
          availableBytes,
          usedBytes,
          remainingBytes: configuration.maxBytes - usedBytes,
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

function isWorkspaceProvenance(value: unknown): boolean {
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

function isContainmentFailure(error: unknown): boolean {
  return error instanceof Error && /escape|containment|configured root|unsafe/i.test(error.message)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}
