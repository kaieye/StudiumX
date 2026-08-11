import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Shared authentication surface frame.
 *
 * The session/QR implementation is platform-specific (Electron uses the
 * native bridge while Web uses the browser API), but the rendered card and
 * all visual landmarks stay identical. Keeping this frame in the renderer
 * prevents the two login surfaces from drifting as the shared app evolves.
 */
export interface AuthScreenLayoutProps {
  ariaLabel: string
  /** Overlay the caller's page rather than paint a standalone auth background. */
  overlay?: boolean
  title: ReactNode
  error?: ReactNode
  stage: ReactNode
  actions: ReactNode
  footer: ReactNode
  /** Optional icon-only control for dismissing an overlay login panel. */
  onClose?: () => void
  /** Accessible name for the optional close control. */
  closeLabel?: string
}

export function AuthScreenLayout({
  ariaLabel,
  overlay = false,
  title,
  error,
  stage,
  actions,
  footer,
  onClose,
  closeLabel = 'Close'
}: AuthScreenLayoutProps) {
  return (
    <div className={`auth-screen${overlay ? ' auth-screen--overlay' : ''}`} role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div className="auth-screen-drag-region" aria-hidden="true" />
      <div className="auth-screen-card">
        {onClose ? (
          <button
            type="button"
            className="auth-screen-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <div className="auth-screen-brand">
          <h1 className="auth-screen-title">{title}</h1>
        </div>

        {error ? <div className="auth-screen-alert auth-screen-alert--error" role="alert">{error}</div> : null}

        <div className="auth-screen-login-stage">{stage}</div>
        {actions}
        <p className="auth-screen-footer">{footer}</p>
      </div>
    </div>
  )
}
