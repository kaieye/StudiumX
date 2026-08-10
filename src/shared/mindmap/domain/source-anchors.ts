import { mindMapSourceRefSchema } from './schema'
import type { MindMapSourceRef } from './types'

export type MindMapSourceRefsParseResult =
  | { ok: true; refs: MindMapSourceRef[] }
  | { ok: false; code: 'json_parse' | 'schema_invalid'; message: string }

/** High-level destination bucket used by source-reference consumers. */
export type MindMapSourceRefDisplayKind = 'lesson' | 'notes' | 'glossary' | 'workspace'

/** Whether a source reference can currently be trusted as pointing at its source. */
export type MindMapSourceRefDisplayStatus = 'fresh' | 'stale' | 'unknown'

/** Source-reference fields that a manual refresh may relocate or re-anchor. */
export type MindMapSourceRefRefreshField =
  | 'workspacePath'
  | 'breadcrumb'
  | 'blockId'
  | 'contentHash'

export type MindMapSourceRefRefreshValue = string | string[] | undefined

export type MindMapSourceRefRefreshChange = {
  field: MindMapSourceRefRefreshField
  before?: MindMapSourceRefRefreshValue
  after?: MindMapSourceRefRefreshValue
}

/**
 * A review-only result for comparing a persisted anchor with a newly resolved
 * source anchor. This is intentionally not a document mutation or command:
 * callers must show the diff and obtain confirmation before writing it back to
 * the topic. `lastConfirmedAt` is excluded because it records the confirmation
 * action, not source content.
 */
export type MindMapSourceRefRefreshDiff = {
  sourceRefId: string
  status: MindMapSourceRefDisplayStatus
  requiresReview: boolean
  changes: MindMapSourceRefRefreshChange[]
  before: MindMapSourceRef
  after: MindMapSourceRef
}

export type MindMapSourceRefRefreshDiffResult =
  | { ok: true; diff: MindMapSourceRefRefreshDiff }
  | { ok: false; code: 'source_id_mismatch'; message: string }

/**
 * Pure, renderer-friendly metadata for displaying a source reference.
 *
 * This is deliberately a locator/display model rather than a navigation
 * command. A consumer can use `workspacePath` and `blockId` to resolve the
 * reference through its normal workspace access boundary without introducing
 * a second route or teaching-evidence authority here.
 */
export type MindMapSourceRefDisplay = {
  id: string
  kind: MindMapSourceRefDisplayKind
  status: MindMapSourceRefDisplayStatus
  stale: boolean
  title: string
  breadcrumb: string[]
  workspacePath?: string
  blockId?: string
  canOpen: boolean
}

/**
 * Decide whether a source anchor should be presented as stale.
 *
 * A persisted stale flag is sticky until the user explicitly refreshes or
 * relocates the anchor. When both sides have a content hash, a hash change is
 * sufficient evidence that the source changed. Missing hashes are unknown,
 * not stale: callers must not turn an unverifiable source into a warning
 * without an explicit stale flag.
 */
export function isMindMapSourceRefStale(
  ref: MindMapSourceRef,
  currentContentHash?: string
): boolean {
  if (ref.stale === true) return true
  if (ref.contentHash === undefined || currentContentHash === undefined) return false
  return ref.contentHash !== currentContentHash
}

/**
 * Build the manual-refresh diff for one source anchor.
 *
 * The refreshed ref normally comes from a workspace reader after the user
 * explicitly asks to check updates. A hash mismatch, a persisted stale flag,
 * or a locator change makes the result stale; absent hashes remain unknown.
 * The function only returns review data and never mutates either input.
 */
export function buildMindMapSourceRefRefreshDiff(
  previous: MindMapSourceRef,
  refreshed: MindMapSourceRef
): MindMapSourceRefRefreshDiffResult {
  if (previous.id !== refreshed.id) {
    return {
      ok: false,
      code: 'source_id_mismatch',
      message: `Cannot refresh source "${previous.id}" with source "${refreshed.id}"`
    }
  }

  const changes = sourceRefRefreshChanges(previous, refreshed)
  const locatorChanged = changes.some(({ field }) => field !== 'contentHash')
  const status = sourceRefRefreshStatus(previous, refreshed, locatorChanged)

  return {
    ok: true,
    diff: {
      sourceRefId: previous.id,
      status,
      requiresReview: status !== 'fresh' || changes.length > 0,
      changes,
      before: cloneSourceRef(previous),
      after: cloneSourceRef(refreshed)
    }
  }
}

/**
 * Materialize an explicitly confirmed refreshed anchor.
 *
 * This helper is intentionally separate from diff construction so a caller
 * cannot accidentally treat detection as approval. The caller still owns the
 * command/transaction that writes the returned ref to one or more topics.
 */
export function confirmMindMapSourceRefRefresh(
  previous: MindMapSourceRef,
  refreshed: MindMapSourceRef,
  confirmedAt: string
): MindMapSourceRef {
  if (previous.id !== refreshed.id) {
    throw new TypeError(`Cannot refresh source "${previous.id}" with source "${refreshed.id}"`)
  }

  return {
    id: previous.id,
    ...(refreshed.workspacePath !== undefined ? { workspacePath: refreshed.workspacePath } : {}),
    ...(refreshed.breadcrumb !== undefined ? { breadcrumb: [...refreshed.breadcrumb] } : {}),
    ...(refreshed.blockId !== undefined ? { blockId: refreshed.blockId } : {}),
    ...(refreshed.contentHash !== undefined ? { contentHash: refreshed.contentHash } : {}),
    lastConfirmedAt: confirmedAt,
    stale: false
  }
}

/**
 * Build stable display/locator data for a source reference.
 *
 * Paths are normalized to portable workspace-relative separators for display
 * and later resolution. Missing hashes are explicitly `unknown`; they must
 * not be presented as either fresh or stale without evidence.
 */
export function buildMindMapSourceRefDisplay(
  ref: MindMapSourceRef,
  currentContentHash?: string
): MindMapSourceRefDisplay {
  const workspacePath = normalizeMindMapSourceRefPath(ref.workspacePath)
  const breadcrumb = ref.breadcrumb ? [...ref.breadcrumb] : []
  const title = sourceRefTitle(ref.id, breadcrumb, workspacePath)
  const status = sourceRefStatus(ref, currentContentHash)

  return {
    id: ref.id,
    kind: sourceRefKind(workspacePath),
    status,
    stale: status === 'stale',
    title,
    breadcrumb,
    ...(workspacePath ? { workspacePath } : {}),
    ...(ref.blockId !== undefined ? { blockId: ref.blockId } : {}),
    canOpen: Boolean(workspacePath)
  }
}

/**
 * Serialize source anchors as a small, schema-checked JSON payload.
 *
 * Source refs are user-editable metadata rather than teaching facts. Keeping
 * this boundary explicit makes clipboard/IPC adapters able to round-trip the
 * anchors without accepting or silently stripping foreign fields.
 */
export function serializeMindMapSourceRefs(refs: readonly MindMapSourceRef[]): string {
  const parsed = mindMapSourceRefSchema.strict().array().safeParse(refs)
  if (!parsed.success) {
    throw new TypeError(`Invalid mind map source refs: ${parsed.error.message}`)
  }
  return `${JSON.stringify(parsed.data, null, 2)}\n`
}

/** Parse the schema-checked JSON form emitted by `serializeMindMapSourceRefs`. */
export function parseMindMapSourceRefsJson(content: string): MindMapSourceRefsParseResult {
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch {
    return { ok: false, code: 'json_parse', message: 'source refs are not valid JSON' }
  }

  const parsed = mindMapSourceRefSchema.strict().array().safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'schema_invalid',
      message: 'source refs failed schema validation'
    }
  }
  return { ok: true, refs: parsed.data }
}

function sourceRefStatus(
  ref: MindMapSourceRef,
  currentContentHash: string | undefined
): MindMapSourceRefDisplayStatus {
  if (ref.stale === true) return 'stale'
  if (ref.contentHash === undefined || currentContentHash === undefined) return 'unknown'
  return ref.contentHash === currentContentHash ? 'fresh' : 'stale'
}

function sourceRefRefreshStatus(
  previous: MindMapSourceRef,
  refreshed: MindMapSourceRef,
  locatorChanged: boolean
): MindMapSourceRefDisplayStatus {
  if (previous.stale === true || refreshed.stale === true || locatorChanged) return 'stale'
  if (previous.contentHash === undefined || refreshed.contentHash === undefined) return 'unknown'
  return previous.contentHash === refreshed.contentHash ? 'fresh' : 'stale'
}

function sourceRefRefreshChanges(
  previous: MindMapSourceRef,
  refreshed: MindMapSourceRef
): MindMapSourceRefRefreshChange[] {
  const changes: MindMapSourceRefRefreshChange[] = []
  const fields: MindMapSourceRefRefreshField[] = [
    'workspacePath',
    'breadcrumb',
    'blockId',
    'contentHash'
  ]

  for (const field of fields) {
    const before = sourceRefRefreshValue(previous, field)
    const after = sourceRefRefreshValue(refreshed, field)
    if (sourceRefRefreshValuesEqual(before, after)) continue

    changes.push({
      field,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after })
    })
  }
  return changes
}

function sourceRefRefreshValue(
  ref: MindMapSourceRef,
  field: MindMapSourceRefRefreshField
): MindMapSourceRefRefreshValue {
  if (field === 'workspacePath') return normalizeMindMapSourceRefPath(ref.workspacePath)
  if (field === 'breadcrumb') return ref.breadcrumb === undefined ? undefined : [...ref.breadcrumb]
  return ref[field]
}

function sourceRefRefreshValuesEqual(
  before: MindMapSourceRefRefreshValue,
  after: MindMapSourceRefRefreshValue
): boolean {
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return false
    return before.length === after.length && before.every((value, index) => value === after[index])
  }
  return before === after
}

function cloneSourceRef(ref: MindMapSourceRef): MindMapSourceRef {
  return {
    ...ref,
    ...(ref.breadcrumb === undefined ? {} : { breadcrumb: [...ref.breadcrumb] })
  }
}

function sourceRefKind(workspacePath: string | undefined): MindMapSourceRefDisplayKind {
  if (!workspacePath) return 'workspace'
  const lowerPath = workspacePath.toLocaleLowerCase('en-US')
  if (
    lowerPath === 'lessons' ||
    lowerPath.startsWith('lessons/') ||
    lowerPath === 'courses' ||
    lowerPath.startsWith('courses/')
  ) {
    return 'lesson'
  }
  if (
    lowerPath === 'notes' ||
    lowerPath.startsWith('notes/') ||
    lowerPath === 'notes.md'
  ) {
    return 'notes'
  }
  if (
    lowerPath === 'glossary' ||
    lowerPath.startsWith('glossary/') ||
    lowerPath === 'glossary.md' ||
    lowerPath === 'glossary.markdown'
  ) {
    return 'glossary'
  }
  return 'workspace'
}

function sourceRefTitle(
  id: string,
  breadcrumb: readonly string[],
  workspacePath: string | undefined
): string {
  const breadcrumbTitle = [...breadcrumb]
    .reverse()
    .map((part) => part.trim())
    .find(Boolean)
  if (breadcrumbTitle) return breadcrumbTitle

  if (workspacePath) {
    const basename = workspacePath.split('/').filter(Boolean).at(-1)
    if (basename) {
      const withoutMarkdownExtension = basename.replace(/\.(?:md|markdown)$/i, '')
      return withoutMarkdownExtension || basename
    }
  }

  return id
}

function normalizeMindMapSourceRefPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
  return normalized || undefined
}
