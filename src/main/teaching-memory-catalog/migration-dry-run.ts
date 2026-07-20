import { randomUUID } from 'node:crypto'
import type {
  TeachingMemoryLegacyMigrationDryRunAccessClass,
  TeachingMemoryLegacyMigrationDryRunDisposition,
  TeachingMemoryLegacyMigrationDryRunIntentPreview,
  TeachingMemoryLegacyMigrationDryRunReceiptPreview,
  TeachingMemoryLegacyMigrationPreflight
} from '../../shared/teaching-types'
import type {
  TeachingMemoryAccess,
  TeachingMemoryCatalog
} from '../teaching-memory-catalog'

const DEFAULT_TTL_MS = 60_000
const AUTHORIZATION_CLASS = 'readonly_preview_only' as const

type PrivateIntent = {
  intentId: string
  createdAtMs: number
  expiresAtMs: number
  access?: TeachingMemoryAccess
  accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass
  disposition: TeachingMemoryLegacyMigrationDryRunDisposition
  preflight: TeachingMemoryLegacyMigrationPreflight
}

type DryRunClock = {
  nowMs: () => number
  idGenerator?: () => string
  ttlMs?: number
}

/**
 * Main-only readonly dry-run intent/receipt preview for legacy Memory migration.
 *
 * This coordinator never copies, holds, publishes, or deletes Memory files. A
 * successful preview is not destructive consent, reservation, or retry authority.
 * Request input is fail-closed: only an optional trusted access bag is accepted;
 * path, root, target, checksum, and other privileged locators are rejected.
 */
export class TeachingMemoryLegacyMigrationDryRun {
  private readonly intents = new Map<string, PrivateIntent>()
  private busy = false

  constructor(
    private readonly catalog: TeachingMemoryCatalog,
    private readonly clock: DryRunClock = { nowMs: () => Date.now() }
  ) {}

  /**
   * Creates a short-lived aggregate-only intent after trusted-scope validation
   * and a fresh readonly discovery. Missing Memory roots are not created.
   */
  async previewIntent(request?: unknown): Promise<TeachingMemoryLegacyMigrationDryRunIntentPreview> {
    if (this.busy) return this.busyIntentPreview()
    this.busy = true
    try {
      this.purgeExpired()
      const parsed = parseReadonlyDryRunRequest(request)
      if (!parsed.ok) {
        return this.unauthorizedIntentPreview(parsed.accessClass)
      }

      const snapshot = await this.catalog.diagnosticsSnapshot({ access: parsed.access })
      const disposition = dispositionFromPreflight(snapshot.legacyMigrationPreflight, 'intent')
      const nowMs = this.clock.nowMs()
      const ttlMs = this.clock.ttlMs ?? DEFAULT_TTL_MS
      const intentId = this.clock.idGenerator?.() ?? randomUUID()
      const intent: PrivateIntent = {
        intentId,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + ttlMs,
        access: parsed.access,
        accessClass: parsed.accessClass,
        disposition,
        preflight: snapshot.legacyMigrationPreflight
      }
      this.intents.set(intentId, intent)
      return toIntentPreview(intent)
    } finally {
      this.busy = false
    }
  }

  /**
   * Completes a dry-run intent into an aggregate-only receipt preview after a
   * fresh readonly discovery. Never mutates Memory and never authorizes
   * destructive migration. Expired or unknown intents fail closed.
   */
  async completeReceipt(intentId: string): Promise<TeachingMemoryLegacyMigrationDryRunReceiptPreview> {
    if (this.busy) {
      return {
        intentId: typeof intentId === 'string' ? intentId : '',
        createdAt: new Date(this.clock.nowMs()).toISOString(),
        completedAt: new Date(this.clock.nowMs()).toISOString(),
        authorizationClass: AUTHORIZATION_CLASS,
        accessClass: 'catalog',
        disposition: 'busy',
        preflight: emptyPreflight(),
        destructiveAuthorized: false,
        memoryMutated: false
      }
    }
    this.busy = true
    try {
      this.purgeExpired()
      const normalizedId = typeof intentId === 'string' ? intentId.trim() : ''
      const intent = normalizedId ? this.intents.get(normalizedId) : undefined
      const nowMs = this.clock.nowMs()
      if (!intent) {
        return {
          intentId: normalizedId,
          createdAt: new Date(nowMs).toISOString(),
          completedAt: new Date(nowMs).toISOString(),
          authorizationClass: AUTHORIZATION_CLASS,
          accessClass: 'catalog',
          disposition: 'expired',
          preflight: emptyPreflight(),
          destructiveAuthorized: false,
          memoryMutated: false
        }
      }
      if (intent.expiresAtMs <= nowMs) {
        this.intents.delete(intent.intentId)
        return {
          intentId: intent.intentId,
          createdAt: new Date(intent.createdAtMs).toISOString(),
          completedAt: new Date(nowMs).toISOString(),
          authorizationClass: AUTHORIZATION_CLASS,
          accessClass: intent.accessClass,
          disposition: 'expired',
          preflight: intent.preflight,
          destructiveAuthorized: false,
          memoryMutated: false
        }
      }

      // Fresh discovery + trusted-scope validation on every receipt preview.
      const snapshot = await this.catalog.diagnosticsSnapshot({ access: intent.access })
      const disposition = dispositionFromPreflight(snapshot.legacyMigrationPreflight, 'receipt')
      this.intents.delete(intent.intentId)
      return {
        intentId: intent.intentId,
        createdAt: new Date(intent.createdAtMs).toISOString(),
        completedAt: new Date(nowMs).toISOString(),
        authorizationClass: AUTHORIZATION_CLASS,
        accessClass: intent.accessClass,
        disposition,
        preflight: snapshot.legacyMigrationPreflight,
        destructiveAuthorized: false,
        memoryMutated: false
      }
    } finally {
      this.busy = false
    }
  }

  /** Intentionally absent: no copy/hold/publish/delete entry points exist on this type. */
  authorizeDestructiveMigration(): never {
    throw new Error('Destructive Memory migration is not authorized. Readonly dry-run intent is not consent.')
  }

  private purgeExpired(): void {
    const nowMs = this.clock.nowMs()
    for (const [id, intent] of this.intents) {
      if (intent.expiresAtMs <= nowMs) this.intents.delete(id)
    }
  }

  private busyIntentPreview(): TeachingMemoryLegacyMigrationDryRunIntentPreview {
    const nowMs = this.clock.nowMs()
    return {
      intentId: '',
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs).toISOString(),
      authorizationClass: AUTHORIZATION_CLASS,
      accessClass: 'catalog',
      disposition: 'busy',
      preflight: emptyPreflight(),
      destructiveAuthorized: false,
      memoryMutated: false
    }
  }

  private unauthorizedIntentPreview(accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass): TeachingMemoryLegacyMigrationDryRunIntentPreview {
    const nowMs = this.clock.nowMs()
    return {
      intentId: '',
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs).toISOString(),
      authorizationClass: AUTHORIZATION_CLASS,
      accessClass,
      disposition: 'not_authorized',
      preflight: emptyPreflight(),
      destructiveAuthorized: false,
      memoryMutated: false
    }
  }
}

function toIntentPreview(intent: PrivateIntent): TeachingMemoryLegacyMigrationDryRunIntentPreview {
  return {
    intentId: intent.intentId,
    createdAt: new Date(intent.createdAtMs).toISOString(),
    expiresAt: new Date(intent.expiresAtMs).toISOString(),
    authorizationClass: AUTHORIZATION_CLASS,
    accessClass: intent.accessClass,
    disposition: intent.disposition,
    preflight: intent.preflight,
    destructiveAuthorized: false,
    memoryMutated: false
  }
}

function dispositionFromPreflight(
  preflight: TeachingMemoryLegacyMigrationPreflight,
  _phase: 'intent' | 'receipt'
): TeachingMemoryLegacyMigrationDryRunDisposition {
  if (preflight.blockedDuplicateCount > 0 || preflight.blockedRecoveryIssueCount > 0) {
    return 'blocked'
  }
  // Ready means eligible work exists under a clean catalog snapshot. Not ready
  // covers empty/already-partitioned catalogs. Neither authorizes destruction.
  if (!preflight.migrationReady) return 'not_ready'
  return 'preview_only'
}

function emptyPreflight(): TeachingMemoryLegacyMigrationPreflight {
  return {
    legacyFlatEligibleCount: 0,
    alreadyPartitionedCount: 0,
    blockedDuplicateCount: 0,
    blockedRecoveryIssueCount: 0,
    migrationReady: false
  }
}

type ParsedRequest =
  | { ok: true; access?: TeachingMemoryAccess; accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass }
  | { ok: false; accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass }

/**
 * Fail closed on any privileged locator or unknown field. Renderer path input
 * is never accepted for dry-run; only main-trusted access roots may be named.
 */
export function parseReadonlyDryRunRequest(request?: unknown): ParsedRequest {
  if (request == null) {
    return { ok: true, accessClass: 'catalog' }
  }
  if (!isPlainObject(request)) {
    return { ok: false, accessClass: 'catalog' }
  }

  const requestKeys = Object.keys(request)
  for (const key of requestKeys) {
    if (key !== 'access') return { ok: false, accessClass: 'catalog' }
  }

  if (!('access' in request) || request.access == null) {
    return { ok: true, accessClass: 'catalog' }
  }
  if (!isPlainObject(request.access)) {
    return { ok: false, accessClass: 'catalog' }
  }

  const accessKeys = Object.keys(request.access)
  for (const key of accessKeys) {
    if (key !== 'workspaceRoot' && key !== 'projectRoot') {
      return { ok: false, accessClass: 'catalog' }
    }
  }

  const workspaceRoot = normalizeOptionalRoot(request.access.workspaceRoot)
  const projectRoot = normalizeOptionalRoot(request.access.projectRoot)
  if (workspaceRoot === 'invalid' || projectRoot === 'invalid') {
    return { ok: false, accessClass: 'catalog' }
  }

  if (!workspaceRoot && !projectRoot) {
    // Empty access bag is not a trusted scope binding.
    return { ok: false, accessClass: 'catalog' }
  }

  const access: TeachingMemoryAccess = {
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(projectRoot ? { projectRoot } : {})
  }
  const accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass = projectRoot ? 'project' : 'workspace'
  return { ok: true, access, accessClass }
}

function normalizeOptionalRoot(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return 'invalid'
  const trimmed = value.trim()
  if (!trimmed) return 'invalid'
  return trimmed
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
