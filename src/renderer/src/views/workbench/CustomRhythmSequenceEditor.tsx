/**
 * STC-702: ordered custom rhythm sequence editor (non-freeform).
 *
 * ADR-0130 §2: rows = kind select + minutes + up/down/delete + add.
 * No freeform drag/canvas. Validation via normalizeCustomRhythmSequence.
 */

import {
  CUSTOM_RHYTHM_SEED_LIMITS,
  normalizeCustomRhythmSequence,
  sumCustomRhythmMinutes,
  type CustomRhythmStep,
  type CustomRhythmStepKind
} from '../../../../shared/study-planning'

const STEP_KIND_OPTIONS: readonly { value: CustomRhythmStepKind; label: string }[] = [
  { value: 'focus', label: '专注' },
  { value: 'short_break', label: '短休息' },
  { value: 'long_break', label: '长休息' },
  { value: 'wrap_up', label: '收尾' }
] as const

export const DEFAULT_CUSTOM_RHYTHM_SEQUENCE: CustomRhythmStep[] = [
  { kind: 'focus', minutes: 25 },
  { kind: 'short_break', minutes: 5 },
  { kind: 'focus', minutes: 25 },
  { kind: 'short_break', minutes: 5 },
  { kind: 'focus', minutes: 25 },
  { kind: 'long_break', minutes: 15 }
]

export type CustomRhythmSequenceEditorProps = {
  sequence: readonly CustomRhythmStep[]
  onChange: (next: CustomRhythmStep[]) => void
  disabled?: boolean
}

function clampMinutesForKind(kind: CustomRhythmStepKind, minutes: number): number {
  const n = Number.isFinite(minutes) ? Math.trunc(minutes) : 1
  switch (kind) {
    case 'focus':
      return Math.min(
        CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMax,
        Math.max(CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMin, n)
      )
    case 'short_break':
      return Math.min(
        CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMax,
        Math.max(CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMin, n)
      )
    case 'long_break':
      return Math.min(
        CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMax,
        Math.max(CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMin, n)
      )
    case 'wrap_up':
      return Math.min(
        CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMax,
        Math.max(CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMin, n)
      )
    default:
      return Math.max(1, n)
  }
}

export function CustomRhythmSequenceEditor({
  sequence,
  onChange,
  disabled = false
}: CustomRhythmSequenceEditorProps) {
  const steps = sequence.length > 0 ? [...sequence] : [...DEFAULT_CUSTOM_RHYTHM_SEQUENCE]
  const validation = normalizeCustomRhythmSequence(steps)
  const totals = sumCustomRhythmMinutes(steps)
  const issues =
    !validation.ok
      ? validation.issues
      : validation.warnings

  const commit = (next: CustomRhythmStep[]): void => {
    onChange(next.map((s) => ({ kind: s.kind, minutes: s.minutes })))
  }

  const updateStep = (index: number, patch: Partial<CustomRhythmStep>): void => {
    if (disabled || index < 0 || index >= steps.length) return
    const next = steps.map((s, i) => {
      if (i !== index) return s
      const kind = patch.kind ?? s.kind
      const minutes = clampMinutesForKind(kind, patch.minutes ?? s.minutes)
      return { kind, minutes }
    })
    commit(next)
  }

  const moveStep = (index: number, delta: -1 | 1): void => {
    if (disabled) return
    const target = index + delta
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const tmp = next[index]
    next[index] = next[target]
    next[target] = tmp
    commit(next)
  }

  const deleteStep = (index: number): void => {
    if (disabled || steps.length <= 1) return
    commit(steps.filter((_, i) => i !== index))
  }

  const addStep = (): void => {
    if (disabled || steps.length >= CUSTOM_RHYTHM_SEED_LIMITS.stepsMax) return
    commit([...steps, { kind: 'focus', minutes: 25 }])
  }

  return (
    <div className="workbench-custom-rhythm-editor" aria-label="自定义节奏序列">
      <div className="workbench-custom-rhythm-editor__head">
        <span>节奏步骤</span>
        <em>
          {steps.length} 步 · 合计 {totals.totalMinutes} 分
        </em>
      </div>
      <ol className="workbench-custom-rhythm-editor__list">
        {steps.map((step, index) => (
          <li key={`step-${index}`} className="workbench-custom-rhythm-editor__row">
            <span className="workbench-custom-rhythm-editor__index" aria-hidden="true">
              {index + 1}
            </span>
            <select
              aria-label={`步骤 ${index + 1} 类型`}
              value={step.kind}
              disabled={disabled}
              onChange={(event) =>
                updateStep(index, { kind: event.target.value as CustomRhythmStepKind })
              }
            >
              {STEP_KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="workbench-pomodoro-number-input">
              <input
                type="number"
                aria-label={`步骤 ${index + 1} 分钟`}
                value={step.minutes}
                min={1}
                max={240}
                step={1}
                disabled={disabled}
                onChange={(event) =>
                  updateStep(index, { minutes: Number(event.target.value) })
                }
              />
              <em>分钟</em>
            </div>
            <div className="workbench-custom-rhythm-editor__moves">
              <button
                type="button"
                aria-label={`上移步骤 ${index + 1}`}
                disabled={disabled || index === 0}
                onClick={() => moveStep(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`下移步骤 ${index + 1}`}
                disabled={disabled || index === steps.length - 1}
                onClick={() => moveStep(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`删除步骤 ${index + 1}`}
                disabled={disabled || steps.length <= 1}
                onClick={() => deleteStep(index)}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="workbench-custom-rhythm-editor__actions">
        <button
          type="button"
          disabled={disabled || steps.length >= CUSTOM_RHYTHM_SEED_LIMITS.stepsMax}
          onClick={addStep}
        >
          添加步骤
        </button>
        {steps.length >= CUSTOM_RHYTHM_SEED_LIMITS.stepsMax ? (
          <span role="status">最多 {CUSTOM_RHYTHM_SEED_LIMITS.stepsMax} 步</span>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <ul className="workbench-custom-rhythm-editor__issues" role="status">
          {issues.slice(0, 4).map((issue, i) => (
            <li key={`${issue.code}-${i}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
