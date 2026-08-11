import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/electron'

type SurfaceGeometry = {
  x: number
  y: number
  width: number
  height: number
  display: string
  opacity: number
  borderRadius: string
  borderBottomRightRadius: string
  backgroundImage: string
}

type SidebarGeometry = {
  rail: SurfaceGeometry
  panel: SurfaceGeometry
  motionContent: SurfaceGeometry
  divider: SurfaceGeometry
  main: SurfaceGeometry
  topbar: SurfaceGeometry
  corner: SurfaceGeometry
}

async function readSidebarGeometry(mainWindow: Page): Promise<SidebarGeometry> {
  return mainWindow.evaluate(() => {
    const describe = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) throw new Error(`Expected ${selector} to be present`)

      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        display: style.display,
        opacity: Number(style.opacity),
        borderRadius: style.borderRadius,
        borderBottomRightRadius: style.borderBottomRightRadius,
        backgroundImage: style.backgroundImage
      }
    }

    return {
      rail: describe('.sidebar-icon-rail'),
      panel: describe('.sidebar-panel'),
      motionContent: describe('.sidebar-panel-motion-content'),
      divider: describe('.sidebar-resizer'),
      main: describe('.main-area'),
      topbar: describe('.topbar'),
      corner: describe('.topbar-surface-corner')
    }
  })
}

test('collapsing the session panel preserves the fixed rail and clips its full-width content', async ({ mainWindow }) => {
  const collapsePanel = mainWindow.getByRole('button', {
    name: /^(折叠会话面板|Collapse session panel)$/i
  })
  await expect(collapsePanel).toBeVisible()
  await expect(mainWindow.locator('.sidebar-panel')).toBeVisible()

  const expanded = await readSidebarGeometry(mainWindow)
  expect(expanded.rail.width).toBe(60)
  expect(expanded.panel.width).toBeGreaterThan(0)
  expect(expanded.main.borderRadius).toBe('0px')
  expect(expanded.corner.display).toBe('none')
  expect(expanded.corner.backgroundImage).toBe('none')

  await collapsePanel.click()
  await mainWindow.waitForTimeout(80)

  const duringCollapse = await readSidebarGeometry(mainWindow)
  expect(duringCollapse.rail.width).toBe(expanded.rail.width)
  expect(duringCollapse.panel.display).toBe('flex')
  // The moving outer surface contracts horizontally; the inner content keeps
  // its expanded width and is clipped instead of reflowing or fading.
  expect(duringCollapse.panel.width).toBeGreaterThan(expanded.panel.width * 0.4)
  expect(duringCollapse.panel.opacity).toBe(1)
  expect(duringCollapse.motionContent.width).toBeCloseTo(expanded.panel.width, 1)
  expect(duringCollapse.divider.display).toBe('block')
  expect(duringCollapse.divider.opacity).toBeGreaterThan(0)
  expect(duringCollapse.divider.opacity).toBeLessThan(1)
  expect(duringCollapse.main.x).toBeLessThan(expanded.main.x)
  expect(duringCollapse.main.x).toBeGreaterThan(expanded.rail.width)

  await mainWindow.waitForTimeout(320)

  const collapsed = await readSidebarGeometry(mainWindow)
  expect(collapsed.rail.width).toBe(expanded.rail.width)
  expect(collapsed.panel.display).toBe('flex')
  expect(collapsed.panel.width).toBe(0)
  expect(collapsed.panel.opacity).toBe(1)
  expect(collapsed.motionContent.width).toBeCloseTo(expanded.panel.width, 1)
  expect(collapsed.divider.display).toBe('block')
  expect(collapsed.divider.opacity).toBe(0)
  expect(collapsed.main.x).toBe(collapsed.rail.width)
  expect(collapsed.main.borderRadius).toBe('12px 0px 0px 12px')
  // The title strip itself stays square. Its chrome-colored corner overlay
  // reveals the same left-top white surface radius as the expanded panel.
  expect(collapsed.topbar.borderRadius).toBe('0px')
  expect(collapsed.corner.display).toBe('block')
  expect(collapsed.corner.x).toBe(collapsed.main.x)
  expect(collapsed.corner.y).toBe(collapsed.topbar.y + collapsed.topbar.height)
  expect(collapsed.corner.width).toBe(12)
  expect(collapsed.corner.height).toBe(12)
  expect(collapsed.corner.borderBottomRightRadius).toBe('0px')
  expect(collapsed.corner.backgroundImage).toContain('radial-gradient')
})
