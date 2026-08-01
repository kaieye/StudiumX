import { Download, MonitorDown } from 'lucide-react'
import { useCallback, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/kaieye/StudiumX/releases/latest'
const GITHUB_LATEST_RELEASE_PAGE = 'https://github.com/kaieye/StudiumX/releases/latest'
const GITHUB_RELEASE_ASSET_PATH = '/kaieye/StudiumX/releases/download/'

export type DesktopDownloadPlatform = 'macos' | 'windows' | 'linux' | 'other'

type ReleaseAsset = {
  name: string
  browser_download_url: string
}

type PlatformNavigator = Pick<Navigator, 'platform' | 'userAgent'>

/** Infers the installer family from the browser host without collecting it remotely. */
export function detectDesktopDownloadPlatform(
  browser: PlatformNavigator = typeof navigator === 'undefined'
    ? { platform: '', userAgent: '' }
    : navigator
): DesktopDownloadPlatform {
  const platform = `${browser.platform ?? ''} ${browser.userAgent ?? ''}`

  if (/windows/i.test(platform)) return 'windows'
  if (/macintosh|mac os x|macintel/i.test(platform)) return 'macos'
  if (/linux|x11/i.test(platform)) return 'linux'
  return 'other'
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ReleaseAsset).name === 'string'
    && typeof (value as ReleaseAsset).browser_download_url === 'string'
}

function isOfficialReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(GITHUB_RELEASE_ASSET_PATH)
  } catch {
    return false
  }
}

/** Returns the installer published for the visitor's platform, if the latest release has one. */
export function selectLatestReleaseAsset(
  assets: unknown,
  platform: DesktopDownloadPlatform
): string | null {
  if (!Array.isArray(assets)) return null

  const nameMatchesPlatform: Record<Exclude<DesktopDownloadPlatform, 'other'>, RegExp> = {
    macos: /\.dmg$/i,
    windows: /\.exe$/i,
    linux: /\.appimage$/i
  }
  const matcher = platform === 'other' ? null : nameMatchesPlatform[platform]
  if (!matcher) return null

  const asset = assets.find((candidate) =>
    isReleaseAsset(candidate)
    && matcher.test(candidate.name)
    && isOfficialReleaseAssetUrl(candidate.browser_download_url)
  )

  return asset?.browser_download_url ?? null
}

async function resolveLatestDesktopDownload(platform: DesktopDownloadPlatform): Promise<string> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!response.ok) return GITHUB_LATEST_RELEASE_PAGE

  const release = await response.json() as { assets?: unknown }
  return selectLatestReleaseAsset(release.assets, platform) ?? GITHUB_LATEST_RELEASE_PAGE
}

/**
 * Explains the capability boundary of the shared renderer when it is hosted by
 * the browser shell. Native desktop users do not see this notice.
 *
 * The GitHub API is queried only after the visitor explicitly asks to download
 * the app, so merely rendering the Web app does not make a remote request.
 */
export function WebDesktopDownloadNotice() {
  const { t } = useTranslation()
  const [isResolvingDownload, setIsResolvingDownload] = useState(false)
  const isWeb = typeof window !== 'undefined' && window.teachingSystem?.platform === 'web'
  const platform = detectDesktopDownloadPlatform()

  const handleDownload = useCallback(async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (isResolvingDownload) return

    // Open the tab while the click still has browser user activation. Resolving the
    // GitHub asset first can otherwise make popup blockers reject the final open().
    const downloadWindow = window.open('', '_blank')
    if (downloadWindow) downloadWindow.opener = null

    setIsResolvingDownload(true)
    try {
      const url = await resolveLatestDesktopDownload(platform)
      if (downloadWindow) downloadWindow.location.assign(url)
      else window.location.assign(url)
    } catch {
      if (downloadWindow) downloadWindow.location.assign(GITHUB_LATEST_RELEASE_PAGE)
      else window.location.assign(GITHUB_LATEST_RELEASE_PAGE)
    } finally {
      setIsResolvingDownload(false)
    }
  }, [isResolvingDownload, platform])

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
      <a
        className="web-desktop-download-notice__action"
        href={GITHUB_LATEST_RELEASE_PAGE}
        onClick={handleDownload}
        aria-busy={isResolvingDownload || undefined}
      >
        <Download size={15} strokeWidth={2} aria-hidden="true" />
        {isResolvingDownload
          ? t('webDesktopNotice.downloadLoading')
          : t('webDesktopNotice.download', { platform: t(`webDesktopNotice.platform.${platform}`) })}
      </a>
    </aside>
  )
}
