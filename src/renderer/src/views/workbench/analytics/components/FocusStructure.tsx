import type { CSSProperties } from 'react'
import type { AnalyticsDataState } from '../types'
import { CoreSectionState, type CoreStateLabels } from './CoreAnalyticsState'
import '../core-analytics.css'

export type CoreFocusStructureItem = {
  id: string
  label: string
  seconds: number | null
  share: number | null
  kind?: 'known' | 'unknown'
}

export type CoreFocusStructureGroup = {
  id: string
  label: string
  items: readonly CoreFocusStructureItem[]
}

export type CoreTaskFocusAttribution = {
  attributedSeconds: number | null
  unattributedSeconds: number | null
  topTasks: readonly {
    id: string
    title: string
    seconds: number
  }[]
}

export type CoreSessionStructure = {
  focusSeconds: number | null
  breakSeconds: number | null
  pausedSeconds: number | null
  completed: number | null
  interrupted: number | null
  canceled: number | null
  completionRate: number | null
  interruptionRate: number | null
}

export type FocusStructureLabels = CoreStateLabels & {
  unknown: string
  missing: string
  focus: string
  break: string
  paused: string
  completed: string
  interrupted: string
  canceled: string
  completionRate: string
  interruptionRate: string
  taskAttribution: string
  attributed: string
  unattributed: string
  topTasks: string
  noAttributedTasks: string
}

export type FocusStructureFormatters = {
  duration: (seconds: number) => string
  number: (value: number) => string
  percent: (ratio: number) => string
}

export type FocusStructureProps = {
  state: AnalyticsDataState
  dimensionGroups: readonly CoreFocusStructureGroup[]
  session: CoreSessionStructure
  taskAttribution: CoreTaskFocusAttribution
  labels: FocusStructureLabels
  formatters: FocusStructureFormatters
  warnings?: readonly string[]
  className?: string
}

function displayNullable(value: number | null, format: (value: number) => string, missing: string) {
  return value === null ? missing : format(value)
}

function StructureBar({
  item,
  labels,
  formatters
}: {
  item: CoreFocusStructureItem
  labels: FocusStructureLabels
  formatters: FocusStructureFormatters
}) {
  const unknown = item.kind === 'unknown' || item.seconds === null || item.share === null
  return (
    <li className={`focus-structure__bar${unknown ? ' is-unknown' : ''}`}>
      <div className="focus-structure__bar-label">
        <bdi dir="auto">{item.label || labels.unknown}</bdi>
        <span>
          {item.seconds === null ? labels.missing : formatters.duration(item.seconds)}
          {item.share === null ? '' : ` · ${formatters.percent(item.share)}`}
        </span>
      </div>
      <span className="focus-structure__track" aria-hidden="true">
        <span style={{ '--structure-share': item.share === null ? 0 : Math.max(0, Math.min(1, item.share)) } as CSSProperties} />
        {unknown ? <i>?</i> : null}
      </span>
    </li>
  )
}

export function FocusStructure({
  state,
  dimensionGroups,
  session,
  taskAttribution,
  labels,
  formatters,
  warnings,
  className = ''
}: FocusStructureProps) {
  const taskTotal = taskAttribution.attributedSeconds !== null && taskAttribution.unattributedSeconds !== null
    ? taskAttribution.attributedSeconds + taskAttribution.unattributedSeconds
    : null
  const taskBars: CoreFocusStructureItem[] = [
    {
      id: 'attributed',
      label: labels.attributed,
      seconds: taskAttribution.attributedSeconds,
      share: taskTotal && taskAttribution.attributedSeconds !== null ? taskAttribution.attributedSeconds / taskTotal : null
    },
    {
      id: 'unattributed',
      label: labels.unattributed,
      seconds: taskAttribution.unattributedSeconds,
      share: taskTotal && taskAttribution.unattributedSeconds !== null ? taskAttribution.unattributedSeconds / taskTotal : null,
      kind: 'unknown'
    }
  ]

  return (
    <section className={`core-analytics-card focus-structure ${className}`.trim()} data-state={state}>
      <CoreSectionState state={state} labels={labels} warnings={warnings}>
        <div className="focus-structure__dimensions">
          {dimensionGroups.map((group) => (
            <section key={group.id} className="focus-structure__group">
              <h3>{group.label}</h3>
              <ul>{group.items.map((item) => <StructureBar key={item.id} item={item} labels={labels} formatters={formatters} />)}</ul>
            </section>
          ))}
          <section className="focus-structure__group">
            <h3>{labels.taskAttribution}</h3>
            <ul>{taskBars.map((item) => <StructureBar key={item.id} item={item} labels={labels} formatters={formatters} />)}</ul>
          </section>
        </div>

        <dl className="focus-structure__session-grid">
          <div><dt>{labels.focus}</dt><dd>{displayNullable(session.focusSeconds, formatters.duration, labels.missing)}</dd></div>
          <div><dt>{labels.break}</dt><dd>{displayNullable(session.breakSeconds, formatters.duration, labels.missing)}</dd></div>
          <div><dt>{labels.paused}</dt><dd>{displayNullable(session.pausedSeconds, formatters.duration, labels.missing)}</dd></div>
          <div><dt>{labels.completed}</dt><dd>{displayNullable(session.completed, formatters.number, labels.missing)}</dd></div>
          <div><dt>{labels.interrupted}</dt><dd>{displayNullable(session.interrupted, formatters.number, labels.missing)}</dd></div>
          <div><dt>{labels.canceled}</dt><dd>{displayNullable(session.canceled, formatters.number, labels.missing)}</dd></div>
          <div><dt>{labels.completionRate}</dt><dd>{displayNullable(session.completionRate, formatters.percent, labels.missing)}</dd></div>
          <div><dt>{labels.interruptionRate}</dt><dd>{displayNullable(session.interruptionRate, formatters.percent, labels.missing)}</dd></div>
        </dl>

        <section className="focus-structure__tasks">
          <h3>{labels.topTasks}</h3>
          {taskAttribution.topTasks.length > 0 ? (
            <ol>
              {taskAttribution.topTasks.map((task) => (
                <li key={task.id}>
                  <bdi dir="auto">{task.title}</bdi>
                  <span>{formatters.duration(task.seconds)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="core-analytics-note">{labels.noAttributedTasks}</p>}
        </section>
      </CoreSectionState>
    </section>
  )
}
