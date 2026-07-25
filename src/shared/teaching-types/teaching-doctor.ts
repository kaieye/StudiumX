export const TEACHING_DOCTOR_SCHEMA_VERSION = 1 as const

export type TeachingDoctorSchemaVersion = typeof TEACHING_DOCTOR_SCHEMA_VERSION

/** Stable check IDs for structured TeachingDoctor reports. */
export type TeachingDoctorCheckId =
  | 'p0_session_event_manifest_crash_window'
  | 'p0_outcome_publication_crash_window'
  | 'config_availability'
  | 'source_gap'
  | 'catalog_drift'
  | 'local_process_crash_marker'
  | 'local_data_index'
  | 'mcp_status'

/**
 * Check result ladder. `error` means the check itself failed to execute; that
 * must never block a read-only workspace open (see workspaceOpenPolicy).
 */
export type TeachingDoctorCheckResult = 'ok' | 'warning' | 'fail' | 'skipped' | 'error'

/** Repair is a separate effect from diagnosis; v1 never auto-executes repairs. */
export type TeachingDoctorRepairKind =
  | 'none'
  | 'deterministic_projection_rebuild'
  | 'manual_review'

export type TeachingDoctorSafeEvidence = {
  /** Bounded, redacted key/value pairs safe for export and support. */
  fields: Readonly<Record<string, string | number | boolean | null>>
  notes: readonly string[]
}

export type TeachingDoctorRepairRecommendation = {
  kind: TeachingDoctorRepairKind
  description: string
  /** v1 always false — repair is never an automatic side effect of run(). */
  autoRepairAllowed: false
}

/**
 * Structured fix suggestion for UI / diagnosing skills.
 * Paths are locator labels or relative/redacted configuration paths — never secrets.
 */
export type TeachingDoctorFixSuggestion = {
  /** Stable machine code for agents and UI cards. */
  code: string
  title: string
  steps: readonly string[]
  /** Configuration locator (logical path or settings key), never a secret value. */
  configPath?: string | null
  /** Optional documentation or diagnosing-skill id. */
  docsRef?: string | null
}

export type TeachingDoctorCheckItem = {
  checkId: TeachingDoctorCheckId
  result: TeachingDoctorCheckResult
  summary: string
  evidence: TeachingDoctorSafeEvidence
  recommendedAction: string
  repair: TeachingDoctorRepairRecommendation
  /** Optional structured fix for UI / diagnosing skills (manual only). */
  fixSuggestion?: TeachingDoctorFixSuggestion | null
  /** Optional configuration locator for this check (logical / redacted). */
  configPath?: string | null
}

export type TeachingDoctorReport = {
  schemaVersion: TeachingDoctorSchemaVersion
  generatedAt: string
  overallStatus: TeachingDoctorCheckResult
  /**
   * Doctor is advisory. Even when overallStatus is fail/error, callers must
   * still allow a read-only workspace open.
   */
  workspaceOpenPolicy: 'read_only_allowed'
  mode: 'read_only'
  checks: readonly TeachingDoctorCheckItem[]
  diagnostics: {
    redaction: string
    autoRepair: 'disabled'
  }
}

/** Pure facts consumed by TeachingDoctor.run — collectors own I/O. */
export type TeachingDoctorSessionCrashWindowFacts = {
  pendingStageCount: number
  unsafeStageCount: number
  quarantinedSessionCount: number
  recoveryCount: number
  diagnosticCodes: readonly string[]
  /** Sessions where immutable events outrun the repaired manifest projection. */
  eventManifestGapCount: number
}

export type TeachingDoctorOutcomeCrashWindowFacts = {
  pendingSettlementCount: number
  needsProjectionRepairCount: number
  reviewRequiredCount: number
  settledCount: number
}

export type TeachingDoctorConfigFacts = {
  settingsAvailable: boolean
  settingsReadable: boolean
  settingsParseable: boolean
  providerConfigured: boolean
  reason: string | null
  /**
   * Logical configuration locator for doctor UI / diagnosing skills.
   * Prefer a redacted or relative label (e.g. `userData/studiumx-settings.json`)
   * rather than an absolute home path.
   */
  configPath?: string | null
  /** Optional settings schema/key path when known (e.g. `provider.apiKey`). */
  configKey?: string | null
  /**
   * Optional agent sandbox readiness (ADR-0153 Stage E).
   * Same source as runtime resolveAgentSandboxReadiness — non-secret only.
   */
  agentSandboxMode?: string
  agentSandboxBackend?: string
  agentSandboxOsEnforcementAvailable?: boolean
  /** Human-readable, bounded, non-secret readiness summary. */
  agentSandboxSummary?: string
  /** Windows only: ready | notConfigured | updateRequired */
  agentSandboxWindowsReadiness?: string
}

export type TeachingDoctorSourceGapFacts = {
  status: 'ready' | 'degraded' | 'unavailable' | 'unknown' | 'not_configured'
  availableSourceCount: number
  exclusionCodes: readonly string[]
  gapCount: number
}

export type TeachingDoctorCatalogDriftFacts = {
  requiresPersist: boolean
  recoveredCount: number
  removedCount: number
  /** Relative paths only — never absolute user home paths in evidence. */
  recoveredRelativePaths: readonly string[]
  removedRelativePaths: readonly string[]
}

/**
 * Aggregate-only LocalDataIndex diagnostics for TeachingDoctor.
 * Absolute host paths must not appear in user-facing evidence; use logical labels.
 */
export type TeachingDoctorLocalDataIndexFacts = {
  /** Whether the disposable projection file exists on disk. */
  pathExists: boolean
  /** Logical locator only (e.g. userData/studiumx-index.sqlite) — never absolute home path. */
  indexPathLabel?: string | null
  status: 'ready' | 'building' | 'incomplete' | 'unavailable' | 'closed'
  reason: string | null
  complete: boolean | null
  rebuiltAt: string | null
  /** Applied migration ids only (no SQL bodies). */
  migrationIds: readonly string[]
  /** Issue counts by stable code (source_drift / read_failed / …). */
  issueCountsByCode: Readonly<Record<string, number>>
  /** DB-OPT-4: usage ledger segment / invalid counters (aggregate-only). */
  usage?: {
    segmentFileCount: number
    projectedEntryCount: number
    invalidRowCount: number
    invalidRowIssueCount?: number
    readFailedIssueCount?: number
  } | null
}


/** Aggregate-only MCP diagnostics — no command/args secrets or secret values. */
export type TeachingDoctorMcpServerFacts = {
  id: string
  enabled: boolean
  transport: string
  state: string
  toolCount?: number | null
  errorCode?: string | null
  /** Redacted command label only (never secret env). */
  commandLabel?: string | null
  /**
   * Aggregate inventory counters only (no tool names/schemas).
   * Optional for backward compatibility with older fact collectors.
   */
  inventory?: {
    discoveredToolCount: number
    registeredToolCount: number
    rejectedToolCount: number
    stale: boolean
  } | null
  /**
   * Secret-free OAuth lifecycle category only (`authorization_required` | …).
   * Never includes tokens, codes, endpoints, or error detail text.
   */
  authorizationState?: string | null
}

export type TeachingDoctorMcpFacts = {
  /** Feature / implementation present in this build. */
  implementationPresent: boolean
  rootEnabled: boolean
  /** Opt-in discovery auto-connect (ADR-0137); never implies tool approval. */
  autoConnectEnabled?: boolean
  serverCount: number
  enabledServerCount: number
  connectedServerCount: number
  errorServerCount: number
  servers: readonly TeachingDoctorMcpServerFacts[]
  /** Logical locator only. */
  configPathLabel?: string | null
  /** Local marketplace emergency kill-switch (ADR-0140); no catalog payload. */
  marketplaceEmergencyDisabled?: boolean
  /**
   * Distinct multi-source origin kinds represented among effective winners
   * (ADR-0137). Aggregate only — no paths or server payloads.
   */
  effectiveSourceCount?: number
  /** Count of non-secret multi-source load/parse warnings (aggregate only). */
  sourceWarningCount?: number
}

export type TeachingDoctorProcessCrashMarkerFacts = {
  /** True when a valid crash marker was found under appData observability. */
  present: boolean
  /** ISO-8601 write time from marker, if present. */
  writtenAt?: string | null
  /** Closed reason code from marker (opaque). */
  reasonCode?: string | null
  /** Optional opaque run id from marker. */
  runId?: string | null
}

export type TeachingDoctorFacts = {
  sessionCrashWindow?: TeachingDoctorSessionCrashWindowFacts | null
  outcomeCrashWindow?: TeachingDoctorOutcomeCrashWindowFacts | null
  config?: TeachingDoctorConfigFacts | null
  sourceGap?: TeachingDoctorSourceGapFacts | null
  catalogDrift?: TeachingDoctorCatalogDriftFacts | null
  localDataIndex?: TeachingDoctorLocalDataIndexFacts | null
  /** Local process crash marker from prior abnormal exit (collector I/O). */
  processCrashMarker?: TeachingDoctorProcessCrashMarkerFacts | null
  /** User MCP status (default-off; redacted). */
  mcp?: TeachingDoctorMcpFacts | null
}

/**
 * Product IPC payload for `runTeachingDoctor` (ADR-0084).
 * Fail-closed: only optional includeProcessCrashMarker; no free-form facts from renderer.
 */
export type RunTeachingDoctorPayload = {
  /** When true (default), collect local process crash marker facts from main store. */
  includeProcessCrashMarker?: boolean
}
