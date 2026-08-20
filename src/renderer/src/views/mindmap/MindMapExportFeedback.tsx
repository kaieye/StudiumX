import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type MindMapExportFormat = 'markdown' | 'opml' | 'portable' | 'svg' | 'png'

export type MindMapExportFeedbackState =
  | { status: 'exporting'; format: MindMapExportFormat }
  | { status: 'success'; format: MindMapExportFormat; path: string }
  | { status: 'error'; format: MindMapExportFormat; message?: string }
  | { status: 'cancelled'; format: MindMapExportFormat }

type MindMapExportFeedbackProps = {
  state: MindMapExportFeedbackState
  onDismiss: () => void
}

/**
 * Accessible status for the native export boundary.
 *
 * Keep this separate from the generic view notice: export has a lifecycle of
 * its own (preparing, complete, failed, cancelled), and users should be able
 * to tell which format produced a path without relying on a transient button
 * spinner or an English-only string.
 */
export function MindMapExportFeedback({
  state,
  onDismiss
}: MindMapExportFeedbackProps) {
  const { t } = useTranslation()
  const format = t(`mindmap.exportFormat.${state.format}`)

  const content = (() => {
    switch (state.status) {
      case 'exporting':
        return {
          text: t('mindmap.exporting', { format }),
          icon: <Loader2 size={14} className="spin" aria-hidden="true" />
        }
      case 'success':
        return {
          text: t('mindmap.exported', { format, path: state.path }),
          icon: <CheckCircle2 size={14} aria-hidden="true" />
        }
      case 'error':
        return {
          text: state.message?.trim()
            ? t('mindmap.exportFailedWithReason', { format, message: state.message.trim() })
            : t('mindmap.exportFailed', { format }),
          icon: <AlertCircle size={14} aria-hidden="true" />
        }
      case 'cancelled':
        return {
          text: t('mindmap.exportCancelled', { format }),
          icon: <X size={14} aria-hidden="true" />
        }
    }
  })()

  const liveRole = state.status === 'error' ? 'alert' : 'status'

  return (
    <div
      className={`mindmap-export-feedback is-${state.status}`}
      role={liveRole}
      aria-live={state.status === 'error' ? 'assertive' : 'polite'}
    >
      <span className="mindmap-export-feedback__message">
        {content.icon}
        <span>{content.text}</span>
      </span>
      {state.status === 'exporting' ? null : (
        <button
          type="button"
          className="icon-button"
          onClick={onDismiss}
          aria-label={t('mindmap.dismissNotice')}
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
