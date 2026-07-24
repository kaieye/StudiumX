/**
 * User MCP config store: userData/mcp/config.v1.json + .bak + CAS (ADR-0128 §3).
 */

import { join } from 'node:path'

import {
  defaultUserMcpConfig,
  fingerprintUserMcpConfig,
  isUserMcpConfigDocument,
  parseUserMcpConfig,
  toPublicMcpConfig,
  type ParseMcpConfigResult
} from '../../shared/mcp/config-schema'
import { applyMcpOps, type McpSettingsOp } from '../../shared/mcp/mcp-ops'
import {
  MCP_ERROR_CODES,
  mcpUserMessage,
  type McpConfigUpdateResult,
  type McpGetConfigResult,
  type McpSecretInputChanges,
  type UserMcpConfigV1
} from '../../shared/mcp/types'
import {
  readValidatedWithBackup,
  replaceWithBackup,
  type DurableFileOperations
} from '../persistence/durable-file'
import {
  createMemoryMcpSecretEnv,
  type McpSecretEnvResolver
} from './secret-env'
import { materializeMcpServerSecrets } from './secret-merge'

export const MCP_CONFIG_RELATIVE_PATH = 'mcp/config.v1.json'

export type McpConfigStoreOptions = {
  userDataPath: string
  operations?: DurableFileOperations
  now?: () => string
  secrets?: McpSecretEnvResolver
}

export class McpConfigStore {
  private readonly path: string
  private readonly operations?: DurableFileOperations
  private readonly secrets: McpSecretEnvResolver
  private cache: UserMcpConfigV1 | null = null

  constructor(options: McpConfigStoreOptions) {
    this.path = join(options.userDataPath, MCP_CONFIG_RELATIVE_PATH)
    this.operations = options.operations
    this.secrets = options.secrets ?? createMemoryMcpSecretEnv()
  }

  get configPath(): string {
    return this.path
  }

  async load(): Promise<UserMcpConfigV1> {
    if (this.cache) return this.cache

    const recovered = await readValidatedWithBackup({
      path: this.path,
      validate: isUserMcpConfigDocument,
      operations: this.operations
    })

    if (recovered.value) {
      // Re-fingerprint to keep CAS token aligned with content.
      const normalized = withFingerprint(recovered.value)
      this.cache = normalized
      return normalized
    }

    // Missing / invalid → empty default (fail-closed, do not half-parse).
    const empty = defaultUserMcpConfig()
    this.cache = empty
    return empty
  }

  async getPublic(): Promise<McpGetConfigResult> {
    try {
      const config = await this.load()
      return { ok: true, config: toPublicMcpConfig(config) }
    } catch {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config)
      }
    }
  }

  /**
   * Live settings getter: always reads the current store (cache/disk), never a
   * frozen turn-level snapshot. Secret-free public projection only.
   */
  async getMcpSettings(): Promise<McpGetConfigResult> {
    return this.getPublic()
  }

  /**
   * CAS write via pure id-level ops reduction. Concurrent Settings updates that
   * touch different server ids compose when each load-then-applyOps against the
   * latest fingerprint (whole-document clobber is avoided at the merge layer).
   */
  async applyOps(
    ops: readonly McpSettingsOp[],
    expectedFingerprint: string,
    secretChanges?: McpSecretInputChanges
  ): Promise<McpConfigUpdateResult> {
    const current = await this.load()
    const currentFp = current.fingerprint ?? fingerprintUserMcpConfig(current)
    if (!expectedFingerprint || expectedFingerprint !== currentFp) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_cas_conflict,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_cas_conflict)
      }
    }

    const applied = applyMcpOps(current, ops)
    if (!applied.ok) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: `${mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config)} ${applied.reason}`
      }
    }

    const { fingerprint: _fp, ...document } = applied.config
    return this.update(document, expectedFingerprint, secretChanges)
  }

  /**
   * CAS write: expectedFingerprint must match current; otherwise mcp_cas_conflict.
   * Secret refs / plain env for unchanged server ids are merged from disk when
   * the incoming document omits them (renderer public view).
   */
  async update(
    nextDocument: unknown,
    expectedFingerprint: string,
    secretChanges?: McpSecretInputChanges
  ): Promise<McpConfigUpdateResult> {
    const current = await this.load()
    const currentFp = current.fingerprint ?? fingerprintUserMcpConfig(current)
    if (!expectedFingerprint || expectedFingerprint !== currentFp) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_cas_conflict,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_cas_conflict)
      }
    }

    const parsed = parseUserMcpConfig(nextDocument)
    if (!parsed.ok) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: `${mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config)} ${parsed.reason}`
      }
    }

    let materialized: ReturnType<typeof materializeMcpServerSecrets> | null = null
    try {
      materialized = materializeMcpServerSecrets({
        nextServers: parsed.config.servers,
        previousServers: current.servers,
        secretChanges,
        secrets: this.secrets
      })
      // New encrypted refs must be durable before config starts referencing them.
      await this.secrets.flush?.()
    } catch (error) {
      if (materialized) {
        for (const refId of materialized.createdRefs) this.secrets.forget(refId)
        await this.secrets.flush?.().catch(() => undefined)
      }
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: `${mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config)} ${error instanceof Error ? error.message : String(error)}`
      }
    }
    if (!materialized) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config)
      }
    }
    const stamped = withFingerprint({
      schemaVersion: parsed.config.schemaVersion,
      enabled: parsed.config.enabled,
      servers: materialized.servers
    })
    try {
      await replaceWithBackup({
        path: this.path,
        content: `${JSON.stringify(stamped, null, 2)}\n`,
        validate: isUserMcpConfigDocument,
        mode: 0o600,
        operations: this.operations
      })
    } catch {
      for (const refId of materialized.createdRefs) this.secrets.forget(refId)
      await this.secrets.flush?.().catch(() => undefined)
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config)
      }
    }

    this.cache = stamped
    for (const refId of materialized.refsToForget) this.secrets.forget(refId)
    await this.secrets.flush?.().catch(() => undefined)
    return { ok: true, config: toPublicMcpConfig(stamped) }
  }

  /** Replace cache after external mutation (tests / session manager). */
  invalidateCache(): void {
    this.cache = null
  }

  /** Test helper: set in-memory config without disk. */
  seedForTests(config: UserMcpConfigV1): void {
    this.cache = withFingerprint(config)
  }
}

function withFingerprint(config: UserMcpConfigV1): UserMcpConfigV1 {
  const { fingerprint: _ignored, ...rest } = config
  const fingerprint = fingerprintUserMcpConfig(rest)
  return { ...rest, fingerprint }
}

export function parseMcpConfigOrDefault(input: unknown): UserMcpConfigV1 {
  const parsed: ParseMcpConfigResult = parseUserMcpConfig(input)
  return parsed.ok ? withFingerprint(parsed.config) : defaultUserMcpConfig()
}
