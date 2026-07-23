import { describe, expect, it } from 'vitest'

import {
  DANGEROUS_FEATURE_FLAG_KEYS,
  FEATURES,
  FEATURE_STAGES,
  FORBIDDEN_FEATURE_IDS,
  assertNoBypassKeys,
  featureCount,
  getFeature,
  isFeatureEnabled,
  isFeatureStage,
  isStageEnabled,
  listFeatures,
  type FeatureStage
} from '../../src/shared/features'

describe('FeatureStage', () => {
  it('exposes the Codex-aligned five stages', () => {
    expect(FEATURE_STAGES).toEqual([
      'under_development',
      'experimental',
      'stable',
      'deprecated',
      'removed'
    ])
    for (const stage of FEATURE_STAGES) {
      expect(isFeatureStage(stage)).toBe(true)
    }
    expect(isFeatureStage('Stable')).toBe(false)
    expect(isFeatureStage('yolo')).toBe(false)
  })
})

describe('FEATURES table integrity', () => {
  it('seeds a small honest teaching-only set', () => {
    expect(FEATURES.length).toBeGreaterThanOrEqual(6)
    expect(FEATURES.length).toBeLessThanOrEqual(14)
    expect(featureCount()).toBe(FEATURES.length)
  })

  it('has unique stable ids and required metadata', () => {
    const ids = FEATURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const feature of FEATURES) {
      expect(feature.id).toMatch(/^[a-z][a-z0-9_-]*$/)
      expect(feature.title.length).toBeGreaterThan(0)
      expect(FEATURE_STAGES).toContain(feature.stage)
      if (feature.footprintHint !== undefined) {
        expect([1, 2, 3, 4, 5]).toContain(feature.footprintHint)
      }
    }
  })

  it('does not register shell / code_mode / yolo bypass feature ids', () => {
    const ids = new Set(FEATURES.map((f) => f.id))
    for (const forbidden of FORBIDDEN_FEATURE_IDS) {
      expect(ids.has(forbidden)).toBe(false)
    }
    // Also reject substring-style product traps (marketplace is allowed as mcp-marketplace metadata)
    for (const feature of FEATURES) {
      expect(feature.id).not.toMatch(/shell|code[_-]?mode|yolo/i)
    }
  })

  it('registers mcp-marketplace as experimental product path (ADR-0141)', () => {
    const feature = getFeature('mcp-marketplace')
    expect(feature).toBeDefined()
    expect(feature!.stage).toBe('experimental')
    expect(feature!.summary).toMatch(/local|remote|catalog|目录/i)
    expect(feature!.summary).toMatch(/approval|审批/i)
    expect(isFeatureEnabled('mcp-marketplace')).toBe(false)
    expect(isFeatureEnabled('mcp-marketplace', { allowExperimental: true })).toBe(true)
  })
})

describe('listFeatures / getFeature', () => {
  it('lists a readonly snapshot matching FEATURES', () => {
    const listed = listFeatures()
    expect(listed).toBe(FEATURES)
    expect(listed.length).toBe(featureCount())
  })

  it('looks up known and unknown ids', () => {
    const sample = FEATURES[0]
    expect(getFeature(sample.id)).toEqual(sample)
    expect(getFeature('does-not-exist')).toBeUndefined()
    expect(getFeature('')).toBeUndefined()
  })
})

describe('isFeatureEnabled / isStageEnabled stage matrix', () => {
  it('enables only stable by default', () => {
    const stable = FEATURES.find((f) => f.stage === 'stable')
    const experimental = FEATURES.find((f) => f.stage === 'experimental')
    const underDev = FEATURES.find((f) => f.stage === 'under_development')
    expect(stable).toBeDefined()
    expect(experimental).toBeDefined()
    expect(underDev).toBeDefined()

    expect(isFeatureEnabled(stable!.id)).toBe(true)
    expect(isFeatureEnabled(experimental!.id)).toBe(false)
    expect(isFeatureEnabled(underDev!.id)).toBe(false)
    expect(isFeatureEnabled('missing-feature')).toBe(false)
  })

  it('enables experimental only with allowExperimental', () => {
    const experimental = FEATURES.find((f) => f.stage === 'experimental')!
    expect(isFeatureEnabled(experimental.id, { allowExperimental: false })).toBe(false)
    expect(isFeatureEnabled(experimental.id, { allowExperimental: true })).toBe(true)
    // under_development still off unless explicitly allowed
    const underDev = FEATURES.find((f) => f.stage === 'under_development')!
    expect(isFeatureEnabled(underDev.id, { allowExperimental: true })).toBe(false)
  })

  it('enables under_development only with allowUnderDevelopment', () => {
    const underDev = FEATURES.find((f) => f.stage === 'under_development')!
    expect(isFeatureEnabled(underDev.id)).toBe(false)
    expect(isFeatureEnabled(underDev.id, { allowUnderDevelopment: true })).toBe(true)
    // experimental still requires its own flag
    const experimental = FEATURES.find((f) => f.stage === 'experimental')!
    expect(isFeatureEnabled(experimental.id, { allowUnderDevelopment: true })).toBe(false)
  })

  it('never enables deprecated or removed stages (even with all allow opts)', () => {
    const allOn = { allowExperimental: true, allowUnderDevelopment: true }
    expect(isStageEnabled('deprecated')).toBe(false)
    expect(isStageEnabled('removed')).toBe(false)
    expect(isStageEnabled('deprecated', allOn)).toBe(false)
    expect(isStageEnabled('removed', allOn)).toBe(false)

    // Full stage matrix via pure helper (no need to seed deprecated/removed product ids)
    const matrix: Array<{
      stage: FeatureStage
      defaultOn: boolean
      withOpts: boolean
    }> = [
      { stage: 'stable', defaultOn: true, withOpts: true },
      { stage: 'experimental', defaultOn: false, withOpts: true },
      { stage: 'under_development', defaultOn: false, withOpts: true },
      { stage: 'deprecated', defaultOn: false, withOpts: false },
      { stage: 'removed', defaultOn: false, withOpts: false }
    ]
    for (const row of matrix) {
      expect(isStageEnabled(row.stage)).toBe(row.defaultOn)
      expect(isStageEnabled(row.stage, allOn)).toBe(row.withOpts)
    }
  })

  it('keeps stable on regardless of experimental/under_dev opts', () => {
    const stable = FEATURES.find((f) => f.stage === 'stable')!
    expect(
      isFeatureEnabled(stable.id, { allowExperimental: true, allowUnderDevelopment: true })
    ).toBe(true)
    expect(isStageEnabled('stable', { allowExperimental: false, allowUnderDevelopment: false })).toBe(
      true
    )
  })
})

describe('assertNoBypassKeys', () => {
  it('returns empty for clean or empty bags', () => {
    expect(assertNoBypassKeys({})).toEqual([])
    expect(assertNoBypassKeys({ 'consent-gated-learner-memory': true })).toEqual([])
    expect(assertNoBypassKeys({ temporary_chat: 1, experimental: true } as Record<string, unknown>)).toEqual([])
  })

  it('rejects known dangerous bypass keys', () => {
    const bag: Record<string, unknown> = {
      yolo: true,
      danger_full_access: 'on',
      always_approve: 1,
      tools_replayed: true,
      bypass_settlement: true,
      shell: true,
      code_mode: true,
      safe_flag: true
    }
    const rejected = assertNoBypassKeys(bag)
    expect(rejected.sort()).toEqual(
      [
        'yolo',
        'danger_full_access',
        'always_approve',
        'tools_replayed',
        'bypass_settlement',
        'shell',
        'code_mode'
      ].sort()
    )
    expect(rejected).not.toContain('safe_flag')
  })

  it('normalizes casing and hyphen variants', () => {
    const rejected = assertNoBypassKeys({
      YOLO: true,
      'Danger-Full-Access': 1,
      Code_Mode: false
    })
    expect(rejected.sort()).toEqual(['YOLO', 'Danger-Full-Access', 'Code_Mode'].sort())
  })

  it('covers the published dangerous key set', () => {
    expect(DANGEROUS_FEATURE_FLAG_KEYS).toEqual([
      'yolo',
      'danger_full_access',
      'always_approve',
      'tools_replayed',
      'bypass_settlement',
      'shell',
      'code_mode'
    ])
  })
})
