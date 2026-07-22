/**
 * Stable MCP tool name encode/decode (ADR-0128 §5.1).
 * Pure — no I/O.
 *
 * Format: mcp__{serverId}__{rawToolName}
 */

const MCP_PREFIX = 'mcp__'
const SERVER_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/
const SAFE_TOOL_CHAR_RE = /[^A-Za-z0-9_-]/g

export type McpToolNameParts = Readonly<{
  serverId: string
  rawToolName: string
}>

export function isMcpToolName(toolName: string): boolean {
  if (typeof toolName !== 'string' || !toolName.startsWith(MCP_PREFIX)) return false
  const rest = toolName.slice(MCP_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return false
  const serverId = rest.slice(0, sep)
  const raw = rest.slice(sep + 2)
  return SERVER_ID_RE.test(serverId) && raw.length > 0
}

export function encodeMcpToolName(serverId: string, rawToolName: string): string {
  const safeServer = serverId.trim()
  if (!SERVER_ID_RE.test(safeServer)) {
    throw new Error(`Invalid MCP server id for tool name: ${serverId}`)
  }
  const sanitized = sanitizeRawToolName(rawToolName)
  return `${MCP_PREFIX}${safeServer}__${sanitized}`
}

export function decodeMcpToolName(toolName: string): McpToolNameParts | null {
  if (!isMcpToolName(toolName)) return null
  const rest = toolName.slice(MCP_PREFIX.length)
  const sep = rest.indexOf('__')
  return {
    serverId: rest.slice(0, sep),
    rawToolName: rest.slice(sep + 2)
  }
}

/**
 * Map raw MCP tool names to registry-safe names within one server.
 * Non [A-Za-z0-9_-] → `_`; collisions get `_2`, `_3`, …
 */
export function allocateUniqueRawToolNames(
  rawNames: readonly string[]
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const raw of rawNames) {
    // Duplicate raw names keep the first allocated mapping (stable id → name).
    if (out.has(raw)) continue
    const base = sanitizeRawToolName(raw) || 'tool'
    let candidate = base
    let n = 2
    while (used.has(candidate)) {
      candidate = `${base}_${n}`
      n += 1
    }
    used.add(candidate)
    out.set(raw, candidate)
  }
  return out
}

export function sanitizeRawToolName(rawToolName: string): string {
  const trimmed = typeof rawToolName === 'string' ? rawToolName.trim() : ''
  if (!trimmed) return 'tool'
  const sanitized = trimmed.replace(SAFE_TOOL_CHAR_RE, '_')
  // Collapse repeated underscores from multi-char replacements.
  return sanitized.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool'
}

export { SERVER_ID_RE as MCP_SERVER_ID_RE }
