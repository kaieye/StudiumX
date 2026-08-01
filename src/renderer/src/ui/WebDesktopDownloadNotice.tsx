import { MonitorDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Explains the capability boundary of the shared renderer when it is hosted by
 * the browser shell. Native desktop users do not see this notice.
 */
export function WebDesktopDownloadNotice() {
  const { t } = useTranslation()
  const isWeb = typeof window !== 'undefined' && window.teachingSystem?.platform === 'web'

  if (!isWeb) return null

  return (
    <aside className="web-desktop-download-notice" role="note">
      <span className="web-desktop-download-notice__icon" aria-hidden="true">
        <MonitorDown size={17} strokeWidth={1.9} />
      </span>
      <div className="web-desktop-download-notice__copy">
        <strong>{t('webDesktopNotice.title')}</strong>
        <p>{t('webDesktopNotice.detail')}</p>
      </div>
    </aside>
  )
}
