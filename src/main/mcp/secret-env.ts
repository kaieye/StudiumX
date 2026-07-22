/**
 * MCP secret env / header bridge (ADR-0128 §3.1 / §4.3).
 * Secrets never enter logs; config only stores secret ref ids.
 */

export type McpSecretStorage = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

const SAFE_STORAGE_PREFIX = 'mcpSecret:v1:'

export type McpSecretEnvResolver = {
  /** Resolve a secret ref id to plaintext, or null if missing. */
  resolve(refId: string): string | null
  /** Persist plaintext under a new or existing ref id; returns ref id. */
  store(refId: string | null, plaintext: string): string
  /** Drop a ref (best-effort). */
  forget(refId: string): void
}

/**
 * In-memory secret map for unit tests (no Electron safeStorage).
 */
export function createMemoryMcpSecretEnv(): McpSecretEnvResolver & {
  readonly map: Map<string, string>
} {
  const map = new Map<string, string>()
  let seq = 0
  return {
    map,
    resolve(refId: string) {
      return map.get(refId) ?? null
    },
    store(refId: string | null, plaintext: string) {
      const id = refId && refId.trim() ? refId.trim() : `ref_${++seq}`
      map.set(id, plaintext)
      return id
    },
    forget(refId: string) {
      map.delete(refId)
    }
  }
}

/**
 * safeStorage-backed resolver using a small JSON index file content holder.
 * Caller owns durable index; this only encrypts/decrypts values in memory map.
 */
export function createSafeStorageMcpSecretEnv(options: {
  storage: McpSecretStorage
  /** Mutable map refId → encrypted base64 (loaded/saved by config-store side). */
  encryptedIndex: Map<string, string>
}): McpSecretEnvResolver {
  let seq = 0
  return {
    resolve(refId: string) {
      if (!options.storage.isEncryptionAvailable()) return null
      const packed = options.encryptedIndex.get(refId)
      if (!packed || !packed.startsWith(SAFE_STORAGE_PREFIX)) return null
      try {
        const b64 = packed.slice(SAFE_STORAGE_PREFIX.length)
        return options.storage.decryptString(Buffer.from(b64, 'base64'))
      } catch {
        return null
      }
    },
    store(refId: string | null, plaintext: string) {
      const id = refId && refId.trim() ? refId.trim() : `mcp_sec_${Date.now()}_${++seq}`
      if (!options.storage.isEncryptionAvailable()) {
        // Fail closed: still allocate id but store empty so unresolved fails later.
        options.encryptedIndex.set(id, '')
        return id
      }
      const encrypted = options.storage.encryptString(plaintext).toString('base64')
      options.encryptedIndex.set(id, `${SAFE_STORAGE_PREFIX}${encrypted}`)
      return id
    },
    forget(refId: string) {
      options.encryptedIndex.delete(refId)
    }
  }
}

/** Platform-minimal env inheritance for MCP child processes. */
const INHERITED_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMP',
  'TEMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'ComSpec',
  'COMSPEC',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS'
] as const

/**
 * Build sanitized env for spawn: minimal inherit + envPlain + resolved secrets.
 * Never injects provider API keys or ELECTRON_* debug flags by default.
 */
export function buildSanitizedMcpEnv(input: {
  envPlain: Readonly<Record<string, string>>
  envSecretRefs: Readonly<Record<string, string>>
  secrets: McpSecretEnvResolver
  processEnv?: NodeJS.ProcessEnv
}):
  | { ok: true; env: Record<string, string> }
  | { ok: false; unresolvedKey: string } {
  const base = input.processEnv ?? process.env
  const env: Record<string, string> = {}

  for (const key of INHERITED_ENV_KEYS) {
    const value = base[key]
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }

  for (const [key, value] of Object.entries(input.envPlain)) {
    env[key] = value
  }

  for (const [key, refId] of Object.entries(input.envSecretRefs)) {
    const resolved = input.secrets.resolve(refId)
    if (resolved == null) {
      return { ok: false, unresolvedKey: key }
    }
    env[key] = resolved
  }

  return { ok: true, env }
}
