/**
 * Shared closed-set helpers for workspace file-touch classification + path sanitize.
 * Used by main ledger (context projection) and learner UI projection (ADR-0143).
 *
 * Only product-registered single-path tools are listed. Dead aliases such as
 * apply_patch are intentionally omitted (no Shell / apply_patch product path).
 */

import { redactAgentSecretText } from './agent-secret-redaction'

/** Access kind for a touched workspace path. */
export type FileTouchKind = 'read' | 'modified'

/** Single-path tools that only observe a file (product registry names + short aliases). */
export const READ_TOUCH_TOOLS = new Set([
  'read_workspace_file',
  'read_file',
  'Read',
  'read'
])

/** Single-path tools that create/overwrite/edit/delete content (product registry names + short aliases). */
export const MODIFY_TOUCH_TOOLS = new Set([
  'write_workspace_file',
  'write_file',
  'Write',
  'write',
  'edit_workspace_file',
  'edit_file',
  'Edit',
  'edit',
  'delete_workspace_file',
  'delete_file',
  'Delete',
  'delete'
])

export const DEFAULT_FILE_TOUCH_MAX_ENTRIES = 64
export const DEFAULT_FILE_TOUCH_MAX_PATH_CHARS = 240

/**
 * Classify a tool name into a file-touch kind when it targets a single path.
 * Multi-path / search / list tools return null (not recorded).
 */
export function classifyFileTouchTool(toolName: string): FileTouchKind | null {
  const name = toolName.trim()
  if (!name) return null
  if (MODIFY_TOUCH_TOOLS.has(name)) return 'modified'
  if (READ_TOUCH_TOOLS.has(name)) return 'read'
  return null
}

/**
 * Lexical path sanitization for ledger / UI keys.
 * Rejects absolute / UNC / drive / traversal breakout; normalizes to posix relative.
 * Returns null when the path must be dropped (never partially truncated).
 */
export function sanitizeFileTouchPath(
  raw: unknown,
  maxPathChars: number = DEFAULT_FILE_TOUCH_MAX_PATH_CHARS
): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (isAbsoluteOrBreakoutPath(trimmed)) return null

  const normalized = normalizeRelativePosix(trimmed)
  if (!normalized) return null
  if (normalized.length > maxPathChars) return null
  return normalized
}

/**
 * Learner-safe path: sanitize + drop secret-looking redactions entirely.
 */
export function sanitizeFileTouchDisplayPath(
  raw: unknown,
  maxPathChars: number = DEFAULT_FILE_TOUCH_MAX_PATH_CHARS
): string | null {
  const sanitized = sanitizeFileTouchPath(raw, maxPathChars)
  if (!sanitized) return null
  const redacted = redactAgentSecretText(sanitized)
  if (redacted !== sanitized || redacted.includes('[redacted')) return null
  return redacted
}

export function stickyFileTouchKind(a: FileTouchKind, b: FileTouchKind): FileTouchKind {
  return a === 'modified' || b === 'modified' ? 'modified' : 'read'
}

export function clampFileTouchInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function isAbsoluteOrBreakoutPath(value: string): boolean {
  if (value.includes('\0')) return true
  if (value.startsWith('/')) return true
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\') || value.startsWith('//')) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return true
  return false
}

function normalizeRelativePosix(value: string): string | null {
  const replaced = value.replace(/\\/g, '/')
  const parts = replaced.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    if (part.includes(':') || part.includes('\\')) return null
    stack.push(part)
  }
  if (stack.length === 0) return null
  return stack.join('/')
}
