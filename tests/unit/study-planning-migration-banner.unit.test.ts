import { describe, expect, it } from 'vitest'
import {
  buildMigrationBannerModel,
  normalizeMigrationBannerSummary,
  shouldOfferMigrationBanner
} from '../../src/renderer/src/study-space/planning-migration-banner'

describe('study-planning migration banner model (cutover B UX)', () => {
  it('normalizes partial / invalid summary counts to non-negative ints', () => {
    expect(
      normalizeMigrationBannerSummary({
        taskCount: 2.7,
        scheduleBlockCount: -3,
        timerPlanCount: 'x' as unknown as number,
        suggestedWindowCount: undefined
      })
    ).toEqual({
      taskCount: 2,
      scheduleBlockCount: 0,
      timerPlanCount: 0,
      suggestedWindowCount: 0
    })
    expect(normalizeMigrationBannerSummary(null)).toEqual({
      taskCount: 0,
      scheduleBlockCount: 0,
      timerPlanCount: 0,
      suggestedWindowCount: 0
    })
  })

  it('builds confirmable model when at least one migratable row exists', () => {
    const model = buildMigrationBannerModel({
      summary: {
        taskCount: 3,
        scheduleBlockCount: 2,
        timerPlanCount: 1,
        suggestedWindowCount: 4
      }
    })
    expect(model.kind).toBe('prompt')
    expect(model.canConfirm).toBe(true)
    expect(model.copy.eyebrow).toBe('工作区迁移')
    expect(model.copy.title).toContain('迁移')
    expect(model.copy.confirmLabel).toBe('确认迁移')
    expect(model.copy.metaLine).toContain('任务 3')
    expect(model.copy.metaLine).toContain('日程块 2')
    expect(model.copy.metaLine).toContain('计时方案 1')
    expect(model.copy.metaLine).toContain('模拟时段建议 4')
    expect(model.summary.suggestedWindowCount).toBe(4)
  })

  it('disables confirm when summary is empty', () => {
    const model = buildMigrationBannerModel({
      summary: {
        taskCount: 0,
        scheduleBlockCount: 0,
        timerPlanCount: 0,
        suggestedWindowCount: 9
      }
    })
    expect(model.canConfirm).toBe(false)
    expect(model.copy.title).toContain('暂无')
    expect(model.copy.confirmLabel).toBe('确认迁移')
    // suggested windows alone do not enable confirm (not durable history)
    expect(model.copy.metaLine).toContain('模拟时段建议 9')
  })

  it('shows busy label on confirm when busy=true', () => {
    const model = buildMigrationBannerModel({
      summary: {
        taskCount: 1,
        scheduleBlockCount: 0,
        timerPlanCount: 0,
        suggestedWindowCount: 0
      },
      busy: true
    })
    expect(model.canConfirm).toBe(true)
    expect(model.copy.confirmLabel).toBe('正在迁移…')
    expect(model.copy.busyLabel).toContain('写入')
  })

  it('shouldOfferMigrationBanner only when suggested + host tasks and not race-unknown', () => {
    expect(
      shouldOfferMigrationBanner({
        migrationSuggested: true,
        hostTaskCount: 2,
        reason: 'canonical_empty'
      })
    ).toBe(true)
    expect(
      shouldOfferMigrationBanner({
        migrationSuggested: false,
        hostTaskCount: 2,
        reason: 'canonical_empty'
      })
    ).toBe(false)
    expect(
      shouldOfferMigrationBanner({
        migrationSuggested: true,
        hostTaskCount: 0,
        reason: 'canonical_empty'
      })
    ).toBe(false)
    expect(
      shouldOfferMigrationBanner({
        migrationSuggested: true,
        hostTaskCount: 2,
        reason: 'unknown'
      })
    ).toBe(false)
  })
})
