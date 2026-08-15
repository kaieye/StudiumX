import { Check, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

type MindMapCreateDialogProps = {
  open: boolean
  submitting: boolean
  error: string | null
  title: string
  onTitleChange: (title: string) => void
  onSubmit: () => void | Promise<void>
  onCancel: () => void
}

/** Centered starter dialog for naming a new mind map. */
export function MindMapCreateDialog({
  open,
  submitting,
  error,
  title,
  onTitleChange,
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

      // Keep keyboard focus inside the modal while it is open.
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
