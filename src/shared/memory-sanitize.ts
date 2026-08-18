/**
 * Pure sanitizers for memory text before prompt injection (ADOPTION S-10 / ADR-0009).
 *
 * Fail-closed: bad input never throws; returns empty string or sanitized remainder.
 * Does not search, rank, persist, or change consent policy. Not FTS / vector / auto-memory.
 */

import { redactAgentSecretText } from './agent-secret-redaction'

export const DEFAULT_MEMORY_INJECTION_MAX_CHARS = 2000
export const DEFAULT_MEMORY_RECORDS_TOTAL_BUDGET = 8000

export type SanitizeMemoryInjectionOptions = {
  /** Hard cap on sanitized output length (default 2000). */
  maxChars?: number
}

export type SanitizeMemoryRecordsOptions = SanitizeMemoryInjectionOptions & {
  /** Optional total character budget across all records after sanitize. */
  totalBudget?: number
}

export type MemorySanitizeRecord = {
  id?: string
  content: string
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const EXCESSIVE_NEWLINES = /\n{3,}/g
const EXCESSIVE_SPACES = /[^\S\n\t]{2,}/g
const WINDOWS_ABS_PATH = /\b[A-Za-z]:[\\/][^\s"'`]+/g
const UNC_PATH = /\\\\[^\s"'`]+/g
const POSIX_HOME_PATH =
  /(?:^|[\s="'(:])(\/(?:Users|home|private\/var|var\/folders)\/[^\s"'`]+)/g
const GENERIC_UNIX_ABS =
  /(?:^|[\s="'(:])(\/(?:Users|home|Documents|Desktop|Downloads|tmp|var|opt|etc)\/[^\s"'`]+)/g

/**
 * Sanitize a single memory content string for safe prompt injection.
 * Never throws. Non-string / nullish → empty string.
 */
export function sanitizeMemoryInjectionText(
  raw: unknown,
  opts?: SanitizeMemoryInjectionOptions
): string {
  try {
    if (raw == null) return ''
    if (typeof raw !== 'string') return ''
    if (!raw) return ''

    const maxChars = normalizeMaxChars(opts?.maxChars)

    let text = raw
    // Normalize newlines first so control-char strip can keep \n and \t.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    text = text.replace(CONTROL_CHARS, '')
    text = redactObviousSecrets(text)
    text = redactAbsolutePaths(text)
    text = text.replace(EXCESSIVE_SPACES, ' ')
    text = text.replace(EXCESSIVE_NEWLINES, '\n\n')
    text = text.trim()

    if (text.length > maxChars) {
      text = `${text.slice(0, Math.max(0, maxChars - 1))}…`
    }
    return text
  } catch {
    return ''
  }
}

/**
 * Map memory records through content sanitize for prompt assembly.
 * Drops empty contents; preserves order; optional total char budget.
 * Never throws.
 */
export function sanitizeMemoryRecordsForPrompt(
  records: readonly MemorySanitizeRecord[] | null | undefined,
  opts?: SanitizeMemoryRecordsOptions
): { content: string; id?: string }[] {
  try {
    if (!Array.isArray(records) || records.length === 0) return []

    const totalBudget =
      opts?.totalBudget === undefined
        ? DEFAULT_MEMORY_RECORDS_TOTAL_BUDGET
        : Math.max(0, Math.floor(Number(opts.totalBudget) || 0))

    const out: { content: string; id?: string }[] = []
    let used = 0

    for (const record of records) {
      if (!record || typeof record !== 'object') continue
      const content = sanitizeMemoryInjectionText(record.content, opts)
      if (!content) continue

      if (used + content.length > totalBudget) {
        const remaining = totalBudget - used
        if (remaining <= 0) break
        const clipped = sanitizeMemoryInjectionText(content, {
          maxChars: remaining
        })
        if (!clipped) break
        out.push(withOptionalId(clipped, record.id))
        break
      }

      out.push(withOptionalId(content, record.id))
      used += content.length
    }

    return out
  } catch {
    return []
  }
}

function withOptionalId(content: string, id: unknown): { content: string; id?: string } {
  if (typeof id === 'string' && id) return { content, id }
  return { content }
}

function normalizeMaxChars(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_MEMORY_INJECTION_MAX_CHARS
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MEMORY_INJECTION_MAX_CHARS
  return n
}

function redactObviousSecrets(text: string): string {
  try {
    return redactAgentSecretText(text)
  } catch {
    // Light fallback if shared redactor fails.
    return text
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
      .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted]')
  }
}

function redactAbsolutePaths(text: string): string {
  let next = text
  next = next.replace(WINDOWS_ABS_PATH, '[path]')
  next = next.replace(UNC_PATH, '[path]')
  next = next.replace(POSIX_HOME_PATH, (full, pathPart: string) => {
    const prefix = full.slice(0, full.length - pathPart.length)
    return `${prefix}[path]`
  })
  next = next.replace(GENERIC_UNIX_ABS, (full, pathPart: string) => {
    const prefix = full.slice(0, full.length - pathPart.length)
    return `${prefix}[path]`
  })
  return next
}
