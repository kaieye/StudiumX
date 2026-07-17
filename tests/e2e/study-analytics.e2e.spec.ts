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

test('opens analytics from a deep link and exposes page landmarks and unavailable states @a11y', async ({ mainWindow }) => {
  await openAnalytics(mainWindow)

  await expect(mainWindow).toHaveURL(/workbench=analytics/)
  await expect(mainWindow.locator('#analytics-main')).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-page h1')).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-page [data-section-state]').first()).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-scroll')).toHaveCount(1)
  const overflow = await mainWindow.locator('.study-analytics-scroll').evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  await expectNoAccessibilityViolations(mainWindow, { include: '.study-analytics-page' })
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
