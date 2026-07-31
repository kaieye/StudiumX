/**
 * Built-in system-default MCP servers (ADR-0137 system layer).
 *
 * These appear in every user's MCP server list but are disabled by default.
 * Users can enable them in Settings > MCP. A user-layer server with the same
 * id always takes precedence (higher source rank).
 */

import type { UserMcpServerV1 } from './types'

/** Stable timestamp for built-in entries (does not affect CAS fingerprint of user layer). */
const SYSTEM_EPOCH = '2026-07-31T00:00:00.000Z'

/**
 * Context documentation server (neuledge/context).
 * Provides full-text search over installed documentation packages via MCP.
 * Hosted at https://api.studiumx.cn/mcp for external StudiumX users.
 */
const contextDocsServer: UserMcpServerV1 = {
  id: 'context-docs',
  label: 'StudiumX 文档检索',
  enabled: false,
  scope: 'user',
  workspaceRoot: null,
  transport: 'http',
  command: null,
  args: [],
  cwd: null,
  envSecretRefs: {},
  envPlain: {},
  url: 'https://api.studiumx.cn/mcp',
  headersSecretRefs: {},
  headersPlain: { 'X-StudiumX-Auth': 'auto' },
  timeoutMs: null,
  toolEffectOverrides: {},
  oauth: null,
  workspaceRootInjection: 'off',
  injectionIdentity: null,
  createdAt: SYSTEM_EPOCH,
  updatedAt: SYSTEM_EPOCH
}

/** All built-in system-default servers (disabled by default). */
export const SYSTEM_DEFAULT_MCP_SERVERS: readonly UserMcpServerV1[] = [
  contextDocsServer
]
