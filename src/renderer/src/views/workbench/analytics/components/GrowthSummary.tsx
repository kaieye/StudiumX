import type { CSSProperties } from 'react'
import type { AnalyticsDataState, FocusAnalytics } from '../types'
import { CoreSectionState, type CoreStateLabels } from './CoreAnalyticsState'
import '../core-analytics.css'

export type GrowthSummaryLabels = CoreStateLabels & {
  rangeXp: string
  rangeBasis: (rangeLabel: string) => string
  currentBasis: (asOfLabel: string) => string
  currentXp: string
  currentLevel: string
  levelProgress: string
  currentStreak: string
  badges: string
  plantStage: string
  unlockedBadge: string
  lockedBadge: string
  noBadges: string
  missing: string
  legacyUtcStreakWarning: string
}

export type GrowthSummaryFormatters = {
  number: (value: number) => string
  percent: (ratio: number) => string
  xp: (value: number) => string
  days: (value: number) => string
}

export type GrowthSummaryProps = {
  state: AnalyticsDataState
  rangeXp: number | null
  current: FocusAnalytics['currentGrowth'] | null
  rangeLabel: string
  currentAsOfLabel: string
  legacyUtcStreak?: boolean
  labels: GrowthSummaryLabels
  formatters: GrowthSummaryFormatters
  warnings?: readonly string[]
  className?: string
}

export function GrowthSummary({
  state,
  rangeXp,
  current,
  rangeLabel,
  currentAsOfLabel,
  legacyUtcStreak = false,
  labels,
  formatters,
  warnings,
  className = ''
}: GrowthSummaryProps) {
  const mergedWarnings = legacyUtcStreak
    ? [...(warnings ?? []), labels.legacyUtcStreakWarning]
    : warnings
  const levelProgress = current?.level.progress ?? null

  return (
    <section className={`core-analytics-card growth-summary ${className}`.trim()} data-state={state}>
      <CoreSectionState state={state} labels={labels} warnings={mergedWarnings}>
        <div className="growth-summary__basis-grid">
          <section className="growth-summary__basis growth-summary__basis--range" aria-label={labels.rangeBasis(rangeLabel)}>
            <span className="growth-summary__eyebrow">{labels.rangeBasis(rangeLabel)}</span>
            <dl>
              <div>
                <dt>{labels.rangeXp}</dt>
                <dd>{rangeXp === null ? labels.missing : formatters.xp(rangeXp)}</dd>
              </div>
            </dl>
          </section>
          <section className="growth-summary__basis growth-summary__basis--current" aria-label={labels.currentBasis(currentAsOfLabel)}>
            <span className="growth-summary__eyebrow">{labels.currentBasis(currentAsOfLabel)}</span>
            <dl>
              <div><dt>{labels.currentXp}</dt><dd>{current ? formatters.xp(current.xp) : labels.missing}</dd></div>
              <div><dt>{labels.currentLevel}</dt><dd>{current ? formatters.number(current.level.level) : labels.missing}</dd></div>
              <div><dt>{labels.currentStreak}</dt><dd>{current ? formatters.days(current.streakDays) : labels.missing}</dd></div>
              <div><dt>{labels.plantStage}</dt><dd><bdi dir="auto">{current?.plantStage ?? labels.missing}</bdi></dd></div>
            </dl>
            <div className="growth-summary__level-progress">
              <div>
                <span>{labels.levelProgress}</span>
                <strong>{levelProgress === null ? labels.missing : formatters.percent(levelProgress)}</strong>
              </div>
              <span
                className="growth-summary__progress-track"
                role="progressbar"
                aria-label={labels.levelProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={levelProgress === null ? undefined : Math.round(levelProgress * 100)}
                aria-valuetext={levelProgress === null ? labels.missing : formatters.percent(levelProgress)}
              >
                <span style={{ '--growth-progress': levelProgress === null ? 0 : Math.max(0, Math.min(1, levelProgress)) } as CSSProperties} />
              </span>
            </div>
          </section>
        </div>

        <section className="growth-summary__badges">
          <h3>{labels.badges}</h3>
          {current && current.badges.length > 0 ? (
            <ul>
              {current.badges.map((badge) => (
                <li key={badge.id} data-unlocked={badge.unlocked}>
                  <span aria-hidden="true">{badge.unlocked ? '◆' : '◇'}</span>
                  <bdi dir="auto">{badge.label}</bdi>
                  <span className="sr-only">{badge.unlocked ? labels.unlockedBadge : labels.lockedBadge}</span>
                </li>
              ))}
            </ul>
          ) : <p className="core-analytics-note">{current ? labels.noBadges : labels.missing}</p>}
        </section>
      </CoreSectionState>
    </section>
  )
}
