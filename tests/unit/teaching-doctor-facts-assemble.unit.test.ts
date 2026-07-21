import { describe, expect, it } from 'vitest'

import {
  assembleTeachingDoctorFacts,
  staticTeachingDoctorFactsCollector,
  type TeachingDoctorFactsCollector
} from '../../src/main/observability/teaching-doctor-facts-assemble'
import type { TeachingDoctorFacts } from '../../src/shared/teaching-types/teaching-doctor'

describe('assembleTeachingDoctorFacts', () => {
  it('returns shallow copy of base when no collectors', async () => {
    const base: TeachingDoctorFacts = {
      config: {
        settingsAvailable: true,
        settingsReadable: true,
        settingsParseable: true,
        providerConfigured: false,
        reason: 'no provider'
      }
    }
    const facts = await assembleTeachingDoctorFacts({ base })
    expect(facts).toEqual(base)
    expect(facts).not.toBe(base)
  })

  it('returns empty object when base and collectors omitted', async () => {
    const facts = await assembleTeachingDoctorFacts({})
    expect(facts).toEqual({})
  })

  it('merges collector partial over base (later overwrites same top-level key)', async () => {
    const base: TeachingDoctorFacts = {
      config: {
        settingsAvailable: false,
        settingsReadable: false,
        settingsParseable: false,
        providerConfigured: false,
        reason: 'base'
      },
      sourceGap: {
        status: 'unknown',
        availableSourceCount: 0,
        exclusionCodes: [],
        gapCount: 0
      }
    }
    const collector = staticTeachingDoctorFactsCollector('config-v2', {
      config: {
        settingsAvailable: true,
        settingsReadable: true,
        settingsParseable: true,
        providerConfigured: true,
        reason: null,
        configPath: 'userData/studiumx-settings.json'
      }
    })
    const facts = await assembleTeachingDoctorFacts({
      base,
      collectors: [collector]
    })
    expect(facts.config?.settingsAvailable).toBe(true)
    expect(facts.config?.providerConfigured).toBe(true)
    expect(facts.config?.configPath).toBe('userData/studiumx-settings.json')
    // Unrelated top-level key from base preserved
    expect(facts.sourceGap?.status).toBe('unknown')
  })

  it('later collectors overwrite earlier collectors for same top-level key', async () => {
    const first = staticTeachingDoctorFactsCollector('first', {
      catalogDrift: {
        requiresPersist: false,
        recoveredCount: 1,
        removedCount: 0,
        recoveredRelativePaths: ['a.md'],
        removedRelativePaths: []
      }
    })
    const second = staticTeachingDoctorFactsCollector('second', {
      catalogDrift: {
        requiresPersist: true,
        recoveredCount: 0,
        removedCount: 2,
        recoveredRelativePaths: [],
        removedRelativePaths: ['b.md', 'c.md']
      }
    })
    const facts = await assembleTeachingDoctorFacts({
      collectors: [first, second]
    })
    expect(facts.catalogDrift?.requiresPersist).toBe(true)
    expect(facts.catalogDrift?.removedCount).toBe(2)
    expect(facts.catalogDrift?.removedRelativePaths).toEqual(['b.md', 'c.md'])
  })

  it('skips collector throw / reject; other collectors still apply', async () => {
    const good: TeachingDoctorFactsCollector = {
      id: 'good-config',
      collect() {
        return {
          config: {
            settingsAvailable: true,
            settingsReadable: true,
            settingsParseable: true,
            providerConfigured: false,
            reason: 'ok-after-fail'
          }
        }
      }
    }
    const boomSync: TeachingDoctorFactsCollector = {
      id: 'boom-sync',
      collect() {
        throw new Error('disk offline C:\\Users\\Alice\\secret-token')
      }
    }
    const boomAsync: TeachingDoctorFactsCollector = {
      id: 'boom-async',
      async collect() {
        throw new Error('network leak sk-abc123secrettoken')
      }
    }
    const after: TeachingDoctorFactsCollector = {
      id: 'after',
      collect() {
        return {
          sourceGap: {
            status: 'ready',
            availableSourceCount: 2,
            exclusionCodes: [],
            gapCount: 0
          }
        }
      }
    }

    const facts = await assembleTeachingDoctorFacts({
      collectors: [good, boomSync, boomAsync, after]
    })
    expect(facts.config?.reason).toBe('ok-after-fail')
    expect(facts.sourceGap?.status).toBe('ready')
    // No secret leakage into returned facts object
    const blob = JSON.stringify(facts)
    expect(blob).not.toMatch(/Alice|sk-abc123|disk offline/i)
  })

  it('ignores null/undefined top-level keys from collectors (does not clear base)', async () => {
    const base: TeachingDoctorFacts = {
      config: {
        settingsAvailable: true,
        settingsReadable: true,
        settingsParseable: true,
        providerConfigured: true,
        reason: null
      }
    }
    const collector: TeachingDoctorFactsCollector = {
      id: 'nullish',
      collect() {
        return {
          config: null,
          sourceGap: undefined
        }
      }
    }
    const facts = await assembleTeachingDoctorFacts({ base, collectors: [collector] })
    expect(facts.config?.settingsAvailable).toBe(true)
    expect(facts.sourceGap).toBeUndefined()
  })

  it('supports async collect()', async () => {
    const collector: TeachingDoctorFactsCollector = {
      id: 'async',
      async collect() {
        return {
          outcomeCrashWindow: {
            pendingSettlementCount: 1,
            needsProjectionRepairCount: 0,
            reviewRequiredCount: 0,
            settledCount: 3
          }
        }
      }
    }
    const facts = await assembleTeachingDoctorFacts({ collectors: [collector] })
    expect(facts.outcomeCrashWindow?.pendingSettlementCount).toBe(1)
    expect(facts.outcomeCrashWindow?.settledCount).toBe(3)
  })
})

describe('staticTeachingDoctorFactsCollector', () => {
  it('exposes stable id and returns partial', async () => {
    const c = staticTeachingDoctorFactsCollector('static-1', {
      processCrashMarker: { present: false }
    })
    expect(c.id).toBe('static-1')
    await expect(Promise.resolve(c.collect())).resolves.toEqual({
      processCrashMarker: { present: false }
    })
  })
})
