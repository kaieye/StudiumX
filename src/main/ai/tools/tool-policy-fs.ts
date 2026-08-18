/**
 * Workspace-contained FS loader for declarative tool-policy documents
 * Loads and merges workspace tool-policy documents under ADR-0005.
 *
 * Reads optional relative JSON file(s) under a registered workspace root via
 * path-access contained IO, then parses with pure `loadToolPolicyDocument`.
 * Multi-path load merges with most-restrictive-wins (ADR-0005).
 * Fail closed: missing / invalid / oversize / path-escape → null (per file or overall).
 *
 * Does not invent shell argv / prefix_rule policy language, and does not
 * change the default approvalMode lattice when no document loads.
 */

import { resolve } from 'node:path'

import { isLexicallyInsideRoot, readContainedRegularFileBounded } from '../../path-access'
import {
  loadToolPolicyDocument,
  mergeToolPolicyDocuments,
  type ToolPolicyDocument
} from './tool-policy'
import { normalizeRelativePath } from './write-policy'

/** Conventional relative path for an optional workspace tool-policy document. */
export const DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH = '.studiumx/tool-policy.json'

/**
 * Optional course-layer overlay relative path (ADR-0005).
 * Loaded after the primary workspace document when multi-path merge is used;
 * missing secondary is fail-soft and does not change single-file behavior.
 */
export const OPTIONAL_COURSE_TOOL_POLICY_RELATIVE_PATH = '.studiumx/tool-policy.course.json'

/** Max bytes accepted for a workspace tool-policy document (64 KiB). */
export const WORKSPACE_TOOL_POLICY_MAX_BYTES = 64 * 1024

/** Default dual paths for product multi-path load (primary + optional course overlay). */
export const DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS = Object.freeze([
  DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH,
  OPTIONAL_COURSE_TOOL_POLICY_RELATIVE_PATH
] as const)

export type LoadToolPolicyDocumentFromWorkspaceInput = Readonly<{
  /** Absolute (or process-cwd-relative) registered workspace root. */
  workspaceRoot: string
  /**
   * Relative path under the workspace root.
   * Defaults to {@link DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH}.
   */
  relativePath?: string
  /** Override bounded-read limit; default {@link WORKSPACE_TOOL_POLICY_MAX_BYTES}. */
  maxBytes?: number
}>

export type LoadAndMergeToolPolicyDocumentsFromWorkspaceInput = Readonly<{
  /** Absolute (or process-cwd-relative) registered workspace root. */
  workspaceRoot: string
  /**
   * Relative paths under the workspace root, load order preserved for merge.
   * Defaults to {@link DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS}
   * (primary workspace + optional course overlay).
   */
  relativePaths?: readonly string[]
  /** Override bounded-read limit per file; default {@link WORKSPACE_TOOL_POLICY_MAX_BYTES}. */
  maxBytes?: number
}>

/**
 * Pure text helper: JSON.parse then `loadToolPolicyDocument`.
 * Returns null on invalid JSON or invalid policy shape (fail closed).
 */
export function loadToolPolicyDocumentFromJsonText(text: string): ToolPolicyDocument | null {
  if (typeof text !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    return null
  }
  return loadToolPolicyDocument(raw)
}

/**
 * Load an optional tool-policy document from a file under a workspace root.
 *
 * - Lexically rejects relative-path escape (`..`, absolute, empty).
 * - Uses `readContainedRegularFileBounded` for contained regular-file IO.
 * - Parses with pure `loadToolPolicyDocument` (rejects argv / YOLO / bad shape).
 * - Missing file / invalid JSON / invalid shape / oversize / path outside root
 *   → **null** (fail closed; no throw for normal miss or bad document).
 */
export async function loadToolPolicyDocumentFromWorkspace(
  input: LoadToolPolicyDocumentFromWorkspaceInput
): Promise<ToolPolicyDocument | null> {
  const workspaceRoot =
    typeof input.workspaceRoot === 'string' ? input.workspaceRoot.trim() : ''
  if (!workspaceRoot) return null

  const relativeRaw =
    typeof input.relativePath === 'string' && input.relativePath.trim()
      ? input.relativePath
      : DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH

  const normalizedRelative = normalizeRelativePath(relativeRaw)
  if (!normalizedRelative) return null

  // Re-join with platform separators for path-access (POSIX-normalized segments).
  const absoluteTarget = resolve(workspaceRoot, ...normalizedRelative.split('/'))
  if (!isLexicallyInsideRoot(workspaceRoot, absoluteTarget)) return null

  const maxBytes =
    typeof input.maxBytes === 'number' && Number.isSafeInteger(input.maxBytes) && input.maxBytes >= 0
      ? input.maxBytes
      : WORKSPACE_TOOL_POLICY_MAX_BYTES

  let bounded: Awaited<ReturnType<typeof readContainedRegularFileBounded>>
  try {
    bounded = await readContainedRegularFileBounded(workspaceRoot, absoluteTarget, maxBytes)
  } catch {
    // Missing file, symlink, non-file, containment failure, etc. → fail closed.
    return null
  }

  if (bounded.status === 'over_limit') return null

  const text = bounded.content.toString('utf8')
  return loadToolPolicyDocumentFromJsonText(text)
}

/**
 * Load multiple optional tool-policy documents and merge (ADR-0005).
 *
 * Semantics:
 * - Each path is loaded via {@link loadToolPolicyDocumentFromWorkspace} (fail-soft null per file).
 * - Null results (missing / invalid / oversize / escape) are skipped; no throw for miss.
 * - Zero documents loaded → `null` (default-equivalent omit for product inject).
 * - One document → that document unchanged.
 * - Multiple → {@link mergeToolPolicyDocuments} (most-restrictive-wins).
 * - Merge throws (unexpected invalid shape that slipped past single-file loader) → `null`
 *   fail-soft for product readiness (never surface invalid merged docs).
 *
 * Default paths: primary `.studiumx/tool-policy.json` then optional
 * `.studiumx/tool-policy.course.json`. Secondary miss keeps primary-only behavior
 * identical to single-file load.
 */
export async function loadAndMergeToolPolicyDocumentsFromWorkspace(
  input: LoadAndMergeToolPolicyDocumentsFromWorkspaceInput
): Promise<ToolPolicyDocument | null> {
  const workspaceRoot =
    typeof input.workspaceRoot === 'string' ? input.workspaceRoot.trim() : ''
  if (!workspaceRoot) return null

  const relativePaths =
    Array.isArray(input.relativePaths) && input.relativePaths.length > 0
      ? input.relativePaths
      : DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS

  const loaded: ToolPolicyDocument[] = []
  for (const relativePath of relativePaths) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) continue
    const doc = await loadToolPolicyDocumentFromWorkspace({
      workspaceRoot,
      relativePath,
      maxBytes: input.maxBytes
    })
    if (doc != null) loaded.push(doc)
  }

  if (loaded.length === 0) return null
  if (loaded.length === 1) return loaded[0]!

  try {
    return mergeToolPolicyDocuments(loaded)
  } catch {
    // Fail-soft product readiness: never return an invalid merged document.
    return null
  }
}

/**
 * Pure inject option: only spread `toolPolicyDocument` when a document loaded.
 *
 * Prefer this over passing `null` into `buildToolContext` so the field is
 * **omitted** on miss/invalid and registry falls back to
 * `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT` (default-equivalent lattice).
 * Product inject for the ADR-0005 primary and overlay paths.
 */
export function toolPolicyDocumentOption(
  document: ToolPolicyDocument | null | undefined
): { toolPolicyDocument: ToolPolicyDocument } | Record<string, never> {
  if (document == null) return {}
  return { toolPolicyDocument: document }
}

/**
 * Optional attach helper: set `toolPolicyDocument` on a context-like object.
 * Callers may also assign the field themselves; this is a thin convenience.
 * When `document` is null/undefined the property is left as-is or cleared only
 * if the caller passes an explicit null after load — prefer assigning after load.
 */
export function attachWorkspaceToolPolicyDocument<
  T extends { toolPolicyDocument?: ToolPolicyDocument | null }
>(ctxLike: T, document: ToolPolicyDocument | null | undefined): T {
  if (document === undefined) return ctxLike
  return { ...ctxLike, toolPolicyDocument: document }
}
