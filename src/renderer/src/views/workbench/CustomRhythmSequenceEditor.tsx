/**
 * STC-702: ordered custom rhythm sequence editor (non-freeform).
 *
 * ADR-0011: rows = kind select + minutes + up/down/delete + add.
 * No freeform drag/canvas. Validation via normalizeCustomRhythmSequence.
 * Product-signal polish: fail-closed issues with clear Chinese copy;
 * a11y labels distinguish focus / short_break / long_break / wrap_up.
 */

import {
  CUSTOM_RHYTHM_SEED_LIMITS,
  CUSTOM_RHYTHM_STEP_KIND_LABELS,
  CUSTOM_RHYTHM_STEP_KIND_OPTIONS,
  formatCustomRhythmIssueMessage,
  listCustomRhythmEditorIssues,
  normalizeCustomRhythmSequence,
  sumCustomRhythmMinutes,
  type CustomRhythmStep,
  type CustomRhythmStepKind
} from '../../../../shared/study-planning'

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
  /**
   * When true (active timer session running), edits only affect the draft /
   * next catalog plan — never the live planSnapshot. Surfaces freeze copy.
   */
  freezeActiveSession?: boolean
}

function clampMinutesForKind(kind: CustomRhythmStepKind, minutes: number): number {
  const n = Number.isFinite(minutes) ? Math.trunc(minutes) : 0
  // Keep 0 / negative out of draft so validation fail-closed is visible
  // (no silent invent of a 3-min tomato). Still clamp upper bound for UX.
  if (n < 1) return n
  switch (kind) {
    case 'focus':
      return Math.min(CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMax, n)
    case 'short_break':
      return Math.min(CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMax, n)
    case 'long_break':
      return Math.min(CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMax, n)
    case 'wrap_up':
      return Math.min(CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMax, n)
    default:
      return n
  }
}

function minutesBounds(kind: CustomRhythmStepKind): { min: number; max: number } {
  switch (kind) {
    case 'focus':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.focusMinutesMax
      }
    case 'short_break':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.shortBreakMinutesMax
      }
    case 'long_break':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.longBreakMinutesMax
      }
    case 'wrap_up':
      return {
        min: CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMin,
        max: CUSTOM_RHYTHM_SEED_LIMITS.wrapUpMinutesMax
      }
  }
}

export function CustomRhythmSequenceEditor({
  sequence,
  onChange,
  disabled = false,
  freezeActiveSession = false
}: CustomRhythmSequenceEditorProps) {
  // Empty sequence is a real draft state (fail-closed) — do not invent DEFAULT
  // into the controlled value. Only seed UI display when parent never provided.
  const steps = [...sequence]
  const displaySteps =
    steps.length > 0 ? steps : [...DEFAULT_CUSTOM_RHYTHM_SEQUENCE]
  const isEmptyDraft = steps.length === 0
  const validationTarget = isEmptyDraft ? steps : displaySteps
  const editorIssues = listCustomRhythmEditorIssues(validationTarget)
  const totals = sumCustomRhythmMinutes(displaySteps)
  const hardIssues = editorIssues.hard
  const warnIssues = editorIssues.warnings
  // Live normalize for per-step invalid flags when parent holds raw draft.
  const rawValidation = normalizeCustomRhythmSequence(validationTarget)

  const commit = (next: CustomRhythmStep[]): void => {
    onChange(next.map((s) => ({ kind: s.kind, minutes: s.minutes })))
  }

  const ensureEditableSteps = (): CustomRhythmStep[] => {
    if (steps.length > 0) return [...steps]
    // First edit on empty: start from seed so up/down/add have a base.
    return DEFAULT_CUSTOM_RHYTHM_SEQUENCE.map((s) => ({ ...s }))
  }

  const updateStep = (index: number, patch: Partial<CustomRhythmStep>): void => {
    if (disabled) return
    const base = ensureEditableSteps()
    if (index < 0 || index >= base.length) return
    const next = base.map((s, i) => {
      if (i !== index) return s
      const kind = patch.kind ?? s.kind
      const minutes =
        patch.minutes !== undefined
          ? clampMinutesForKind(kind, patch.minutes)
          : s.minutes
      // When kind changes, re-clamp existing minutes into new kind range if needed.
      if (patch.kind !== undefined && patch.minutes === undefined) {
        const bounds = minutesBounds(kind)
        const clamped =
          s.minutes < bounds.min
            ? bounds.min
            : s.minutes > bounds.max
              ? bounds.max
              : s.minutes
        return { kind, minutes: clamped }
      }
      return { kind, minutes }
    })
    commit(next)
  }

  const moveStep = (index: number, delta: -1 | 1): void => {
    if (disabled) return
    const base = ensureEditableSteps()
    const target = index + delta
    if (target < 0 || target >= base.length) return
    const next = [...base]
    const tmp = next[index]
    next[index] = next[target]
    next[target] = tmp
    commit(next)
  }

  const deleteStep = (index: number): void => {
    if (disabled) return
    const base = ensureEditableSteps()
    // Allow delete down to empty so fail-closed empty-sequence error is visible.
    commit(base.filter((_, i) => i !== index))
  }

  const addStep = (): void => {
    if (disabled) return
    const base = ensureEditableSteps()
    if (base.length >= CUSTOM_RHYTHM_SEED_LIMITS.stepsMax) return
    commit([...base, { kind: 'focus', minutes: 25 }])
  }

  const issueList =
    hardIssues.length > 0
      ? hardIssues
      : warnIssues

  return (
    <div
      className={`workbench-custom-rhythm-editor${hardIssues.length > 0 ? ' is-invalid' : ''}${freezeActiveSession ? ' is-freeze-active' : ''}`}
      aria-label="自定义节奏序列"
      data-validation-ok={editorIssues.ok ? 'true' : 'false'}
    >
      <div className="workbench-custom-rhythm-editor__head">
        <span>节奏步骤</span>
        <em>
          {displaySteps.length} 步 · 合计 {totals.totalMinutes} 分
          {totals.focusMinutes > 0 ? ` · 专注 ${totals.focusMinutes}` : ''}
        </em>
      </div>
      {freezeActiveSession ? (
        <p className="workbench-custom-rhythm-editor__freeze" role="status">
          计时进行中：此处修改只影响<strong>下次</strong>开始的方案；当前进行中的会话方案保持冻结（不会改写本次节奏）。
        </p>
      ) : null}
      {isEmptyDraft ? (
        <p className="workbench-custom-rhythm-editor__empty" role="alert">
          序列为空 — 无法保存。请添加步骤（至少一次专注）。不会静默使用默认番茄。
        </p>
      ) : null}
      <ol className="workbench-custom-rhythm-editor__list">
        {displaySteps.map((step, index) => {
          const kindMeta = CUSTOM_RHYTHM_STEP_KIND_LABELS[step.kind] ?? {
            label: String(step.kind),
            shortLabel: String(step.kind),
            description: '未知步骤类型'
          }
          const bounds = minutesBounds(step.kind)
          const minutesInvalid =
            !Number.isFinite(step.minutes) ||
            step.minutes < bounds.min ||
            step.minutes > bounds.max
          return (
            <li
              key={`step-${index}-${step.kind}`}
              className={`workbench-custom-rhythm-editor__row${minutesInvalid ? ' is-invalid' : ''}`}
              data-step-kind={step.kind}
            >
              <span className="workbench-custom-rhythm-editor__index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="workbench-custom-rhythm-editor__kind-chip" title={kindMeta.description}>
                {kindMeta.shortLabel}
              </span>
              <select
                aria-label={`步骤 ${index + 1} 类型：${kindMeta.label}`}
                value={step.kind}
                disabled={disabled}
                onChange={(event) =>
                  updateStep(index, { kind: event.target.value as CustomRhythmStepKind })
                }
              >
                {CUSTOM_RHYTHM_STEP_KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="workbench-pomodoro-number-input">
                <input
                  type="number"
                  aria-label={`步骤 ${index + 1} ${kindMeta.label} 分钟（${bounds.min}–${bounds.max}）`}
                  aria-invalid={minutesInvalid ? true : undefined}
                  value={Number.isFinite(step.minutes) ? step.minutes : ''}
                  min={0}
                  max={bounds.max}
                  step={1}
                  disabled={disabled}
                  onChange={(event) => {
                    const raw = event.target.value
                    if (raw === '') {
                      updateStep(index, { minutes: 0 })
                      return
                    }
                    updateStep(index, { minutes: Number(raw) })
                  }}
                />
                <em>分钟</em>
              </div>
              <div className="workbench-custom-rhythm-editor__moves">
                <button
                  type="button"
                  aria-label={`上移步骤 ${index + 1}（${kindMeta.label}）`}
                  disabled={disabled || index === 0}
                  onClick={() => moveStep(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`下移步骤 ${index + 1}（${kindMeta.label}）`}
                  disabled={disabled || index === displaySteps.length - 1}
                  onClick={() => moveStep(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`删除步骤 ${index + 1}（${kindMeta.label}）`}
                  disabled={disabled}
                  onClick={() => deleteStep(index)}
                >
                  ×
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="workbench-custom-rhythm-editor__actions">
        <button
          type="button"
          disabled={disabled || displaySteps.length >= CUSTOM_RHYTHM_SEED_LIMITS.stepsMax}
          onClick={addStep}
        >
          添加步骤
        </button>
        {displaySteps.length >= CUSTOM_RHYTHM_SEED_LIMITS.stepsMax ? (
          <span role="status">最多 {CUSTOM_RHYTHM_SEED_LIMITS.stepsMax} 步</span>
        ) : null}
      </div>
      {issueList.length > 0 ? (
        <ul
          className={`workbench-custom-rhythm-editor__issues${hardIssues.length > 0 ? ' is-error' : ' is-warn'}`}
          role={hardIssues.length > 0 ? 'alert' : 'status'}
          aria-live="polite"
        >
          {issueList.slice(0, 5).map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              {issue.displayMessage ?? formatCustomRhythmIssueMessage(issue)}
            </li>
          ))}
        </ul>
      ) : null}
      {!rawValidation.ok && hardIssues.length === 0 ? (
        <p className="workbench-custom-rhythm-editor__issues is-error" role="alert">
          节奏序列无效，无法保存（禁止静默改写为默认番茄）。
        </p>
      ) : null}
    </div>
  )
}
