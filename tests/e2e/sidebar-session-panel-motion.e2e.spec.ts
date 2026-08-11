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

type DividerGeometry = SurfaceGeometry & {
  lineTopInset: number
  lineBottomInset: number
  lineHeight: number
  lineOpacity: number
  lineScaleY: number
}

type SidebarGeometry = {
  rail: SurfaceGeometry
  panel: SurfaceGeometry
  motionContent: SurfaceGeometry
  divider: DividerGeometry
  main: SurfaceGeometry
  topbar: SurfaceGeometry
  corner: SurfaceGeometry
  roundedEndInset: number
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

    const divider = document.querySelector<HTMLElement>('.sidebar-resizer')
    const shell = document.querySelector<HTMLElement>('.app-shell')
    if (!divider || !shell) throw new Error('Expected sidebar divider and shell to be present')

    const dividerLine = getComputedStyle(divider, '::before')
    const lineScaleY = (() => {
      if (dividerLine.transform === 'none') return 1
      const parts = dividerLine.transform.match(/matrix\(([^)]+)\)/)?.[1].split(',')
      return parts ? Number.parseFloat(parts[3]) : Number.NaN
    })()

    return {
      rail: describe('.sidebar-icon-rail'),
      panel: describe('.sidebar-panel'),
      motionContent: describe('.sidebar-panel-motion-content'),
      divider: {
        ...describe('.sidebar-resizer'),
        lineTopInset: Number.parseFloat(dividerLine.top),
        lineBottomInset: Number.parseFloat(dividerLine.bottom),
        lineHeight: Number.parseFloat(dividerLine.height),
        lineOpacity: Number(dividerLine.opacity),
        lineScaleY
      },
      main: describe('.main-area'),
      topbar: describe('.topbar'),
      corner: describe('.topbar-surface-corner'),
      roundedEndInset: Number.parseFloat(getComputedStyle(shell).getPropertyValue('--app-shell-main-radius'))
    }
  })
}

function expectDividerToAvoidRoundedEndcaps(geometry: SidebarGeometry): void {
  // The painted seam spans the divider's full height. Conflicts with the
  // rounded rail-facing corners are prevented by the retract-and-fade motion
  // instead of a static endcap inset.
  expect(geometry.divider.lineTopInset).toBe(0)
  expect(geometry.divider.lineBottomInset).toBe(0)
  expect(geometry.divider.lineHeight).toBeCloseTo(geometry.divider.height, 1)
}

test('session-panel motion keeps the movable divider out of the rounded rail seam', async ({ mainWindow }) => {
  const collapsePanel = mainWindow.getByRole('button', {
    name: /^(折叠会话面板|Collapse session panel)$/i
  })
  await expect(collapsePanel).toBeVisible()
  await expect(mainWindow.locator('.sidebar-panel')).toBeVisible()

  const expanded = await readSidebarGeometry(mainWindow)
  expect(expanded.rail.width).toBe(60)
  expect(expanded.panel.width).toBeGreaterThan(0)
  // The white surface and its rail-facing rounded corners live on the
  // fixed-width inner content; the collapsing outer panel stays square so
  // CSS never clamps the radii into a square-ended sliver mid-motion.
  expect(expanded.panel.borderRadius).toBe('0px')
  expect(expanded.motionContent.borderRadius).toBe('12px 0px 0px 12px')
  expect(expanded.main.borderRadius).toBe('0px')
  // The corner overlay is always mounted and hidden via opacity, so it can
  // fade with the panel motion instead of popping a square corner in/out.
  expect(expanded.corner.display).toBe('block')
  expect(expanded.corner.opacity).toBe(0)
  expect(expanded.corner.backgroundImage).toContain('radial-gradient')
  expectDividerToAvoidRoundedEndcaps(expanded)

  await collapsePanel.click()
  await mainWindow.waitForTimeout(120)

  const duringCollapse = await readSidebarGeometry(mainWindow)
  expect(duringCollapse.rail.width).toBe(expanded.rail.width)
  expect(duringCollapse.panel.display).toBe('flex')
  // The moving outer surface contracts horizontally; the inner content keeps
  // its expanded width and is clipped instead of reflowing or fading.
  expect(duringCollapse.panel.width).toBeGreaterThan(expanded.panel.width * 0.2)
  expect(duringCollapse.panel.opacity).toBe(1)
  expect(duringCollapse.motionContent.width).toBeCloseTo(expanded.panel.width, 1)
  expect(duringCollapse.divider.display).toBe('block')
  // The seam retracts toward its midpoint and fades out early, while the
  // moving edge is still safely away from the rail-facing rounded contour;
  // it is never carried into that contour as a square-ended line.
  expect(duringCollapse.divider.lineOpacity).toBe(0)
  expect(duringCollapse.divider.lineScaleY).toBeCloseTo(0.4, 2)
  expect(duringCollapse.main.x).toBeLessThan(expanded.main.x)
  expect(duringCollapse.main.x).toBeGreaterThan(expanded.rail.width)
  expectDividerToAvoidRoundedEndcaps(duringCollapse)

  await mainWindow.waitForTimeout(250)

  const collapsed = await readSidebarGeometry(mainWindow)
  expect(collapsed.rail.width).toBe(expanded.rail.width)
  expect(collapsed.panel.display).toBe('flex')
  expect(collapsed.panel.width).toBe(0)
  expect(collapsed.panel.opacity).toBe(1)
  expect(collapsed.motionContent.width).toBeCloseTo(expanded.panel.width, 1)
  expect(collapsed.divider.display).toBe('block')
  expect(collapsed.divider.lineOpacity).toBe(0)
  expect(collapsed.divider.lineScaleY).toBeCloseTo(0.4, 2)
  expect(collapsed.main.x).toBe(collapsed.rail.width)
  expect(collapsed.main.borderRadius).toBe('12px 0px 0px 12px')
  // The title strip itself stays square. Its chrome-colored corner overlay
  // reveals the same left-top white surface radius as the expanded panel.
  expect(collapsed.topbar.borderRadius).toBe('0px')
  expect(collapsed.corner.display).toBe('block')
  expect(collapsed.corner.opacity).toBe(1)
  expect(collapsed.corner.x).toBe(collapsed.main.x)
  expect(collapsed.corner.y).toBe(collapsed.topbar.y + collapsed.topbar.height)
  expect(collapsed.corner.width).toBe(12)
  expect(collapsed.corner.height).toBe(12)
  expect(collapsed.corner.borderBottomRightRadius).toBe('0px')
  expect(collapsed.corner.backgroundImage).toContain('radial-gradient')
  expectDividerToAvoidRoundedEndcaps(collapsed)

  const expandPanel = mainWindow.getByRole('button', {
    name: /^(展开会话面板|Expand session panel)$/i
  })
  await expect(expandPanel).toBeVisible()
  await expandPanel.click()
  await mainWindow.waitForTimeout(80)
  const duringExpansion = await readSidebarGeometry(mainWindow)
  expect(duringExpansion.panel.width).toBeGreaterThan(0)
  expect(duringExpansion.panel.width).toBeLessThan(expanded.panel.width)
  // Conversely, the seam remains hidden until expansion has moved it well
  // clear of the rounded rail seam.
  expect(duringExpansion.divider.lineOpacity).toBe(0)
  expect(duringExpansion.main.x).toBeGreaterThan(collapsed.main.x)
  expect(duringExpansion.main.x).toBeLessThan(expanded.main.x)
  expectDividerToAvoidRoundedEndcaps(duringExpansion)

  await mainWindow.waitForTimeout(300)
  const reExpanded = await readSidebarGeometry(mainWindow)
  expect(reExpanded.panel.width).toBeCloseTo(expanded.panel.width, 1)
  expect(reExpanded.motionContent.width).toBeCloseTo(expanded.panel.width, 1)
  expect(reExpanded.divider.lineOpacity).toBe(1)
  expect(reExpanded.divider.lineScaleY).toBeCloseTo(1, 2)
  expect(reExpanded.main.x).toBe(expanded.main.x)
  expect(reExpanded.main.borderRadius).toBe('0px')
  expect(reExpanded.corner.opacity).toBe(0)
  expectDividerToAvoidRoundedEndcaps(reExpanded)
})
