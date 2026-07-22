/**
 * Composition-root MCP host: config store + session manager (ADR-0128).
 * Default-off; no auto-connect until snapshot/test is requested.
 */

import { McpConfigStore } from './config-store'
import {
  createMemoryMcpSecretEnv,
  createSafeStorageMcpSecretEnv,
  type McpSecretEnvResolver,
  type McpSecretStorage
} from './secret-env'
import { McpSessionManager } from './session-manager'
import { staticTeachingToolNameSet } from '../../shared/mcp/static-tool-names'
import type {
  McpConfigUpdateResult,
  McpGetConfigResult,
  McpRuntimeServerView,
  McpTestServerResult,
  UserMcpConfigV1
} from '../../shared/mcp/types'

export type McpHostOptions = {
  userDataPath: string
  secretStorage?: McpSecretStorage | null
  /** Test-only secret resolver override. */
  secrets?: McpSecretEnvResolver
  /** Test-only session manager options. */
  sessionManager?: McpSessionManager
}

export class McpHost {
  readonly configStore: McpConfigStore
  readonly sessionManager: McpSessionManager
  private readonly secrets: McpSecretEnvResolver
  private readonly encryptedIndex = new Map<string, string>()
  private disposed = false

  constructor(options: McpHostOptions) {
    this.configStore = new McpConfigStore({ userDataPath: options.userDataPath })
    this.secrets =
      options.secrets ??
      (options.secretStorage
        ? createSafeStorageMcpSecretEnv({
            storage: options.secretStorage,
            encryptedIndex: this.encryptedIndex
          })
        : createMemoryMcpSecretEnv())
    this.sessionManager =
      options.sessionManager ??
      new McpSessionManager({
        secrets: this.secrets,
        staticToolNames: staticTeachingToolNameSet()
      })
  }

  async start(): Promise<void> {
    const config = await this.configStore.load()
    await this.sessionManager.applyConfig(config)
  }

  async getPublicConfig(): Promise<McpGetConfigResult> {
    return this.configStore.getPublic()
  }

  async updateConfig(
    nextDocument: unknown,
    expectedFingerprint: string
  ): Promise<McpConfigUpdateResult> {
    const result = await this.configStore.update(nextDocument, expectedFingerprint)
    if (result.ok) {
      const full = await this.configStore.load()
      await this.sessionManager.applyConfig(full)
    }
    return result
  }

  async testServer(serverId: string): Promise<McpTestServerResult> {
    // Ensure latest config is applied before test.
    const config = await this.configStore.load()
    await this.sessionManager.applyConfig(config)
    return this.sessionManager.testServer(serverId)
  }

  listRuntime(): readonly McpRuntimeServerView[] {
    return this.sessionManager.getRuntimeView()
  }

  /** Expose manager for agent-run registry inject. */
  getSessionManager(): McpSessionManager {
    return this.sessionManager
  }

  async reloadFromDisk(): Promise<UserMcpConfigV1> {
    this.configStore.invalidateCache()
    const config = await this.configStore.load()
    await this.sessionManager.applyConfig(config)
    return config
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.sessionManager.dispose()
  }
}