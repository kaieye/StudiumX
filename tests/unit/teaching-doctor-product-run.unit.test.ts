import { describe, expect, it } from 'vitest'

import {
  LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL,
  runProductTeachingDoctor,
  staticTeachingDoctorFactsCollector,
  type ProductTeachingDoctorCrashMarkerStore
} from '../../src/main/observability'
import { parseRunTeachingDoctorPayload } from '../../src/main/teaching-ipc-commands'
import type { CrashMarker } from '../../src/main/observability/crash-marker'
import type { TeachingDoctorReport } from '../../src/shared/teaching-types/teaching-doctor'

const NOW = '2026-07-21T04:00:00.000Z'

function byId(report: TeachingDoctorReport, checkId: string) {
  const item = report.checks.find((check) => check.checkId === checkId)
  if (!item) throw new Error(`missing check ${checkId}`)
  return item
}

function storeOf(marker: CrashMarker | null): ProductTeachingDoctorCrashMarkerStore {
  return {
    async read() {
      return marker
    }
  }
}

describe('parseRunTeachingDoctorPayload', () => {
  it('accepts undefined, null, and empty object', () => {
    expect(parseRunTeachingDoctorPayload(undefined)).toEqual({})
    expect(parseRunTeachingDoctorPayload(null)).toEqual({})
    expect(parseRunTeachingDoctorPayload({})).toEqual({})
  })

  it('accepts boolean includeProcessCrashMarker', () => {
    expect(parseRunTeachingDoctorPayload({ includeProcessCrashMarker: true })).toEqual({
      includeProcessCrashMarker: true
    })
    expect(parseRunTeachingDoctorPayload({ includeProcessCrashMarker: false })).toEqual({
      includeProcessCrashMarker: false
    })
  })

  it('rejects unknown keys and non-boolean include flag', () => {
    expect(() => parseRunTeachingDoctorPayload({ facts: {} })).toThrow(/includeProcessCrashMarker/i)
    expect(() => parseRunTeachingDoctorPayload({ includeProcessCrashMarker: 'yes' })).toThrow(/boolean/i)
    expect(() => parseRunTeachingDoctorPayload({ includeProcessCrashMarker: true, extra: 1 })).toThrow(
      /includeProcessCrashMarker/i
    )
  })
})

describe('runProductTeachingDoctor', () => {
  it('maps absent marker to present:false and ok process check (other checks skipped)', async () => {
    const report = await runProductTeachingDoctor(
      {},
      {
        crashMarkerStore: storeOf(null),
        now: () => NOW
      }
    )

    expect(report.generatedAt).toBe(NOW)
    expect(report.mode).toBe('read_only')
    expect(report.workspaceOpenPolicy).toBe('read_only_allowed')
    expect(report.diagnostics.autoRepair).toBe('disabled')
    expect(report.checks.every((check) => check.repair.autoRepairAllowed === false)).toBe(true)

    const processCheck = byId(report, 'local_process_crash_marker')
    expect(processCheck.result).toBe('ok')
    expect(processCheck.evidence.fields.present).toBe(false)
    expect(report.overallStatus).toBe('ok')

    // Other collectors not supplied → skipped
    expect(byId(report, 'p0_session_event_manifest_crash_window').result).toBe('skipped')
    expect(byId(report, 'config_availability').result).toBe('skipped')
  })

  it('maps present marker to warning path for local_process_crash_marker', async () => {
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: true },
      {
        crashMarkerStore: storeOf({
          schemaVersion: 1,
          writtenAt: '2026-07-20T07:55:00.000Z',
          reasonCode: 'uncaught_exception',
          runId: 'run_product'
        }),
        now: () => NOW
      }
    )

    const processCheck = byId(report, 'local_process_crash_marker')
    expect(processCheck.result).toBe('warning')
    expect(processCheck.evidence.fields.present).toBe(true)
    expect(processCheck.evidence.fields.reasonCode).toBe('uncaught_exception')
    expect(processCheck.evidence.fields.runId).toBe('run_product')
    expect(processCheck.repair.autoRepairAllowed).toBe(false)
    expect(processCheck.recommendedAction).toMatch(/clear|crash marker|never auto-upload/i)
    expect(report.overallStatus).toBe('warning')
  })

  it('prefers store as SoT for processCrashMarker when include is true', async () => {
    const report = await runProductTeachingDoctor(
      {
        includeProcessCrashMarker: true,
        facts: {
          processCrashMarker: { present: false }
        }
      },
      {
        crashMarkerStore: storeOf({
          schemaVersion: 1,
          writtenAt: '2026-07-21T01:00:00.000Z',
          reasonCode: 'unhandled_rejection'
        }),
        now: () => NOW
      }
    )
    const processCheck = byId(report, 'local_process_crash_marker')
    expect(processCheck.result).toBe('warning')
    expect(processCheck.evidence.fields.reasonCode).toBe('unhandled_rejection')
  })

  it('skips process marker collection when includeProcessCrashMarker is false', async () => {
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        crashMarkerStore: storeOf({
          schemaVersion: 1,
          writtenAt: '2026-07-20T07:55:00.000Z',
          reasonCode: 'uncaught_exception'
        }),
        now: () => NOW
      }
    )
    expect(byId(report, 'local_process_crash_marker').result).toBe('skipped')
  })

  it('does not throw on store failure; maps to present:false', async () => {
    const broken: ProductTeachingDoctorCrashMarkerStore = {
      async read() {
        throw new Error('disk offline C:\\Users\\Alice\\secret')
      }
    }
    const report = await runProductTeachingDoctor({}, { crashMarkerStore: broken, now: () => NOW })
    const processCheck = byId(report, 'local_process_crash_marker')
    expect(processCheck.result).toBe('ok')
    expect(processCheck.evidence.fields.present).toBe(false)
    const blob = JSON.stringify(report)
    // Error text from the store must not leak into the export-safe report.
    // (diagnostics.redaction may legitimately mention "secret-shaped tokens".)
    expect(blob).not.toMatch(/Alice|disk offline|C:\\Users/i)
  })

  it('export redacts secret-shaped tokens in evidence (smoke)', async () => {
    const report = await runProductTeachingDoctor(
      {
        includeProcessCrashMarker: true,
        facts: {
          config: {
            settingsAvailable: true,
            settingsReadable: true,
            settingsParseable: true,
            providerConfigured: false,
            reason: 'apiKey=sk-abc123secrettoken'
          }
        }
      },
      {
        crashMarkerStore: storeOf(null),
        now: () => NOW
      }
    )
    const blob = JSON.stringify(report)
    expect(blob).not.toMatch(/sk-abc123secrettoken/)
    expect(report.diagnostics.autoRepair).toBe('disabled')
  })

  it('works without a store (process check skipped)', async () => {
    const report = await runProductTeachingDoctor({}, { now: () => NOW })
    expect(byId(report, 'local_process_crash_marker').result).toBe('skipped')
  })

  it('factsCollectors populate config facts; processCrashMarker store remains SoT when include true', async () => {
    const configCollector = staticTeachingDoctorFactsCollector('config', {
      config: {
        settingsAvailable: true,
        settingsReadable: true,
        settingsParseable: true,
        providerConfigured: true,
        reason: null,
        configPath: 'userData/studiumx-settings.json'
      }
    })
    // Collector may also try to set processCrashMarker — store must win when include true.
    const markerCollector = staticTeachingDoctorFactsCollector('marker-spoof', {
      processCrashMarker: { present: false }
    })

    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: true },
      {
        crashMarkerStore: storeOf({
          schemaVersion: 1,
          writtenAt: '2026-07-21T02:00:00.000Z',
          reasonCode: 'uncaught_exception',
          runId: 'collector-sot'
        }),
        factsCollectors: [configCollector, markerCollector],
        now: () => NOW
      }
    )

    const configCheck = byId(report, 'config_availability')
    expect(configCheck.result).toBe('ok')
    expect(configCheck.evidence.fields.settingsAvailable).toBe(true)
    expect(configCheck.evidence.fields.providerConfigured).toBe(true)

    const processCheck = byId(report, 'local_process_crash_marker')
    expect(processCheck.result).toBe('warning')
    expect(processCheck.evidence.fields.present).toBe(true)
    expect(processCheck.evidence.fields.reasonCode).toBe('uncaught_exception')
    expect(processCheck.evidence.fields.runId).toBe('collector-sot')
  })

  it('include false does not collect marker; collector facts still present', async () => {
    const configCollector = staticTeachingDoctorFactsCollector('config', {
      config: {
        settingsAvailable: true,
        settingsReadable: false,
        settingsParseable: false,
        providerConfigured: false,
        reason: 'settings unreadable'
      }
    })

    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        crashMarkerStore: storeOf({
          schemaVersion: 1,
          writtenAt: '2026-07-20T07:55:00.000Z',
          reasonCode: 'uncaught_exception'
        }),
        factsCollectors: [configCollector],
        now: () => NOW
      }
    )

    expect(byId(report, 'local_process_crash_marker').result).toBe('skipped')
    const configCheck = byId(report, 'config_availability')
    // Unreadable settings typically warning/fail depending on pure doctor ladder — must not be skipped.
    expect(configCheck.result).not.toBe('skipped')
    expect(configCheck.evidence.fields.settingsAvailable).toBe(true)
    expect(configCheck.evidence.fields.settingsReadable).toBe(false)
  })

  it('skips failing collector and still applies others; export remains redacted', async () => {
    const boom = {
      id: 'boom',
      collect() {
        throw new Error('C:\\Users\\Alice\\leak sk-abc123secrettoken')
      }
    }
    const good = staticTeachingDoctorFactsCollector('config', {
      config: {
        settingsAvailable: true,
        settingsReadable: true,
        settingsParseable: true,
        providerConfigured: false,
        reason: 'apiKey=sk-abc123secrettoken'
      }
    })

    const report = await runProductTeachingDoctor(
      {},
      {
        crashMarkerStore: storeOf(null),
        factsCollectors: [boom, good],
        now: () => NOW
      }
    )

    expect(byId(report, 'config_availability').result).not.toBe('skipped')
    const blob = JSON.stringify(report)
    expect(blob).not.toMatch(/Alice|sk-abc123secrettoken|C:\\Users/i)
    expect(report.diagnostics.autoRepair).toBe('disabled')
  })
})

describe('B-11 bootstrap residual status', () => {
  it('records product-ipc residual closure for crash-marker bootstrap', () => {
    expect(LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL).toBe('main-process-hook-wired+product-ipc')
  })
})
