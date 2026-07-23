/**
 * Process-local, bounded OAuth pending-state store. It intentionally has no
 * persistence, logging, IPC, or token/callback URL projection.
 */

import {
  isValidMcpOAuthPkceVerifier,
  isValidMcpOAuthState,
  mcpOAuthStateEquals
} from './oauth-pkce'

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 32
const MAX_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 128
const SERVER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export type McpOAuthPendingAuthorization = Readonly<{
  serverId: string
  state: string
  verifier: string
}>

export type McpOAuthPendingStateStoreOptions = Readonly<{
  now?: () => number
  ttlMs?: number
  maxEntries?: number
}>

export class McpOAuthPendingStateStoreError extends Error {
  readonly code: 'invalid_pending_state' | 'pending_state_capacity'

  constructor(code: 'invalid_pending_state' | 'pending_state_capacity') {
    super(code)
    this.name = 'McpOAuthPendingStateStoreError'
    this.code = code
  }
}

type StoredPendingAuthorization = McpOAuthPendingAuthorization & Readonly<{ expiresAt: number }>

/**
 * One-time use state correlation. Capacity exhaustion rejects a new attempt
 * instead of evicting an in-flight authorization silently.
 */
export class McpOAuthPendingStateStore {
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly entries = new Map<string, StoredPendingAuthorization>()

  constructor(options: McpOAuthPendingStateStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = boundedPositiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, 1, MAX_TTL_MS)
    this.maxEntries = boundedPositiveInteger(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 1, MAX_ENTRIES)
  }

  issue(input: McpOAuthPendingAuthorization): void {
    if (!isValidServerId(input.serverId) || !isValidMcpOAuthState(input.state) || !isValidMcpOAuthPkceVerifier(input.verifier)) {
      throw new McpOAuthPendingStateStoreError('invalid_pending_state')
    }

    this.purgeExpired()
    if (this.entries.size >= this.maxEntries) {
      throw new McpOAuthPendingStateStoreError('pending_state_capacity')
    }
    if (this.findMatchingState(input.state)) {
      throw new McpOAuthPendingStateStoreError('invalid_pending_state')
    }

    this.entries.set(input.state, Object.freeze({ ...input, expiresAt: this.now() + this.ttlMs }))
  }

  /** Atomically consumes a valid state. Missing, expired, or malformed values return null. */
  consume(state: unknown): McpOAuthPendingAuthorization | null {
    if (!isValidMcpOAuthState(state)) return null
    const stored = this.findMatchingState(state)
    if (!stored) return null

    this.entries.delete(stored.state)
    if (stored.expiresAt <= this.now()) return null
    return Object.freeze({ serverId: stored.serverId, state: stored.state, verifier: stored.verifier })
  }

  /** Explicitly abandons an attempt without revealing whether a state existed. */
  discard(state: unknown): void {
    if (!isValidMcpOAuthState(state)) return
    const stored = this.findMatchingState(state)
    if (stored) this.entries.delete(stored.state)
  }

  purgeExpired(): number {
    const now = this.now()
    let removed = 0
    for (const [state, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(state)
        removed += 1
      }
    }
    return removed
  }

  get size(): number {
    this.purgeExpired()
    return this.entries.size
  }

  private findMatchingState(state: string): StoredPendingAuthorization | null {
    // Keep comparison timing independent of the matching prefix. The store is
    // deliberately tiny and bounded, so scanning is acceptable.
    let match: StoredPendingAuthorization | null = null
    for (const entry of this.entries.values()) {
      if (mcpOAuthStateEquals(entry.state, state)) match = entry
    }
    return match
  }
}

function boundedPositiveInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new McpOAuthPendingStateStoreError('invalid_pending_state')
  }
  return value
}

function isValidServerId(value: unknown): value is string {
  return typeof value === 'string' && SERVER_ID_RE.test(value)
}
