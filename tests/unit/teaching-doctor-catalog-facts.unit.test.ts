import { describe, expect, it } from 'vitest'

import {
  TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP,
  createTeachingDoctorCatalogDriftFactsCollector,
  mapPlanToCatalogDriftFacts,
  runProductTeachingDoctor,
  type TeachingDoctorCatalogDriftPlan,
  type TeachingDoctorCatalogFactsSource
} from '../../src/main/observability'

function plan(
  partial: Partial<TeachingDoctorCatalogDriftPlan> & {
    recoveredRelativePaths?: readonly string[]
    removedRelativePaths?: readonly string[]
  } = {}
): TeachingDoctorCatalogDriftPlan {
  return {
    requiresPersist: partial.requiresPersist ?? false,
    recoveredRelativePaths: partial.recoveredRelativePaths ?? [],
    removedRelativePaths: partial.removedRelativePaths ?? []
  }
}

describe('createTeachingDoctorCatalogDriftFactsCollector', () => {
  it('maps successful plan into catalogDrift with counts and relative paths', async () => {
    const source: TeachingDoctorCatalogFactsSource = {
      async loadPlan() {
        return plan({
          requiresPersist: true,
          recoveredRelativePaths: ['course-a/01-intro.html', 'course-a/02-lab.html'],
          removedRelativePaths: ['course-a/gone.html']
        })
      }
    }
    const collector = createTeachingDoctorCatalogDriftFactsCollector(source)
    expect(collector.id).toBe('catalog-drift')

    const partial = await collector.collect()
    expect(partial.catalogDrift).toEqual({
      requiresPersist: true,
      recoveredCount: 2,
      removedCount: 1,
      recoveredRelativePaths: ['course-a/01-intro.html', 'course-a/02-lab.html'],
      removedRelativePaths: ['course-a/gone.html']
    })
    expect(partial).not.toHaveProperty('config')
    expect(partial).not.toHaveProperty('processCrashMarker')
  })

  it('returns empty partial when loadPlan yields null (no active workspace → skipped check)', async () => {
    const source: TeachingDoctorCatalogFactsSource = {
      async loadPlan() {
        return null
      }
    }
    const partial = await createTeachingDoctorCatalogDriftFactsCollector(source).collect()
    expect(partial).toEqual({})
    expect(partial.catalogDrift).toBeUndefined()
  })

  it('returns empty partial when loadPlan yields undefined', async () => {
    const source: TeachingDoctorCatalogFactsSource = {
      async loadPlan() {
        return undefined
      }
    }
    const partial = await createTeachingDoctorCatalogDriftFactsCollector(source).collect()
    expect(partial).toEqual({})
  })

  it('fail-soft on loadPlan throw: empty partial, never rethrows secrets/paths', async () => {
    const source: TeachingDoctorCatalogFactsSource = {
      async loadPlan() {
        throw new Error(`ENOENT C:\\Users\\Alice\\workspace\\lesson.html key=sk-live-secret-xyz`)
      }
    }
    const collector = createTeachingDoctorCatalogDriftFactsCollector(source)
    const partial = await collector.collect()
    expect(partial).toEqual({})
    const blob = JSON.stringify(partial)
    expect(blob).not.toContain('Alice')
    expect(blob).not.toContain('sk-live')
    expect(blob).not.toMatch(/C:\\\\Users/i)
  })

  it('drops absolute / home-rooted path entries from samples', async () => {
    const source: TeachingDoctorCatalogFactsSource = {
      async loadPlan() {
        return plan({
          requiresPersist: true,
          recoveredRelativePaths: [
            'safe/relative.html',
            'C:\\Users\\Alice\\secret\\lesson.html',
            '/home/alice/ws/lesson.html',
            '/Users/alice/Documents/x.html',
            'course/ok.html'
          ],
          removedRelativePaths: [
            '\\\\server\\share\\x.html',
            'removed/ok.html',
            '~/Downloads/x.html'
          ]
        })
      }
    }
    const partial = await createTeachingDoctorCatalogDriftFactsCollector(source).collect()
    expect(partial.catalogDrift?.recoveredRelativePaths).toEqual([
      'safe/relative.html',
      'course/ok.html'
    ])
    expect(partial.catalogDrift?.removedRelativePaths).toEqual(['removed/ok.html'])
    // Counts reflect sanitized lists only (absolute entries never count).
    expect(partial.catalogDrift?.recoveredCount).toBe(2)
    expect(partial.catalogDrift?.removedCount).toBe(1)

    const blob = JSON.stringify(partial)
    expect(blob).not.toMatch(/Alice|Users|home\/alice|C:\\\\Users/i)
    expect(blob).not.toContain('~/Downloads')
  })

  it('hard-caps path samples at TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP', async () => {
    const many = Array.from({ length: TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP + 10 }, (_, i) =>
      `course/lesson-${String(i).padStart(3, '0')}.html`
    )
    const source: TeachingDoctorCatalogFactsSource = {
      async loadPlan() {
        return plan({
          requiresPersist: true,
          recoveredRelativePaths: many,
          removedRelativePaths: many
        })
      }
    }
    const partial = await createTeachingDoctorCatalogDriftFactsCollector(source).collect()
    expect(partial.catalogDrift?.recoveredRelativePaths).toHaveLength(
      TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP
    )
    expect(partial.catalogDrift?.removedRelativePaths).toHaveLength(
      TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP
    )
    // Counts use full sanitized length before sample cap.
    expect(partial.catalogDrift?.recoveredCount).toBe(many.length)
    expect(partial.catalogDrift?.removedCount).toBe(many.length)
  })

  it('normalizes backslashes and de-duplicates relative paths', async () => {
    const mapped = mapPlanToCatalogDriftFacts(
      plan({
        requiresPersist: false,
        recoveredRelativePaths: ['course\\a.html', 'course/a.html', './course/b.html', ''],
        removedRelativePaths: ['x.html', 'x.html']
      })
    )
    expect(mapped.recoveredRelativePaths).toEqual(['course/a.html', 'course/b.html'])
    expect(mapped.removedRelativePaths).toEqual(['x.html'])
    expect(mapped.recoveredCount).toBe(2)
    expect(mapped.removedCount).toBe(1)
    expect(mapped.requiresPersist).toBe(false)
  })

  it('product-run with collector surfaces catalog_drift warning when drift present', async () => {
    const collector = createTeachingDoctorCatalogDriftFactsCollector({
      async loadPlan() {
        return plan({
          requiresPersist: true,
          recoveredRelativePaths: ['new/lesson.html'],
          removedRelativePaths: []
        })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'catalog_drift')
    expect(check).toBeDefined()
    expect(check?.result).toBe('warning')
    expect(check?.evidence.fields.requiresPersist).toBe(true)
    expect(check?.evidence.fields.recoveredCount).toBe(1)
    expect(check?.repair.autoRepairAllowed).toBe(false)
    expect(report.diagnostics.autoRepair).toBe('disabled')

    const blob = JSON.stringify(report)
    expect(blob).not.toMatch(/C:\\\\Users|\/home\//i)
  })

  it('product-run with null plan keeps catalog_drift skipped', async () => {
    const collector = createTeachingDoctorCatalogDriftFactsCollector({
      async loadPlan() {
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
    const check = report.checks.find((c) => c.checkId === 'catalog_drift')
    expect(check?.result).toBe('skipped')
  })

  it('product-run with clean plan marks catalog_drift ok', async () => {
    const collector = createTeachingDoctorCatalogDriftFactsCollector({
      async loadPlan() {
        return plan({
          requiresPersist: false,
          recoveredRelativePaths: [],
          removedRelativePaths: []
        })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const check = report.checks.find((c) => c.checkId === 'catalog_drift')
    expect(check?.result).toBe('ok')
    expect(check?.evidence.fields.requiresPersist).toBe(false)
    expect(check?.evidence.fields.recoveredCount).toBe(0)
    expect(check?.evidence.fields.removedCount).toBe(0)
  })
})
