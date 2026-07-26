import { expect } from '@playwright/test'
import { test } from '../helpers/electron'
import { expectNoAccessibilityViolations } from '../helpers/accessibility'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const taskToggle = mainWindow.locator('.workbench-task-toggle-card')
  if (await taskToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(taskToggle).toBeVisible()
}

async function openAnalyticsEntry(mainWindow: import('@playwright/test').Page): Promise<void> {
  await openWorkbench(mainWindow)
  const isExpanded = await mainWindow.locator('.workbench-task-toggle-card').getAttribute('aria-expanded')
  if (isExpanded !== 'true') {
    await mainWindow.locator('.workbench-task-toggle-card').click()
  }
  await expect(mainWindow.locator('.workbench-task-analytics-button')).toBeVisible()
}

async function openAnalytics(mainWindow: import('@playwright/test').Page): Promise<void> {
  await mainWindow.evaluate(() => {
    history.replaceState(null, '', `${location.pathname}?workbench=analytics`)
  })
  await mainWindow.reload()
  await expect(mainWindow.locator('.study-analytics-page')).toBeVisible()
}

test('opens analytics from a deep link with accessible light and dark section states @a11y', async ({ mainWindow }) => {
  await openAnalytics(mainWindow)

  await expect(mainWindow).toHaveURL(/workbench=analytics/)
  await expect(mainWindow.locator('#analytics-main')).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-page h1')).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-page [data-section-state]').first()).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-scroll')).toHaveCount(1)

  const emptySections = mainWindow.locator('.analytics-section-card[data-section-state="empty"]')
  await expect(emptySections.first()).toBeVisible()
  await expect(mainWindow.getByText('当前范围内暂无学习记录。').first()).toBeVisible()
  await expect(mainWindow.getByText(/尚未接入/)).toHaveCount(0)
  await expect(mainWindow.getByText(/未提供学习分析 API/)).toHaveCount(0)

  for (const theme of ['light', 'dark'] as const) {
    await mainWindow.evaluate((resolvedTheme) => {
      document.documentElement.dataset.resolvedTheme = resolvedTheme
    }, theme)
    await expect(mainWindow.locator('html')).toHaveAttribute('data-resolved-theme', theme)

    const overflow = await mainWindow.locator('.study-analytics-scroll').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

    await expectNoAccessibilityViolations(mainWindow, { include: '.study-analytics-page' })
  }
})

test('task panel analytics button opens analytics and back restores focus', async ({ mainWindow }) => {
  await openAnalyticsEntry(mainWindow)
  const analyticsButton = mainWindow.locator('.workbench-task-analytics-button')
  await expect(analyticsButton).toBeVisible()
  await analyticsButton.click()
  await expect(mainWindow).toHaveURL(/workbench=analytics/)
  await expect(mainWindow.locator('.study-analytics-page')).toBeVisible()

  await mainWindow.getByRole('button', { name: /返回自习室|Back to study room/i }).click()
  await expect(mainWindow).toHaveURL(/workbench=1/)
  await expect(mainWindow.locator('.workbench-task-analytics-button')).toBeFocused()
})

test('analytics renders the full multi-section dashboard', async ({ mainWindow }) => {
  await openAnalytics(mainWindow)

  // The stripped-down single token card is gone.
  await expect(mainWindow.locator('.token-consumption-card')).toHaveCount(0)

  // The streamlined section set and range presets are present.
  await expect(mainWindow.locator('.analytics-section-card')).toHaveCount(5)
  await expect(mainWindow.locator('#analytics-section-memory')).toHaveCount(0)
  await expect(mainWindow.locator('#analytics-section-platform')).toHaveCount(0)
  await expect(mainWindow.locator('#analytics-section-insights')).toHaveCount(0)
  await expect(mainWindow.locator('.analytics-range-bar')).toBeVisible()
})


test('focus board keeps every card inside a compact mosaic in a narrow window', async ({ electronApp, mainWindow }) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 900)
  })
  await openAnalytics(mainWindow)

  const focus = mainWindow.locator('.analytics-focus')
  await expect(focus).toBeVisible()
  // At the width where the old layout left a blank lane under the heatmap,
  // the board must choose the compact two-column mosaic before it overflows.
  await expect.poll(async () => focus.evaluate((board) => (
    getComputedStyle(board).gridTemplateColumns.split(' ').filter(Boolean).length
  ))).toBe(2)

  const layout = await focus.evaluate((board) => {
    const boardRect = board.getBoundingClientRect()
    const cards = [...board.querySelectorAll<HTMLElement>(
      '.analytics-focus__heatmap, .analytics-focus__plan, .analytics-focus__share, .analytics-focus__hours, .analytics-focus__percentile'
    )].map((card) => {
      const rect = card.getBoundingClientRect()
      return {
        className: card.className,
        gridArea: getComputedStyle(card).gridArea,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      }
    })
    const heatmapScroll = board.querySelector<HTMLElement>('.calendar-heatmap__scroll')
    return {
      boardClassName: board.className,
      gridTemplateAreas: getComputedStyle(board).gridTemplateAreas,
      boardLeft: boardRect.left,
      boardRight: boardRect.right,
      scrollWidth: board.scrollWidth,
      clientWidth: board.clientWidth,
      heatmapScrollWidth: heatmapScroll?.scrollWidth ?? 0,
      heatmapClientWidth: heatmapScroll?.clientWidth ?? 0,
      cards
    }
  })

  expect(layout.boardClassName).toContain('analytics-focus--mosaic')
  for (const area of ['heat', 'plan', 'share', 'hours', 'hub']) {
    expect(layout.gridTemplateAreas).toContain(area)
  }
  expect(layout.cards).toHaveLength(5)
  expect(layout.cards.map((card) => card.gridArea)).toEqual(['heat', 'plan', 'share', 'hours', 'hub'])
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
  expect(layout.heatmapScrollWidth).toBeLessThanOrEqual(layout.heatmapClientWidth + 1)
  for (const card of layout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(layout.boardLeft - 1)
    expect(card.right).toBeLessThanOrEqual(layout.boardRight + 1)
  }
})

test('focus board keeps all five cards visible at the smallest window', async ({ electronApp, mainWindow }) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(800, 900)
  })
  await openAnalytics(mainWindow)

  const focus = mainWindow.locator('.analytics-focus')
  await expect(focus).toBeVisible()
  await expect.poll(async () => focus.evaluate((board) => board.clientWidth)).toBeGreaterThan(0)

  const layout = await focus.evaluate((board) => {
    const boardRect = board.getBoundingClientRect()
    const cards = [...board.querySelectorAll<HTMLElement>(
      '.analytics-focus__heatmap, .analytics-focus__plan, .analytics-focus__share, .analytics-focus__hours, .analytics-focus__percentile'
    )].map((card) => {
      const rect = card.getBoundingClientRect()
      return {
        gridArea: getComputedStyle(card).gridArea,
        left: rect.left,
        right: rect.right
      }
    })
    const heatmapScroll = board.querySelector<HTMLElement>('.calendar-heatmap__scroll')
    return {
      boardLeft: boardRect.left,
      boardRight: boardRect.right,
      scrollWidth: board.scrollWidth,
      clientWidth: board.clientWidth,
      heatmapScrollWidth: heatmapScroll?.scrollWidth ?? 0,
      heatmapClientWidth: heatmapScroll?.clientWidth ?? 0,
      cards
    }
  })

  expect(layout.cards).toHaveLength(5)
  expect(layout.cards.map((card) => card.gridArea)).toEqual(['heat', 'plan', 'share', 'hours', 'hub'])
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
  expect(layout.heatmapScrollWidth).toBeLessThanOrEqual(layout.heatmapClientWidth + 1)
  for (const card of layout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(layout.boardLeft - 1)
    expect(card.right).toBeLessThanOrEqual(layout.boardRight + 1)
  }
})
