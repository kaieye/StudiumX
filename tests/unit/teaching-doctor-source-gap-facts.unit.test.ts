import { describe, expect, it } from 'vitest'

import {
  TEACHING_DOCTOR_SOURCE_GAP_CODE_HARD_CAP,
  createTeachingDoctorSourceGapFactsCollector,
  mapWorkspaceSummaryToSourceGapFacts,
  runProductTeachingDoctor,
  type TeachingDoctorSourceGapFactsSource,
  type TeachingDoctorSourceGapWorkspaceSummary
} from '../../src/main/observability'

function summary(
  partial: Partial<TeachingDoctorSourceGapWorkspaceSummary> = {}
): TeachingDoctorSourceGapWorkspaceSummary {
  return {
    resourcesCount: partial.resourcesCount ?? 0,
    referenceCount: partial.referenceCount ?? 0,
    assetsReady: partial.assetsReady ?? false
  }
}

describe('createTeachingDoctorSourceGapFactsCollector', () => {
  it('maps ready workspace summary into sourceGap facts', async () => {
    const source: TeachingDoctorSourceGapFactsSource = {
      async loadSummary() {
        return summary({ resourcesCount: 2, referenceCount: 1, assetsReady: true })
      }
    }
    const collector = createTeachingDoctorSourceGapFactsCollector(source)
    expect(collector.id).toBe('source-gap')

    const partial = await collector.collect()
    expect(partial.sourceGap).toEqual({
      status: 'ready',
      availableSourceCount: 3,
      exclusionCodes: [],
      gapCount: 0
    })
    expect(partial).not.toHaveProperty('config')
    expect(partial).not.toHaveProperty('catalogDrift')
    expect(partial).not.toHaveProperty('processCrashMarker')
  })

  it('returns empty partial when loadSummary yields null (no active workspace → skipped check)', async () => {
    const source: TeachingDoctorSourceGapFactsSource = {
      async loadSummary() {
        return null
      }
    }
    const partial = await createTeachingDoctorSourceGapFactsCollector(source).collect()
    expect(partial).toEqual({})
    expect(partial.sourceGap).toBeUndefined()
  })

  it('returns empty partial when loadSummary yields undefined', async () => {
    const source: TeachingDoctorSourceGapFactsSource = {
      async loadSummary() {
        return undefined
      }
    }
    const partial = await createTeachingDoctorSourceGapFactsCollector(source).collect()
    expect(partial).toEqual({})
  })

  it('fail-soft on loadSummary throw: empty partial, never rethrows secrets/paths', async () => {
    const source: TeachingDoctorSourceGapFactsSource = {
      async loadSummary() {
        throw new Error(`ENOENT C:\\Users\\Alice\\workspace\\resources key=sk-live-secret-xyz`)
      }
    }
    const collector = createTeachingDoctorSourceGapFactsCollector(source)
    const partial = await collector.collect()
    expect(partial).toEqual({})
    const blob = JSON.stringify(partial)
    expect(blob).not.toContain('Alice')
    expect(blob).not.toContain('sk-live')
    expect(blob).not.toMatch(/C:\\\\Users/i)
  })

  it('maps not_configured when assets not ready and no sources', () => {
    const mapped = mapWorkspaceSummaryToSourceGapFacts(
      summary({ resourcesCount: 0, referenceCount: 0, assetsReady: false })
    )
    expect(mapped).toEqual({
      status: 'not_configured',
      availableSourceCount: 0,
      exclusionCodes: ['assets_not_ready'],
      gapCount: 1
    })
  })

  it('maps degraded when assets not ready but sources exist', () => {
    const mapped = mapWorkspaceSummaryToSourceGapFacts(
      summary({ resourcesCount: 2, referenceCount: 0, assetsReady: false })
    )
    expect(mapped.status).toBe('degraded')
    expect(mapped.availableSourceCount).toBe(2)
    expect(mapped.exclusionCodes).toEqual(['assets_not_ready'])
    expect(mapped.gapCount).toBe(1)
  })

  it('maps unavailable when assets ready but no resources and no references', () => {
    const mapped = mapWorkspaceSummaryToSourceGapFacts(
      summary({ resourcesCount: 0, referenceCount: 0, assetsReady: true })
    )
    expect(mapped).toEqual({
      status: 'unavailable',
      availableSourceCount: 0,
      exclusionCodes: ['resource_absent'],
      gapCount: 1
    })
  })

  it('maps degraded resource_gap for reference-only workspaces', () => {
    const mapped = mapWorkspaceSummaryToSourceGapFacts(
      summary({ resourcesCount: 0, referenceCount: 3, assetsReady: true })
    )
    expect(mapped.status).toBe('degraded')
    expect(mapped.availableSourceCount).toBe(3)
    expect(mapped.exclusionCodes).toEqual(['resource_gap'])
    expect(mapped.gapCount).toBe(1)
  })

  it('hard-caps availableSourceCount as non-negative integers only', () => {
    const mapped = mapWorkspaceSummaryToSourceGapFacts({
      resourcesCount: -4 as unknown as number,
      referenceCount: Number.NaN as unknown as number,
      assetsReady: true
    })
    // negative/NaN → 0; zero resources + zero refs with assetsReady → unavailable
    expect(mapped.availableSourceCount).toBe(0)
    expect(mapped.status).toBe('unavailable')
    expect(mapped.exclusionCodes).toEqual(['resource_absent'])
  })

  it('never embeds absolute paths into facts blob', async () => {
    const source: TeachingDoctorSourceGapFactsSource = {
      async loadSummary() {
        return summary({ resourcesCount: 1, referenceCount: 0, assetsReady: true })
      }
    }
    const partial = await createTeachingDoctorSourceGapFactsCollector(source).collect()
    const blob = JSON.stringify(partial)
    expect(blob).not.toMatch(/C:\\\\Users|\/home\/|\/Users\//i)
    expect(blob).not.toContain('resourcesPath')
    expect(blob).not.toContain('referenceDir')
  })

  it(`exclusion code hard-cap constant is ${12}`, () => {
    expect(TEACHING_DOCTOR_SOURCE_GAP_CODE_HARD_CAP).toBe(12)
  })

  it('product-run with ready summary marks source_gap ok', async () => {
    const collector = createTeachingDoctorSourceGapFactsCollector({
      async loadSummary() {
        return summary({ resourcesCount: 1, referenceCount: 0, assetsReady: true })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'source_gap')
    expect(check).toBeDefined()
    expect(check?.result).toBe('ok')
    expect(check?.evidence.fields.availableSourceCount).toBe(1)
    expect(check?.evidence.fields.gapCount).toBe(0)
    expect(check?.repair.autoRepairAllowed).toBe(false)
    expect(report.diagnostics.autoRepair).toBe('disabled')
  })

  it('product-run with unavailable summary marks source_gap fail', async () => {
    const collector = createTeachingDoctorSourceGapFactsCollector({
      async loadSummary() {
        return summary({ resourcesCount: 0, referenceCount: 0, assetsReady: true })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'source_gap')
    expect(check?.result).toBe('fail')
    expect(check?.evidence.fields.status).toBe('unavailable')
    expect(check?.repair.autoRepairAllowed).toBe(false)
  })

  it('product-run with not_configured (zero sources) is fail via available===0 ladder', async () => {
    // Pure checkSourceGap fails when availableSourceCount===0 && gapCount>0,
    // even if status is not_configured (see teaching-doctor.ts).
    const collector = createTeachingDoctorSourceGapFactsCollector({
      async loadSummary() {
        return summary({ resourcesCount: 0, referenceCount: 0, assetsReady: false })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'source_gap')
    expect(check?.result).toBe('fail')
    expect(check?.evidence.fields.status).toBe('not_configured')
    expect(check?.evidence.fields.availableSourceCount).toBe(0)
    expect(check?.evidence.fields.gapCount).toBe(1)
  })

  it('product-run with degraded assets_not_ready (sources present) marks source_gap warning', async () => {
    const collector = createTeachingDoctorSourceGapFactsCollector({
      async loadSummary() {
        return summary({ resourcesCount: 2, referenceCount: 1, assetsReady: false })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'source_gap')
    expect(check?.result).toBe('warning')
    expect(check?.evidence.fields.status).toBe('degraded')
    expect(check?.evidence.fields.availableSourceCount).toBe(3)
  })

  it('product-run with null summary keeps source_gap skipped', async () => {
    const collector = createTeachingDoctorSourceGapFactsCollector({
      async loadSummary() {
        return null
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'source_gap')
    expect(check?.result).toBe('skipped')
  })
})

