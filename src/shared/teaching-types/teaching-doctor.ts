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
  /** Local process crash marker from prior abnormal exit (collector I/O). */
  processCrashMarker?: TeachingDoctorProcessCrashMarkerFacts | null
}

/**
 * Product IPC payload for \unTeachingDoctor\ (ADR-0084).
 * Fail-closed: only optional includeProcessCrashMarker; no free-form facts from renderer.
 */
export type RunTeachingDoctorPayload = {
  /** When true (default), collect local process crash marker facts from main store. */
  includeProcessCrashMarker?: boolean
}
