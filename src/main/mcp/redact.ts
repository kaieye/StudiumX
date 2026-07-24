/**
 * MCP doctor / support-bundle redaction (ADR-0128 §11 / ADR-0148 presence-only).
 *
 * Never returns env/header secret values — only scrubbed command/args/cwd labels.
 */

import { projectSecretPresenceMap } from '../../shared/secret-presence'
import { redactPath, redactSecrets } from '../observability/redact'

export function redactMcpCommandLine(
  command: string | null | undefined,
  args: readonly string[] | null | undefined,
  workspaceRoot: string | null = null
): { command: string; args: string[] } {
  const cmd = redactSecrets(command ?? '')
  const safeCmd = looksLikeAbs(cmd) ? redactPath(cmd, workspaceRoot) : cmd
  const safeArgs = (args ?? []).map((arg) => {
    const scrubbed = redactSecrets(arg)
    return looksLikeAbs(scrubbed) ? redactPath(scrubbed, workspaceRoot) : scrubbed
  })
  return { command: safeCmd, args: safeArgs }
}

export function redactMcpCwd(
  cwd: string | null | undefined,
  workspaceRoot: string | null = null
): string | null {
  if (cwd == null || cwd === '') return null
  return redactPath(cwd, workspaceRoot)
}

/**
 * Presence-only map for MCP secret refs (doctor / public views).
 * Re-export of shared helper so MCP main stays one import for presence.
 */
export function projectMcpSecretPresence(
  refs: Readonly<Record<string, unknown>> | null | undefined
): Record<string, boolean> {
  return projectSecretPresenceMap(refs)
}

function looksLikeAbs(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  )
}
