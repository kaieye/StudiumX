/**
 * User-previewable, consent-gated support bundle export (P2-8).
 *
 * Assembles optional diagnostics (doctor, inspector, config fingerprint,
 * capability counts, audit correlation, environment, MCP status) into a redacted preview.
 * Export requires explicit consent and only includes sections that appear in
 * both the preview and the consent allowlist. Never auto-uploads.
 */

import type { TeachingDoctorReport } from '../shared/teaching-types/teaching-doctor'
import type {
  SkillOrchestrationEvaluationSummary,
  SkillOrchestrationStageKind
} from '../shared/teaching-types/skill-orchestration'
import {
  DEFAULT_SUPPORT_BUNDLE_REDACTION_POLICY,
  SUPPORT_BUNDLE_SCHEMA_VERSION,
  type SupportBundleConsent,
  type SupportBundleExport,
  type SupportBundleExportResult,
  type SupportBundleJsonValue,
  type SupportBundlePreview,
  type SupportBundleSectionId,
  type SupportBundleSectionPreview
} from '../shared/teaching-types/support-bundle'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
import { isSecretFieldKey } from '../shared/secret-presence'
import {
  REDACTED_ABSOLUTE_PATH,
  redactExportString,
  redactPath as sharedRedactPath
} from './observability/redact'
import { exportTeachingDoctorReport } from './teaching-doctor'
import {
  projectSafeTeachingAuditMetadata,
  redactTeachingAuditForExport,
  type TeachingAuditSafeMetadata
} from './teaching-audit-correlation'
import type {
  TeachingConfigDiagnostic,
  TeachingConfigFieldSource
} from './teaching-config-resolver'
import type {
  WorkspaceInspectionFinding,
  WorkspaceInspectionReport
} from './teaching-workspace-inspector'

/** Local hard-cap for free-text fields after shared export redaction. */
const MAX_STRING_LENGTH = 480
// Shared absolute-path marker must stay identical: '<redacted-absolute-path>'
// (imported as REDACTED_ABSOLUTE_PATH from observability/redact; ADR-0007).
const MAX_FINDINGS = 40
const MAX_CAPABILITY_ITEMS = 48
const MAX_SOURCE_ENTRIES = 80
const MAX_DIAGNOSTICS = 40
const MAX_AUDIT_ENTRIES = 24

const SECTION_TITLES: Readonly<Record<SupportBundleSectionId, string>> = {
  doctor: 'Teaching Doctor',
  inspector: 'Workspace Inspector',
  config_fingerprint: 'Config Fingerprint',
  capability: 'Capability Snapshot',
  audit_correlation: 'Audit Correlation',
  environment: 'Environment',
  local_data_index: 'Local Data Index',
  mcp_status: 'User MCP Status',
  skill_orchestration: 'Skill Orchestration Evaluation'
}

const ALL_SECTION_IDS: readonly SupportBundleSectionId[] = [
  'doctor',
  'inspector',
  'config_fingerprint',
  'capability',
  'audit_correlation',
  'environment',
  'local_data_index',
  'mcp_status',
  'skill_orchestration'
]

/** Optional inputs assembled by callers; missing sections are simply omitted. */
export type SupportBundleInput = {
  /** Injected clock for deterministic previews in tests. */
  now?: () => string
  /** Workspace root used to rewrite absolute paths to relative ones. */
  workspaceRoot?: string | null
  doctor?: TeachingDoctorReport | null
  inspector?: WorkspaceInspectionReport | WorkspaceInspectionFindingsSummary | null
  configFingerprint?: SupportBundleConfigFingerprintInput | null
  capability?: SupportBundleCapabilityInput | null
  auditCorrelation?:
    | TeachingAuditSafeMetadata
    | readonly TeachingAuditSafeMetadata[]
    | readonly unknown[]
    | null
  environment?: SupportBundleEnvironmentInput | null
  /** Aggregate-only LocalDataIndex diagnostics — never projection row bodies. */
  localDataIndex?: SupportBundleLocalDataIndexInput | null
  /**
   * Aggregate-only user MCP status (ADR-0013).
   * Command/args must already be redacted or will be scrubbed again here.
   * Never includes env secrets, headers, or secret storage refs.
   */
  mcp?: SupportBundleMcpStatusInput | null
  /** Aggregate counts only; export remains previewed and consent-gated. */
  skillOrchestration?: SkillOrchestrationEvaluationSummary | null
}

/**
 * Aggregate-only index diagnostics for support bundles.
 * Callers must not supply conversation/memory projection row bodies.
 */
export type SupportBundleLocalDataIndexInput = {
  pathExists: boolean
  /** Logical label only (e.g. userData/studiumx-index.sqlite). Absolute paths are redacted. */
  indexPathLabel?: string | null
  status: 'ready' | 'building' | 'incomplete' | 'unavailable' | 'closed'
  reason?: string | null
  complete?: boolean | null
  rebuiltAt?: string | null
  version?: string | null
  migrationIds?: readonly string[]
  appliedMigrations?: readonly {
    id: string
    checksum?: string
    appliedAt?: string
    appVersion?: string | null
    appliedBy?: string | null
    sqlBytes?: number | null
  }[]
  issueCountsByCode?: Readonly<Record<string, number>>
  issueCount?: number
  /** Optional row counts only — never full projection payloads. */
  projectionRowCounts?: Readonly<Record<string, number>>
}


/**
 * Aggregate-only user MCP status for support bundles (ADR-0013).
 * Callers must not supply secret env values, secret refs, or raw unredacted command lines
 * with embedded credentials. This builder re-redacts command/args/cwd labels fail-closed.
 */
export type SupportBundleMcpStatusInput = {
  implementationPresent: boolean
  rootEnabled: boolean
  serverCount: number
  enabledServerCount: number
  connectedServerCount: number
  errorServerCount: number
  /** Logical label only (e.g. userData/mcp/config.v1.json). Absolute paths are redacted. */
  configPathLabel?: string | null
  servers?: readonly {
    id: string
    enabled: boolean
    transport: string
    state: string
    toolCount?: number | null
    errorCode?: string | null
    /** Redacted command label only. */
    commandLabel?: string | null
    /** Optional redacted args (prefer commandLabel-only when unsure). */
    args?: readonly string[] | null
    /** Optional redacted cwd. */
    cwd?: string | null
  }[]
  /**
   * Forbidden: if present on the object at runtime, must never appear in payload.
   * Kept only so tests can prove smuggling is stripped.
   */
  envSecrets?: unknown
  headers?: unknown
  envSecretRefs?: unknown
  headersSecretRefs?: unknown
  rawCommand?: unknown
  rawArgs?: unknown
}

export type WorkspaceInspectionFindingsSummary = {
  status?: WorkspaceInspectionReport['status']
  inspectedAt?: string
  summary?: WorkspaceInspectionReport['summary']
  findings?: readonly WorkspaceInspectionFinding[]
  findingCount?: number
  errorCount?: number
  warningCount?: number
  infoCount?: number
}

export type SupportBundleConfigFingerprintInput = {
  fingerprint: string
  sources?: readonly TeachingConfigFieldSource[] | readonly { path: string; source: string }[]
  diagnostics?: readonly TeachingConfigDiagnostic[] | readonly {
    code: string
    severity: string
    source?: string
    path?: string
    message?: string
  }[]
  /** Never include secret-bearing config values; optional secret-free summary only. */
  valueSummary?: Readonly<Record<string, string | number | boolean | null>>
}

export type SupportBundleCapabilityInput = {
  generatedAt?: string
  policyId?: string
  totalCount?: number
  availableCount?: number
  countsByStatus?: Readonly<Record<string, number>>
  countsByKind?: Readonly<Record<string, number>>
  items?: readonly {
    id: string
    kind: string
    name: string
    status: string
    reason?: string
    promptEligible?: boolean
  }[]
}

export type SupportBundleEnvironmentInput = {
  platform: string
  appVersion: string
  electronVersion?: string
  nodeVersion?: string
  arch?: string
}

export type SupportBundleOptions = {
  now?: () => string
  workspaceRoot?: string | null
}

/**
 * Build a user-previewable, fully redacted support bundle.
 * Only sections with supplied input are included.
 */
export function previewSupportBundle(input: SupportBundleInput = {}): SupportBundlePreview {
  const generatedAt = (input.now ?? (() => new Date().toISOString()))()
  const workspaceRoot = input.workspaceRoot ?? null
  const sections: SupportBundleSectionPreview[] = []
  const topWarnings: string[] = []

  if (input.doctor != null) {
    sections.push(buildDoctorSection(input.doctor, workspaceRoot))
  }
  if (input.inspector != null) {
    sections.push(buildInspectorSection(input.inspector, workspaceRoot))
  }
  if (input.configFingerprint != null) {
    sections.push(buildConfigFingerprintSection(input.configFingerprint, workspaceRoot))
  }
  if (input.capability != null) {
    sections.push(buildCapabilitySection(input.capability, workspaceRoot))
  }
  if (input.auditCorrelation != null) {
    sections.push(buildAuditCorrelationSection(input.auditCorrelation, workspaceRoot))
  }
  if (input.environment != null) {
    sections.push(buildEnvironmentSection(input.environment, workspaceRoot))
  }
  if (input.localDataIndex != null) {
    sections.push(buildLocalDataIndexSection(input.localDataIndex, workspaceRoot))
  }
  if (input.mcp != null) {
    sections.push(buildMcpStatusSection(input.mcp, workspaceRoot))
  }
  if (input.skillOrchestration != null) {
    sections.push(buildSkillOrchestrationSection(input.skillOrchestration))
  }

  if (sections.length === 0) {
    topWarnings.push('No diagnostic sections were supplied; preview is empty.')
  }

  return {
    schemaVersion: SUPPORT_BUNDLE_SCHEMA_VERSION,
    generatedAt: redactText(generatedAt),
    sections,
    warnings: uniqueStrings(topWarnings.map((warning) => redactText(warning))),
    redactionPolicy: { ...DEFAULT_SUPPORT_BUNDLE_REDACTION_POLICY }
  }
}

/**
 * Export a consent-gated subset of a previously previewed bundle.
 * Requires `consent.accepted === true` and only includes sections that exist in
 * both the preview and `consent.sectionsAllowed`.
 */
export function exportSupportBundle(
  preview: SupportBundlePreview,
  consent: SupportBundleConsent | null | undefined,
  options: SupportBundleOptions = {}
): SupportBundleExportResult {
  if (!isValidConsent(consent)) {
    return {
      ok: false,
      code: 'consent_required',
      message: '导出支持包需要用户明确同意（consent.accepted === true）。'
    }
  }

  const previewIds = new Set(preview.sections.map((section) => section.id))
  const allowed = uniqueSectionIds(consent.sectionsAllowed)

  for (const id of allowed) {
    if (!previewIds.has(id)) {
      return {
        ok: false,
        code: 'section_not_previewed',
        message: `导出失败：分区 "${id}" 未出现在预览中，无法在同意后直接加入。`
      }
    }
  }

  const allowedSet = new Set(allowed)
  const sections = preview.sections
    .filter((section) => allowedSet.has(section.id))
    .map((section) => ({
      id: section.id,
      title: section.title,
      payload: deepRedactJson(section.payload, options.workspaceRoot ?? null),
      warnings: section.warnings.map((warning) => redactText(warning))
    }))

  const exportedAt = (options.now ?? (() => new Date().toISOString()))()

  const exported: SupportBundleExport = {
    schemaVersion: SUPPORT_BUNDLE_SCHEMA_VERSION,
    exportedAt: redactText(exportedAt),
    consent: {
      accepted: true,
      acceptedAt: redactText(consent.acceptedAt),
      sectionsAllowed: allowed
    },
    sections,
    redactionPolicy: { ...DEFAULT_SUPPORT_BUNDLE_REDACTION_POLICY }
  }

  return exported
}

function isValidConsent(consent: SupportBundleConsent | null | undefined): consent is SupportBundleConsent {
  if (!consent || typeof consent !== 'object') return false
  if (consent.accepted !== true) return false
  if (typeof consent.acceptedAt !== 'string' || consent.acceptedAt.trim().length === 0) return false
  if (!Array.isArray(consent.sectionsAllowed)) return false
  return true
}

function buildDoctorSection(
  report: TeachingDoctorReport,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const safe = exportTeachingDoctorReport(report)
  const warnings: string[] = []
  if (safe.overallStatus === 'fail' || safe.overallStatus === 'error') {
    warnings.push(`Doctor overall status is ${safe.overallStatus}; report remains exportable.`)
  }
  return section('doctor', deepRedactJson(safe, workspaceRoot), warnings)
}

function buildInspectorSection(
  report: WorkspaceInspectionReport | WorkspaceInspectionFindingsSummary,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const findingsSource = Array.isArray(report.findings) ? report.findings : []
  const findings = findingsSource.slice(0, MAX_FINDINGS).map((finding) => ({
    code: String(finding.code ?? ''),
    severity: String(finding.severity ?? ''),
    category: String(finding.category ?? ''),
    message: redactText(String(finding.message ?? ''), workspaceRoot),
    repairability: String(finding.repairability ?? 'none'),
    evidence: {
      relativePath:
        finding.evidence?.relativePath != null
          ? redactPath(String(finding.evidence.relativePath), workspaceRoot)
          : null,
      detail:
        finding.evidence?.detail != null ? redactText(String(finding.evidence.detail), workspaceRoot) : null
    }
  }))

  const summarySource = report.summary
  const summary = summarySource
    ? {
        findingCount: Number(summarySource.findingCount ?? findings.length),
        errorCount: Number(summarySource.errorCount ?? 0),
        warningCount: Number(summarySource.warningCount ?? 0),
        infoCount: Number(summarySource.infoCount ?? 0)
      }
    : {
        findingCount: 'findingCount' in report ? Number(report.findingCount ?? findings.length) : findings.length,
        errorCount: 'errorCount' in report ? Number(report.errorCount ?? 0) : 0,
        warningCount: 'warningCount' in report ? Number(report.warningCount ?? 0) : 0,
        infoCount: 'infoCount' in report ? Number(report.infoCount ?? 0) : 0
      }

  const payload = {
    schemaVersion: 'schemaVersion' in report ? report.schemaVersion ?? 1 : 1,
    readOnly: true,
    inspectedAt:
      'inspectedAt' in report && report.inspectedAt
        ? redactText(String(report.inspectedAt))
        : null,
    status: 'status' in report && report.status ? String(report.status) : 'unknown',
    summary,
    findings,
    truncated: findingsSource.length > MAX_FINDINGS
  }

  const warnings: string[] = []
  if (payload.status === 'error') {
    warnings.push('Inspector reported error findings; export remains allowed.')
  }
  if (findingsSource.length > MAX_FINDINGS) {
    warnings.push(`Inspector findings truncated to ${MAX_FINDINGS} entries.`)
  }

  return section('inspector', deepRedactJson(payload, workspaceRoot), warnings)
}

function buildConfigFingerprintSection(
  input: SupportBundleConfigFingerprintInput,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const sources = (input.sources ?? []).slice(0, MAX_SOURCE_ENTRIES).map((entry) => ({
    path: redactPath(String(entry.path ?? ''), workspaceRoot),
    source: redactText(String(entry.source ?? ''))
  }))
  const diagnostics = (input.diagnostics ?? []).slice(0, MAX_DIAGNOSTICS).map((entry) => ({
    code: redactText(String(entry.code ?? '')),
    severity: redactText(String(entry.severity ?? '')),
    source: entry.source != null ? redactText(String(entry.source)) : null,
    path: entry.path != null ? redactPath(String(entry.path), workspaceRoot) : null,
    message: entry.message != null ? redactText(String(entry.message), workspaceRoot) : null
  }))

  const valueSummary: Record<string, string | number | boolean | null> = {}
  if (input.valueSummary) {
    for (const [key, value] of Object.entries(input.valueSummary)) {
      if (typeof value === 'string') valueSummary[key] = redactText(value)
      else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        valueSummary[key] = value
      }
    }
  }

  const payload = {
    fingerprint: redactText(String(input.fingerprint ?? '')),
    sources,
    diagnostics,
    valueSummary: Object.keys(valueSummary).length > 0 ? valueSummary : null,
    secretFree: true
  }

  const warnings: string[] = []
  if ((input.sources?.length ?? 0) > MAX_SOURCE_ENTRIES) {
    warnings.push(`Config sources truncated to ${MAX_SOURCE_ENTRIES} entries.`)
  }
  if ((input.diagnostics?.length ?? 0) > MAX_DIAGNOSTICS) {
    warnings.push(`Config diagnostics truncated to ${MAX_DIAGNOSTICS} entries.`)
  }
  warnings.push('Config values that may contain secrets are never included; fingerprint is secret-free.')

  return section('config_fingerprint', deepRedactJson(payload, workspaceRoot), warnings)
}

function buildCapabilitySection(
  input: SupportBundleCapabilityInput,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const items = (input.items ?? []).slice(0, MAX_CAPABILITY_ITEMS).map((item) => ({
    id: redactText(String(item.id ?? '')),
    kind: redactText(String(item.kind ?? '')),
    name: redactText(String(item.name ?? '')),
    status: redactText(String(item.status ?? '')),
    reason: item.reason != null ? redactText(String(item.reason)) : null,
    promptEligible: item.promptEligible === true
  }))

  const countsByStatus = sanitizeCountMap(input.countsByStatus)
  const countsByKind = sanitizeCountMap(input.countsByKind)

  const totalCount =
    input.totalCount ??
    (items.length > 0
      ? items.length
      : Object.values(countsByStatus).reduce((sum, n) => sum + n, 0))
  const availableCount =
    input.availableCount ??
    countsByStatus.available ??
    items.filter((item) => item.status === 'available').length

  const payload = {
    generatedAt: input.generatedAt != null ? redactText(String(input.generatedAt)) : null,
    policyId: input.policyId != null ? redactText(String(input.policyId)) : null,
    totalCount: Number(totalCount) || 0,
    availableCount: Number(availableCount) || 0,
    countsByStatus,
    countsByKind,
    items,
    truncated: (input.items?.length ?? 0) > MAX_CAPABILITY_ITEMS
  }

  const warnings: string[] = []
  if ((input.items?.length ?? 0) > MAX_CAPABILITY_ITEMS) {
    warnings.push(`Capability items truncated to ${MAX_CAPABILITY_ITEMS} entries.`)
  }

  return section('capability', deepRedactJson(payload, workspaceRoot), warnings)
}

function buildAuditCorrelationSection(
  input: TeachingAuditSafeMetadata | readonly TeachingAuditSafeMetadata[] | readonly unknown[],
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const entries = Array.isArray(input) ? input : [input]
  const safeEntries: SupportBundleJsonValue[] = []
  const warnings: string[] = []

  for (const entry of entries.slice(0, MAX_AUDIT_ENTRIES)) {
    const projected = projectSafeTeachingAuditMetadata(entry)
    if (projected) {
      safeEntries.push(deepRedactJson(projected, workspaceRoot))
      continue
    }
    // Fall back to export redaction for unknown shapes; never pass raw free text.
    safeEntries.push(deepRedactJson(redactTeachingAuditForExport(entry), workspaceRoot))
    warnings.push('An audit entry was not pure safe metadata; applied export redaction stub.')
  }

  if (entries.length > MAX_AUDIT_ENTRIES) {
    warnings.push(`Audit correlation entries truncated to ${MAX_AUDIT_ENTRIES}.`)
  }

  const payload = {
    entryCount: safeEntries.length,
    entries: safeEntries,
    truncated: entries.length > MAX_AUDIT_ENTRIES
  }

  return section('audit_correlation', deepRedactJson(payload, workspaceRoot), warnings)
}

function buildLocalDataIndexSection(
  input: SupportBundleLocalDataIndexInput,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const disposableNote =
    'studiumx-index.sqlite can be safely deleted and rebuilt from canonical local files (JSON/JSONL).'
  const pathLabel = redactPath(
    String(input.indexPathLabel?.trim() || 'userData/studiumx-index.sqlite'),
    workspaceRoot
  )
  const migrationIds = uniqueStrings((input.migrationIds ?? []).map(String)).slice(0, 32)
  const appliedMigrations = (input.appliedMigrations ?? []).slice(0, 32).map((row) => ({
    id: redactText(String(row.id ?? '')),
    checksum: row.checksum != null ? redactText(String(row.checksum)) : null,
    appliedAt: row.appliedAt != null ? redactText(String(row.appliedAt)) : null,
    appVersion: row.appVersion != null ? redactText(String(row.appVersion)) : null,
    appliedBy: row.appliedBy != null ? redactText(String(row.appliedBy)) : null,
    sqlBytes: typeof row.sqlBytes === 'number' && Number.isFinite(row.sqlBytes) ? Math.max(0, Math.floor(row.sqlBytes)) : null
  }))
  const issueCountsByCode = sanitizeCountMap(input.issueCountsByCode)
  const issueCount =
    typeof input.issueCount === 'number' && Number.isFinite(input.issueCount)
      ? Math.max(0, Math.floor(input.issueCount))
      : Object.values(issueCountsByCode).reduce((sum, n) => sum + n, 0)
  const projectionRowCounts = sanitizeCountMap(input.projectionRowCounts)

  // Aggregate-only: explicitly omit any accidental row-body fields if callers smuggle them.
  const payload = {
    aggregateOnly: true as const,
    disposable: true as const,
    disposableNote,
    pathExists: input.pathExists === true,
    indexPathLabel: pathLabel,
    status: redactText(String(input.status ?? 'unavailable')),
    reason: input.reason != null ? redactText(String(input.reason), workspaceRoot) : null,
    complete: typeof input.complete === 'boolean' ? input.complete : null,
    rebuiltAt: input.rebuiltAt != null ? redactText(String(input.rebuiltAt)) : null,
    version: input.version != null ? redactText(String(input.version)) : null,
    migrationIds,
    appliedMigrations,
    issueCount,
    issueCountsByCode,
    projectionRowCounts: Object.keys(projectionRowCounts).length > 0 ? projectionRowCounts : null,
    // Documented non-inclusion for support recipients / redaction audits.
    includesProjectionRowBodies: false as const,
    includesConversationBodies: false as const,
    includesMemoryBodies: false as const
  }

  const warnings: string[] = [
    disposableNote,
    'Local data index section is aggregate-only; conversation/memory projection row bodies are never packed.'
  ]
  if (payload.status === 'unavailable' || payload.status === 'incomplete') {
    warnings.push(`Index status is ${payload.status}; file-scan fallback may be active.`)
  }
  if ((input.appliedMigrations?.length ?? 0) > 32 || (input.migrationIds?.length ?? 0) > 32) {
    warnings.push('Migration list truncated to 32 entries.')
  }

  return section('local_data_index', deepRedactJson(payload, workspaceRoot), warnings)
}

function buildSkillOrchestrationSection(
  input: SkillOrchestrationEvaluationSummary
): SupportBundleSectionPreview {
  const stageKinds: readonly SkillOrchestrationStageKind[] = [
    'ground',
    'diagnose',
    'teach',
    'elicit',
    'artifact_authoring',
    'enhance',
    'verify',
    'package'
  ]
  const safeCount = (value: unknown): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? Math.min(value, Number.MAX_SAFE_INTEGER)
      : 0
  const stageSelectionCounts: Partial<Record<SkillOrchestrationStageKind, number>> = {}
  for (const kind of stageKinds) {
    const count = safeCount(input.stageSelectionCounts?.[kind])
    if (count > 0) stageSelectionCounts[kind] = count
  }
  const checkedCount = safeCount(input.gates?.checkedCount)
  const passedCount = Math.min(checkedCount, safeCount(input.gates?.passedCount))
  const failedCount = Math.min(checkedCount - passedCount, safeCount(input.gates?.failedCount))
  const payload = {
    aggregateOnly: true as const,
    schemaVersion: 1 as const,
    planCount: safeCount(input.planCount),
    stageSelectionCounts,
    unresolvedStageCount: safeCount(input.unresolvedStageCount),
    conflictExclusionCount: safeCount(input.conflictExclusionCount),
    overrideSupported: false as const,
    overrideCount: 0 as const,
    promptBudget: {
      inputChars: safeCount(input.promptBudget?.inputChars),
      includedChars: safeCount(input.promptBudget?.includedChars),
      budgetChars: safeCount(input.promptBudget?.budgetChars),
      truncatedBodyCount: safeCount(input.promptBudget?.truncatedBodyCount)
    },
    gates: {
      checkedCount,
      passedCount,
      failedCount,
      passRate: checkedCount > 0 ? passedCount / checkedCount : null
    },
    teachingCompleteness: {
      applicablePlanCount: safeCount(input.teachingCompleteness?.applicablePlanCount),
      elicitPresentCount: safeCount(input.teachingCompleteness?.elicitPresentCount),
      evidenceStatusPresentCount: safeCount(input.teachingCompleteness?.evidenceStatusPresentCount),
      nextStepActionPresentCount: safeCount(input.teachingCompleteness?.nextStepActionPresentCount)
    },
    includesPromptBodies: false as const,
    includesObjectives: false as const,
    includesLearnerEvidence: false as const,
    automaticallyUploaded: false as const
  }
  return section(
    'skill_orchestration',
    payload,
    [
      'Local aggregate-only evaluation; no prompt bodies, objectives, paths, secrets, or learner Evidence are included.',
      'Export requires explicit user consent and this section in sectionsAllowed; data is never automatically uploaded.'
    ]
  )
}

function buildMcpStatusSection(
  input: SupportBundleMcpStatusInput,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const configPathLabel = redactPath(
    String(input.configPathLabel?.trim() || 'userData/mcp/config.v1.json'),
    workspaceRoot
  )
  const warnings: string[] = [
    'MCP section is aggregate-only: secrets, secret refs, headers, and unredacted command lines are never exported.',
    'Enabling MCP is not tool auto-approval; tools still pass the existing effect lattice.'
  ]
  if (input.rootEnabled === true) {
    warnings.push('User MCP root switch is on; review server error counts and command labels carefully.')
  }

  const servers = (input.servers ?? []).slice(0, 32).map((server) => {
    const id = redactText(String(server.id ?? '')).slice(0, 64)
    const argsRaw = Array.isArray(server.args) ? server.args.map(String).slice(0, 24) : []
    // Prefer commandLabel when provided; otherwise rebuild from raw pieces with redaction.
    let commandLabel =
      server.commandLabel != null && String(server.commandLabel).trim()
        ? redactText(String(server.commandLabel)).slice(0, 120)
        : null
    if (!commandLabel && argsRaw.length > 0) {
      const scrubbedArgs = argsRaw.map((arg) => {
        const secretSafe = redactSecretsLocal(arg)
        return looksLikeAbsolutePathLocal(secretSafe)
          ? redactPath(secretSafe, workspaceRoot)
          : secretSafe
      })
      commandLabel = scrubbedArgs.join(' ').slice(0, 120) || null
    } else if (commandLabel) {
      // Re-scrub labels in case a caller passed an unredacted token.
      commandLabel = scrubMcpCommandLabel(commandLabel, workspaceRoot)
    }

    const cwd =
      server.cwd != null && String(server.cwd).trim()
        ? redactPath(String(server.cwd), workspaceRoot)
        : null

    return {
      id,
      enabled: server.enabled === true,
      transport: redactText(String(server.transport ?? 'stdio')).slice(0, 32),
      state: redactText(String(server.state ?? 'unknown')).slice(0, 32),
      toolCount:
        typeof server.toolCount === 'number' && Number.isFinite(server.toolCount)
          ? Math.max(0, Math.floor(server.toolCount))
          : null,
      errorCode:
        server.errorCode != null ? redactText(String(server.errorCode)).slice(0, 64) : null,
      commandLabel,
      cwd
    }
  })

  const payload = {
    aggregateOnly: true as const,
    secretsNeverExported: true as const,
    implementationPresent: input.implementationPresent === true,
    rootEnabled: input.rootEnabled === true,
    serverCount: Math.max(0, Math.floor(Number(input.serverCount) || 0)),
    enabledServerCount: Math.max(0, Math.floor(Number(input.enabledServerCount) || 0)),
    connectedServerCount: Math.max(0, Math.floor(Number(input.connectedServerCount) || 0)),
    errorServerCount: Math.max(0, Math.floor(Number(input.errorServerCount) || 0)),
    configPathLabel,
    servers
    // Intentionally omit envSecrets / headers / envSecretRefs / rawCommand / rawArgs
  }

  return section('mcp_status', deepRedactJson(payload, workspaceRoot), warnings)
}

function scrubMcpCommandLabel(label: string, workspaceRoot: string | null): string {
  // Split lightly and re-apply secret + path redaction per token.
  return label
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part
      const secretSafe = redactSecretsLocal(part)
      return looksLikeAbsolutePathLocal(secretSafe)
        ? redactPath(secretSafe, workspaceRoot)
        : secretSafe
    })
    .join('')
    .slice(0, 120)
}

function redactSecretsLocal(value: string): string {
  try {
    return redactAgentSecretText(value)
  } catch {
    return '[redacted]'
  }
}

function looksLikeAbsolutePathLocal(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  )
}


function buildEnvironmentSection(
  input: SupportBundleEnvironmentInput,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  // Allowlisted product fields first; then any smuggled own-keys so deepRedactJson
  // can deny secret-shaped values while keeping presence booleans (ADR-0013).
  const payload: Record<string, unknown> = {
    platform: redactText(String(input.platform ?? '')),
    appVersion: redactText(String(input.appVersion ?? ''))
  }
  if (input.electronVersion != null) {
    payload.electronVersion = redactText(String(input.electronVersion))
  }
  if (input.nodeVersion != null) {
    payload.nodeVersion = redactText(String(input.nodeVersion))
  }
  if (input.arch != null) {
    payload.arch = redactText(String(input.arch))
  }

  const known = new Set(['platform', 'appVersion', 'electronVersion', 'nodeVersion', 'arch'])
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (known.has(key)) continue
    payload[key] = value
  }

  return section('environment', deepRedactJson(payload, workspaceRoot), [])
}

function section(
  id: SupportBundleSectionId,
  payload: SupportBundleJsonValue,
  warnings: readonly string[]
): SupportBundleSectionPreview {
  return {
    id,
    title: SECTION_TITLES[id],
    payload,
    warnings: uniqueStrings(warnings.map((warning) => redactText(warning)))
  }
}

function sanitizeCountMap(
  value: Readonly<Record<string, number>> | undefined
): Record<string, number> {
  if (!value) return {}
  const out: Record<string, number> = {}
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isFinite(count)) continue
    out[redactText(key)] = Math.max(0, Math.floor(count))
  }
  return out
}

function deepRedactJson(value: unknown, workspaceRoot: string | null, depth = 0): SupportBundleJsonValue {
  if (depth > 8) return '[truncated]'
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return redactStringValue(value, workspaceRoot)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return '[omitted]'
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => deepRedactJson(item, workspaceRoot, depth + 1))
  }
  if (!isPlainObject(value)) return '[omitted]'

  const out: Record<string, SupportBundleJsonValue> = {}
  let count = 0
  for (const [rawKey, nested] of Object.entries(value)) {
    if (count >= 80) break
    const key = redactText(rawKey)
    if (isDeniedFieldName(rawKey)) {
      out[key] = '[redacted]'
      count += 1
      continue
    }
    if (looksLikePathField(rawKey) && typeof nested === 'string') {
      out[key] = redactPath(nested, workspaceRoot)
      count += 1
      continue
    }
    out[key] = deepRedactJson(nested, workspaceRoot, depth + 1)
    count += 1
  }
  return out
}

function redactStringValue(value: string, workspaceRoot: string | null): string {
  // Stable identifiers (checkId, status, snake_case codes) must not be
  // collapsed by high-entropy credential detection. Only free-text / mixed
  // prose goes through full secret scrubbing (shared observability/redact;
  // ADR-0007). Denied-field / stable-id policy stays local.
  if (looksLikeStableIdentifier(value)) {
    return compact(value, MAX_STRING_LENGTH)
  }
  // Free text: secrets via shared agent-secret primitive, paths via shared redactPath.
  return compact(sharedRedactPath(redactAgentSecretText(value), workspaceRoot), MAX_STRING_LENGTH)
}

function looksLikeStableIdentifier(value: string): boolean {
  if (!value || value.length > 128) return false
  if (/\s/.test(value)) return false
  // snake_case / kebab / dotted / colon ids used by check codes and catalogs
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
}

/**
 * Free-text redaction for section builders. Thin wrapper over shared
 * `redactExportString` (secrets + absolute paths) with local length cap.
 */
function redactText(value: string, workspaceRoot: string | null = null): string {
  return compact(redactExportString(value, workspaceRoot), MAX_STRING_LENGTH)
}

/**
 * Path field redaction. Thin wrapper over shared `redactPath`.
 * Marker string remains `<redacted-absolute-path>` (shared constant).
 */
function redactPath(value: string, workspaceRoot: string | null): string {
  const next = sharedRedactPath(value, workspaceRoot)
  // Shared marker identity remains '<redacted-absolute-path>'.
  return next === REDACTED_ABSOLUTE_PATH ? REDACTED_ABSOLUTE_PATH : next
}

function looksLikePathField(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    lower === 'path' ||
    lower.endsWith('path') ||
    lower.includes('filepath') ||
    lower.includes('relativepath') ||
    lower.includes('absolutepath') ||
    lower.includes('rootpath') ||
    lower.includes('workspacepath')
  )
}

const DENIED_FIELD_NAMES = new Set(
  [
    'prompt',
    'reasoning',
    'answer',
    'learneranswer',
    'fullanswer',
    'selectedoptionids',
    'assessment',
    'assessmentpayload',
    'providerpayload',
    'providerresponse',
    'providerrequest',
    'messages',
    'content',
    'body',
    'raw',
    'transcript',
    'apikey',
    'secret',
    'token',
    'password',
    'authorization',
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'rawprompt',
    'systemprompt',
    'userprompt',
    // LocalDataIndex projection row bodies must never ship in support bundles.
    'turn_projection_json',
    'turnprojectionjson',
    'snapshot_json',
    'snapshotjson',
    'conversation_projection',
    'conversationprojection',
    'memory_projection',
    'memoryprojection',
    'learning_work_projection',
    'learningworkprojection',
    'projectionrows',
    'projectionrowbodies',
    'recordbodies',
    'conversationbodies',
    'memorybodies',
    // MCP secret material must never ship in support bundles (ADR-0013).
    'envsecrets',
    'envsecretrefs',
    'headerssecretrefs',
    'headers',
    'headersplain',
    'rawcommand',
    'rawargs',
    'secretrefs',
    'envplain',
    'clientsecret',
    'oauthclientsecret',
    'bearertoken',
    'sessiontoken',
    'privatekey',
    'mcpsecretrefs'
  ].map((name) => name.toLowerCase())
)

function isDeniedFieldName(name: string): boolean {
  const lower = name.toLowerCase()
  if (DENIED_FIELD_NAMES.has(lower)) return true
  // Presence-only (ADR-0013): deny whole secret-bearing key names without
  // collapsing lifecycle labels like authorizationState / authorizationCode (codes only).
  // Boolean presence flags (hasApiKey, apiKeyConfigured, *SecretConfigured) must survive.
  const compact = lower.replace(/[_-]/g, '')
  if (
    compact.startsWith('has') ||
    compact.endsWith('configured') ||
    compact.includes('presence') ||
    compact.includes('configured')
  ) {
    return false
  }
  // Shared secret field detector (ADR-0013) for smuggled customApiKey etc.
  if (isSecretFieldKey(name) || isSecretFieldKey(compact)) {
    return true
  }
  if (
    compact === 'apikey' ||
    compact.endsWith('apikey') ||
    compact === 'clientsecret' ||
    compact.endsWith('clientsecret') ||
    compact === 'accesstoken' ||
    compact === 'refreshtoken' ||
    compact === 'bearertoken' ||
    compact === 'sessiontoken' ||
    compact === 'privatekey' ||
    compact === 'password' ||
    compact.endsWith('password') ||
    compact === 'authorization' ||
    compact === 'secret' ||
    compact.endsWith('secret')
  ) {
    return true
  }
  return false
}

function compact(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))]
}

function uniqueSectionIds(values: readonly SupportBundleSectionId[]): SupportBundleSectionId[] {
  const seen = new Set<SupportBundleSectionId>()
  const out: SupportBundleSectionId[] = []
  for (const value of values) {
    if (!ALL_SECTION_IDS.includes(value)) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}



