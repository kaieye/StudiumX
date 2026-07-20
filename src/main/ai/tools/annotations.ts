/**
 * Tool risk annotations and hard result byte budgets.
 *
 * Annotations are derived from effect classes by default so existing tools
 * stay consistent without per-tool boilerplate. Callers may override on
 * ToolEntry when a tool is more (or less) dangerous than its effect class.
 *
 * Result budgets prevent tool output from exploding model context. Truncation
 * is explicit and model-visible; it never rewrites structured error markers.
 */

import type { ToolEffectClass } from './tool-outcome'

export const DEFAULT_TOOL_RESULT_BUDGET_BYTES = 32 * 1024

export type ToolRiskAnnotations = Readonly<{
  /** Hint that the tool only reads state (no durable side effects). */
  readOnlyHint: boolean
  /** Hint that the tool may destroy or overwrite durable learner/workspace data. */
  destructiveHint: boolean
  /** Hint that the tool may reach the network. */
  openWorldHint: boolean
  /** Human-readable risk label for permission / timeline UI. */
  risk: 'readonly' | 'write' | 'network' | 'privileged'
}>

export type ToolResultBudgetPolicy = Readonly<{
  maxBytes: number
  /** Suffix appended when truncating; kept ASCII for stable byte counts. */
  truncationMarker?: string
}>

export type ToolResultBudgetResult = Readonly<{
  content: string
  truncated: boolean
  originalBytes: number
  budgetBytes: number
}>

const DEFAULT_TRUNCATION_MARKER =
  '\n\n[truncated: tool result exceeded budget; remaining content omitted]'

/**
 * Map effect class to default risk annotations.
 * Unknown / privileged tools stay fail-closed as privileged.
 */
export function annotationsForEffectClass(effectClass: ToolEffectClass): ToolRiskAnnotations {
  switch (effectClass) {
    case 'read':
      return {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        risk: 'readonly'
      }
    case 'workspace_write':
      return {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        risk: 'write'
      }
    case 'external_write':
      return {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        risk: 'network'
      }
    case 'privileged':
    default:
      return {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        risk: 'privileged'
      }
  }
}

export function resolveToolResultBudget(
  explicit?: number | ToolResultBudgetPolicy | null
): ToolResultBudgetPolicy {
  if (explicit == null) {
    return { maxBytes: DEFAULT_TOOL_RESULT_BUDGET_BYTES, truncationMarker: DEFAULT_TRUNCATION_MARKER }
  }
  if (typeof explicit === 'number') {
    return {
      maxBytes: normalizeBudget(explicit),
      truncationMarker: DEFAULT_TRUNCATION_MARKER
    }
  }
  return {
    maxBytes: normalizeBudget(explicit.maxBytes),
    truncationMarker: explicit.truncationMarker ?? DEFAULT_TRUNCATION_MARKER
  }
}

/**
 * Enforce a hard UTF-8 byte budget on tool result content.
 * Truncation prefers character boundaries and always leaves a visible marker.
 */
export function enforceToolResultBudget(
  content: string,
  budget?: number | ToolResultBudgetPolicy | null
): ToolResultBudgetResult {
  const policy = resolveToolResultBudget(budget)
  const originalBytes = utf8ByteLength(content)
  if (originalBytes <= policy.maxBytes) {
    return {
      content,
      truncated: false,
      originalBytes,
      budgetBytes: policy.maxBytes
    }
  }

  const marker = policy.truncationMarker ?? DEFAULT_TRUNCATION_MARKER
  const markerBytes = utf8ByteLength(marker)
  const bodyBudget = Math.max(0, policy.maxBytes - markerBytes)
  const body = truncateUtf8ToBytes(content, bodyBudget)
  return {
    content: `${body}${marker}`,
    truncated: true,
    originalBytes,
    budgetBytes: policy.maxBytes
  }
}

function normalizeBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TOOL_RESULT_BUDGET_BYTES
  return Math.floor(value)
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function truncateUtf8ToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (utf8ByteLength(value) <= maxBytes) return value
  // Binary search code-unit length so we never split a UTF-16 surrogate pair.
  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (utf8ByteLength(value.slice(0, mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  let end = low
  if (end > 0) {
    const code = value.charCodeAt(end - 1)
    if (code >= 0xdc00 && code <= 0xdfff) end -= 1
  }
  return value.slice(0, end)
}
