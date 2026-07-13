import { CalendarDays } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnalyticsDateRange,
  AnalyticsRangePreset,
  TeachingAnalyticsScope
} from './types'
import {
  buildAnalyticsDateRange,
  validateCustomAnalyticsRange,
  type AnalyticsCustomRangeDraft
} from './useStudyAnalytics'
import { getAnalyticsCopy } from './analyticsCopy'

const DISPLAYED_PRESETS: readonly AnalyticsRangePreset[] = [
  'today',
  'week',
  'month',
  '90d',
  'custom'
]

export type AnalyticsRangeFilterProps = {
  value: AnalyticsDateRange
  localToday: string
  onChange: (range: AnalyticsDateRange) => void
}

export function AnalyticsRangeFilter({
  value,
  localToday,
  onChange
}: AnalyticsRangeFilterProps) {
  const { i18n } = useTranslation()
  const copy = getAnalyticsCopy(i18n.language)
  const [customOpen, setCustomOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [draft, setDraft] = useState<AnalyticsCustomRangeDraft>(() => ({
    from: value.preset === 'custom' ? value.from : value.from,
    to: value.preset === 'custom' ? value.to : localToday
  }))
  const customButtonRef = useRef<HTMLButtonElement>(null)
  const fromInputRef = useRef<HTMLInputElement>(null)
  const validation = validateCustomAnalyticsRange(draft, localToday)
  const fromInvalid = attempted && !validation.valid && (validation.field === 'from' || !validation.field)
  const toInvalid = attempted && !validation.valid && (validation.field === 'to' || !validation.field)
  const validationMessageId = 'analytics-custom-range-error'

  useEffect(() => {
    if (customOpen) fromInputRef.current?.focus({ preventScroll: true })
  }, [customOpen])

  const closeCustom = () => {
    setCustomOpen(false)
    setAttempted(false)
    customButtonRef.current?.focus({ preventScroll: true })
  }

  const selectPreset = (preset: AnalyticsRangePreset) => {
    if (preset === 'custom') {
      setDraft((current) => ({
        from: value.preset === 'custom' ? value.from : current.from || value.from,
        to: value.preset === 'custom' ? value.to : current.to || localToday
      }))
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    setAttempted(false)
    onChange(buildAnalyticsDateRange(preset, localToday))
  }

  const applyCustom = () => {
    setAttempted(true)
    if (!validation.valid) return
    onChange(buildAnalyticsDateRange('custom', localToday, draft))
    setCustomOpen(false)
    customButtonRef.current?.focus({ preventScroll: true })
  }

  return (
    <fieldset className="analytics-filter-group analytics-range-filter">
      <legend>{copy.ranges.legend}</legend>
      <div className="analytics-segmented-control" aria-label={copy.ranges.legend}>
        {DISPLAYED_PRESETS.map((preset) => (
          <button
            key={preset}
            ref={preset === 'custom' ? customButtonRef : undefined}
            type="button"
            className="analytics-filter-button"
            aria-pressed={value.preset === preset}
            aria-expanded={preset === 'custom' ? customOpen : undefined}
            aria-controls={preset === 'custom' ? 'analytics-custom-range' : undefined}
            onClick={() => selectPreset(preset)}
          >
            {preset === 'custom' ? <CalendarDays size={17} aria-hidden="true" /> : null}
            <span>{copy.ranges[preset]}</span>
          </button>
        ))}
      </div>

      {customOpen ? (
        <div
          id="analytics-custom-range"
          className="analytics-custom-range"
          role="group"
          aria-label={copy.ranges.customTitle}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            closeCustom()
          }}
        >
          <label>
            <span>{copy.ranges.from}</span>
            <input
              ref={fromInputRef}
              type="date"
              value={draft.from}
              max={localToday}
              aria-invalid={fromInvalid}
              aria-describedby={fromInvalid ? validationMessageId : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            />
          </label>
          <label>
            <span>{copy.ranges.to}</span>
            <input
              type="date"
              value={draft.to}
              max={localToday}
              aria-invalid={toInvalid}
              aria-describedby={toInvalid ? validationMessageId : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            />
          </label>
          <div className="analytics-custom-range-actions">
            <button type="button" className="analytics-secondary-button" onClick={closeCustom}>
              {copy.ranges.cancel}
            </button>
            <button type="button" className="analytics-primary-button" onClick={applyCustom}>
              {copy.ranges.apply}
            </button>
          </div>
          {attempted && !validation.valid ? (
            <p id={validationMessageId} className="analytics-field-error" role="alert">
              {validation.valid ? '' : copy.ranges.errors[validation.code]}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  )
}

export type AnalyticsTeachingScopeFilterProps = {
  value: TeachingAnalyticsScope
  activeWorkspace: { id: string; name: string } | null
  workspaces: Array<{ id: string; name: string }>
  presenceSpaceCode?: string | null
  onChange: (scope: TeachingAnalyticsScope) => void
}

export function AnalyticsTeachingScopeFilter({
  value,
  activeWorkspace,
  workspaces,
  presenceSpaceCode,
  onChange
}: AnalyticsTeachingScopeFilterProps) {
  const { i18n } = useTranslation()
  const copy = getAnalyticsCopy(i18n.language)
  const hasWorkspaces = workspaces.length > 0
  const allWorkspaceIds = workspaces.map((workspace) => workspace.id)

  return (
    <div className="analytics-scope-panel" aria-labelledby="analytics-scope-title">
      <div className="analytics-scope-heading">
        <h2 id="analytics-scope-title">{copy.scopes.title}</h2>
        <p>{copy.scopes.description}</p>
      </div>
      <dl className="analytics-domain-list">
        <div>
          <dt>{copy.scopes.personalLabel}</dt>
          <dd>{copy.scopes.personalValue}</dd>
        </div>
        <div className="analytics-domain-teaching">
          <dt>{copy.scopes.teachingLabel}</dt>
          <dd>
            {hasWorkspaces ? (
              <div className="analytics-segmented-control analytics-scope-control" aria-label={copy.scopes.teachingLabel}>
                <button
                  type="button"
                  className="analytics-filter-button"
                  aria-pressed={value.kind === 'workspace'}
                  disabled={!activeWorkspace}
                  title={!activeWorkspace ? copy.scopes.teachingCurrentUnavailable : undefined}
                  onClick={() => {
                    if (!activeWorkspace) return
                    onChange({
                      kind: 'workspace',
                      workspaceId: activeWorkspace.id,
                      workspaceName: activeWorkspace.name
                    })
                  }}
                >
                  {copy.scopes.teachingCurrent}
                </button>
                <button
                  type="button"
                  className="analytics-filter-button"
                  aria-pressed={value.kind === 'all_workspaces'}
                  onClick={() => onChange({ kind: 'all_workspaces', workspaceIds: allWorkspaceIds })}
                >
                  {copy.scopes.teachingAll}
                </button>
              </div>
            ) : (
              <span>{copy.scopes.teachingNone}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{copy.scopes.presenceLabel}</dt>
          <dd data-presence-scope="current">{presenceSpaceCode ? `${copy.scopes.presenceCurrent} · ${presenceSpaceCode}` : copy.scopes.presenceNone}</dd>
        </div>
      </dl>
    </div>
  )
}
