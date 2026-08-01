import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/i18n'
import {
  detectDesktopDownloadPlatform,
  selectLatestReleaseAsset,
  WebDesktopDownloadNotice
} from '../../src/renderer/src/ui/WebDesktopDownloadNotice'

const releasePage = 'https://github.com/kaieye/StudiumX/releases/latest'
const windowsInstaller = 'https://github.com/kaieye/StudiumX/releases/download/v0.0.5/StudiumX-0.0.5-win-x64.exe'
const linuxInstaller = 'https://github.com/kaieye/StudiumX/releases/download/v0.0.5/StudiumX-0.0.5-linux-x86_64.AppImage'

function renderWebNotice() {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: { platform: 'web' }
  })
  return render(<WebDesktopDownloadNotice />)
}

afterEach(() => {
  delete (window as Partial<Window>).teachingSystem
  vi.unstubAllGlobals()
})

describe('WebDesktopDownloadNotice', () => {
  it.each([
    [{ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, 'windows'],
    [{ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }, 'macos'],
    [{ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, 'linux'],
    [{ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone)' }, 'other']
  ] as const)('detects %s as %s', (browser, expected) => {
    expect(detectDesktopDownloadPlatform(browser)).toBe(expected)
  })

  it('selects only an official installer matching the browser platform', () => {
    const assets = [
      { name: 'latest.yml', browser_download_url: 'https://github.com/kaieye/StudiumX/releases/download/v0.0.5/latest.yml' },
      { name: 'StudiumX-0.0.5-win-x64.exe', browser_download_url: windowsInstaller },
      { name: 'StudiumX-0.0.5-linux-x86_64.AppImage', browser_download_url: linuxInstaller },
      { name: 'StudiumX-0.0.5-mac-arm64.dmg', browser_download_url: 'https://example.com/installer.dmg' }
    ]

    expect(selectLatestReleaseAsset(assets, 'windows')).toBe(windowsInstaller)
    expect(selectLatestReleaseAsset(assets, 'linux')).toBe(linuxInstaller)
    expect(selectLatestReleaseAsset(assets, 'macos')).toBeNull()
    expect(selectLatestReleaseAsset(assets, 'other')).toBeNull()
  })

  it('fetches the latest release only after a Web visitor clicks the platform download button', async () => {
    const navigate = vi.fn()
    const downloadWindow = { opener: window, location: { assign: navigate } } as unknown as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(downloadWindow)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assets: [{ name: 'StudiumX-0.0.5-linux-x86_64.AppImage', browser_download_url: linuxInstaller }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    renderWebNotice()

    const download = screen.getByRole('link', { name: /下载|download/i })
    expect(download).toHaveAttribute('href', releasePage)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(download)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(linuxInstaller))
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(downloadWindow.opener).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the GitHub latest-release page when no matching installer is published', async () => {
    const navigate = vi.fn()
    const downloadWindow = { opener: window, location: { assign: navigate } } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(downloadWindow)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [] }) }))

    renderWebNotice()
    fireEvent.click(screen.getByRole('link', { name: /下载|download/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(releasePage))
  })
})
