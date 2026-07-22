/**
 * Study planning prefs strip (STC-404) — empty-start policy + classification opt-out.
 * Peel from WorkbenchPomodoro settings so the card stays thin.
 */

import { useMemo } from 'react'
import type { EmptyStartPolicy } from '../../../../shared/study-planning'
import { buildStudyPlanningPrefsModel } from '../../study-space/planning-study-prefs-ui'

export type StudyPlanningPrefsSectionProps = {
  emptyStartPolicy: EmptyStartPolicy
  classificationPromptOptOut: boolean
  onEmptyStartPolicyChange: (policy: EmptyStartPolicy) => void
  onClassificationPromptOptOutChange: (optOut: boolean) => void
}

export function StudyPlanningPrefsSection({
  emptyStartPolicy,
  classificationPromptOptOut,
  onEmptyStartPolicyChange,
  onClassificationPromptOptOutChange
}: StudyPlanningPrefsSectionProps) {
  const model = useMemo(
    () =>
      buildStudyPlanningPrefsModel({
        emptyStartPolicy,
        classificationPromptOptOut
      }),
    [emptyStartPolicy, classificationPromptOptOut]
  )

  return (
    <section className="workbench-study-planning-prefs" aria-label={model.copy.title}>
      <header className="workbench-study-planning-prefs__header">
        <strong>{model.copy.title}</strong>
        <p>{model.copy.description}</p>
      </header>

      <div className="workbench-study-planning-prefs__field">
        <span className="workbench-study-planning-prefs__label">{model.copy.emptyStartLabel}</span>
        <div
          className="workbench-study-planning-prefs__options"
          role="radiogroup"
          aria-label={model.copy.emptyStartLabel}
        >
          {model.options.map((option) => {
            const selected = option.value === model.emptyStartPolicy
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`workbench-study-planning-prefs__option${selected ? ' is-selected' : ''}`}
                onClick={() => onEmptyStartPolicyChange(option.value)}
              >
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </button>
            )
          })}
        </div>
      </div>

      <label className="workbench-study-planning-prefs__toggle">
        <input
          type="checkbox"
          checked={model.classificationPromptOptOut}
          onChange={(event) => onClassificationPromptOptOutChange(event.target.checked)}
          aria-label={model.copy.classificationOptOutLabel}
        />
        <span>
          <strong>{model.copy.classificationOptOutLabel}</strong>
          <small>{model.copy.classificationOptOutDetail}</small>
        </span>
      </label>
    </section>
  )
}
