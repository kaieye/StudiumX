/**
 * Read-only source-anchor refresh preview for canonical mind-map documents.
 *
 * The document remains the teaching/product source of truth. This module only
 * reads source files referenced by that document, hashes bounded content, and
 * returns review metadata. It never rewrites a source ref or a mind-map file;
 * callers must use the normal document update/CAS lane after user review.
 */
import { createHash } from 'node:crypto'
import { isAbsolute, join, win32 } from 'node:path'

import { readContainedRegularFileBounded } from '../path-access'
import type { MindMapDocumentV2, MindMapSourceRef, MindMapTopicV2 } from '../../shared/mindmap/domain/types'
import type {
  MindMapSourceRefreshEntry,
  MindMapSourceRefreshPreviewResult
} from '../../shared/teaching-types/mindmap'

/** Keep refresh checks bounded even for a user-authored source path. */
export const MIND_MAP_SOURCE_REFRESH_MAX_BYTES = 8 * 1024 * 1024

type NormalizedSourcePath =
  | { kind: 'ok'; path: string }
  | { kind: 'missing' }
  | { kind: 'unsafe' }

type SourceOccurrence = {
  sourceRef: MindMapSourceRef
  topicIds: Set<string>
  sheetIds: Set<string>
  metadataKey: string
  conflictingMetadata: boolean
}

type SourceReadFailure = 'missing_file' | 'unreadable' | 'unsafe_path'

/**
 * Hash every unique source ref in one document and return a review-only
 * preview. No source content, absolute path, or write capability is returned.
 */
export async function previewMindMapSourceRefresh(
  document: MindMapDocumentV2,
  workspaceRoot: string,
  maxBytes = MIND_MAP_SOURCE_REFRESH_MAX_BYTES
): Promise<Omit<MindMapSourceRefreshPreviewResult, 'documentId' | 'revision'>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Mind-map source refresh limit must be a non-negative safe integer.')
  }

  const occurrences = collectSourceOccurrences(document)
  const entries: MindMapSourceRefreshEntry[] = []
  for (const occurrence of occurrences) {
    entries.push(await inspectSourceOccurrence(occurrence, workspaceRoot, maxBytes))
  }

  return {
    entries,
    changedCount: entries.filter((entry) => entry.changed).length,
    attentionCount: entries.filter((entry) => entry.status !== 'fresh').length
  }
}

function collectSourceOccurrences(document: MindMapDocumentV2): SourceOccurrence[] {
  const byId = new Map<string, SourceOccurrence>()

  for (const sheet of document.sheets) {
    visitTopic(sheet.root, sheet.id, byId)
  }

  return [...byId.values()].sort((left, right) => left.sourceRef.id.localeCompare(right.sourceRef.id))
}

function visitTopic(
  topic: MindMapTopicV2,
  sheetId: string,
  byId: Map<string, SourceOccurrence>
): void {
  for (const sourceRef of topic.sourceRefs ?? []) {
    const metadataKey = sourceRefMetadataKey(sourceRef)
    const existing = byId.get(sourceRef.id)
    if (existing) {
      existing.topicIds.add(topic.id)
      existing.sheetIds.add(sheetId)
      if (existing.metadataKey !== metadataKey) existing.conflictingMetadata = true
    } else {
      byId.set(sourceRef.id, {
        sourceRef: cloneSourceRef(sourceRef),
        topicIds: new Set([topic.id]),
        sheetIds: new Set([sheetId]),
        metadataKey,
        conflictingMetadata: false
      })
    }
  }

  for (const child of topic.children) visitTopic(child, sheetId, byId)
}

async function inspectSourceOccurrence(
  occurrence: SourceOccurrence,
  workspaceRoot: string,
  maxBytes: number
): Promise<MindMapSourceRefreshEntry> {
  const path = normalizeSourcePath(occurrence.sourceRef.workspacePath)
  const base = {
    sourceRef: publicSourceRef(occurrence.sourceRef, path),
    topicIds: [...occurrence.topicIds].sort(),
    sheetIds: [...occurrence.sheetIds].sort(),
    ...(hasContentHash(occurrence.sourceRef.contentHash)
      ? { previousContentHash: occurrence.sourceRef.contentHash }
      : {})
  }

  if (occurrence.conflictingMetadata) {
    return {
      ...base,
      status: 'unknown',
      changed: false,
      change: 'conflicting_metadata'
    }
  }

  if (path.kind === 'missing') {
    return {
      ...base,
      status: 'unknown',
      changed: false,
      change: 'missing_path'
    }
  }

  if (path.kind === 'unsafe') {
    return {
      ...base,
      status: 'unreadable',
      changed: false,
      change: 'unsafe_path'
    }
  }

  let readResult: Awaited<ReturnType<typeof readContainedRegularFileBounded>>
  try {
    readResult = await readContainedRegularFileBounded(
      workspaceRoot,
      join(workspaceRoot, path.path),
      maxBytes
    )
  } catch (error) {
    const failure = classifyReadFailure(error)
    return {
      ...base,
      status: failure === 'missing_file' ? 'missing' : 'unreadable',
      changed: false,
      change: failure
    }
  }

  if (readResult.status === 'over_limit') {
    return {
      ...base,
      status: 'unreadable',
      changed: false,
      change: 'over_limit'
    }
  }

  const currentContentHash = createHash('sha256').update(readResult.content).digest('hex')
  if (!hasContentHash(occurrence.sourceRef.contentHash)) {
    return {
      ...base,
      currentContentHash,
      status: 'unknown',
      changed: false,
      change: 'missing_hash'
    }
  }

  if (occurrence.sourceRef.stale === true) {
    return {
      ...base,
      currentContentHash,
      status: 'stale',
      changed: true,
      change: 'stale_flag'
    }
  }

  if (occurrence.sourceRef.contentHash !== currentContentHash) {
    return {
      ...base,
      currentContentHash,
      status: 'stale',
      changed: true,
      change: 'content_changed'
    }
  }

  return {
    ...base,
    currentContentHash,
    status: 'fresh',
    changed: false,
    change: 'unchanged'
  }
}

function normalizeSourcePath(rawPath: string | undefined): NormalizedSourcePath {
  if (rawPath === undefined || rawPath.trim() === '') return { kind: 'missing' }

  const normalized = rawPath.trim().replace(/\\/g, '/')
  if (
    normalized.includes('\u0000') ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    isAbsolute(normalized) ||
    win32.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return { kind: 'unsafe' }
  }

  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) return { kind: 'unsafe' }
  if (parts.length === 0) return { kind: 'missing' }
  return { kind: 'ok', path: parts.join('/') }
}

function classifyReadFailure(error: unknown): SourceReadFailure {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  if (record.code === 'ENOENT' || record.code === 'ENOTDIR') return 'missing_file'
  if (
    record.code === 'ELOOP' ||
    record.message === 'Path escapes the configured root.' ||
    (typeof record.message === 'string' && /symbolic link|junction|escapes the configured root|final path must be a regular file|contained path must/i.test(record.message))
  ) {
    return 'unsafe_path'
  }
  return 'unreadable'
}

function sourceRefMetadataKey(sourceRef: MindMapSourceRef): string {
  const path = normalizeSourcePath(sourceRef.workspacePath)
  return JSON.stringify({
    workspacePath: path.kind === 'ok' ? path.path : sourceRef.workspacePath,
    breadcrumb: sourceRef.breadcrumb,
    blockId: sourceRef.blockId,
    contentHash: sourceRef.contentHash,
    lastConfirmedAt: sourceRef.lastConfirmedAt,
    stale: sourceRef.stale
  })
}

function cloneSourceRef(sourceRef: MindMapSourceRef): MindMapSourceRef {
  return {
    ...sourceRef,
    ...(sourceRef.breadcrumb === undefined ? {} : { breadcrumb: [...sourceRef.breadcrumb] })
  }
}

/** Do not add an untrusted absolute path to the new preview response. */
function publicSourceRef(
  sourceRef: MindMapSourceRef,
  path: NormalizedSourcePath
): MindMapSourceRef {
  const cloned = cloneSourceRef(sourceRef)
  if (path.kind === 'ok') return { ...cloned, workspacePath: path.path }
  const { workspacePath: _workspacePath, ...withoutPath } = cloned
  return withoutPath
}

function hasContentHash(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}
