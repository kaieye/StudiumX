import { GraduationCap, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Shared auth/session restoration splash.
 *
 * Electron and Web may validate their sessions through different transports,
 * but the loading surface is part of the same product chrome. Keeping this
 * markup in the renderer prevents a browser-only spinner from drifting away
 * from the desktop auth gate.
 */
export function AuthLoadingScreen({ label }: { label?: string }) {
  const { t } = useTranslation()
  const resolvedLabel = label ?? t('auth.checking', { defaultValue: '正在检查登录状态…' })

  return (
    <div className="auth-screen auth-screen--splash" role="status" aria-live="polite">
      <div className="auth-screen-splash">
        <span className="auth-screen-logo auth-screen-logo--splash">
          <GraduationCap size={40} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="auth-screen-splash-text">
          <Loader2 size={16} className="auth-screen-spinner" aria-hidden="true" />
          {resolvedLabel}
        </span>
      </div>
    </div>
  )
}
