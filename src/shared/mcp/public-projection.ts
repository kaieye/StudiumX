/**
 * Secret-free MCP public projections shared by the main and renderer processes.
 *
 * Keep this module free of Node-only dependencies so renderer bundles can use
 * the projection without pulling the durable config parser (and its hashing
 * implementation) into the browser.
 */

import { projectSecretPresenceMap } from '../secret-presence'
import type { UserMcpServerPublicV1, UserMcpServerV1 } from './types'

export function toPublicServer(server: UserMcpServerV1): UserMcpServerPublicV1 {
  // Presence-only secret maps (ADR-0148): never project ref ids or plaintext.
  const envSecretConfigured = projectSecretPresenceMap(server.envSecretRefs)
  const headersSecretConfigured = projectSecretPresenceMap(server.headersSecretRefs)
  // Command/args may embed credentials; scrub assignment-shaped tokens on public view.
  // Paths stay as configured (editor needs them); free-text secret scrub only.
  const command =
    server.command != null && server.command !== ''
      ? redactPublicCommandText(server.command)
      : server.command
  const args = server.args.map((arg) => redactPublicCommandText(arg))
  return {
    id: server.id,
    label: server.label,
    enabled: server.enabled,
    scope: server.scope,
    workspaceRoot: server.workspaceRoot,
    transport: server.transport,
    command,
    args,
    cwd: server.cwd,
    envSecretConfigured,
    envPlain: sortRecord(server.envPlain),
    envPlainKeys: Object.keys(server.envPlain).sort(),
    url: server.url,
    headersSecretConfigured,
    headersPlain: sortRecord(server.headersPlain),
    timeoutMs: server.timeoutMs,
    toolEffectOverrides: server.toolEffectOverrides,
    oauth: server.oauth,
    workspaceRootInjection: server.workspaceRootInjection,
    injectionIdentity: server.injectionIdentity,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt
  }
}

/**
 * Light public scrub for command/args on MCP public DTO.
 * Uses agent-secret patterns without path rewriting (path rewrite is doctor/support only).
 */
function redactPublicCommandText(value: string): string {
  // Inline minimal assignment/Bearer scrub aligned with agent-secret-redaction.
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[redacted]')
    .replace(
      /([?&#](?:api[_-]?key|token|secret|password|authorization|credential)=)([^&#\s]*)/gi,
      '$1[redacted]'
    )
    .replace(
      /(["']?\b(?:api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)\b["']?\s*[:=]\s*)(["'][^"\r\n]*["']|'[^'\r\n]*'|[^\s,;&}\r\n]+)/gi,
      (_m, prefix: string, secretValue: string) => {
        const quote = secretValue[0] === '"' || secretValue[0] === "'" ? secretValue[0] : ''
        return `${prefix}${quote}[redacted]${quote}`
      }
    )
    .replace(/\b(?:sk-proj-|sk-live-|sk-test-|sk-)[A-Za-z0-9_-]{16,}\b/g, '[redacted]')
}

function sortRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}
