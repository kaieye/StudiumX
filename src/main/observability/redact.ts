/**
 * Fail-closed redaction helpers for local support / export strings.
 *
 * Standalone primitives for path + secret scrubbing so observability and
 * export paths do not depend on support-bundle internals. Prefer over-redact
 * when uncertain. No remote export.
 */

import { redactAgentSecretText } from '../../shared/agent-secret-redaction'

export const REDACTED_ABSOLUTE_PATH = '<redacted-absolute-path>'
export const REDACTED_SECRET = '[redacted]'
const MAX_STRING_LENGTH = 480

/**
 * Redact secret-shaped tokens. Fail-closed: empty / non-string → empty string;
 * on internal error → full redaction marker.
 */
export function redactSecrets(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'string') return REDACTED_SECRET
  try {
    return redactAgentSecretText(value)
  } catch {
    return REDACTED_SECRET
  }
}

/**
 * Redact absolute host paths for export. Prefer workspace-relative when a root
 * is known; otherwise replace absolute paths with a stub. Fail-closed on error.
 */
export function redactPath(value: unknown, workspaceRoot: string | null = null): string {
  try {
    if (value == null) return ''
    if (typeof value !== 'string') return REDACTED_ABSOLUTE_PATH
    const trimmed = value.trim()
    if (!trimmed) return ''

    const secretSafe = redactSecrets(trimmed)

    if (workspaceRoot) {
      const relative = tryWorkspaceRelative(workspaceRoot, secretSafe)
      if (relative != null) {
        return compact(normalizeRelative(relative))
      }
    }

    if (looksLikeAbsolutePath(secretSafe)) {
      return REDACTED_ABSOLUTE_PATH
    }

    // Strip drive letters / home roots embedded in free text.
    const scrubbed = scrubAbsolutePaths(secretSafe, workspaceRoot)
    if (scrubbed.includes('/') || scrubbed.includes('\\')) {
      return compact(normalizeRelative(scrubbed))
    }
    return compact(scrubbed)
  } catch {
    return REDACTED_ABSOLUTE_PATH
  }
}

/**
 * Combined fail-closed export string redaction: secrets then paths.
 */
export function redactExportString(value: unknown, workspaceRoot: string | null = null): string {
  try {
    if (value == null) return ''
    if (typeof value !== 'string') return REDACTED_SECRET
    return redactPath(redactSecrets(value), workspaceRoot)
  } catch {
    return REDACTED_SECRET
  }
}

function scrubAbsolutePaths(value: string, workspaceRoot: string | null): string {
  let next = value

  next = next.replace(/\b[A-Za-z]:[\\/][^\s"'`]+/g, (match) => {
    if (workspaceRoot) {
      const relative = tryWorkspaceRelative(workspaceRoot, match)
      if (relative != null) return normalizeRelative(relative)
    }
    return REDACTED_ABSOLUTE_PATH
  })

  next = next.replace(/\\\\[^\s"'`]+/g, REDACTED_ABSOLUTE_PATH)

  next = next.replace(
    /(?:^|[\s="'(:])(\/(?:Users|home|private\/var|var\/folders)\/[^\s"'`]+)/g,
    (full, pathPart: string) => {
      const prefix = full.slice(0, full.length - pathPart.length)
      if (workspaceRoot) {
        const relative = tryWorkspaceRelative(workspaceRoot, pathPart)
        if (relative != null) return `${prefix}${normalizeRelative(relative)}`
      }
      return `${prefix}${REDACTED_ABSOLUTE_PATH}`
    }
  )

  // Generic home path segments that slipped through.
  next = next.replace(
    /(?:^|[\s="'(:])(\/(?:Users|home)\/[^\s"'`]+)/g,
    (full, pathPart: string) => {
      const prefix = full.slice(0, full.length - pathPart.length)
      return `${prefix}${REDACTED_ABSOLUTE_PATH}`
    }
  )

  return next
}

function tryWorkspaceRelative(workspaceRoot: string, absoluteOrAny: string): string | null {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const candidate = absoluteOrAny.replace(/\\/g, '/')
  if (!root || !candidate) return null

  const rootLower = root.toLowerCase()
  const candidateLower = candidate.toLowerCase()
  if (candidateLower === rootLower) return '.'
  const prefix = `${rootLower}/`
  if (candidateLower.startsWith(prefix)) {
    return candidate.slice(root.length).replace(/^[/\\]+/, '')
  }
  return null
}

function looksLikeAbsolutePath(value: string): boolean {
  if (!value) return false
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\')) return true
  if (
    value.startsWith('/Users/') ||
    value.startsWith('/home/') ||
    value.startsWith('/private/var/') ||
    value.startsWith('/var/folders/')
  ) {
    return true
  }
  if (value.startsWith('/') && /\/(Users|home|Documents|Desktop|Downloads)\//i.test(value)) {
    return true
  }
  return false
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function compact(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH - 1)}…`
}
