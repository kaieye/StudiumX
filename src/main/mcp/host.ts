/**
 * Composition-root MCP host: config store + session manager (ADR-0128).
 * Default-off; no auto-connect until snapshot/test is requested.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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
  McpSecretInputChanges,
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
  private readonly secretIndexPath: string
  private readonly durableSecretIndex: boolean
  private disposed = false

  constructor(options: McpHostOptions) {
    this.secretIndexPath = join(options.userDataPath, 'mcp/secrets.v1.json')
    this.durableSecretIndex = Boolean(!options.secrets && options.secretStorage)
    this.secrets =
      options.secrets ??
      (options.secretStorage
        ? createSafeStorageMcpSecretEnv({
            storage: options.secretStorage,
            encryptedIndex: this.encryptedIndex,
            flush: () => this.writeEncryptedSecretIndex()
          })
        : createMemoryMcpSecretEnv())
    this.configStore = new McpConfigStore({
      userDataPath: options.userDataPath,
      secrets: this.secrets
    })
    this.sessionManager =
      options.sessionManager ??
      new McpSessionManager({
        secrets: this.secrets,
        staticToolNames: staticTeachingToolNameSet()
      })
  }

  async start(): Promise<void> {
    await this.loadEncryptedSecretIndex()
    const config = await this.configStore.load()
    await this.sessionManager.applyConfig(config)
  }

  async getPublicConfig(): Promise<McpGetConfigResult> {
    return this.configStore.getPublic()
  }

  async updateConfig(
    nextDocument: unknown,
    expectedFingerprint: string,
    secretChanges?: McpSecretInputChanges
  ): Promise<McpConfigUpdateResult> {
    const result = await this.configStore.update(nextDocument, expectedFingerprint, secretChanges)
    if (result.ok) {
      const full = await this.configStore.load()
      await this.sessionManager.applyConfig(full)
    }
    return result
  }

  async testServer(serverId: string, workspaceRoot?: string | null): Promise<McpTestServerResult> {
    // Ensure latest config is applied before test.
    const config = await this.configStore.load()
    await this.sessionManager.applyConfig(config)
    return this.sessionManager.testServer(serverId, workspaceRoot ?? undefined)
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

  private async loadEncryptedSecretIndex(): Promise<void> {
    if (!this.durableSecretIndex) return
    try {
      const parsed = JSON.parse(await readFile(this.secretIndexPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const secrets = (parsed as { secrets?: unknown }).secrets
      if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) return
      this.encryptedIndex.clear()
      for (const [refId, packed] of Object.entries(secrets)) {
        if (typeof packed === 'string') this.encryptedIndex.set(refId, packed)
      }
    } catch {
      // Missing/corrupt secret index fails closed: configured refs remain unresolved.
      this.encryptedIndex.clear()
    }
  }

  private async writeEncryptedSecretIndex(): Promise<void> {
    if (!this.durableSecretIndex) return
    await mkdir(dirname(this.secretIndexPath), { recursive: true, mode: 0o700 })
    const tempPath = `${this.secretIndexPath}.tmp-${process.pid}-${Date.now()}`
    const content = `${JSON.stringify({
      schemaVersion: 1,
      secrets: Object.fromEntries([...this.encryptedIndex.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }, null, 2)}\n`
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
      await rename(tempPath, this.secretIndexPath)
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
}
