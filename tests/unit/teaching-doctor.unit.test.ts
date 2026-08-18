import { describe, expect, it } from 'vitest'
import {
  createTeachingDoctor,
  exportTeachingDoctorReport,
  formatTeachingDoctorReport,
  runTeachingDoctor
} from '../../src/main/teaching-doctor'
import type { TeachingDoctorFacts, TeachingDoctorReport } from '../../src/shared/teaching-types/teaching-doctor'

const NOW = '2026-07-20T08:00:00.000Z'

function healthyFacts(): TeachingDoctorFacts {
  return {
    sessionCrashWindow: {
      pendingStageCount: 0,
      unsafeStageCount: 0,
      quarantinedSessionCount: 0,
      recoveryCount: 0,
      diagnosticCodes: [],
      eventManifestGapCount: 0
    },
    outcomeCrashWindow: {
      pendingSettlementCount: 0,
      needsProjectionRepairCount: 0,
      reviewRequiredCount: 0,
      settledCount: 2
    },
    config: {
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: true,
      providerConfigured: true,
      reason: null
    },
    sourceGap: {
      status: 'ready',
      availableSourceCount: 2,
      exclusionCodes: [],
      gapCount: 0
    },
    catalogDrift: {
      requiresPersist: false,
      recoveredCount: 0,
      removedCount: 0,
      recoveredRelativePaths: [],
      removedRelativePaths: []
    },
    processCrashMarker: {
      present: false
    },
    // ADR-0013: default-off MCP posture is a healthy 'ok' diagnosis.
    mcp: {
      implementationPresent: true,
      rootEnabled: false,
      serverCount: 0,
      enabledServerCount: 0,
      connectedServerCount: 0,
      errorServerCount: 0,
      servers: []
    },
    localDataIndex: {
      pathExists: true,
      indexPathLabel: 'userData/studiumx-index.sqlite',
      status: 'ready',
      reason: null,
      complete: true,
      rebuiltAt: NOW,
      migrationIds: ['0001', '0002'],
      issueCountsByCode: {}
    }
  }
}

function byId(report: TeachingDoctorReport, checkId: string) {
  const item = report.checks.find((check) => check.checkId === checkId)
  if (!item) throw new Error(`missing check ${checkId}`)
  return item
}

describe('TeachingDoctor', () => {
  it('reports ok when all supplied facts are healthy', () => {
    const report = runTeachingDoctor(healthyFacts(), NOW)

    expect(report.schemaVersion).toBe(1)
    expect(report.generatedAt).toBe(NOW)
    expect(report.mode).toBe('read_only')
    expect(report.workspaceOpenPolicy).toBe('read_only_allowed')
    expect(report.diagnostics.autoRepair).toBe('disabled')
    expect(report.overallStatus).toBe('ok')
    expect(report.checks).toHaveLength(8)
    expect(report.checks.every((check) => check.result === 'ok')).toBe(true)
    expect(report.checks.every((check) => check.repair.autoRepairAllowed === false)).toBe(true)
  })

  it('diagnoses the P0 session event/manifest crash window without auto-repair', () => {
    const facts = healthyFacts()
    facts.sessionCrashWindow = {
      pendingStageCount: 1,
      unsafeStageCount: 0,
      quarantinedSessionCount: 0,
      recoveryCount: 0,
      diagnosticCodes: ['stale_session_stage'],
      eventManifestGapCount: 1
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'p0_session_event_manifest_crash_window')

    expect(report.overallStatus).toBe('fail')
    expect(check.result).toBe('fail')
    expect(check.evidence.fields.eventManifestGapCount).toBe(1)
    expect(check.repair.kind).toBe('deterministic_projection_rebuild')
    expect(check.repair.autoRepairAllowed).toBe(false)
    expect(check.recommendedAction).toMatch(/manifest projection rebuild|ledger load/i)
  })

  it('diagnoses the P0 outcome publication crash window as a separate repair effect', () => {
    const facts = healthyFacts()
    facts.outcomeCrashWindow = {
      pendingSettlementCount: 1,
      needsProjectionRepairCount: 1,
      reviewRequiredCount: 0,
      settledCount: 0
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'p0_outcome_publication_crash_window')

    expect(report.overallStatus).toBe('fail')
    expect(check.result).toBe('fail')
    expect(check.evidence.fields.needsProjectionRepairCount).toBe(1)
    expect(check.repair.kind).toBe('deterministic_projection_rebuild')
    expect(check.repair.autoRepairAllowed).toBe(false)
    expect(check.recommendedAction).toMatch(/reconcile|separate effect/i)
  })

  it('flags configuration unavailability while keeping workspace open policy read-only', () => {
    const facts = healthyFacts()
    facts.config = {
      settingsAvailable: false,
      settingsReadable: false,
      settingsParseable: false,
      providerConfigured: false,
      reason: 'settings missing at userData',
      configPath: 'userData/studiumx-settings.json'
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'config_availability')

    expect(report.overallStatus).toBe('fail')
    expect(report.workspaceOpenPolicy).toBe('read_only_allowed')
    expect(check.result).toBe('fail')
    expect(check.recommendedAction).toMatch(/read-only/i)
    expect(check.configPath).toBe('userData/studiumx-settings.json')
    expect(check.fixSuggestion?.code).toBe('restore_settings_file')
    expect(check.fixSuggestion?.steps.length).toBeGreaterThan(0)
    expect(check.evidence.fields.configPath).toBe('userData/studiumx-settings.json')
  })

  it('includes configure_provider fix suggestion when provider is missing', () => {
    const facts = healthyFacts()
    facts.config = {
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: true,
      providerConfigured: false,
      reason: null,
      configPath: 'userData/studiumx-settings.json',
      configKey: 'provider'
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'config_availability')
    expect(check.result).toBe('warning')
    expect(check.fixSuggestion?.code).toBe('configure_provider')
    expect(check.configPath).toBe('userData/studiumx-settings.json')
    expect(check.fixSuggestion?.docsRef).toBe('diagnosing-provider')
  })

  it('reports source gaps from grounding readiness without inventing sources', () => {
    const facts = healthyFacts()
    facts.sourceGap = {
      status: 'unavailable',
      availableSourceCount: 0,
      exclusionCodes: ['resource_absent', 'source_unavailable'],
      gapCount: 2
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'source_gap')

    expect(check.result).toBe('fail')
    expect(check.evidence.fields.gapCount).toBe(2)
    expect(check.evidence.notes.some((note) => note.includes('resource_absent'))).toBe(true)
    expect(check.repair.kind).toBe('manual_review')
  })

  it('reports catalog drift as a warning with deterministic projection rebuild recommendation', () => {
    const facts = healthyFacts()
    facts.catalogDrift = {
      requiresPersist: true,
      recoveredCount: 1,
      removedCount: 1,
      recoveredRelativePaths: ['courses/demo/lesson/0001.html'],
      removedRelativePaths: ['courses/demo/lesson/gone.html']
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'catalog_drift')

    expect(report.overallStatus).toBe('warning')
    expect(check.result).toBe('warning')
    expect(check.repair.kind).toBe('deterministic_projection_rebuild')
    expect(check.repair.autoRepairAllowed).toBe(false)
    expect(check.evidence.notes.some((note) => note.includes('recovered='))).toBe(true)
  })

  it('skips missing fact groups instead of failing the whole report', () => {
    const report = runTeachingDoctor({}, NOW)

    expect(report.overallStatus).toBe('skipped')
    expect(report.workspaceOpenPolicy).toBe('read_only_allowed')
    expect(report.checks.every((check) => check.result === 'skipped')).toBe(true)
  })

  it('never auto-repairs and always allows read-only open even when overall status is fail', () => {
    const facts = healthyFacts()
    facts.sessionCrashWindow = {
      pendingStageCount: 0,
      unsafeStageCount: 1,
      quarantinedSessionCount: 0,
      recoveryCount: 0,
      diagnosticCodes: ['unsafe_session_stage'],
      eventManifestGapCount: 0
    }
    facts.outcomeCrashWindow = {
      pendingSettlementCount: 0,
      needsProjectionRepairCount: 1,
      reviewRequiredCount: 0,
      settledCount: 0
    }

    const doctor = createTeachingDoctor({ now: () => NOW })
    const report = doctor.run(facts)

    expect(report.overallStatus).toBe('fail')
    expect(report.workspaceOpenPolicy).toBe('read_only_allowed')
    expect(report.diagnostics.autoRepair).toBe('disabled')
    expect(report.checks.every((check) => check.repair.autoRepairAllowed === false)).toBe(true)
  })

  it('exports a redacted report that strips secret-shaped values', () => {
    const facts = healthyFacts()
    facts.config = {
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: true,
      providerConfigured: true,
      reason: 'provider token sk-should-not-leak and Bearer abcdefghijklmnop'
    }

    const report = runTeachingDoctor(facts, NOW)
    const exported = exportTeachingDoctorReport(report)
    const json = formatTeachingDoctorReport(exported, 'json')
    const text = formatTeachingDoctorReport(exported, 'text')

    expect(json).not.toMatch(/sk-should-not-leak/)
    expect(json).not.toMatch(/abcdefghijklmnop/)
    expect(json).toMatch(/\[redacted\]/i)
    expect(text).toMatch(/TeachingDoctor/)
    expect(text).toMatch(/workspace open: read_only_allowed/)
    expect(text).not.toMatch(/sk-should-not-leak/)
  })

  it('does not mutate deeply frozen facts', () => {
    const facts = deepFreeze(healthyFacts())
    const report = runTeachingDoctor(facts, NOW)
    expect(report.overallStatus).toBe('ok')
    expect(facts.sessionCrashWindow?.eventManifestGapCount).toBe(0)
  })

  it('warns on provider-unconfigured settings without failing config parse', () => {
    const facts = healthyFacts()
    facts.config = {
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: true,
      providerConfigured: false,
      reason: null
    }

    const report = runTeachingDoctor(facts, NOW)
    expect(byId(report, 'config_availability').result).toBe('warning')
    expect(report.overallStatus).toBe('warning')
  })

  it('reports a prior-process crash marker as warning without auto-repair or upload', () => {
    const facts = healthyFacts()
    facts.processCrashMarker = {
      present: true,
      writtenAt: '2026-07-20T07:55:00.000Z',
      reasonCode: 'uncaught_exception',
      runId: 'run_abc'
    }

    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'local_process_crash_marker')

    expect(report.overallStatus).toBe('warning')
    expect(check.result).toBe('warning')
    expect(check.evidence.fields.present).toBe(true)
    expect(check.evidence.fields.reasonCode).toBe('uncaught_exception')
    expect(check.repair.autoRepairAllowed).toBe(false)
    expect(check.recommendedAction).toMatch(/clear|crash marker|never auto-upload/i)
  })

  it('skips process crash marker when facts are omitted', () => {
    const facts = healthyFacts()
    delete facts.processCrashMarker
    const report = runTeachingDoctor(facts, NOW)
    const check = byId(report, 'local_process_crash_marker')
    expect(check.result).toBe('skipped')
  })

  it('reports stable local data index diagnostics for unavailable / incomplete / ready', () => {
    const unavailable = runTeachingDoctor(
      {
        ...healthyFacts(),
        localDataIndex: {
          pathExists: false,
          indexPathLabel: 'userData/studiumx-index.sqlite',
          status: 'unavailable',
          reason: 'native binding missing',
          complete: null,
          rebuiltAt: null,
          migrationIds: [],
          issueCountsByCode: {}
        }
      },
      NOW
    )
    const unavailableCheck = byId(unavailable, 'local_data_index')
    expect(unavailableCheck.result).toBe('warning')
    expect(unavailableCheck.evidence.fields.status).toBe('unavailable')
    expect(unavailableCheck.evidence.fields.pathExists).toBe(false)
    expect(unavailableCheck.evidence.fields.disposable).toBe(true)
    expect(unavailableCheck.evidence.notes.some((note) => /safely deleted and rebuilt/i.test(note))).toBe(true)
    expect(unavailableCheck.configPath).toBe('userData/studiumx-index.sqlite')
    expect(JSON.stringify(unavailableCheck)).not.toMatch(/\/Users\//)

    const incomplete = runTeachingDoctor(
      {
        ...healthyFacts(),
        localDataIndex: {
          pathExists: true,
          indexPathLabel: 'userData/studiumx-index.sqlite',
          status: 'incomplete',
          reason: null,
          complete: false,
          rebuiltAt: NOW,
          migrationIds: ['0001', '0002'],
          issueCountsByCode: { source_drift: 2, read_failed: 1 }
        }
      },
      NOW
    )
    const incompleteCheck = byId(incomplete, 'local_data_index')
    expect(incompleteCheck.result).toBe('warning')
    expect(incompleteCheck.evidence.fields.status).toBe('incomplete')
    expect(incompleteCheck.evidence.fields.complete).toBe(false)
    expect(incompleteCheck.evidence.fields.issueCount).toBe(3)
    expect(incompleteCheck.evidence.notes.some((note) => note.includes('source_drift=2'))).toBe(true)
    expect(incompleteCheck.evidence.notes.some((note) => note.includes('read_failed=1'))).toBe(true)
    expect(incompleteCheck.repair.kind).toBe('deterministic_projection_rebuild')
    expect(incompleteCheck.repair.autoRepairAllowed).toBe(false)
    expect(incompleteCheck.fixSuggestion?.code).toBe('rebuild_local_data_index')

    const ready = runTeachingDoctor(healthyFacts(), NOW)
    const readyCheck = byId(ready, 'local_data_index')
    expect(readyCheck.result).toBe('ok')
    expect(readyCheck.evidence.fields.status).toBe('ready')
    expect(readyCheck.evidence.fields.complete).toBe(true)
    expect(readyCheck.evidence.fields.migrationCount).toBe(2)
    expect(readyCheck.evidence.notes.some((note) => note.includes('migration_ids=0001,0002'))).toBe(true)
    expect(readyCheck.recommendedAction).toMatch(/safely deleted and rebuilt/i)
  })

  it('skips local data index when facts are omitted without failing other checks', () => {
    const facts = healthyFacts()
    delete facts.localDataIndex
    const report = runTeachingDoctor(facts, NOW)
    expect(byId(report, 'local_data_index').result).toBe('skipped')
    expect(byId(report, 'config_availability').result).toBe('ok')
  })


})

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as object)) deepFreeze(nested)
  }
  return value
}
