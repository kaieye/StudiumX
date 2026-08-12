import { Check, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import {
  MIND_MAP_CREATE_PRESETS,
  type MindMapCreatePreset
} from './mind-map-create-presets'

type MindMapCreateDialogProps = {
  open: boolean
  submitting: boolean
  error: string | null
  title: string
  selectedStructureClass: MindMapStructureClass
  onTitleChange: (title: string) => void
  onStructureClassChange: (structureClass: MindMapStructureClass) => void
  onSubmit: () => void | Promise<void>
  onCancel: () => void
}

function StructureThumbnail({ preset }: { preset: MindMapCreatePreset }) {
  switch (preset.thumbnail) {
    case 'mindMap':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M60 36 30 17M60 36 91 16M60 36 25 53M60 36 95 54" />
          <circle className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" cx="60" cy="36" r="8" />
          <circle className="mindmap-create-dialog__diagram-node" cx="27" cy="15" r="5" />
          <circle className="mindmap-create-dialog__diagram-node" cx="94" cy="14" r="5" />
          <circle className="mindmap-create-dialog__diagram-node" cx="22" cy="55" r="5" />
          <circle className="mindmap-create-dialog__diagram-node" cx="98" cy="56" r="5" />
        </svg>
      )
    case 'logic':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M32 36H55M55 36 82 16M55 36H91M55 36 82 56" />
          <rect className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" x="18" y="28" width="16" height="16" rx="4" />
          <rect className="mindmap-create-dialog__diagram-node" x="82" y="10" width="18" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="91" y="30" width="17" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="82" y="50" width="18" height="12" rx="3" />
        </svg>
      )
    case 'org':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M60 21V33M25 33H95M25 33V48M60 33V48M95 33V48" />
          <rect className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" x="51" y="9" width="18" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="15" y="48" width="20" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="50" y="48" width="20" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="85" y="48" width="20" height="12" rx="3" />
        </svg>
      )
    case 'tree':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M28 36H48M48 36V17M48 36V55M48 17H72M48 36H82M48 55H72" />
          <circle className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" cx="25" cy="36" r="7" />
          <rect className="mindmap-create-dialog__diagram-node" x="72" y="11" width="19" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="82" y="30" width="19" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="72" y="49" width="19" height="12" rx="3" />
        </svg>
      )
    case 'brace':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M28 36H48M48 17C60 17 59 29 68 29M48 55C60 55 59 43 68 43M68 29V43M68 29H94M68 43H94" />
          <circle className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" cx="25" cy="36" r="7" />
          <rect className="mindmap-create-dialog__diagram-node" x="94" y="23" width="16" height="12" rx="3" />
          <rect className="mindmap-create-dialog__diagram-node" x="94" y="37" width="16" height="12" rx="3" />
        </svg>
      )
    case 'timeline':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M15 37H105" />
          <path className="mindmap-create-dialog__diagram-line" d="M31 37V22M60 37V52M89 37V22" />
          <circle className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" cx="31" cy="37" r="6" />
          <circle className="mindmap-create-dialog__diagram-node" cx="60" cy="37" r="6" />
          <circle className="mindmap-create-dialog__diagram-node" cx="89" cy="37" r="6" />
        </svg>
      )
    case 'fishbone':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <path className="mindmap-create-dialog__diagram-line" d="M18 36H93M93 36 105 27M93 36 105 45M40 36 29 18M58 36 47 54M76 36 65 18" />
          <path className="mindmap-create-dialog__diagram-line" d="M29 18H16M47 54H34M65 18H52" />
          <circle className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" cx="96" cy="36" r="7" />
          <circle className="mindmap-create-dialog__diagram-node" cx="16" cy="18" r="4" />
          <circle className="mindmap-create-dialog__diagram-node" cx="34" cy="54" r="4" />
          <circle className="mindmap-create-dialog__diagram-node" cx="52" cy="18" r="4" />
        </svg>
      )
    case 'matrix':
      return (
        <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
          <rect className="mindmap-create-dialog__diagram-grid" x="21" y="12" width="78" height="48" rx="4" />
          <path className="mindmap-create-dialog__diagram-line" d="M47 12V60M73 12V60M21 28H99M21 44H99" />
          <rect className="mindmap-create-dialog__diagram-node mindmap-create-dialog__diagram-node--root" x="24" y="15" width="20" height="10" rx="2" />
          <rect className="mindmap-create-dialog__diagram-node" x="50" y="31" width="20" height="10" rx="2" />
          <rect className="mindmap-create-dialog__diagram-node" x="76" y="47" width="20" height="10" rx="2" />
        </svg>
      )
  }
}

/** Centered starter dialog for naming a map and selecting its XMind-style layout. */
export function MindMapCreateDialog({
  open,
  submitting,
  error,
  title,
  selectedStructureClass,
  onTitleChange,
  onStructureClassChange,
  onSubmit,
  onCancel
}: MindMapCreateDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const nameInputId = useId()
  const structuresLabelId = useId()

  useEffect(() => {
    if (!open) return

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    titleInputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!submitting) onCancel()
        return
      }

      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return

      // Keep keyboard focus inside the modal while it is open.  The selector
      // intentionally includes the radio-card buttons so every preset remains
      // reachable without a mouse.
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault()
          last?.focus()
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const previous = previouslyFocusedRef.current
      previouslyFocusedRef.current = null
      if (previous?.isConnected) previous.focus()
    }
  }, [onCancel, open, submitting])

  if (!open) return null

  return (
    <div
      className="mindmap-create-dialog-backdrop"
      onMouseDown={(event) => {
        if (!submitting && event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        ref={dialogRef}
        className="mindmap-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          <header className="mindmap-create-dialog__header">
            <div>
              <h2 id={titleId}>{t('mindmap.createDialog.title')}</h2>
              <p id={descriptionId}>{t('mindmap.createDialog.description')}</p>
            </div>
            <button
              type="button"
              className="mindmap-create-dialog__close"
              onClick={onCancel}
              disabled={submitting}
              aria-label={t('mindmap.cancel')}
              title={t('mindmap.cancel')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="mindmap-create-dialog__body">
            <label className="mindmap-create-dialog__field" htmlFor={nameInputId}>
              <span>{t('mindmap.createDialog.nameLabel')}</span>
              <input
                ref={titleInputRef}
                id={nameInputId}
                className="mindmap-create-dialog__input"
                value={title}
                onChange={(event) => onTitleChange(event.currentTarget.value)}
                placeholder={t('mindmap.enterTitle')}
                autoComplete="off"
                disabled={submitting}
              />
            </label>

            {error ? (
              <div className="mindmap-create-dialog__error" role="alert" aria-live="assertive">
                {error}
              </div>
            ) : null}

            <div className="mindmap-create-dialog__structure-field">
              <span id={structuresLabelId} className="mindmap-create-dialog__field-label">
                {t('mindmap.createDialog.structureLabel')}
              </span>
              <div
                className="mindmap-create-dialog__presets"
                role="radiogroup"
                aria-labelledby={structuresLabelId}
              >
                {MIND_MAP_CREATE_PRESETS.map((preset) => {
                  const selected = preset.structureClass === selectedStructureClass
                  const titleKey = `mindmap.createDialog.presets.${preset.translationKey}.title`
                  const descriptionKey = `mindmap.createDialog.presets.${preset.translationKey}.description`
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      key={preset.id}
                      className={`mindmap-create-dialog__preset${selected ? ' is-selected' : ''}`}
                      onClick={() => onStructureClassChange(preset.structureClass)}
                      disabled={submitting}
                    >
                      <span className="mindmap-create-dialog__thumbnail">
                        <StructureThumbnail preset={preset} />
                      </span>
                      <span className="mindmap-create-dialog__preset-copy">
                        <strong>{t(titleKey)}</strong>
                        <small>{t(descriptionKey)}</small>
                      </span>
                      {selected ? (
                        <span className="mindmap-create-dialog__selected">
                          <Check size={13} aria-hidden="true" />
                          <span>{t('mindmap.createDialog.selected')}</span>
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <footer className="mindmap-create-dialog__footer">
            <button type="button" className="mindmap-create-dialog__cancel" onClick={onCancel} disabled={submitting}>
              {t('mindmap.createDialog.cancel')}
            </button>
            <button type="submit" className="mindmap-create-dialog__submit" disabled={submitting}>
              <Check size={16} aria-hidden="true" />
              <span>{t(submitting ? 'mindmap.createDialog.creating' : 'mindmap.createDialog.create')}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
