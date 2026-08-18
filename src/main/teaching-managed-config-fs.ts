/**
 * Caller-root-contained FS loader for optional secret-free managed teaching
 * config documents (ADOPTION S-11 residual / ADR-0006).
 *
 * Managed docs live under a **caller-supplied absolute root** (typically
 * Electron userData or a test temp dir) — **not** under untrusted workspace.
 * Fail closed: missing / invalid / oversize / path-escape → null.
 *
 * Pure resolver layer (ADR-0006) already accepts `TeachingConfigScope.managed`
 * and strips secrets; this module only loads raw JSON for inject helpers.
 * No MDM, no remote policy fetch, no secret storage feature.
 */

import { resolve } from 'node:path'

import { isLexicallyInsideRoot, readContainedRegularFileBounded } from './path-access'
import type { TeachingConfigScope } from './teaching-config-resolver'

/** Conventional relative path under the managed root (e.g. app userData). */
export const DEFAULT_MANAGED_CONFIG_RELATIVE_PATH = 'studiumx-managed-config.json'

/** Max bytes accepted for a managed config document (64 KiB). */
export const MANAGED_CONFIG_MAX_BYTES = 64 * 1024

export type LoadManagedConfigDocumentInput = Readonly<{
  /** Absolute (or process-cwd-relative) contained root — e.g. app userData. */
  rootPath: string
  /** Relative path under root; default DEFAULT_MANAGED_CONFIG_RELATIVE_PATH. */
  relativePath?: string
  maxBytes?: number
}>

/**
 * Local relative-path normalizer (fail-closed).
 * Rejects empty, absolute, drive-letter, and `..` escape segments without
 * pulling the tool-policy write-policy graph into this module.
 */
export function normalizeManagedRelativePath(value: string): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim().split(String.fromCharCode(92)).join('/')
  if (!candidate || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) {
    return null
  }
  const parts: string[] = []
  for (const part of candidate.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

/**
 * Pure text helper: JSON.parse → plain object or null.
 * Fail closed on invalid JSON, non-object top-level (array/null/primitive).
 * Does not reimplement teaching-loop schema validation (resolver strips secrets).
 */
export function loadManagedConfigDocumentFromJsonText(text: string): unknown | null {
  if (typeof text !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!isPlainObject(raw)) return null
  return raw
}

/**
 * Load an optional managed config document from a file under a caller root.
 *
 * - Lexically rejects relative-path escape (`..`, absolute, empty).
 * - Uses `readContainedRegularFileBounded` for contained regular-file IO.
 * - Missing file / invalid JSON / non-object / oversize / path outside root
 *   → **null** (fail closed; no throw for normal miss or bad document).
 */
export async function loadManagedConfigDocumentFromRoot(
  input: LoadManagedConfigDocumentInput
): Promise<unknown | null> {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) return null

  const relativeRaw =
    typeof input.relativePath === 'string' && input.relativePath.trim()
      ? input.relativePath
      : DEFAULT_MANAGED_CONFIG_RELATIVE_PATH

  const normalizedRelative = normalizeManagedRelativePath(relativeRaw)
  if (!normalizedRelative) return null

  const absoluteTarget = resolve(rootPath, ...normalizedRelative.split('/'))
  if (!isLexicallyInsideRoot(rootPath, absoluteTarget)) return null

  const maxBytes =
    typeof input.maxBytes === 'number' && Number.isSafeInteger(input.maxBytes) && input.maxBytes >= 0
      ? input.maxBytes
      : MANAGED_CONFIG_MAX_BYTES

  let bounded: Awaited<ReturnType<typeof readContainedRegularFileBounded>>
  try {
    bounded = await readContainedRegularFileBounded(rootPath, absoluteTarget, maxBytes)
  } catch {
    // Missing file, symlink, non-file, containment failure, etc. → fail closed.
    return null
  }

  if (bounded.status === 'over_limit') return null

  const text = bounded.content.toString('utf8')
  return loadManagedConfigDocumentFromJsonText(text)
}

/**
 * Pure inject option: only spread `managed` when document is a non-null plain object.
 * Prefer this over passing `null` so the field is **omitted** on miss and the
 * resolver skips the managed layer.
 */
export function managedConfigOption(
  document: unknown | null | undefined
): { managed: unknown } | Record<string, never> {
  if (document == null || !isPlainObject(document)) return {}
  return { managed: document }
}

/**
 * Composition helper: return a scope with optional managed document applied.
 * Null/undefined/non-object managed leaves `scope.managed` unset (omitted),
 * so callers can always spread without inventing an empty managed layer.
 */
export function scopeWithManaged(
  scope: TeachingConfigScope,
  managed: unknown | null | undefined
): TeachingConfigScope {
  const option = managedConfigOption(managed)
  if (!('managed' in option)) {
    const { managed: _drop, ...rest } = scope
    void _drop
    return { ...rest, fallbackDefaultRoot: scope.fallbackDefaultRoot }
  }
  return {
    ...scope,
    managed: option.managed
  }
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
