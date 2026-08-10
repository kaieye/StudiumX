import type {
  ReadLessonPayload,
  ReadWorkspaceMarkdownPayload
} from '../../teaching-types/workspace'
import { buildMindMapSourceRefDisplay } from './source-anchors'
import type { MindMapSourceRef } from './types'

type MindMapSourceJumpTargetBase = {
  /** Portable, workspace-relative locator when the source ref has a path. */
  locator: string | null
  /** Optional block metadata retained for a later reader/renderer integration. */
  blockId?: string
  /** Structural addressability only; this does not assert that a file exists. */
  canResolve: boolean
}

export type MindMapLessonSourceJumpTarget = MindMapSourceJumpTargetBase & {
  kind: 'lesson'
  readerPayload: ReadLessonPayload | null
}

export type MindMapMarkdownSourceJumpTarget = MindMapSourceJumpTargetBase & {
  kind: 'notes' | 'glossary' | 'workspace'
  readerPayload: ReadWorkspaceMarkdownPayload | null
}

/**
 * Pure target information for the workspace readers used by a source jump.
 *
 * This function only classifies and normalizes persisted source-reference
 * metadata. It does not touch the filesystem, check whether the document
 * exists, or dispatch a reader call. A target can therefore be structurally
 * resolvable while still failing when a reader later attempts I/O.
 */
export type MindMapSourceJumpTarget =
  | MindMapLessonSourceJumpTarget
  | MindMapMarkdownSourceJumpTarget

/**
 * Build an IO-free reader target from a mind-map source reference.
 *
 * `workspaceId` is intentionally supplied by the caller rather than stored in
 * the source ref: the same mind map can be copied between registered
 * workspaces, while the persisted ref remains a workspace-relative locator.
 */
export function buildMindMapSourceJumpTarget(
  ref: MindMapSourceRef,
  workspaceId?: string | null
): MindMapSourceJumpTarget {
  const display = buildMindMapSourceRefDisplay(ref)
  const locator = display.workspacePath ?? null
  const canResolve = Boolean(
    workspaceId?.trim() && locator && isSafeWorkspaceLocator(locator)
  )
  const blockMetadata = display.blockId === undefined ? {} : { blockId: display.blockId }

  if (display.kind === 'lesson') {
    return {
      kind: display.kind,
      locator,
      readerPayload:
        canResolve && workspaceId
          ? { workspaceId, lessonPath: locator as string }
          : null,
      canResolve,
      ...blockMetadata
    }
  }

  return {
    kind: display.kind,
    locator,
    readerPayload:
      canResolve && workspaceId
        ? { workspaceId, documentPath: locator as string }
        : null,
    canResolve,
    ...blockMetadata
  }
}

/** Alias phrased as a resolver for callers that prefer the operation name. */
export const resolveMindMapSourceJumpTarget = buildMindMapSourceJumpTarget

/**
 * Keep the pure boundary fail-closed for values the workspace readers reject.
 * The normalized locator is still returned for diagnostics/display; only the
 * reader payload and `canResolve` are withheld for unsafe paths.
 */
function isSafeWorkspaceLocator(locator: string): boolean {
  if (!locator || locator.includes('\0')) return false
  if (locator.startsWith('/') || /^[a-zA-Z]:/.test(locator)) return false

  return locator.split('/').every((segment) => isSafeWorkspacePathSegment(segment))
}

function isSafeWorkspacePathSegment(segment: string): boolean {
  if (!segment || segment === '.') return true
  if (segment === '..') return false

  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }

  return (
    decoded !== '.' &&
    decoded !== '..' &&
    !decoded.includes('/') &&
    !decoded.includes('\\') &&
    !decoded.includes('\0')
  )
}
