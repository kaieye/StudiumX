/**
 * Main-process boundary for one user-selected workspace file.
 *
 * The renderer may identify a file only by a workspace-relative path. This
 * module normalizes and validates that path, resolves the registered root in
 * the gateway, and reads a bounded regular file through the hardened path
 * access helper. The returned source ref is metadata only; file content stays
 * in the main process and is used only to build the provider prompt.
 */
import { createHash } from 'node:crypto'
import { isAbsolute, join, win32 } from 'node:path'

import { readContainedRegularFileBounded } from '../path-access'
import type { MindMapSourceRef } from '../../shared/mindmap/domain/types'

/** Keep a selected-file provider context bounded before it reaches a prompt. */
export const MIND_MAP_SELECTED_FILE_MAX_BYTES = 512 * 1024
/** Avoid accepting an unreasonably large path envelope from IPC. */
export const MIND_MAP_SELECTED_FILE_MAX_PATH_LENGTH = 4096
/** Canonical workspace document used by the Notes proposal scope. */
export const MIND_MAP_NOTES_WORKSPACE_PATH = 'NOTES.md'
/** Keep a Lesson provider context bounded by the same 512 KiB file-read ceiling. */
export const MIND_MAP_LESSON_MAX_BYTES = MIND_MAP_SELECTED_FILE_MAX_BYTES

export type MindMapSelectedFileContext = {
  /** Ephemeral metadata safe to return as part of the canonical request. */
  sourceRef: MindMapSourceRef
  /** Bounded UTF-8 text retained in main process for the provider only. */
  content: string
  /** Byte length of the bounded file snapshot, not a renderer-controlled value. */
  byteLength: number
}

/** Bounded provider-only context for the fixed workspace `NOTES.md` document. */
export type MindMapNotesContext = MindMapSelectedFileContext
/** Bounded provider-only context for one canonical workspace Lesson artifact. */
export type MindMapLessonContext = MindMapSelectedFileContext

export type MindMapLessonErrorCode =
  | 'invalid_path'
  | 'missing_file'
  | 'unsafe_path'
  | 'over_limit'
  | 'unreadable'

/** Renderer-safe error for Lesson artifact resolution. */
export class MindMapLessonError extends Error {
  readonly code: MindMapLessonErrorCode

  constructor(code: MindMapLessonErrorCode, message: string) {
    super(message)
    this.name = 'MindMapLessonError'
    this.code = code
  }
}

export type MindMapSelectedFileErrorCode =
  | 'invalid_path'
  | 'missing_file'
  | 'unsafe_path'
  | 'over_limit'
  | 'unreadable'

/** Renderer-safe error for selected-file resolution. */
export class MindMapSelectedFileError extends Error {
  readonly code: MindMapSelectedFileErrorCode

  constructor(code: MindMapSelectedFileErrorCode, message: string) {
    super(message)
    this.name = 'MindMapSelectedFileError'
    this.code = code
  }
}

/**
 * Normalize a renderer-supplied workspace-relative file path.
 *
 * `null` means the path is not a safe relative path. The function deliberately
 * rejects absolute POSIX paths, Windows drive/UNC paths, NUL bytes, traversal,
 * and an empty path before any filesystem operation is attempted.
 */
export function normalizeSelectedFileWorkspacePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > MIND_MAP_SELECTED_FILE_MAX_PATH_LENGTH ||
    trimmed.includes('\u0000')
  ) {
    return null
  }

  const normalized = trimmed.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    isAbsolute(normalized) ||
    win32.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return null
  }

  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join('/')
}

/**
 * Normalize and constrain a workspace-relative path to a generated Lesson page.
 *
 * Canonical generated artifacts live either under the default-workspace
 * `lessons/` directory or under a named course's `courses/<course>/lesson/`
 * directory. Assessment/reference/flashcard sidecars and non-HTML artifacts
 * are deliberately outside this context boundary.
 */
export function normalizeMindMapLessonWorkspacePath(value: unknown): string | null {
  const normalized = normalizeSelectedFileWorkspacePath(value)
  if (normalized === null) return null

  const parts = normalized.split('/')
  const isDefaultLesson = parts.length >= 2 && parts[0] === 'lessons'
  const isNamedCourseLesson = parts.length >= 4 && parts[0] === 'courses' && parts[2] === 'lesson'
  if (!isDefaultLesson && !isNamedCourseLesson) return null

  const leaf = parts[parts.length - 1] ?? ''
  if (!/\.html?$/i.test(leaf)) return null
  if (/(?:^|[-_])(assessment|reference|flashcards?)(?:[-_.]|$)/i.test(leaf)) return null
  return normalized
}

/**
 * Read one selected workspace file and derive a stable, content-addressed
 * source ref plus bounded provider context.
 *
 * No absolute path is present in the result and no source body is returned by
 * IPC callers; the gateway passes `content` directly to generation only.
 */
export async function resolveSelectedMindMapFile(
  workspaceRoot: string,
  workspacePath: unknown,
  maxBytes = MIND_MAP_SELECTED_FILE_MAX_BYTES
): Promise<MindMapSelectedFileContext> {
  const normalizedPath = normalizeSelectedFileWorkspacePath(workspacePath)
  if (normalizedPath === null) {
    throw new MindMapSelectedFileError(
      'invalid_path',
      'Selected mind-map file path must be a workspace-relative regular-file path.'
    )
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new MindMapSelectedFileError(
      'unreadable',
      'Selected mind-map file read limit is invalid.'
    )
  }

  let result: Awaited<ReturnType<typeof readContainedRegularFileBounded>>
  try {
    result = await readContainedRegularFileBounded(
      workspaceRoot,
      join(workspaceRoot, normalizedPath),
      maxBytes
    )
  } catch (error) {
    throw classifySelectedFileReadError(error)
  }

  if (result.status === 'over_limit') {
    throw new MindMapSelectedFileError(
      'over_limit',
      `Selected mind-map file exceeds the ${maxBytes}-byte context limit.`
    )
  }

  const contentHash = createHash('sha256').update(result.content).digest('hex')
  const sourceRef: MindMapSourceRef = {
    id: `selected-file:${createHash('sha256').update(normalizedPath).digest('hex')}`,
    workspacePath: normalizedPath,
    contentHash
  }
  return {
    sourceRef,
    content: result.content.toString('utf8'),
    byteLength: result.content.byteLength
  }
}

/**
 * Resolve one canonical Lesson artifact and derive a stable, content-addressed
 * source ref. The body remains main-process/provider-only just like selected
 * file context; no absolute root is included in the returned metadata.
 */
export async function resolveMindMapLesson(
  workspaceRoot: string,
  workspacePath: unknown,
  maxBytes = MIND_MAP_LESSON_MAX_BYTES
): Promise<MindMapLessonContext> {
  const normalizedPath = normalizeMindMapLessonWorkspacePath(workspacePath)
  if (normalizedPath === null) {
    throw new MindMapLessonError(
      'invalid_path',
      'Mind-map Lesson path must identify a generated workspace-relative HTML Lesson artifact.'
    )
  }

  try {
    const context = await resolveSelectedMindMapFile(workspaceRoot, normalizedPath, maxBytes)
    return {
      ...context,
      sourceRef: {
        ...context.sourceRef,
        id: `lesson:${createHash('sha256').update(normalizedPath).digest('hex')}`,
        workspacePath: normalizedPath
      }
    }
  } catch (error) {
    if (error instanceof MindMapSelectedFileError) {
      throw new MindMapLessonError(error.code, 'Mind-map Lesson artifact could not be read safely.')
    }
    throw new MindMapLessonError('unreadable', 'Mind-map Lesson artifact could not be read safely.')
  }
}

/** Alias kept explicit for callers that want to emphasize the read boundary. */
export const readSelectedMindMapFile = resolveSelectedMindMapFile

/**
 * Resolve the canonical workspace Notes document without accepting a renderer
 * supplied path. The source identity is stable across workspaces while the
 * content hash changes whenever the bounded snapshot changes.
 */
export async function resolveMindMapNotes(
  workspaceRoot: string,
  maxBytes = MIND_MAP_SELECTED_FILE_MAX_BYTES
): Promise<MindMapNotesContext> {
  const context = await resolveSelectedMindMapFile(
    workspaceRoot,
    MIND_MAP_NOTES_WORKSPACE_PATH,
    maxBytes
  )
  return {
    ...context,
    sourceRef: {
      ...context.sourceRef,
      id: `notes:${createHash('sha256').update(MIND_MAP_NOTES_WORKSPACE_PATH).digest('hex')}`,
      workspacePath: MIND_MAP_NOTES_WORKSPACE_PATH
    }
  }
}

function classifySelectedFileReadError(error: unknown): MindMapSelectedFileError {
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : {}
  const message = typeof record.message === 'string' ? record.message : ''

  if (record.code === 'ENOENT' || record.code === 'ENOTDIR') {
    return new MindMapSelectedFileError('missing_file', 'Selected mind-map file was not found.')
  }
  if (
    record.code === 'ELOOP' ||
    /symbolic link|junction|escapes the configured root|final path must be a regular file|contained path must/i.test(message)
  ) {
    return new MindMapSelectedFileError(
      'unsafe_path',
      'Selected mind-map file must be a contained regular file without links.'
    )
  }
  return new MindMapSelectedFileError(
    'unreadable',
    'Selected mind-map file could not be read safely.'
  )
}
