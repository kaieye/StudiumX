/**
 * Teaching-memory kind taxonomy helpers (DB-P1-2).
 *
 * File-truth records may store optional `memoryKind` and/or stable tags.
 * Resolution is deterministic and never invents vectors/FTS or destructive
 * consolidate/purge policies.
 */
import type {
  TeachingMemoryKind,
  TeachingMemoryRecord,
  TeachingMemoryStatus
} from './teaching-types'
import { TEACHING_MEMORY_KINDS, TEACHING_MEMORY_KIND_TAGS } from './teaching-types'

const KIND_SET = new Set<string>(TEACHING_MEMORY_KINDS)

/** Kind resolution priority when multiple stable tags are present. */
const KIND_TAG_PRIORITY: readonly TeachingMemoryKind[] = [
  'learner-profile',
  'teaching-synthetic',
  'teaching-experience',
  'episodic-session'
]

export function isTeachingMemoryKind(value: unknown): value is TeachingMemoryKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

/**
 * Normalize an explicit kind input. Unknown values are treated as absent so
 * durable records cannot carry free-form diagnostic kind strings.
 */
export function normalizeTeachingMemoryKind(value: unknown): TeachingMemoryKind | undefined {
  if (!isTeachingMemoryKind(value)) return undefined
  return value
}

/**
 * Resolve the effective kind for a record or partial record.
 * 1. Explicit valid `memoryKind`
 * 2. First matching stable kind tag by KIND_TAG_PRIORITY
 * 3. undefined (unspecified)
 */
export function resolveTeachingMemoryKind(
  input: Pick<TeachingMemoryRecord, 'tags'> & { memoryKind?: unknown }
): TeachingMemoryKind | undefined {
  const explicit = normalizeTeachingMemoryKind(input.memoryKind)
  if (explicit) return explicit
  const tags = Array.isArray(input.tags) ? input.tags : []
  const tagSet = new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))
  for (const kind of KIND_TAG_PRIORITY) {
    if (tagSet.has(TEACHING_MEMORY_KIND_TAGS[kind])) return kind
  }
  return undefined
}

/** Soft lifecycle status for analytics projection (no content). */
export function resolveTeachingMemoryStatus(
  input: Pick<TeachingMemoryRecord, 'deletedAt' | 'disabledAt'>
): TeachingMemoryStatus {
  if (input.deletedAt) return 'deleted'
  if (input.disabledAt) return 'disabled'
  return 'active'
}

/** Whether a record matches an optional kind filter (explicit or resolved). */
export function teachingMemoryMatchesKind(
  record: Pick<TeachingMemoryRecord, 'tags' | 'memoryKind'>,
  kind: TeachingMemoryKind | TeachingMemoryKind[] | undefined
): boolean {
  if (kind === undefined) return true
  const resolved = resolveTeachingMemoryKind(record)
  if (Array.isArray(kind)) {
    if (kind.length === 0) return true
    return resolved !== undefined && kind.includes(resolved)
  }
  return resolved === kind
}

export { TEACHING_MEMORY_KINDS, TEACHING_MEMORY_KIND_TAGS, KIND_TAG_PRIORITY }
