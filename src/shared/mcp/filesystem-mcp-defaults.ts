/**
 * ADR-0013: default workspace-root injection for filesystem-class MCP.
 *
 * Detection is for UX defaults only. Runtime injection still requires
 * `workspaceRootInjection: 'granted'` (resolveInjectedStdioServer never infers).
 * Explicit `'off'` always wins when the user or document set it.
 */

import type { McpInjectionIdentity, McpWorkspaceRootInjection } from './types'

export type FilesystemMcpDetectionInput = Readonly<{
  transport?: string | null
  command?: string | null
  args?: readonly string[] | null
  injectionIdentity?: McpInjectionIdentity | string | null
}>

/**
 * True when the server looks like the official filesystem MCP (or declares that identity).
 * Used only to seed defaults — not a grant by itself.
 */
export function looksLikeFilesystemMcpServer(input: FilesystemMcpDetectionInput): boolean {
  if (input.injectionIdentity === 'filesystem_mcp') return true
  if (input.transport != null && input.transport !== 'stdio') return false

  const command = (input.command ?? '').toLowerCase()
  const argsJoined = (input.args ?? []).join(' ').toLowerCase()
  const haystack = `${command} ${argsJoined}`
  return (
    haystack.includes('@modelcontextprotocol/server-filesystem') ||
    // Common npx / binary package segment without the full scoped name.
    /(^|[\s/@-])server-filesystem(\s|$)/.test(haystack) ||
    haystack.includes('server-filesystem')
  )
}

export type WorkspaceRootInjectionDefaults = Readonly<{
  workspaceRootInjection: McpWorkspaceRootInjection
  injectionIdentity: McpInjectionIdentity | null
}>

/**
 * Resolve draft/import defaults for injection fields.
 *
 * - Explicit `workspaceRootInjection: 'off'` is always preserved.
 * - Explicit `granted` is preserved; identity defaults to filesystem_mcp when detected.
 * - Omitted / unknown injection: filesystem-like → granted + filesystem_mcp; else off + prior identity.
 */
export function resolveFilesystemInjectionDefaults(
  input: FilesystemMcpDetectionInput & {
    /** Present when the document or draft already carries a value. */
    workspaceRootInjection?: McpWorkspaceRootInjection | string | null
    /** When true, treat missing injection as "user never set" and allow filesystem default. */
    allowFilesystemDefault?: boolean
  }
): WorkspaceRootInjectionDefaults {
  const allowDefault = input.allowFilesystemDefault !== false
  const looksFs = looksLikeFilesystemMcpServer(input)
  const rawInjection = input.workspaceRootInjection
  const priorIdentity =
    input.injectionIdentity === 'filesystem_mcp' || input.injectionIdentity === 'generic'
      ? input.injectionIdentity
      : null

  if (rawInjection === 'off') {
    return {
      workspaceRootInjection: 'off',
      injectionIdentity: priorIdentity ?? (looksFs ? 'filesystem_mcp' : null)
    }
  }

  if (rawInjection === 'granted') {
    return {
      workspaceRootInjection: 'granted',
      injectionIdentity: priorIdentity ?? (looksFs ? 'filesystem_mcp' : null)
    }
  }

  // Omitted or unrecognized — default for filesystem-class servers (ADR-0013).
  if (allowDefault && looksFs) {
    return {
      workspaceRootInjection: 'granted',
      injectionIdentity: priorIdentity ?? 'filesystem_mcp'
    }
  }

  return {
    workspaceRootInjection: 'off',
    injectionIdentity: priorIdentity
  }
}
