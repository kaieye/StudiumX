import type { ReactNode } from 'react'

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
  title: ReactNode
  error?: ReactNode
  stage: ReactNode
  actions: ReactNode
  footer: ReactNode
}

export function AuthScreenLayout({
  ariaLabel,
  title,
  error,
  stage,
  actions,
  footer
}: AuthScreenLayoutProps) {
  return (
    <div className="auth-screen" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div className="auth-screen-card">
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
