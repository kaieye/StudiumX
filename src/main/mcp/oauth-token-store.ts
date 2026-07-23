/**
 * Main-process-only encrypted OAuth token storage abstraction. The caller owns
 * durable encrypted-index persistence; this module never exposes paths, lists
 * tokens, logs, or creates a renderer/IPC token API.
 */

import { createHash } from 'node:crypto'

const ENCRYPTED_TOKEN_PREFIX = 'mcpOauthToken:v1:'
const SERVER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_TOKEN_LENGTH = 16 * 1024
const MAX_SCOPE_LENGTH = 4096
const TOKEN_TYPE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/

export type McpOAuthTokenCipher = Readonly<{
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}>

/** Main-process-only plaintext returned only to the future authorization/transport owner. */
export type McpOAuthTokenSet = Readonly<{
  accessToken: string
  refreshToken?: string
  tokenType?: string
  expiresAt?: number
  scope?: string
}>

/** Minimal encrypted index needed for a durable host-owned implementation. */
export type McpOAuthEncryptedTokenIndex = Pick<Map<string, string>, 'get' | 'set' | 'delete'>

export type McpOAuthTokenStoreOptions = Readonly<{
  cipher: McpOAuthTokenCipher
  encryptedIndex: McpOAuthEncryptedTokenIndex
}>

export class McpOAuthTokenStoreError extends Error {
  readonly code: 'token_storage_unavailable' | 'invalid_token_set'

  constructor(code: 'token_storage_unavailable' | 'invalid_token_set') {
    super(code)
    this.name = 'McpOAuthTokenStoreError'
    this.code = code
  }
}

/**
 * No public/list API exists by design. `read` is strictly for main-process
 * authorization/session integration and returns null on absent/corrupt data.
 */
export class McpOAuthTokenStore {
  private readonly cipher: McpOAuthTokenCipher
  private readonly encryptedIndex: McpOAuthEncryptedTokenIndex

  constructor(options: McpOAuthTokenStoreOptions) {
    this.cipher = options.cipher
    this.encryptedIndex = options.encryptedIndex
  }

  store(serverId: string, tokenSet: McpOAuthTokenSet): void {
    if (!isValidServerId(serverId) || !isValidTokenSet(tokenSet)) {
      throw new McpOAuthTokenStoreError('invalid_token_set')
    }
    if (!this.cipher.isEncryptionAvailable()) {
      throw new McpOAuthTokenStoreError('token_storage_unavailable')
    }

    try {
      const plaintext = JSON.stringify(toStoredTokenSet(tokenSet))
      const encrypted = this.cipher.encryptString(plaintext)
      this.encryptedIndex.set(storageKey(serverId), `${ENCRYPTED_TOKEN_PREFIX}${encrypted.toString('base64')}`)
    } catch {
      throw new McpOAuthTokenStoreError('token_storage_unavailable')
    }
  }

  /** Main-process-only token lookup. Corrupt/unavailable values are removed and return null. */
  read(serverId: string): McpOAuthTokenSet | null {
    if (!isValidServerId(serverId) || !this.cipher.isEncryptionAvailable()) return null
    const key = storageKey(serverId)
    const packed = this.encryptedIndex.get(key)
    if (!packed || !packed.startsWith(ENCRYPTED_TOKEN_PREFIX)) return null

    try {
      const encoded = packed.slice(ENCRYPTED_TOKEN_PREFIX.length)
      const plaintext = this.cipher.decryptString(Buffer.from(encoded, 'base64'))
      const parsed: unknown = JSON.parse(plaintext)
      if (!isStoredTokenSet(parsed)) throw new Error('invalid token record')
      return Object.freeze({ ...parsed })
    } catch {
      this.encryptedIndex.delete(key)
      return null
    }
  }

  has(serverId: string): boolean {
    return this.read(serverId) !== null
  }

  forget(serverId: string): void {
    if (!isValidServerId(serverId)) return
    this.encryptedIndex.delete(storageKey(serverId))
  }
}

function storageKey(serverId: string): string {
  // Do not persist a user-controlled server id as an index key.
  return `mcp_oauth_${createHash('sha256').update(serverId, 'utf8').digest('hex')}`
}

function toStoredTokenSet(value: McpOAuthTokenSet): McpOAuthTokenSet {
  return {
    accessToken: value.accessToken,
    ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}),
    ...(value.tokenType ? { tokenType: value.tokenType } : {}),
    ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
    ...(value.scope ? { scope: value.scope } : {})
  }
}

function isStoredTokenSet(value: unknown): value is McpOAuthTokenSet {
  return isRecord(value) && isValidTokenSet(value)
}

function isValidTokenSet(value: unknown): value is McpOAuthTokenSet {
  if (!isRecord(value) || !isSecretString(value.accessToken, MAX_TOKEN_LENGTH)) return false
  if (value.refreshToken !== undefined && !isSecretString(value.refreshToken, MAX_TOKEN_LENGTH)) return false
  if (value.tokenType !== undefined && (typeof value.tokenType !== 'string' || !TOKEN_TYPE_RE.test(value.tokenType))) return false
  if (
    value.expiresAt !== undefined &&
    (typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0)
  ) return false
  if (value.scope !== undefined && !isSecretString(value.scope, MAX_SCOPE_LENGTH)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSecretString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)
}

// Intentionally not exported: callers must not derive, enumerate, or resolve
// encrypted index identifiers outside this main-process token-store boundary.

function isValidServerId(value: unknown): value is string {
  return typeof value === 'string' && SERVER_ID_RE.test(value)
}
