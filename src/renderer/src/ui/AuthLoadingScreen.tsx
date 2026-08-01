import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import appIconRounded from '../assets/auth/app-icon-rounded.png'

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
        <img
          className="auth-screen-app-icon auth-screen-app-icon--splash"
          src={appIconRounded}
          alt=""
          aria-hidden="true"
        />
        <span className="auth-screen-splash-text">
          <Loader2 size={16} className="auth-screen-spinner" aria-hidden="true" />
          {resolvedLabel}
        </span>
      </div>
    </div>
  )
}
