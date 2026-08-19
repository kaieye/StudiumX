import { BrainCircuit, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelReasoningEffort } from '../../../shared/teaching-types'
import { useAppStore } from '../app-shell/appStore'
import i18n from '../i18n'
import {
  activeModelProvider,
  reasoningEffortDescription,
  reasoningEffortLabel,
  reasoningEffortOptionsForSettings,
  selectedReasoningEffort
} from '../workflows/settings'

/**
 * Close an open picker popover when the user presses anywhere outside it.
 * Shared by the overview composer pickers (model/reasoning/workspace/git/access).
 */
export function usePickerOutsideClose(
  open: boolean,
  wrapRef: RefObject<HTMLDivElement | null>,
  setOpen: (v: boolean) => void
): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, wrapRef, setOpen])
}

/** Generator model selector — writes the same global settings the main
 *  process reads for provider routing (mind-map generation included). */
export function OverviewModelPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const provider = activeModelProvider(settings)
  const models = provider?.models ?? []
  const current = settings.generator.model
  const label = current || i18n.t('common.auto')

  const handleSelect = async (model: string): Promise<void> => {
    if (acting) return
    if (model === current) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { providerId: provider?.id, model } })
      setOpen(false)
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-model-picker">
      <button
        type="button"
        className="overview-dialog-model"
        onClick={() => setOpen((v) => !v)}
        disabled={acting}
        title={label}
      >
        <span>{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-model-menu" role="listbox">
          <div className="overview-picker-list">
            {models.length === 0 ? (
              <div className="overview-picker-empty">{t('overview.modelEmpty')}</div>
            ) : (
              models.map((model) => {
                const isCurrent = model === current
                return (
                  <button
                    key={model}
                    type="button"
                    className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                    onClick={() => void handleSelect(model)}
                    disabled={acting || isCurrent}
                    title={model}
                  >
                    <span className="overview-picker-option-body">
                      <span className="overview-picker-option-title">{model}</span>
                    </span>
                    {isCurrent ? <Check size={15} /> : null}
                  </button>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Generator reasoning-effort selector — writes the same global settings
 *  the main process reads for provider routing (mind-map generation included). */
export function OverviewReasoningPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const options = reasoningEffortOptionsForSettings(settings)
  const current = selectedReasoningEffort(settings)
  const label = reasoningEffortLabel(current)

  const handleSelect = async (reasoningEffort: ModelReasoningEffort): Promise<void> => {
    if (acting) return
    if (reasoningEffort === current && settings.generator.reasoningEffort === current) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { reasoningEffort } })
      setOpen(false)
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-reasoning-picker">
      <button
        type="button"
        className="overview-dialog-model overview-dialog-reasoning"
        onClick={() => setOpen((v) => !v)}
        disabled={acting}
        title={`${t('reasoning.title')}: ${label}`}
      >
        <BrainCircuit size={14} />
        <span>{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-reasoning-menu" role="listbox">
          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('reasoning.title')}</div>
            {options.map((effort) => {
              const isCurrent = effort === current
              return (
                <button
                  key={effort}
                  type="button"
                  className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                  onClick={() => void handleSelect(effort)}
                  disabled={acting || (isCurrent && settings.generator.reasoningEffort === current)}
                  title={reasoningEffortDescription(effort)}
                >
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{reasoningEffortLabel(effort)}</span>
                  </span>
                  {isCurrent ? <Check size={15} /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

type ModelAndReasoningPickerPane = 'summary' | 'model' | 'reasoning'

/**
 * A compact, two-level model selector for narrow composers. Its trigger keeps
 * the selected model and reasoning effort together; the menu drills into each
 * choice separately, following the same interaction pattern as DeepSeek
 * Harness's composer model seat.
 */
export function OverviewModelAndReasoningPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<ModelAndReasoningPickerPane>('summary')
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const provider = activeModelProvider(settings)
  const models = provider?.models ?? []
  const currentModel = settings.generator.model
  const modelLabel = currentModel || i18n.t('common.auto')
  const reasoningOptions = reasoningEffortOptionsForSettings(settings)
  const currentReasoningEffort = selectedReasoningEffort(settings)
  const reasoningLabel = reasoningEffortLabel(currentReasoningEffort)
  const triggerLabel = `${modelLabel} · ${reasoningLabel}`
  const triggerAriaLabel = `${t('generation.model.label')}: ${modelLabel}; ${t('reasoning.title')}: ${reasoningLabel}`

  const close = useCallback((): void => {
    setOpen(false)
    setPane('summary')
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (pane === 'summary') close()
      else setPane('summary')
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [close, open, pane])

  const handleModelSelect = async (model: string): Promise<void> => {
    if (acting) return
    if (model === currentModel) {
      close()
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { providerId: provider?.id, model } })
      close()
    } finally {
      setActing(false)
    }
  }

  const handleReasoningSelect = async (reasoningEffort: ModelReasoningEffort): Promise<void> => {
    if (acting) return
    if (
      reasoningEffort === currentReasoningEffort &&
      settings.generator.reasoningEffort === currentReasoningEffort
    ) {
      close()
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { reasoningEffort } })
      close()
    } finally {
      setActing(false)
    }
  }

  return (
    <div
      ref={wrapRef}
      className="overview-picker overview-model-and-reasoning-picker"
    >
      <button
        type="button"
        className="overview-dialog-model overview-dialog-model--combined"
        onClick={() => {
          if (open) {
            close()
            return
          }
          setPane('summary')
          setOpen(true)
        }}
        disabled={acting}
        title={triggerLabel}
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="overview-dialog-model__model">{modelLabel}</span>
        <span className="overview-dialog-model__separator" aria-hidden="true">·</span>
        <span className="overview-dialog-model__reasoning">{reasoningLabel}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div
          className="overview-picker-menu overview-model-and-reasoning-menu"
          role="menu"
          aria-label={`${t('generation.model.label')} ${t('reasoning.title')}`}
          aria-busy={acting}
        >
          {pane === 'summary' ? (
            <>
              <button
                type="button"
                className="overview-model-and-reasoning-menu__cell"
                role="menuitem"
                onClick={() => setPane('model')}
              >
                <span className="overview-model-and-reasoning-menu__cell-label">
                  {t('generation.model.label')}
                </span>
                <span className="overview-model-and-reasoning-menu__cell-value">{modelLabel}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="overview-model-and-reasoning-menu__cell"
                role="menuitem"
                onClick={() => setPane('reasoning')}
              >
                <span className="overview-model-and-reasoning-menu__cell-label">
                  {t('reasoning.title')}
                </span>
                <span className="overview-model-and-reasoning-menu__cell-value">{reasoningLabel}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </>
          ) : null}

          {pane === 'model' ? (
            <div className="overview-picker-list" role="listbox" aria-label={t('generation.model.label')}>
              <div className="overview-picker-group-label">{t('generation.model.label')}</div>
              {models.length === 0 ? (
                <div className="overview-picker-empty">{t('overview.modelEmpty')}</div>
              ) : (
                models.map((model) => {
                  const isCurrent = model === currentModel
                  return (
                    <button
                      key={model}
                      type="button"
                      className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                      onClick={() => void handleModelSelect(model)}
                      disabled={acting || isCurrent}
                      title={model}
                    >
                      <span className="overview-picker-option-body">
                        <span className="overview-picker-option-title">{model}</span>
                      </span>
                      {isCurrent ? <Check size={15} /> : null}
                    </button>
                  )
                })
              )}
            </div>
          ) : null}

          {pane === 'reasoning' ? (
            <div className="overview-picker-list" role="listbox" aria-label={t('reasoning.title')}>
              <div className="overview-picker-group-label">{t('reasoning.title')}</div>
              {reasoningOptions.map((effort) => {
                const isCurrent = effort === currentReasoningEffort
                return (
                  <button
                    key={effort}
                    type="button"
                    className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                    onClick={() => void handleReasoningSelect(effort)}
                    disabled={acting || (isCurrent && settings.generator.reasoningEffort === currentReasoningEffort)}
                    title={reasoningEffortDescription(effort)}
                  >
                    <span className="overview-picker-option-body">
                      <span className="overview-picker-option-title">{reasoningEffortLabel(effort)}</span>
                    </span>
                    {isCurrent ? <Check size={15} /> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
