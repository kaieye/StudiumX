/**
 * Local-only observability primitives (ADOPTION B-11 / ADR-0066 / ADR-0093).
 *
 * - Turn/tool correlation ids (process-local, no network)
 * - Crash marker file for next-start doctor visibility
 * - Fail-closed redaction helpers for export / support strings
 * - Multi-collector pure TeachingDoctor facts assemble + product run
 * - Config settings facts collector (fail-soft)
 * - Catalog drift facts collector (fail-soft; active workspace plan)
 * - Session/outcome crash-window scan facts collector (fail-soft; one scan)
 * - Source-gap facts collector (fail-soft; workspace summary projection)
 *
 * Non-claims: no OTEL, Statsig, Mixpanel, auto-upload, or default remote telemetry.
 */

export {
  createTurnContext,
  formatTurnId,
  isToolSpanId,
  isTurnId,
  type CreateTurnContextInput,
  type ToolSpanContext,
  type TurnContext
} from './turn-context'

export {
  CRASH_MARKER_FILE_NAME,
  CRASH_MARKER_REASON_CODES,
  CRASH_MARKER_SCHEMA_VERSION,
  CRASH_MARKER_SUBDIR,
  buildCrashMarker,
  createCrashMarkerStore,
  installLocalCrashMarkerHooks,
  parseCrashMarker,
  type CrashMarker,
  type CrashMarkerReasonCode,
  type CrashMarkerStore,
  type CrashMarkerStoreOptions,
  type CrashMarkerWriteInput
} from './crash-marker'

export {
  REDACTED_ABSOLUTE_PATH,
  REDACTED_SECRET,
  redactExportString,
  redactPath,
  redactSecrets
} from './redact'

export { LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL } from './bootstrap-residual'


export {
  collectProcessCrashMarkerFacts,
  toProcessCrashMarkerFacts
} from './process-crash-marker-facts'

export {
  assembleTeachingDoctorFacts,
  staticTeachingDoctorFactsCollector,
  type AssembleTeachingDoctorFactsInput,
  type TeachingDoctorFactsCollector
} from './teaching-doctor-facts-assemble'

export {
  runProductTeachingDoctor,
  type ProductTeachingDoctorCrashMarkerStore,
  type ProductTeachingDoctorDeps,
  type RunProductTeachingDoctorInput
} from './teaching-doctor-product-run'

export {
  TEACHING_DOCTOR_CONFIG_PATH_LABEL,
  createTeachingDoctorConfigFactsCollector,
  type CreateTeachingDoctorConfigFactsCollectorOptions,
  type TeachingDoctorConfigFactsSource
} from './teaching-doctor-config-facts'

export {
  TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP,
  createTeachingDoctorCatalogDriftFactsCollector,
  mapPlanToCatalogDriftFacts,
  type TeachingDoctorCatalogDriftPlan,
  type TeachingDoctorCatalogFactsSource
} from './teaching-doctor-catalog-facts'

export {
  TEACHING_DOCTOR_SESSION_DIAGNOSTIC_CODE_HARD_CAP,
  createTeachingDoctorSessionOutcomeScanFactsCollector,
  mapScanToOutcomeCrashWindowFacts,
  mapScanToSessionCrashWindowFacts,
  type LearningSessionScanResultLike,
  type TeachingDoctorSessionScanSource
} from './teaching-doctor-session-outcome-facts'

export {
  TEACHING_DOCTOR_SOURCE_GAP_CODE_HARD_CAP,
  createTeachingDoctorSourceGapFactsCollector,
  mapWorkspaceSummaryToSourceGapFacts,
  type TeachingDoctorSourceGapFactsSource,
  type TeachingDoctorSourceGapWorkspaceSummary
} from './teaching-doctor-source-gap-facts'

export {
  TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL,
  createTeachingDoctorMcpFactsCollector,
  mapMcpFacts,
  type CreateTeachingDoctorMcpFactsCollectorOptions,
  type TeachingDoctorMcpFactsSource
} from './teaching-doctor-mcp-facts'

