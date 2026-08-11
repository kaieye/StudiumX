import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  clampSidebarWidth,
  defaultSidebarWidth,
  DesktopAppFrame,
  resolveSidebarResizePolicy,
  resolveWindowChromePolicy,
  sidebarWidthForKeyboardKey
} from '@renderer/app-frame/window-chrome'
import { renderUi, screen, setupUser } from '../helpers/render'

describe('window chrome policy', () => {
  it('selects adapters without leaking platform conditionals into consumers', () => {
    expect(resolveWindowChromePolicy('win32')).toMatchObject({
      adapter: 'windows',
      platformClass: 'platform-win32',
      titlebar: 'native-overlay',
      sidebarTogglePlacement: 'window-chrome',
      sidebarDragRegionClass: 'windows-sidebar-drag-region'
    })
    expect(resolveWindowChromePolicy('darwin')).toMatchObject({
      adapter: 'macos',
      platformClass: 'platform-darwin',
      titlebar: 'native-traffic-lights',
      sidebarTogglePlacement: 'window-chrome',
      sidebarDragRegionClass: 'mac-sidebar-drag-region'
    })
    expect(resolveWindowChromePolicy('linux')).toMatchObject({
      adapter: 'fallback',
      platformClass: '',
      titlebar: 'custom',
      sidebarTogglePlacement: 'inline-topbar',
      sidebarDragRegionClass: null
    })
    expect(resolveWindowChromePolicy('web')).toMatchObject({
      adapter: 'web',
      platformClass: '',
      titlebar: 'none',
      sidebarTogglePlacement: 'inline-topbar',
      sidebarDragRegionClass: null
    })
  })

  it('resizes the session list pane while keeping the icon rail stable', () => {
    const expanded = resolveSidebarResizePolicy(false)

    expect(defaultSidebarWidth()).toBe(288)
    expect(expanded).toEqual({
      enabled: true,
      minimumWidth: 220,
      maximumWidth: 420,
      keyboardStep: 12
    })
    expect(clampSidebarWidth(200.6, expanded)).toBe(220)
    expect(clampSidebarWidth(480.4, expanded)).toBe(420)
    expect(sidebarWidthForKeyboardKey('ArrowLeft', 288, expanded)).toBe(276)
    expect(sidebarWidthForKeyboardKey('ArrowRight', 288, expanded)).toBe(300)
    expect(sidebarWidthForKeyboardKey('Enter', 288, expanded)).toBeNull()
  })

  it('makes a collapsed session list non-resizable without changing its stored width', () => {
    const collapsed = resolveSidebarResizePolicy(true)

    expect(collapsed.enabled).toBe(false)
    expect(sidebarWidthForKeyboardKey('ArrowLeft', 288, collapsed)).toBeNull()
    expect(clampSidebarWidth(288, collapsed)).toBe(288)
  })

  it('composes explicit draggable and clickable chrome layers for each adapter', async () => {
    const onSidebarToggle = vi.fn()
    const user = setupUser()
    const windows = renderUi(
      <DesktopAppFrame
        chrome={resolveWindowChromePolicy('win32')}
        density="comfortable"
        onSidebarToggle={onSidebarToggle}
        sidebarCollapsed={false}
        sidebarWidth={232}
      >
        <div>workspace</div>
      </DesktopAppFrame>
    )

    expect(windows.container.querySelector('.window-chrome-drag-region')).toHaveClass('windows-sidebar-drag-region')
    expect(windows.container.querySelector('.windows-window-chrome')).toBeInTheDocument()
    expect(windows.container.querySelector('.windows-sidebar-toggle-chrome')).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(onSidebarToggle).toHaveBeenCalledTimes(1)

    windows.unmount()
    const mac = renderUi(
      <DesktopAppFrame
        chrome={resolveWindowChromePolicy('darwin')}
        density="comfortable"
        onSidebarToggle={onSidebarToggle}
        sidebarCollapsed={false}
        sidebarWidth={232}
      >
        <div>workspace</div>
      </DesktopAppFrame>
    )

    expect(mac.container.querySelector('.window-chrome-drag-region')).toHaveClass('mac-sidebar-drag-region')
    expect(mac.container.querySelector('.mac-sidebar-toggle-chrome')).toBeInTheDocument()
    expect(mac.container.querySelector('.windows-window-chrome')).not.toBeInTheDocument()

    mac.unmount()
    const fallback = renderUi(
      <DesktopAppFrame
        chrome={resolveWindowChromePolicy('linux')}
        density="comfortable"
        onSidebarToggle={onSidebarToggle}
        sidebarCollapsed={false}
        sidebarWidth={232}
      >
        <div>workspace</div>
      </DesktopAppFrame>
    )

    expect(fallback.container.querySelector('.window-chrome-drag-region')).not.toBeInTheDocument()
    expect(fallback.container.querySelector('.windows-sidebar-toggle-chrome')).not.toBeInTheDocument()
    expect(fallback.container.querySelector('.window-titlebar')).toBeInTheDocument()
    expect(fallback.container.querySelectorAll('.window-control-btn')).toHaveLength(3)

    fallback.unmount()
    const web = renderUi(
      <DesktopAppFrame
        chrome={resolveWindowChromePolicy('web')}
        density="comfortable"
        onSidebarToggle={onSidebarToggle}
        sidebarCollapsed={false}
        sidebarWidth={232}
      >
        <div>workspace</div>
      </DesktopAppFrame>
    )

    expect(web.container.querySelector('.window-chrome-drag-region')).not.toBeInTheDocument()
    expect(web.container.querySelector('.window-titlebar')).not.toBeInTheDocument()
    expect(web.container.querySelectorAll('.window-control-btn')).toHaveLength(0)
  })

  it('keeps the policy-owned drag and no-drag contract in the global stylesheet', () => {
    const entryStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const chromeStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/app-frame/window-chrome.css'), 'utf8')

    expect(entryStyles).toContain('@import "./app-frame/window-chrome.css";')
    expect(chromeStyles).toMatch(/\.window-chrome-drag-region\s*\{[\s\S]*app-region:\s*drag;[\s\S]*-webkit-app-region:\s*drag;/)
    expect(chromeStyles).toMatch(/\.window-chrome-interactive,[\s\S]*app-region:\s*no-drag;[\s\S]*-webkit-app-region:\s*no-drag;/)
  })

})
