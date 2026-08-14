import { BrainCircuit, Check, ChevronDown, Loader2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
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
