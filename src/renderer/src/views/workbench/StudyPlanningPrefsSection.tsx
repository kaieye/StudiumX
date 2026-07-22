/**
 * Study planning prefs strip — empty-start category row (settings-style).
 * Embedded into 专注方案 after product subtraction of the standalone 启动偏好 page.
 */

import { useMemo } from 'react'
import { SettingsRow, SettingsSelect } from '../settings/SettingsPrimitives'
import {
  buildStudyPlanningPrefsModel,
  type EmptyStartCategoryOption
} from '../../study-space/planning-study-prefs-ui'

export type StudyPlanningPrefsSectionProps = {
  emptyStartCategoryId: string
  categoryOptions: readonly EmptyStartCategoryOption[]
  onEmptyStartCategoryIdChange: (categoryId: string) => void
  /**
   * Compact embed inside 专注方案: one settings-row only (no outer card).
   */
  compact?: boolean
}

export function StudyPlanningPrefsSection({
  emptyStartCategoryId,
  categoryOptions,
  onEmptyStartCategoryIdChange,
  compact = true
}: StudyPlanningPrefsSectionProps) {
  const model = useMemo(
    () =>
      buildStudyPlanningPrefsModel({
        emptyStartCategoryId,
        categoryOptions
      }),
    [emptyStartCategoryId, categoryOptions]
  )

  const options = useMemo(
    () =>
      (categoryOptions.length > 0
        ? categoryOptions
        : [{ value: model.emptyStartCategoryId, label: model.emptyStartCategoryId }]
      ).map((o) => ({ value: o.value, label: o.label })),
    [categoryOptions, model.emptyStartCategoryId]
  )

  const selected = options.some((o) => o.value === model.emptyStartCategoryId)
    ? model.emptyStartCategoryId
    : (options[0]?.value ?? 'other')

  const row = (
    <SettingsRow label={model.copy.emptyStartLabel} detail={model.copy.description}>
      <SettingsSelect
        value={selected}
        position="item-aligned"
        options={options}
        onChange={onEmptyStartCategoryIdChange}
      />
    </SettingsRow>
  )

  // Compact: plain row only (parent supplies SettingsCard).
  if (compact) {
    return (
      <div
        className="workbench-study-planning-prefs workbench-study-planning-prefs--row"
        role="region"
        aria-label={model.copy.title}
      >
        {row}
      </div>
    )
  }

  return (
    <section
      className="workbench-study-planning-prefs workbench-study-planning-prefs--row"
      aria-label={model.copy.title}
    >
      {row}
    </section>
  )
}
