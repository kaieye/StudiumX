/**
 * Pure MCP marketplace catalog helpers (ADR-0013).
 * No I/O, no network, no secrets in previews.
 */

import type {
  McpMarketplaceCatalogEntryV1,
  McpMarketplaceInstallRecordV1,
  McpMarketplacePermissionsPreviewV1,
  McpMarketplaceRevokeRecordV1
} from './marketplace-types'

const ENTRY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/
/** sha256:<64 hex> or generic algo:hex form */
const PACKAGE_HASH_RE = /^[a-z0-9]{2,16}:[A-Fa-f0-9]{32,128}$/
const MAX_SUMMARY_ITEMS = 32
const MAX_SUMMARY_ITEM_CHARS = 256

export type MarketplaceValidationResult =
  | { ok: true; entry: McpMarketplaceCatalogEntryV1 }
  | { ok: false; reason: string }

export type MarketplaceInstallPreview = Readonly<{
  entryId: string
  displayName: string
  version: string
  packageHash: string
  publisherId: string
  publisherDisplayName: string
  transportHint: string
  effectSummary: readonly string[]
  networkSummary: readonly string[]
  filesystemSummary: readonly string[]
  mayRequestSecrets: boolean
  mayRequestOAuth: boolean
  /**
   * Pin-only path never auto-connects. installAndEnable is a separate explicit API
   * (ADR-0013). Tool approval is never granted by install.
   */
  doesNotAutoConnect: true
  doesNotGrantToolApproval: true
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown, max = MAX_SUMMARY_ITEMS): value is string[] {
  if (!Array.isArray(value) || value.length > max) return false
  return value.every(
    (item) => typeof item === 'string' && item.length > 0 && item.length <= MAX_SUMMARY_ITEM_CHARS
  )
}

function normalizePermissions(
  value: unknown
): McpMarketplacePermissionsPreviewV1 | null {
  if (!isRecord(value)) return null
  if (
    !isStringArray(value.effectSummary) ||
    !isStringArray(value.networkSummary) ||
    !isStringArray(value.filesystemSummary)
  ) {
    return null
  }
  if (typeof value.mayRequestSecrets !== 'boolean') return null
  if (typeof value.mayRequestOAuth !== 'boolean') return null
  return {
    effectSummary: Object.freeze([...value.effectSummary]),
    networkSummary: Object.freeze([...value.networkSummary]),
    filesystemSummary: Object.freeze([...value.filesystemSummary]),
    mayRequestSecrets: value.mayRequestSecrets,
    mayRequestOAuth: value.mayRequestOAuth
  }
}

/**
 * Fail-closed validation for a catalog entry (local or remote, ADR-0013).
 */
export function validateMarketplaceCatalogEntry(value: unknown): MarketplaceValidationResult {
  if (!isRecord(value)) return { ok: false, reason: 'entry_not_object' }

  const entryId = value.entryId
  if (typeof entryId !== 'string' || !ENTRY_ID_RE.test(entryId)) {
    return { ok: false, reason: 'invalid_entry_id' }
  }

  if (!isRecord(value.publisher)) return { ok: false, reason: 'invalid_publisher' }
  const publisherId = value.publisher.id
  const publisherName = value.publisher.displayName
  if (typeof publisherId !== 'string' || !ENTRY_ID_RE.test(publisherId)) {
    return { ok: false, reason: 'invalid_publisher_id' }
  }
  if (typeof publisherName !== 'string' || publisherName.trim().length === 0) {
    return { ok: false, reason: 'invalid_publisher_name' }
  }

  const displayName = value.displayName
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return { ok: false, reason: 'invalid_display_name' }
  }

  const version = value.version
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    return { ok: false, reason: 'invalid_version' }
  }

  const packageHash = value.packageHash
  if (typeof packageHash !== 'string' || !PACKAGE_HASH_RE.test(packageHash)) {
    return { ok: false, reason: 'invalid_package_hash' }
  }

  if (value.sourceKind !== 'local' && value.sourceKind !== 'remote') {
    return { ok: false, reason: 'invalid_source_kind' }
  }
  const sourceKind = value.sourceKind as 'local' | 'remote'

  const transportHint = value.transportHint
  if (
    transportHint !== 'stdio' &&
    transportHint !== 'http' &&
    transportHint !== 'sse' &&
    transportHint !== 'unknown'
  ) {
    return { ok: false, reason: 'invalid_transport_hint' }
  }

  const permissionsPreview = normalizePermissions(value.permissionsPreview)
  if (!permissionsPreview) return { ok: false, reason: 'invalid_permissions_preview' }

  let signature: string | null | undefined
  if (value.signature === undefined || value.signature === null) {
    signature = value.signature === null ? null : undefined
  } else if (typeof value.signature === 'string' && value.signature.length <= 16_384) {
    signature = value.signature
  } else {
    return { ok: false, reason: 'invalid_signature' }
  }

  let localPackageRef: string | null | undefined
  if (value.localPackageRef === undefined || value.localPackageRef === null) {
    localPackageRef = value.localPackageRef === null ? null : undefined
  } else if (
    typeof value.localPackageRef === 'string' &&
    value.localPackageRef.length > 0 &&
    value.localPackageRef.length <= 2048
  ) {
    localPackageRef = value.localPackageRef
  } else {
    return { ok: false, reason: 'invalid_local_package_ref' }
  }

  let installCommand: string | null | undefined
  if (value.installCommand === undefined || value.installCommand === null) {
    installCommand = value.installCommand === null ? null : undefined
  } else if (
    typeof value.installCommand === 'string' &&
    value.installCommand.length > 0 &&
    value.installCommand.length <= 512
  ) {
    installCommand = value.installCommand
  } else {
    return { ok: false, reason: 'invalid_install_command' }
  }

  let installArgs: readonly string[] | null | undefined
  if (value.installArgs === undefined || value.installArgs === null) {
    installArgs = value.installArgs === null ? null : undefined
  } else if (
    Array.isArray(value.installArgs) &&
    value.installArgs.length <= 64 &&
    value.installArgs.every(
      (item) => typeof item === 'string' && item.length > 0 && item.length <= 512
    )
  ) {
    installArgs = Object.freeze([...(value.installArgs as string[])])
  } else {
    return { ok: false, reason: 'invalid_install_args' }
  }

  let installUrl: string | null | undefined
  if (value.installUrl === undefined || value.installUrl === null) {
    installUrl = value.installUrl === null ? null : undefined
  } else if (
    typeof value.installUrl === 'string' &&
    value.installUrl.length > 0 &&
    value.installUrl.length <= 2048 &&
    /^https?:\/\//i.test(value.installUrl)
  ) {
    installUrl = value.installUrl
  } else {
    return { ok: false, reason: 'invalid_install_url' }
  }

  const description =
    value.description === undefined
      ? undefined
      : typeof value.description === 'string' && value.description.length <= 4096
        ? value.description
        : null
  if (description === null) return { ok: false, reason: 'invalid_description' }

  const homepageUrl =
    value.publisher.homepageUrl === undefined || value.publisher.homepageUrl === null
      ? value.publisher.homepageUrl === null
        ? null
        : undefined
      : typeof value.publisher.homepageUrl === 'string'
        ? value.publisher.homepageUrl
        : null
  if (homepageUrl === null && value.publisher.homepageUrl != null) {
    return { ok: false, reason: 'invalid_homepage_url' }
  }

  const entry: McpMarketplaceCatalogEntryV1 = {
    entryId,
    publisher: {
      id: publisherId,
      displayName: publisherName.trim(),
      ...(homepageUrl !== undefined ? { homepageUrl } : {})
    },
    displayName: displayName.trim(),
    ...(description !== undefined ? { description } : {}),
    version,
    packageHash: packageHash.toLowerCase().startsWith('sha256:')
      ? `sha256:${packageHash.slice('sha256:'.length).toLowerCase()}`
      : packageHash,
    ...(signature !== undefined ? { signature } : {}),
    permissionsPreview,
    transportHint,
    sourceKind,
    ...(localPackageRef !== undefined ? { localPackageRef } : {}),
    ...(installCommand !== undefined ? { installCommand } : {}),
    ...(installArgs !== undefined ? { installArgs } : {}),
    ...(installUrl !== undefined ? { installUrl } : {}),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {})
  }

  return { ok: true, entry }
}

/**
 * Validate a remote catalog JSON document (array or `{ entries|catalog: [] }`).
 * Fail-soft: invalid items are skipped.
 */
export function parseRemoteMarketplaceCatalog(
  value: unknown
): { ok: true; entries: readonly McpMarketplaceCatalogEntryV1[] } | { ok: false; reason: string } {
  let rawList: unknown[]
  if (Array.isArray(value)) {
    rawList = value
  } else if (isRecord(value) && Array.isArray(value.entries)) {
    rawList = value.entries
  } else if (isRecord(value) && Array.isArray(value.catalog)) {
    rawList = value.catalog
  } else {
    return { ok: false, reason: 'catalog_not_array' }
  }
  if (rawList.length > 500) return { ok: false, reason: 'catalog_too_large' }
  const entries: McpMarketplaceCatalogEntryV1[] = []
  for (const item of rawList) {
    const coerced =
      isRecord(item) && item.sourceKind == null ? { ...item, sourceKind: 'remote' } : item
    const validated = validateMarketplaceCatalogEntry(coerced)
    if (validated.ok) entries.push(validated.entry)
  }
  return { ok: true, entries }
}

/**
 * Build a pin record from a validated entry. Does not persist or connect.
 */
export function pinMarketplaceVersion(
  entry: McpMarketplaceCatalogEntryV1,
  installedAt: string,
  trustGrant?: McpMarketplaceInstallRecordV1['trustGrant']
): McpMarketplaceInstallRecordV1 {
  return {
    entryId: entry.entryId,
    pinnedVersion: entry.version,
    pinnedHash: entry.packageHash,
    installedAt,
    ...(trustGrant !== undefined ? { trustGrant } : {})
  }
}

/**
 * True when entry id or package hash appears on the revoke list.
 */
export function isMarketplaceEntryRevoked(
  entry: Pick<McpMarketplaceCatalogEntryV1, 'entryId' | 'packageHash'>,
  revocations: readonly McpMarketplaceRevokeRecordV1[]
): boolean {
  for (const rev of revocations) {
    if (rev.entryId && rev.entryId === entry.entryId) return true
    if (rev.packageHash && rev.packageHash === entry.packageHash) return true
  }
  return false
}

/**
 * Secret-free install preview for UI / audit.
 */
export function buildMarketplaceInstallPreview(
  entry: McpMarketplaceCatalogEntryV1
): MarketplaceInstallPreview {
  return {
    entryId: entry.entryId,
    displayName: entry.displayName,
    version: entry.version,
    packageHash: entry.packageHash,
    publisherId: entry.publisher.id,
    publisherDisplayName: entry.publisher.displayName,
    transportHint: entry.transportHint,
    effectSummary: entry.permissionsPreview.effectSummary,
    networkSummary: entry.permissionsPreview.networkSummary,
    filesystemSummary: entry.permissionsPreview.filesystemSummary,
    mayRequestSecrets: entry.permissionsPreview.mayRequestSecrets,
    mayRequestOAuth: entry.permissionsPreview.mayRequestOAuth,
    doesNotAutoConnect: true,
    doesNotGrantToolApproval: true
  }
}

/**
 * Build a UserMcpServer-shaped install draft from a catalog entry (secret-free).
 * Does not grant tool approval. Caller merges into config store.
 */
export function buildUserMcpServerFromMarketplaceEntry(
  entry: McpMarketplaceCatalogEntryV1,
  now: string,
  options?: Readonly<{ workspaceRoot?: string | null }>
):
  | {
      ok: true
      server: {
        id: string
        label: string
        enabled: boolean
        scope: 'user' | 'workspace'
        workspaceRoot: string | null
        transport: 'stdio' | 'http' | 'sse'
        command: string | null
        args: readonly string[]
        cwd: string | null
        envSecretRefs: Readonly<Record<string, string>>
        envPlain: Readonly<Record<string, string>>
        url: string | null
        headersSecretRefs: Readonly<Record<string, string>>
        headersPlain: Readonly<Record<string, string>>
        timeoutMs: number | null
        toolEffectOverrides: Readonly<Record<string, never>>
        oauth: null
        workspaceRootInjection: 'off'
        injectionIdentity: null
        createdAt: string
        updatedAt: string
      }
    }
  | { ok: false; reason: string } {
  const id = entry.entryId
  const label = entry.displayName
  const transport =
    entry.transportHint === 'http' || entry.transportHint === 'sse'
      ? entry.transportHint
      : 'stdio'

  let command: string | null = entry.installCommand ?? null
  let args: readonly string[] = entry.installArgs ?? []
  let url: string | null = entry.installUrl ?? null

  if (transport === 'stdio' && !command && entry.localPackageRef) {
    const ref = entry.localPackageRef.trim()
    if (ref.startsWith('command:')) {
      const rest = ref.slice('command:'.length).trim()
      const parts = rest.split(/\s+/).filter(Boolean)
      command = parts[0] ?? null
      args = parts.slice(1)
    } else if (!ref.includes('://')) {
      command = ref
      args = []
    }
  }
  if ((transport === 'http' || transport === 'sse') && !url && entry.localPackageRef) {
    const ref = entry.localPackageRef.trim()
    if (/^https?:\/\//i.test(ref)) url = ref
  }

  if (transport === 'stdio' && !command) {
    return { ok: false, reason: 'install_missing_command' }
  }
  if ((transport === 'http' || transport === 'sse') && !url) {
    return { ok: false, reason: 'install_missing_url' }
  }

  const workspaceRoot =
    options?.workspaceRoot && options.workspaceRoot.trim()
      ? options.workspaceRoot.trim()
      : null

  return {
    ok: true,
    server: {
      id,
      label,
      enabled: true,
      scope: workspaceRoot ? 'workspace' : 'user',
      workspaceRoot,
      transport,
      command: transport === 'stdio' ? command : null,
      args: transport === 'stdio' ? args : [],
      cwd: null,
      envSecretRefs: {},
      envPlain: {},
      url: transport === 'stdio' ? null : url,
      headersSecretRefs: {},
      headersPlain: {},
      timeoutMs: null,
      toolEffectOverrides: {},
      oauth: null,
      workspaceRootInjection: 'off',
      injectionIdentity: null,
      createdAt: now,
      updatedAt: now
    }
  }
}
