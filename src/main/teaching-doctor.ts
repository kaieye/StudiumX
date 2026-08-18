import {
  TEACHING_DOCTOR_SCHEMA_VERSION,
  type TeachingDoctorCatalogDriftFacts,
  type TeachingDoctorCheckId,
  type TeachingDoctorCheckItem,
  type TeachingDoctorCheckResult,
  type TeachingDoctorConfigFacts,
  type TeachingDoctorFacts,
  type TeachingDoctorFixSuggestion,
  type TeachingDoctorLocalDataIndexFacts,
  type TeachingDoctorMcpFacts,
  type TeachingDoctorOutcomeCrashWindowFacts,
  type TeachingDoctorProcessCrashMarkerFacts,
  type TeachingDoctorReport,
  type TeachingDoctorRepairRecommendation,
  type TeachingDoctorSafeEvidence,
  type TeachingDoctorSessionCrashWindowFacts,
  type TeachingDoctorSourceGapFacts
} from '../shared/teaching-types/teaching-doctor'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'

/**
 * Structured, read-only TeachingDoctor.
 *
 * `run()` diagnoses P0 crash windows, config unavailability, source gaps, and
 * catalog drift, and local process crash markers. Repair is never executed here — recommendations are separate
 * effect metadata only. Doctor failure never blocks read-only workspace open.
 */
export interface TeachingDoctor {
  run(facts?: TeachingDoctorFacts): TeachingDoctorReport
}

export type TeachingDoctorOptions = {
  /** Injected clock for deterministic reports in tests. */
  now?: () => string
}

export function createTeachingDoctor(options: TeachingDoctorOptions = {}): TeachingDoctor {
  const now = options.now ?? (() => new Date().toISOString())
  return {
    run(facts = {}) {
      return runTeachingDoctor(facts, now())
    }
  }
}

/** Pure entry used by unit tests and the factory. */
export function runTeachingDoctor(facts: TeachingDoctorFacts, generatedAt: string): TeachingDoctorReport {
  const checks: TeachingDoctorCheckItem[] = [
    checkSessionEventManifestCrashWindow(facts.sessionCrashWindow),
    checkOutcomePublicationCrashWindow(facts.outcomeCrashWindow),
    checkConfigAvailability(facts.config),
    checkSourceGap(facts.sourceGap),
    checkCatalogDrift(facts.catalogDrift),
    checkLocalDataIndex(facts.localDataIndex),
    checkLocalProcessCrashMarker(facts.processCrashMarker),
    checkMcpStatus(facts.mcp)
  ]

  return {
    schemaVersion: TEACHING_DOCTOR_SCHEMA_VERSION,
    generatedAt,
    overallStatus: overallStatus(checks),
    workspaceOpenPolicy: 'read_only_allowed',
    mode: 'read_only',
    checks,
    diagnostics: {
      redaction: 'secret-shaped tokens, bearer credentials, URL userinfo, and sensitive assignment values',
      autoRepair: 'disabled'
    }
  }
}

/**
 * Exportable redacted report. Always deep-clones and re-redacts every string so
 * support bundles never carry raw secrets, learner answers, or provider payloads.
 */
export function exportTeachingDoctorReport(report: TeachingDoctorReport): TeachingDoctorReport {
  return redactReport(structuredClone(report))
}

export function formatTeachingDoctorReport(
  report: TeachingDoctorReport,
  format: 'json' | 'text' = 'text'
): string {
  const safe = exportTeachingDoctorReport(report)
  if (format === 'json') return `${JSON.stringify(safe, null, 2)}\n`
  if (format !== 'text') throw new TypeError(`Unsupported teaching doctor report format: ${String(format)}`)

  const lines = [
    `StudiumX TeachingDoctor (${safe.generatedAt})`,
    `overall: ${safe.overallStatus}`,
    `mode: ${safe.mode}`,
    `workspace open: ${safe.workspaceOpenPolicy}`,
    `auto-repair: ${safe.diagnostics.autoRepair}`,
    'checks:'
  ]
  for (const check of safe.checks) {
    lines.push(`- ${check.checkId}: ${check.result} — ${check.summary}`)
    lines.push(`  action: ${check.recommendedAction}`)
    if (check.configPath) {
      lines.push(`  config: ${check.configPath}`)
    }
    if (check.fixSuggestion) {
      lines.push(`  fix: ${check.fixSuggestion.code} — ${check.fixSuggestion.title}`)
      for (const step of check.fixSuggestion.steps) {
        lines.push(`    - ${step}`)
      }
    }
    if (check.repair.kind !== 'none') {
      lines.push(`  repair: ${check.repair.kind} (manual; auto=${check.repair.autoRepairAllowed})`)
    }
  }
  return `${lines.join('\n')}\n`
}

function checkSessionEventManifestCrashWindow(
  facts: TeachingDoctorSessionCrashWindowFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'p0_session_event_manifest_crash_window'
  if (facts == null) {
    return item(checkId, 'skipped', 'Session crash-window facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply session scan facts for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide Learning Session scan facts (stages, quarantines, recoveries) and re-run TeachingDoctor.')
  }

  const gap = Math.max(0, facts.eventManifestGapCount)
  const pending = Math.max(0, facts.pendingStageCount)
  const unsafe = Math.max(0, facts.unsafeStageCount)
  const quarantined = Math.max(0, facts.quarantinedSessionCount)
  const recoveries = Math.max(0, facts.recoveryCount)
  const codes = uniqueStrings(facts.diagnosticCodes)

  const evidence = safeEvidence({
    eventManifestGapCount: gap,
    pendingStageCount: pending,
    unsafeStageCount: unsafe,
    quarantinedSessionCount: quarantined,
    recoveryCount: recoveries,
    diagnosticCodeCount: codes.length
  }, codes.length > 0 ? [`diagnostic_codes=${codes.slice(0, 8).join(',')}`] : [])

  if (gap > 0 || pending > 0 || unsafe > 0) {
    return item(
      checkId,
      'fail',
      'P0 session crash window detected: immutable events may outrun the session manifest projection.',
      evidence,
      repair(
        'deterministic_projection_rebuild',
        'Reload the session through LearningSessionLedger so the independent manifest repair can catch up; do not rewrite event history.'
      ),
      'Open the affected session with the ledger load/repair path. Prefer deterministic manifest projection rebuild only; never invent missing events.'
    )
  }

  if (quarantined > 0) {
    return item(
      checkId,
      'warning',
      'Quarantined sessions present; crash-window stage is clean but some sessions need review.',
      evidence,
      repair('manual_review', 'Inspect quarantined session diagnostics without mutating event history.'),
      'Review quarantined session diagnostics and keep the workspace open read-only while investigating.'
    )
  }

  if (recoveries > 0) {
    return item(
      checkId,
      'warning',
      'Prior writer recoveries recorded; current stage projections look consistent.',
      evidence,
      repair('none', 'No repair required for recovered writer locks that already settled.'),
      'No action required unless a later load fails; doctor remains advisory.'
    )
  }

  return item(
    checkId,
    'ok',
    'No session event/manifest crash-window symptoms.',
    evidence,
    repair('none', 'No repair required.'),
    'No action required.'
  )
}

function checkOutcomePublicationCrashWindow(
  facts: TeachingDoctorOutcomeCrashWindowFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'p0_outcome_publication_crash_window'
  if (facts == null) {
    return item(checkId, 'skipped', 'Outcome crash-window facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply outcome reconciliation facts for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide Learning Outcome reconciliation facts and re-run TeachingDoctor.')
  }

  const pending = Math.max(0, facts.pendingSettlementCount)
  const needsRepair = Math.max(0, facts.needsProjectionRepairCount)
  const review = Math.max(0, facts.reviewRequiredCount)
  const settled = Math.max(0, facts.settledCount)

  const evidence = safeEvidence({
    pendingSettlementCount: pending,
    needsProjectionRepairCount: needsRepair,
    reviewRequiredCount: review,
    settledCount: settled
  })

  if (needsRepair > 0 || pending > 0) {
    return item(
      checkId,
      'fail',
      'P0 outcome publication crash window detected: durable record/marker may lack matching projections.',
      evidence,
      repair(
        'deterministic_projection_rebuild',
        'Call LearningOutcomeCommitter.reconcile(sessionId) so record-authoritative projections can rebuild without reevaluation.'
      ),
      'Run outcome reconcile for the listed sessions. Repair is a separate effect and must stay deterministic; do not re-evaluate outcomes.'
    )
  }

  if (review > 0) {
    return item(
      checkId,
      'warning',
      'Outcome settlements require manual review; auto-repair is not safe.',
      evidence,
      repair('manual_review', 'Inspect conflicting or invalid settlement markers without rewriting records.'),
      'Review outcome diagnostics. Do not auto-repair conflicting settlements.'
    )
  }

  return item(
    checkId,
    'ok',
    'No outcome publication crash-window symptoms.',
    evidence,
    repair('none', 'No repair required.'),
    'No action required.'
  )
}

function checkConfigAvailability(
  facts: TeachingDoctorConfigFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'config_availability'
  if (facts == null) {
    return item(checkId, 'skipped', 'Config availability facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply settings/provider facts for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide settings availability facts and re-run TeachingDoctor.', {
      configPath: 'userData/studiumx-settings.json',
      fixSuggestion: {
        code: 'supply_config_facts',
        title: 'Collect settings facts',
        steps: [
          'Locate studiumx-settings.json under the app userData directory.',
          'Re-run TeachingDoctor with settingsAvailable/readable/parseable/providerConfigured facts.'
        ],
        configPath: 'userData/studiumx-settings.json',
        docsRef: 'diagnosing-provider'
      }
    })
  }

  const configPath = facts.configPath?.trim() || 'userData/studiumx-settings.json'
  const configKey = facts.configKey?.trim() || null
  const evidence = safeEvidence({
    settingsAvailable: facts.settingsAvailable,
    settingsReadable: facts.settingsReadable,
    settingsParseable: facts.settingsParseable,
    providerConfigured: facts.providerConfigured,
    configPath,
    ...(configKey ? { configKey } : {}),
    ...(facts.agentSandboxMode ? { agentSandboxMode: facts.agentSandboxMode } : {}),
    ...(facts.agentSandboxBackend ? { agentSandboxBackend: facts.agentSandboxBackend } : {}),
    ...(typeof facts.agentSandboxOsEnforcementAvailable === 'boolean'
      ? { agentSandboxOsEnforcementAvailable: facts.agentSandboxOsEnforcementAvailable }
      : {}),
    ...(facts.agentSandboxSummary ? { agentSandboxSummary: facts.agentSandboxSummary } : {}),
    ...(facts.agentSandboxWindowsReadiness
      ? { agentSandboxWindowsReadiness: facts.agentSandboxWindowsReadiness }
      : {})
  }, [
    ...(facts.reason ? [redactText(facts.reason)] : []),
    ...(facts.agentSandboxSummary
      ? [redactText(`agent_sandbox=${facts.agentSandboxSummary}`)]
      : [])
  ])

  if (!facts.settingsAvailable || !facts.settingsReadable || !facts.settingsParseable) {
    return item(
      checkId,
      'fail',
      'Teaching configuration is unavailable or unreadable.',
      evidence,
      repair('manual_review', 'Restore or replace studiumx-settings.json from a verified backup; do not invent provider secrets.'),
      'Restore settings from backup or recreate defaults on next app launch. Workspace may still open read-only.',
      {
        configPath,
        fixSuggestion: {
          code: 'restore_settings_file',
          title: 'Restore teaching settings file',
          steps: [
            `Open or restore ${configPath} from a verified backup.`,
            'Confirm the file is valid JSON matching TeachingSettingsV1.',
            'Relaunch the app so defaults can be recreated if the file is missing.',
            'Do not paste provider secrets into logs, doctor evidence, or support bundles.'
          ],
          configPath,
          docsRef: 'diagnosing-provider'
        }
      }
    )
  }

  if (!facts.providerConfigured) {
    return item(
      checkId,
      'warning',
      'Settings load, but no provider is configured for generation.',
      evidence,
      repair('none', 'Provider configuration is user-owned; doctor does not invent credentials.'),
      'Configure a teaching provider in settings. Read-only workspace open remains allowed.',
      {
        configPath,
        fixSuggestion: {
          code: 'configure_provider',
          title: 'Configure teaching provider',
          steps: [
            'Open Settings in StudiumX.',
            `Set provider credentials under ${configKey ?? 'provider'} (values stay secret-storage protected).`,
            `Locator: ${configPath}`,
            'Re-run TeachingDoctor after saving.'
          ],
          configPath,
          docsRef: 'diagnosing-provider'
        }
      }
    )
  }

  return item(
    checkId,
    'ok',
    'Teaching configuration is available.',
    evidence,
    repair('none', 'No repair required.'),
    'No action required.',
    { configPath }
  )
}

function checkSourceGap(
  facts: TeachingDoctorSourceGapFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'source_gap'
  if (facts == null) {
    return item(checkId, 'skipped', 'Source-gap facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply grounding/resource facts for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide grounding pack summary facts and re-run TeachingDoctor.')
  }

  const codes = uniqueStrings(facts.exclusionCodes)
  const gapCount = Math.max(0, facts.gapCount)
  const available = Math.max(0, facts.availableSourceCount)
  const evidence = safeEvidence({
    status: facts.status,
    availableSourceCount: available,
    gapCount,
    exclusionCodeCount: codes.length
  }, codes.length > 0 ? [`exclusion_codes=${codes.slice(0, 12).join(',')}`] : [])

  if (facts.status === 'unavailable' || (available === 0 && gapCount > 0)) {
    return item(
      checkId,
      'fail',
      'Trusted teaching sources are unavailable (source gap).',
      evidence,
      repair('manual_review', 'Restore missing trusted resources or update Mission resource descriptors; never invent sources.'),
      'Add or repair trusted resources before continuing generative teaching turns. Workspace remains openable read-only.'
    )
  }

  if (facts.status === 'degraded' || gapCount > 0 || facts.status === 'not_configured') {
    return item(
      checkId,
      'warning',
      'Source readiness is degraded or incomplete.',
      evidence,
      repair('manual_review', 'Review grounding exclusions and refresh stale or unauthorized resources.'),
      'Review resource gaps and exclusion codes. Planner should wait_for_resources when readiness is not ready.'
    )
  }

  if (facts.status === 'unknown') {
    return item(
      checkId,
      'warning',
      'Source readiness is unknown.',
      evidence,
      repair('none', 'Collect grounding facts and re-run doctor.'),
      'Collect grounding pack status before diagnosing further source issues.'
    )
  }

  return item(
    checkId,
    'ok',
    'No source gap detected.',
    evidence,
    repair('none', 'No repair required.'),
    'No action required.'
  )
}

function checkCatalogDrift(
  facts: TeachingDoctorCatalogDriftFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'catalog_drift'
  if (facts == null) {
    return item(checkId, 'skipped', 'Catalog drift facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply lesson-index reconciliation facts for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide catalog reconciliation plan facts and re-run TeachingDoctor.')
  }

  const recovered = Math.max(0, facts.recoveredCount)
  const removed = Math.max(0, facts.removedCount)
  const recoveredPaths = uniqueStrings(facts.recoveredRelativePaths).slice(0, 8)
  const removedPaths = uniqueStrings(facts.removedRelativePaths).slice(0, 8)

  const evidence = safeEvidence(
    {
      requiresPersist: facts.requiresPersist,
      recoveredCount: recovered,
      removedCount: removed
    },
    [
      ...recoveredPaths.map((path) => `recovered=${redactText(path)}`),
      ...removedPaths.map((path) => `removed=${redactText(path)}`)
    ]
  )

  if (facts.requiresPersist || recovered > 0 || removed > 0) {
    return item(
      checkId,
      'warning',
      'Catalog drift detected between durable lesson index and filesystem.',
      evidence,
      repair(
        'deterministic_projection_rebuild',
        'Persist the Lesson index reconciliation plan (recover/remove only). Catalog remains a read-only projection of the resulting index.'
      ),
      'Apply deterministic lesson-index reconciliation as a separate effect, then rebuild the catalog projection. Do not invent lessons.'
    )
  }

  return item(
    checkId,
    'ok',
    'Lesson catalog matches the durable index plan.',
    evidence,
    repair('none', 'No repair required.'),
    'No action required.'
  )
}


function checkLocalDataIndex(
  facts: TeachingDoctorLocalDataIndexFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'local_data_index'
  const disposableNote =
    'studiumx-index.sqlite can be safely deleted and rebuilt from canonical local files (JSON/JSONL).'
  const pathLabel = facts?.indexPathLabel?.trim() || 'userData/studiumx-index.sqlite'

  if (facts == null) {
    return item(checkId, 'skipped', 'Local data index diagnostics were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply LocalDataIndex.diagnostics() facts for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide LocalDataIndex aggregate diagnostics and re-run TeachingDoctor.', {
      configPath: pathLabel,
      fixSuggestion: {
        code: 'supply_local_data_index_facts',
        title: 'Collect local data index diagnostics',
        steps: [
          'Call LocalDataIndex.diagnostics() (aggregate-only; no projection row bodies).',
          'Re-run TeachingDoctor with localDataIndex facts.',
          disposableNote
        ],
        configPath: pathLabel,
        docsRef: 'local-data-index'
      }
    })
  }

  const issueCounts = facts.issueCountsByCode ?? {}
  const issueCount = Object.values(issueCounts).reduce((sum, n) => sum + Math.max(0, Number(n) || 0), 0)
  const migrationIds = uniqueStrings(facts.migrationIds).slice(0, 24)
  const topIssueCodes = Object.entries(issueCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([code, count]) => `${code}=${Math.max(0, Math.floor(Number(count) || 0))}`)

  const evidence = safeEvidence(
    {
      pathExists: facts.pathExists === true,
      indexPathLabel: pathLabel,
      status: facts.status,
      complete: facts.complete,
      rebuiltAt: facts.rebuiltAt,
      migrationCount: migrationIds.length,
      issueCount,
      disposable: true,
      ...(facts.usage
        ? {
            usageSegmentFileCount: Math.max(0, Math.floor(Number(facts.usage.segmentFileCount) || 0)),
            usageProjectedEntryCount: Math.max(0, Math.floor(Number(facts.usage.projectedEntryCount) || 0)),
            usageInvalidRowCount: Math.max(0, Math.floor(Number(facts.usage.invalidRowCount) || 0))
          }
        : {})
    },
    [
      disposableNote,
      ...(facts.reason ? [`reason=${redactText(facts.reason)}`] : []),
      ...(migrationIds.length > 0 ? [`migration_ids=${migrationIds.join(',')}`] : []),
      ...(topIssueCodes.length > 0 ? [`issue_counts=${topIssueCodes.join(',')}`] : []),
      ...(facts.usage
        ? [
            `usage_segments=${Math.max(0, Math.floor(Number(facts.usage.segmentFileCount) || 0))}`,
            `usage_projected_entries=${Math.max(0, Math.floor(Number(facts.usage.projectedEntryCount) || 0))}`,
            `usage_invalid_rows=${Math.max(0, Math.floor(Number(facts.usage.invalidRowCount) || 0))}`
          ]
        : [])
    ]
  )

  const fixSuggestion = {
    code: 'rebuild_local_data_index',
    title: 'Rebuild disposable local data index',
    steps: [
      disposableNote,
      `If needed, delete ${pathLabel} (and -wal/-shm sidecars) while the app is stopped.`,
      'Relaunch StudiumX so LocalDataIndex can open and scheduleRebuild() from canonical files.',
      'Do not delete workspace JSON/JSONL sources; those remain the file-truth.'
    ],
    configPath: pathLabel,
    docsRef: 'local-data-index'
  }

  if (facts.status === 'unavailable') {
    return item(
      checkId,
      'warning',
      'Local data index is unavailable; file-scan fallback remains active.',
      evidence,
      repair(
        'deterministic_projection_rebuild',
        'Delete studiumx-index.sqlite if corrupt, then reopen so the disposable projection can rebuild from canonical files.'
      ),
      'SQLite projection is optional. Prefer file-scan fallback; delete and rebuild studiumx-index.sqlite if native/open failures persist.',
      { configPath: pathLabel, fixSuggestion }
    )
  }

  if (facts.status === 'closed') {
    return item(
      checkId,
      'warning',
      'Local data index is closed.',
      evidence,
      repair('none', 'Re-open LocalDataIndex if analytics projections are needed.'),
      'Re-open the local data index process service if projections are required; file-truth is unaffected.',
      { configPath: pathLabel, fixSuggestion }
    )
  }

  if (facts.status === 'building') {
    return item(
      checkId,
      'warning',
      'Local data index rebuild is in progress.',
      evidence,
      repair('none', 'Wait for rebuild to finish; do not treat the projection as ready yet.'),
      'Wait for rebuild completion. studiumx-index.sqlite remains disposable if the rebuild stalls.',
      { configPath: pathLabel, fixSuggestion }
    )
  }

  if (facts.status === 'incomplete' || facts.complete === false || issueCount > 0) {
    return item(
      checkId,
      'warning',
      'Local data index is incomplete or has projection issues.',
      evidence,
      repair(
        'deterministic_projection_rebuild',
        'Schedule or force a LocalDataIndex rebuild; delete studiumx-index.sqlite if it remains stuck incomplete.'
      ),
      'Trigger LocalDataIndex.rebuild() / scheduleRebuild(), or delete the disposable SQLite file so it can be recreated from file-truth.',
      { configPath: pathLabel, fixSuggestion }
    )
  }

  if (facts.status === 'ready') {
    return item(
      checkId,
      'ok',
      'Local data index is ready (disposable projection of file-truth).',
      evidence,
      repair('none', 'No repair required.'),
      'No action required. studiumx-index.sqlite can still be safely deleted and rebuilt if needed.',
      { configPath: pathLabel }
    )
  }

  return item(
    checkId,
    'warning',
    `Local data index status is ${facts.status}.`,
    evidence,
    repair('manual_review', 'Inspect LocalDataIndex diagnostics and rebuild if needed.'),
    'Review local data index diagnostics. Projection remains disposable.',
    { configPath: pathLabel, fixSuggestion }
  )
}


function checkMcpStatus(
  facts: TeachingDoctorMcpFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'mcp_status'
  const configPath = facts?.configPathLabel?.trim() || 'userData/mcp/config.v1.json'

  if (facts == null) {
    return item(checkId, 'skipped', 'MCP status facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply redacted user MCP status for a full diagnosis.',
      autoRepairAllowed: false
    }, 'Provide MCP host/config facts and re-run TeachingDoctor.', {
      configPath,
      fixSuggestion: {
        code: 'supply_mcp_status_facts',
        title: 'Collect user MCP status',
        steps: [
          'Load userData/mcp/config.v1.json (secret-free view).',
          'Include runtime connection state without command secrets.',
          'Re-run TeachingDoctor.'
        ],
        configPath,
        docsRef: 'adr-0013-mcp-runtime-trust-and-secrets'
      }
    })
  }

  const rootEnabled = facts.rootEnabled === true
  const serverCount = Math.max(0, Math.floor(Number(facts.serverCount) || 0))
  const enabledServerCount = Math.max(0, Math.floor(Number(facts.enabledServerCount) || 0))
  const connectedServerCount = Math.max(0, Math.floor(Number(facts.connectedServerCount) || 0))
  const errorServerCount = Math.max(0, Math.floor(Number(facts.errorServerCount) || 0))
  const implementationPresent = facts.implementationPresent === true

  const serverIds = (facts.servers ?? [])
    .map((s) => (typeof s.id === 'string' ? s.id.trim().slice(0, 64) : ''))
    .filter(Boolean)
    .slice(0, 16)

  const autoConnectEnabled = facts.autoConnectEnabled === true
  const effectiveSourceCount =
    typeof facts.effectiveSourceCount === 'number' &&
    Number.isSafeInteger(facts.effectiveSourceCount) &&
    facts.effectiveSourceCount >= 0
      ? facts.effectiveSourceCount
      : null
  const sourceWarningCount =
    typeof facts.sourceWarningCount === 'number' &&
    Number.isSafeInteger(facts.sourceWarningCount) &&
    facts.sourceWarningCount >= 0
      ? facts.sourceWarningCount
      : null
  const marketplaceEmergencyDisabled =
    typeof facts.marketplaceEmergencyDisabled === 'boolean'
      ? facts.marketplaceEmergencyDisabled
      : null

  const evidence = safeEvidence(
    {
      implementationPresent,
      rootEnabled,
      autoConnectEnabled,
      serverCount,
      enabledServerCount,
      connectedServerCount,
      errorServerCount,
      configPathLabel: configPath,
      ...(effectiveSourceCount != null ? { effectiveSourceCount } : {}),
      ...(sourceWarningCount != null ? { sourceWarningCount } : {}),
      ...(marketplaceEmergencyDisabled != null ? { marketplaceEmergencyDisabled } : {})
    },
    serverIds.map((id) => `server=${id}`)
  )

  if (!implementationPresent) {
    return item(
      checkId,
      'ok',
      'User MCP implementation is not present in this build (or not wired).',
      evidence,
      repair('none', 'No repair required.'),
      'No action required.',
      { configPath }
    )
  }

  if (!rootEnabled) {
    return item(
      checkId,
      'ok',
      'User MCP root switch is off (default). No MCP connections expected.',
      evidence,
      repair('none', 'No repair required.'),
      'Leave MCP disabled unless you intentionally need external tools. Enable only under Settings · MCP.',
      { configPath }
    )
  }

  if (errorServerCount > 0) {
    return item(
      checkId,
      'warning',
      `User MCP is enabled with ${errorServerCount} server(s) in error state.`,
      evidence,
      repair(
        'manual_review',
        'Review MCP server command/config under Settings · MCP; fix spawn/handshake failures. Secrets stay out of doctor evidence.'
      ),
      'Open Settings · MCP, test the failing server, and inspect logs (redacted). Keep secret material out of support bundles.',
      {
        configPath,
        fixSuggestion: {
          code: 'review_mcp_server_errors',
          title: 'Review MCP server errors',
          steps: [
            'Open Settings · MCP.',
            'Confirm root switch and per-server enable flags are intentional.',
            'Use Test connection on the failing server.',
            'Fix command/args/cwd; never paste secrets into support bundles.'
          ],
          configPath,
          docsRef: 'adr-0013-mcp-runtime-trust-and-secrets'
        }
      }
    )
  }

  return item(
    checkId,
    'ok',
    `User MCP is enabled (${enabledServerCount}/${serverCount} server(s) enabled, ${connectedServerCount} connected).`,
    evidence,
    repair('none', 'No repair required.'),
    'MCP tools still require the existing approval lattice; enabling a server is not tool auto-approval.',
    { configPath }
  )
}

function checkLocalProcessCrashMarker(
  facts: TeachingDoctorProcessCrashMarkerFacts | null | undefined
): TeachingDoctorCheckItem {
  const checkId: TeachingDoctorCheckId = 'local_process_crash_marker'
  if (facts == null) {
    return item(checkId, 'skipped', 'Process crash-marker facts were not supplied.', emptyEvidence(), {
      kind: 'none',
      description: 'No repair; supply crash-marker scan facts for next-start visibility.',
      autoRepairAllowed: false
    }, 'Collect the local crash marker from appData/observability and re-run TeachingDoctor.')
  }

  const present = facts.present === true
  const reasonCode = typeof facts.reasonCode === 'string' && facts.reasonCode.trim()
    ? redactText(facts.reasonCode.trim().slice(0, 64))
    : null
  const writtenAt = typeof facts.writtenAt === 'string' && facts.writtenAt.trim()
    ? redactText(facts.writtenAt.trim().slice(0, 40))
    : null
  const runId = typeof facts.runId === 'string' && facts.runId.trim()
    ? redactText(facts.runId.trim().slice(0, 128))
    : null

  const evidence = safeEvidence({
    present,
    ...(reasonCode ? { reasonCode } : {}),
    ...(writtenAt ? { writtenAt } : {}),
    ...(runId ? { runId } : {})
  })

  if (!present) {
    return item(
      checkId,
      'ok',
      'No prior-process crash marker present.',
      evidence,
      repair('none', 'No repair required.'),
      'No action required.'
    )
  }

  return item(
    checkId,
    'warning',
    'Prior process crash marker present; last session may have ended abnormally.',
    evidence,
    repair(
      'manual_review',
      'Review local logs and session/outcome crash windows; clear the crash marker after investigation. No auto-upload.'
    ),
    'Inspect local logs and P0 crash-window checks. Clear the marker via CrashMarkerStore.clear() after review. Never auto-upload crash reports.',
    {
      fixSuggestion: {
        code: 'review_local_crash_marker',
        title: 'Review local crash marker',
        steps: [
          'Confirm TeachingDoctor P0 session and outcome crash-window checks.',
          'Inspect studiumx.log under userData (already secret-redacted at write).',
          'Clear appData/observability/crash-marker.json after investigation.',
          'Do not enable remote telemetry or auto-upload of crash reports.'
        ],
        docsRef: 'adr-0007-local-observability-and-diagnostics'
      }
    }
  )
}

function overallStatus(checks: readonly TeachingDoctorCheckItem[]): TeachingDoctorCheckResult {
  if (checks.some((check) => check.result === 'error')) return 'error'
  if (checks.some((check) => check.result === 'fail')) return 'fail'
  if (checks.some((check) => check.result === 'warning')) return 'warning'
  if (checks.every((check) => check.result === 'skipped')) return 'skipped'
  if (checks.some((check) => check.result === 'ok')) return 'ok'
  return 'skipped'
}

function item(
  checkId: TeachingDoctorCheckId,
  result: TeachingDoctorCheckResult,
  summary: string,
  evidence: TeachingDoctorSafeEvidence,
  repairRecommendation: TeachingDoctorRepairRecommendation,
  recommendedAction: string,
  extras: { configPath?: string | null; fixSuggestion?: TeachingDoctorFixSuggestion | null } = {}
): TeachingDoctorCheckItem {
  const fix = extras.fixSuggestion
    ? {
        code: extras.fixSuggestion.code,
        title: redactText(extras.fixSuggestion.title),
        steps: extras.fixSuggestion.steps.map(redactText),
        configPath: extras.fixSuggestion.configPath != null
          ? redactText(String(extras.fixSuggestion.configPath))
          : extras.fixSuggestion.configPath,
        docsRef: extras.fixSuggestion.docsRef != null
          ? redactText(String(extras.fixSuggestion.docsRef))
          : extras.fixSuggestion.docsRef
      }
    : extras.fixSuggestion
  return {
    checkId,
    result,
    summary: redactText(summary),
    evidence: redactEvidence(evidence),
    recommendedAction: redactText(recommendedAction),
    repair: {
      kind: repairRecommendation.kind,
      description: redactText(repairRecommendation.description),
      autoRepairAllowed: false
    },
    ...(extras.configPath !== undefined
      ? { configPath: extras.configPath != null ? redactText(String(extras.configPath)) : null }
      : {}),
    ...(fix !== undefined ? { fixSuggestion: fix } : {})
  }
}

function repair(kind: TeachingDoctorRepairRecommendation['kind'], description: string): TeachingDoctorRepairRecommendation {
  return { kind, description, autoRepairAllowed: false }
}

function emptyEvidence(): TeachingDoctorSafeEvidence {
  return { fields: {}, notes: [] }
}

function safeEvidence(
  fields: Record<string, string | number | boolean | null>,
  notes: string[] = []
): TeachingDoctorSafeEvidence {
  const safeFields: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(fields)) {
    safeFields[key] = typeof value === 'string' ? redactText(value) : value
  }
  return {
    fields: safeFields,
    notes: notes.map(redactText)
  }
}

function redactEvidence(evidence: TeachingDoctorSafeEvidence): TeachingDoctorSafeEvidence {
  const fields: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(evidence.fields)) {
    fields[key] = typeof value === 'string' ? redactText(value) : value
  }
  return {
    fields,
    notes: evidence.notes.map(redactText)
  }
}

function redactReport(report: TeachingDoctorReport): TeachingDoctorReport {
  return {
    ...report,
    generatedAt: redactText(report.generatedAt),
    checks: report.checks.map((check) => ({
      ...check,
      summary: redactText(check.summary),
      recommendedAction: redactText(check.recommendedAction),
      evidence: redactEvidence(check.evidence),
      repair: {
        kind: check.repair.kind,
        description: redactText(check.repair.description),
        autoRepairAllowed: false
      },
      ...(check.configPath !== undefined
        ? { configPath: check.configPath != null ? redactText(String(check.configPath)) : null }
        : {}),
      ...(check.fixSuggestion
        ? {
            fixSuggestion: {
              code: check.fixSuggestion.code,
              title: redactText(check.fixSuggestion.title),
              steps: check.fixSuggestion.steps.map(redactText),
              configPath:
                check.fixSuggestion.configPath != null
                  ? redactText(String(check.fixSuggestion.configPath))
                  : check.fixSuggestion.configPath,
              docsRef:
                check.fixSuggestion.docsRef != null
                  ? redactText(String(check.fixSuggestion.docsRef))
                  : check.fixSuggestion.docsRef
            }
          }
        : {})
    })),
    diagnostics: {
      redaction: redactText(report.diagnostics.redaction),
      autoRepair: 'disabled'
    }
  }
}

function redactText(value: string): string {
  return redactAgentSecretText(value)
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  if (!values) return []
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort()
}

