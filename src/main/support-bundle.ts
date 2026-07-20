/**
 * User-previewable, consent-gated support bundle export (P2-8).
 *
 * Assembles optional diagnostics (doctor, inspector, config fingerprint,
 * capability counts, audit correlation, environment) into a redacted preview.
 * Export requires explicit consent and only includes sections that appear in
 * both the preview and the consent allowlist. Never auto-uploads.
 */

import type { TeachingDoctorReport } from '../shared/teaching-types/teaching-doctor'
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
import { normalizeWorkspaceRelativePath } from './teaching-workspace-paths'

const REDACTED_ABSOLUTE_PATH = '<redacted-absolute-path>'
const MAX_STRING_LENGTH = 480
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
  environment: 'Environment'
}

const ALL_SECTION_IDS: readonly SupportBundleSectionId[] = [
  'doctor',
  'inspector',
  'config_fingerprint',
  'capability',
  'audit_correlation',
  'environment'
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

  if (sections.length === 0) {
    topWarnings.push('No diagnostic sections were supplied; preview is empty.')
  }

  return {
    schemaVersion: SUPPORT_BUNDLE_SCHEMA_VERSION,
    generatedAt: redactText(generatedAt),
    sections,
    warnings: uniqueStrings(topWarnings.map(redactText)),
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
      warnings: section.warnings.map(redactText)
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

  const summary =
    'summary' in report && report.summary
      ? {
          findingCount: Number(report.summary.findingCount ?? findings.length),
          errorCount: Number(report.summary.errorCount ?? 0),
          warningCount: Number(report.summary.warningCount ?? 0),
          infoCount: Number(report.summary.infoCount ?? 0)
        }
      : {
          findingCount: Number(report.findingCount ?? findings.length),
          errorCount: Number(report.errorCount ?? 0),
          warningCount: Number(report.warningCount ?? 0),
          infoCount: Number(report.infoCount ?? 0)
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

function buildEnvironmentSection(
  input: SupportBundleEnvironmentInput,
  workspaceRoot: string | null
): SupportBundleSectionPreview {
  const payload: Record<string, string | null> = {
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
    warnings: uniqueStrings(warnings.map(redactText))
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
  // prose goes through full secret scrubbing.
  const pathSafe = scrubAbsolutePaths(value, workspaceRoot)
  if (looksLikeAbsolutePath(pathSafe)) {
    return redactPath(pathSafe, workspaceRoot)
  }
  if (looksLikeStableIdentifier(pathSafe)) {
    return compact(pathSafe, MAX_STRING_LENGTH)
  }
  const redacted = scrubAbsolutePaths(redactAgentSecretText(pathSafe), workspaceRoot)
  if (looksLikeAbsolutePath(redacted)) {
    return redactPath(redacted, workspaceRoot)
  }
  return compact(redacted, MAX_STRING_LENGTH)
}

function looksLikeStableIdentifier(value: string): boolean {
  if (!value || value.length > 128) return false
  if (/\s/.test(value)) return false
  // snake_case / kebab / dotted / colon ids used by check codes and catalogs
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
}

function redactText(value: string, workspaceRoot: string | null = null): string {
  return compact(scrubAbsolutePaths(redactAgentSecretText(value), workspaceRoot), MAX_STRING_LENGTH)
}

/**
 * Rewrite absolute host paths embedded in free-text diagnostics.
 * Prefer workspace-relative when a root is known; otherwise stub.
 */
function scrubAbsolutePaths(value: string, workspaceRoot: string | null): string {
  let next = value

  if (workspaceRoot) {
    const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
    if (root.length > 0) {
      // Match both forward and backslash forms of the workspace root.
      const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]')
      const rootPattern = new RegExp(`${escaped}(?=[\\\\/]|$)`, 'gi')
      next = next.replace(rootPattern, (match) => {
        // Keep trailing separator behaviour for the subsequent relative rewrite.
        return ''
      })
      // Clean doubled separators left after root strip: "at /lessons" or "at \lessons"
      next = next.replace(/([=\s:(])[\\/]+(?=[A-Za-z0-9._-])/g, '$1')
    }
  }

  // Windows drive paths: C:\... or C:/...
  next = next.replace(/\b[A-Za-z]:[\\/][^\s"'`]+/g, (match) => {
    if (workspaceRoot) {
      const relative = tryWorkspaceRelative(workspaceRoot, match)
      if (relative != null) return normalizeWorkspaceRelativePath(relative)
    }
    return REDACTED_ABSOLUTE_PATH
  })

  // UNC paths
  next = next.replace(/\\\\[^\s"'`]+/g, REDACTED_ABSOLUTE_PATH)

  // POSIX home-ish absolute paths
  next = next.replace(
    /(?:^|[\s="'(:])(\/(?:Users|home|private\/var|var\/folders)\/[^\s"'`]+)/g,
    (full, pathPart: string) => {
      const prefix = full.slice(0, full.length - pathPart.length)
      if (workspaceRoot) {
        const relative = tryWorkspaceRelative(workspaceRoot, pathPart)
        if (relative != null) return `${prefix}${normalizeWorkspaceRelativePath(relative)}`
      }
      return `${prefix}${REDACTED_ABSOLUTE_PATH}`
    }
  )

  return next
}

function redactPath(value: string, workspaceRoot: string | null): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''

  const secretSafe = redactAgentSecretText(trimmed)

  if (workspaceRoot) {
    const relative = tryWorkspaceRelative(workspaceRoot, secretSafe)
    if (relative != null) {
      return compact(normalizeWorkspaceRelativePath(relative), MAX_STRING_LENGTH)
    }
  }

  if (looksLikeAbsolutePath(secretSafe)) {
    return REDACTED_ABSOLUTE_PATH
  }

  // Relative-looking path: normalize separators only.
  if (secretSafe.includes('/') || secretSafe.includes('\\')) {
    return compact(normalizeWorkspaceRelativePath(secretSafe), MAX_STRING_LENGTH)
  }

  return compact(secretSafe, MAX_STRING_LENGTH)
}

function tryWorkspaceRelative(workspaceRoot: string, absoluteOrAny: string): string | null {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const candidate = absoluteOrAny.replace(/\\/g, '/')
  if (!root || !candidate) return null

  const rootLower = root.toLowerCase()
  const candidateLower = candidate.toLowerCase()
  if (candidateLower === rootLower) return '.'
  const prefix = `${rootLower}/`
  if (candidateLower.startsWith(prefix)) {
    return candidate.slice(root.length).replace(/^[/\\]+/, '')
  }
  return null
}

function looksLikeAbsolutePath(value: string): boolean {
  if (!value) return false
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\')) return true
  if (value.startsWith('/Users/') || value.startsWith('/home/') || value.startsWith('/private/var/')) {
    return true
  }
  // Generic POSIX absolute with user-home-ish segments
  if (value.startsWith('/') && /\/(Users|home|Documents|Desktop|Downloads)\//i.test(value)) {
    return true
  }
  return false
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
    'userprompt'
  ].map((name) => name.toLowerCase())
)

function isDeniedFieldName(name: string): boolean {
  return DENIED_FIELD_NAMES.has(name.toLowerCase())
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



