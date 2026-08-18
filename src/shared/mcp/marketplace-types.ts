/**
 * MCP marketplace catalog foundation types (ADR-0013).
 * Optional remote catalog URLs are user/config only — no default phone-home telemetry.
 */

export const MCP_MARKETPLACE_SCHEMA_VERSION = 1 as const

/** Publisher identity as recorded in a local catalog entry (no secrets). */
export type McpMarketplacePublisherV1 = Readonly<{
  id: string
  displayName: string
  /** Optional homepage or documentation URL (display only; not fetched by default). */
  homepageUrl?: string | null
}>

/**
 * Declared permission surface for install preview only.
 * Does not grant effect lattice rights or tool approval.
 */
export type McpMarketplacePermissionsPreviewV1 = Readonly<{
  /** Highest suggested effect class labels for UI (not authorization). */
  effectSummary: readonly string[]
  /** Network endpoints / host patterns claimed by the package (display). */
  networkSummary: readonly string[]
  /** Filesystem access claims (display; not workspace-root grant). */
  filesystemSummary: readonly string[]
  /** Whether the package expects user-supplied secrets / OAuth. */
  mayRequestSecrets: boolean
  /** Whether the package may request OAuth (public config only). */
  mayRequestOAuth: boolean
}>

export type McpMarketplaceTransportHint = 'stdio' | 'http' | 'sse' | 'unknown'

/**
 * One catalog entry (local inject or remote catalog fetch, ADR-0013).
 * Hash/signature fields are recorded for pin/revoke.
 */
export type McpMarketplaceCatalogEntryV1 = Readonly<{
  entryId: string
  publisher: McpMarketplacePublisherV1
  displayName: string
  description?: string
  version: string
  /** Content hash of the installable package (e.g. sha256:<hex>). */
  packageHash: string
  /** Optional detached signature or attestation string (opaque; no secret). */
  signature?: string | null
  permissionsPreview: McpMarketplacePermissionsPreviewV1
  transportHint: McpMarketplaceTransportHint
  sourceKind: 'local' | 'remote'
  /** Optional local path, package id, or command/url install hint (never a secret). */
  localPackageRef?: string | null
  /**
   * Optional install transport fields (secret-free). Used by installAndEnable
   * when building a UserMcpServer. Prefer these over parsing localPackageRef.
   */
  installCommand?: string | null
  installArgs?: readonly string[] | null
  installUrl?: string | null
  createdAt?: string
  updatedAt?: string
}>

/**
 * User-local trust grant for an installed entry. Not tool approval and not connect.
 */
export type McpMarketplaceTrustGrantV1 = Readonly<{
  grantedAt: string
  /** Free-form actor label (e.g. "user"); never a secret. */
  actorLabel?: string
}>

/** Pinned install record. Version is fixed until explicit uninstall/re-pin. */
export type McpMarketplaceInstallRecordV1 = Readonly<{
  entryId: string
  pinnedVersion: string
  pinnedHash: string
  installedAt: string
  trustGrant?: McpMarketplaceTrustGrantV1 | null
}>

export type McpMarketplaceRevokeRecordV1 = Readonly<{
  /** Revoke by catalog entry id and/or package hash. */
  entryId?: string | null
  packageHash?: string | null
  revokedAt: string
  reasonCode: string
  note?: string | null
}>

/** Durable marketplace document under userData (main only). */
export type McpMarketplaceStoreDocumentV1 = Readonly<{
  schemaVersion: typeof MCP_MARKETPLACE_SCHEMA_VERSION
  catalog: readonly McpMarketplaceCatalogEntryV1[]
  installs: readonly McpMarketplaceInstallRecordV1[]
  revocations: readonly McpMarketplaceRevokeRecordV1[]
  /** When true, all marketplace installs are treated as disabled. */
  emergencyDisabled: boolean
  /**
   * Optional remote catalog source URLs (ADR-0013). Default empty — no network.
   * Fetch is fail-soft; never used for product telemetry.
   */
  catalogUrls?: readonly string[]
  updatedAt?: string
}>

/** Secret-free list projection for renderer marketplace UI. */
export type McpMarketplaceListResultV1 = Readonly<{
  ok: true
  catalog: readonly McpMarketplaceCatalogEntryV1[]
  installs: readonly McpMarketplaceInstallRecordV1[]
  emergencyDisabled: boolean
  catalogUrls: readonly string[]
}>

export type McpMarketplaceInstallResultV1 =
  | Readonly<{
      ok: true
      install: McpMarketplaceInstallRecordV1
      serverId: string
      connected?: boolean
      connectError?: string
    }>
  | Readonly<{ ok: false; code: string; message: string }>

export type McpMarketplaceUninstallResultV1 =
  | Readonly<{ ok: true; entryId: string }>
  | Readonly<{ ok: false; code: string; message: string }>

export function emptyMarketplaceStoreDocument(
  now?: string
): McpMarketplaceStoreDocumentV1 {
  return {
    schemaVersion: MCP_MARKETPLACE_SCHEMA_VERSION,
    catalog: [],
    installs: [],
    revocations: [],
    emergencyDisabled: false,
    catalogUrls: [],
    ...(now ? { updatedAt: now } : {})
  }
}
