import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import type { WindowControlAction } from '../../../shared/teaching-types'

export type WindowChromeAdapter = 'windows' | 'macos' | 'fallback' | 'web'
export type WindowTitlebarKind = 'native-overlay' | 'native-traffic-lights' | 'custom' | 'none'
export type SidebarTogglePlacement = 'window-chrome' | 'inline-topbar'

export interface WindowChromePolicy {
  adapter: WindowChromeAdapter
  platformClass: '' | 'platform-win32' | 'platform-darwin'
  titlebar: WindowTitlebarKind
  sidebarTogglePlacement: SidebarTogglePlacement
  sidebarDragRegionClass: 'windows-sidebar-drag-region' | 'mac-sidebar-drag-region' | null
}

const WINDOWS_WINDOW_CHROME_POLICY: WindowChromePolicy = {
  adapter: 'windows',
  platformClass: 'platform-win32',
  titlebar: 'native-overlay',
  sidebarTogglePlacement: 'window-chrome',
  sidebarDragRegionClass: 'windows-sidebar-drag-region'
}

const MACOS_WINDOW_CHROME_POLICY: WindowChromePolicy = {
  adapter: 'macos',
  platformClass: 'platform-darwin',
  titlebar: 'native-traffic-lights',
  sidebarTogglePlacement: 'window-chrome',
  sidebarDragRegionClass: 'mac-sidebar-drag-region'
}

const FALLBACK_WINDOW_CHROME_POLICY: WindowChromePolicy = {
  adapter: 'fallback',
  platformClass: '',
  titlebar: 'custom',
  sidebarTogglePlacement: 'inline-topbar',
  sidebarDragRegionClass: null
}

const WEB_WINDOW_CHROME_POLICY: WindowChromePolicy = {
  adapter: 'web',
  platformClass: '',
  titlebar: 'none',
  sidebarTogglePlacement: 'inline-topbar',
  sidebarDragRegionClass: null
}

export function resolveWindowChromePolicy(platform: string | undefined): WindowChromePolicy {
  if (platform === 'win32') return WINDOWS_WINDOW_CHROME_POLICY
  if (platform === 'darwin') return MACOS_WINDOW_CHROME_POLICY
  if (platform === 'web') return WEB_WINDOW_CHROME_POLICY
  return FALLBACK_WINDOW_CHROME_POLICY
}

export interface SidebarResizePolicy {
  enabled: boolean
  minimumWidth: number
  maximumWidth: number
  keyboardStep: number
}

const SIDEBAR_WIDTH = 288

const SIDEBAR_RESIZE_LIMITS = {
  // The icon rail stays at a stable touch-friendly width. The divider on the
  // session-list/conversation seam resizes the complete left pane instead.
  minimumWidth: 220,
  maximumWidth: 420,
  keyboardStep: 12
} as const

export function resolveSidebarResizePolicy(sidebarCollapsed: boolean): SidebarResizePolicy {
  return {
    enabled: !sidebarCollapsed,
    minimumWidth: SIDEBAR_RESIZE_LIMITS.minimumWidth,
    maximumWidth: SIDEBAR_RESIZE_LIMITS.maximumWidth,
    keyboardStep: SIDEBAR_RESIZE_LIMITS.keyboardStep
  }
}

export function defaultSidebarWidth(): number {
  return SIDEBAR_WIDTH
}

export function clampSidebarWidth(width: number, policy: SidebarResizePolicy): number {
  return Math.min(policy.maximumWidth, Math.max(policy.minimumWidth, Math.round(width)))
}

export function sidebarWidthForKeyboardKey(
  key: string,
  width: number,
  policy: SidebarResizePolicy
): number | null {
  if (!policy.enabled) return null
  if (key === 'ArrowLeft') return clampSidebarWidth(width - policy.keyboardStep, policy)
  if (key === 'ArrowRight') return clampSidebarWidth(width + policy.keyboardStep, policy)
  return null
}

export interface DesktopAppFrameProps {
  chrome: WindowChromePolicy
  sidebarCollapsed: boolean
  /** Dim the Windows titlebar surface when an in-app modal covers the workspace. */
  windowChromeDimmed?: boolean
  /** Hide the chrome control when the current surface intentionally has no session panel. */
  sidebarToggleVisible?: boolean
  sidebarWidth: number
  density: string
  onSidebarToggle: () => void
  floatingContent?: ReactNode
  children: ReactNode
}

export function DesktopAppFrame({
  chrome,
  sidebarCollapsed,
  windowChromeDimmed = false,
  sidebarToggleVisible = true,
  sidebarWidth,
  density,
  onSidebarToggle,
  floatingContent,
  children
}: DesktopAppFrameProps) {
  const frameStyle = { '--sidebar-width': `${sidebarWidth}px` } as CSSProperties
  const platformClass = chrome.platformClass ? ` ${chrome.platformClass}` : ''
  const collapsedClass = sidebarCollapsed ? ' is-sidebar-collapsed' : ''
  const dimmedChromeClass = windowChromeDimmed ? ' is-window-chrome-dimmed' : ''

  return (
    <div
      className={`app-frame${platformClass}${dimmedChromeClass}`}
      data-window-chrome={chrome.adapter}
      style={frameStyle}
    >
      <WindowChrome
        chrome={chrome}
        sidebarCollapsed={sidebarCollapsed}
        sidebarToggleVisible={sidebarToggleVisible}
        onSidebarToggle={onSidebarToggle}
      />
      <div
        className={`app-shell${platformClass}${collapsedClass}`}
        data-density={density}
        style={frameStyle}
      >
        {children}
      </div>
      {floatingContent}
    </div>
  )
}

interface WindowChromeProps {
  chrome: WindowChromePolicy
  sidebarCollapsed: boolean
  sidebarToggleVisible: boolean
  onSidebarToggle: () => void
}

function WindowChrome({ chrome, sidebarCollapsed, sidebarToggleVisible, onSidebarToggle }: WindowChromeProps) {
  if (chrome.titlebar === 'none') return null
  if (chrome.titlebar === 'native-overlay') {
    return (
      <WindowsWindowChromeAdapter
        dragRegionClass={chrome.sidebarDragRegionClass as 'windows-sidebar-drag-region'}
        sidebarCollapsed={sidebarCollapsed}
        sidebarToggleVisible={sidebarToggleVisible}
        onSidebarToggle={onSidebarToggle}
      />
    )
  }
  if (chrome.titlebar === 'native-traffic-lights') {
    return (
      <MacWindowChromeAdapter
        dragRegionClass={chrome.sidebarDragRegionClass as 'mac-sidebar-drag-region'}
        sidebarCollapsed={sidebarCollapsed}
        sidebarToggleVisible={sidebarToggleVisible}
        onSidebarToggle={onSidebarToggle}
      />
    )
  }
  return <FallbackWindowChromeAdapter />
}

function WindowsWindowChromeAdapter({
  dragRegionClass,
  sidebarCollapsed,
  sidebarToggleVisible,
  onSidebarToggle
}: Omit<WindowChromeProps, 'chrome'> & { dragRegionClass: 'windows-sidebar-drag-region' }) {
  return (
    <>
      <SidebarDragRegion className={dragRegionClass} collapsed={sidebarCollapsed} />
      {sidebarToggleVisible ? (
        <SidebarToggleChrome
          chromeClassName="windows-sidebar-toggle-chrome"
          buttonClassName="windows-sidebar-toggle"
          iconClassName="windows-sidebar-action-icon"
          sidebarCollapsed={sidebarCollapsed}
          onSidebarToggle={onSidebarToggle}
        />
      ) : null}
      <div className="windows-window-chrome" aria-hidden="true" />
    </>
  )
}

function MacWindowChromeAdapter({
  dragRegionClass,
  sidebarCollapsed,
  sidebarToggleVisible,
  onSidebarToggle
}: Omit<WindowChromeProps, 'chrome'> & { dragRegionClass: 'mac-sidebar-drag-region' }) {
  return (
    <>
      <SidebarDragRegion className={dragRegionClass} collapsed={sidebarCollapsed} />
      {sidebarToggleVisible ? (
        <SidebarToggleChrome
          chromeClassName="mac-sidebar-toggle-chrome"
          buttonClassName="mac-sidebar-toggle"
          iconClassName="mac-sidebar-action-icon"
          sidebarCollapsed={sidebarCollapsed}
          onSidebarToggle={onSidebarToggle}
        />
      ) : null}
    </>
  )
}

function FallbackWindowChromeAdapter() {
  return (
    <div className="window-titlebar">
      <WindowControlButtons />
    </div>
  )
}

function SidebarDragRegion({ className, collapsed }: { className: string; collapsed: boolean }) {
  return (
    <div
      className={`window-chrome-drag-region ${className}${collapsed ? ' is-sidebar-collapsed' : ''}`}
      aria-hidden="true"
    />
  )
}

interface SidebarToggleChromeProps {
  chromeClassName: string
  buttonClassName: string
  iconClassName: string
  sidebarCollapsed: boolean
  onSidebarToggle: () => void
}

function SidebarToggleChrome({
  chromeClassName,
  buttonClassName,
  iconClassName,
  sidebarCollapsed,
  onSidebarToggle
}: SidebarToggleChromeProps) {
  const { t } = useTranslation()
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSidebarToggle()
  }
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (event.detail !== 0) {
      event.preventDefault()
      return
    }
    onSidebarToggle()
  }

  return (
    <div className={`window-chrome-interactive ${chromeClassName}`}>
      <button
        className={`icon-button ${buttonClassName}`}
        type="button"
        aria-label={sidebarCollapsed ? t('main.expandSidebar') : t('main.collapseSidebar')}
        title={sidebarCollapsed ? t('main.expandSidebar') : t('main.collapseSidebar')}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
      >
        <SidebarToggleGlyph className={iconClassName} collapsed={sidebarCollapsed} />
      </button>
    </div>
  )
}

function SidebarToggleGlyph({ className, collapsed }: { className: string; collapsed: boolean }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return <Icon className={className} size={17} strokeWidth={1.9} aria-hidden="true" />
}

function WindowControlButtons() {
  const { t } = useTranslation()
  return (
    <div className="window-controls" role="group" aria-label={t('titlebar.group')}>
      <button
        className="window-control-btn"
        type="button"
        aria-label={t('titlebar.minimize')}
        title={t('titlebar.minimize')}
        onClick={() => controlAppWindow('minimize')}
      >
        <Minus size={14} strokeWidth={1.8} />
      </button>
      <button
        className="window-control-btn"
        type="button"
        aria-label={t('titlebar.maximize')}
        title={t('titlebar.maximize')}
        onClick={() => controlAppWindow('toggle-maximize')}
      >
        <Square size={12} strokeWidth={1.7} />
      </button>
      <button
        className="window-control-btn window-control-btn--close"
        type="button"
        aria-label={t('titlebar.close')}
        title={t('titlebar.close')}
        onClick={() => controlAppWindow('close')}
      >
        <X size={15} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function controlAppWindow(action: WindowControlAction): void {
  try {
    const request = window.teachingSystem?.controlWindow(action)
    void request?.catch((error: unknown) => {
      console.error(`[StudiumX] window control failed (${action}):`, error)
    })
  } catch (error) {
    // Browser/fallback surfaces intentionally do not expose native window
    // controls. Keep the shared chrome inert instead of letting the adapter's
    // fail-closed WebNotSupportedError escape from a click handler.
    console.debug(`[StudiumX] window control unavailable (${action}):`, error)
  }
}

interface SidebarResizeHandleProps {
  policy: SidebarResizePolicy
  onResize: (width: number) => void
  width: number
}

export function SidebarResizeHandle({ policy, onResize, width }: SidebarResizeHandleProps) {
  const { t } = useTranslation()
  const disabled = !policy.enabled
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      onResize(clampSidebarWidth(startWidth + moveEvent.clientX - startX, policy))
    }

    const finishResize = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      document.body.classList.remove('is-sidebar-resizing')
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    document.body.classList.add('is-sidebar-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const nextWidth = sidebarWidthForKeyboardKey(event.key, width, policy)
    if (nextWidth === null) return
    event.preventDefault()
    onResize(nextWidth)
  }

  return (
    <div
      aria-label={t('sidebarResizer.aria')}
      aria-orientation="vertical"
      aria-valuemax={policy.maximumWidth}
      aria-valuemin={policy.minimumWidth}
      aria-valuenow={width}
      className={`sidebar-resizer${disabled ? ' is-disabled' : ''}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      role="separator"
      tabIndex={disabled ? -1 : 0}
    />
  )
}
