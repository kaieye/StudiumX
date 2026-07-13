import { describe, expect, it } from 'vitest'
import { GrowthSummary, type GrowthSummaryLabels } from '@renderer/views/workbench/analytics/components/GrowthSummary'
import { renderUi, screen } from '../helpers/render'

const labels: GrowthSummaryLabels = {
  empty: 'No growth activity',
  partial: 'Growth history is partial',
  unavailable: 'Growth unavailable',
  error: 'Growth failed',
  rangeXp: 'XP earned in range',
  rangeBasis: (range) => `Selected range: ${range}`,
  currentBasis: (asOf) => `Current state, independent of range: ${asOf}`,
  currentXp: 'Current lifetime XP',
  currentLevel: 'Current level',
  levelProgress: 'Current level progress',
  currentStreak: 'Current streak',
  badges: 'Current badges',
  plantStage: 'Current plant stage',
  unlockedBadge: 'Unlocked',
  lockedBadge: 'Locked',
  noBadges: 'No badges',
  missing: 'Not recorded',
  legacyUtcStreakWarning: 'Legacy streak used UTC date boundaries.'
}

const formatters = {
  number: (value: number) => String(value),
  percent: (ratio: number) => `${Math.round(ratio * 100)}%`,
  xp: (value: number) => `${value} XP`,
  days: (value: number) => `${value} days`
}

describe('GrowthSummary', () => {
  it('separates range XP from range-independent current growth and warns on legacy UTC streaks', () => {
    renderUi(
      <GrowthSummary
        state="partial"
        rangeXp={240}
        rangeLabel="July 1–7"
        currentAsOfLabel="July 13, 2026"
        legacyUtcStreak
        current={{
          xp: 4200,
          level: { level: 8, xpAtLevelStart: 4000, xpAtNextLevel: 5000, currentXp: 4200, progress: 0.2 },
          streakDays: 6,
          badges: [
            { id: 'rtl', label: 'إنجاز طويل جدًا 📚 学习者', unlocked: true },
            { id: 'locked', label: 'Next badge', unlocked: false }
          ],
          plantStage: '🌱 مرحلة النمو'
        }}
        labels={labels}
        formatters={formatters}
      />
    )

    expect(screen.getByText('Selected range: July 1–7')).toBeInTheDocument()
    expect(screen.getByText('Current state, independent of range: July 13, 2026')).toBeInTheDocument()
    expect(screen.getByText('240 XP')).toBeInTheDocument()
    expect(screen.getByText('4200 XP')).toBeInTheDocument()
    expect(screen.getByText(labels.legacyUtcStreakWarning)).toBeInTheDocument()
    expect(screen.getByText('إنجاز طويل جدًا 📚 学习者').closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('🌱 مرحلة النمو').closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('progressbar', { name: labels.levelProgress })).toHaveAttribute('aria-valuenow', '20')
    expect(screen.getByText(labels.unlockedBadge)).toHaveClass('sr-only')
    expect(screen.getByText(labels.lockedBadge)).toHaveClass('sr-only')
  })

  it('uses a missing label rather than a zero when range XP or current state is absent', () => {
    renderUi(
      <GrowthSummary
        state="partial"
        rangeXp={null}
        current={null}
        rangeLabel="Older range"
        currentAsOfLabel="Now"
        labels={labels}
        formatters={formatters}
      />
    )
    expect(screen.getAllByText(labels.missing).length).toBeGreaterThan(1)
    expect(screen.queryByText('0 XP')).not.toBeInTheDocument()
  })
})
