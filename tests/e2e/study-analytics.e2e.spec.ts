import { expect } from '@playwright/test'
import { test } from '../helpers/electron'
import { expectNoAccessibilityViolations } from '../helpers/accessibility'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const fab = mainWindow.locator('.workbench-analytics-fab')
  if (await fab.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(fab).toBeVisible()
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
  await expect(mainWindow.locator('.study-analytics-page [data-state]').first()).toBeVisible()
  await expect(mainWindow.locator('.study-analytics-scroll')).toHaveCount(1)
  const overflow = await mainWindow.locator('.study-analytics-scroll').evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  await expectNoAccessibilityViolations(mainWindow, { include: '.study-analytics-page' })
})

test('FAB opens analytics and back restores the FAB focus', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)
  await expect(mainWindow.locator('.workbench-analytics-fab')).toBeVisible()
  await mainWindow.locator('.workbench-analytics-fab').click()
  await expect(mainWindow).toHaveURL(/workbench=analytics/)
  await expect(mainWindow.locator('.study-analytics-page')).toBeVisible()

  await mainWindow.getByRole('button', { name: /返回自习室|Back to study room/i }).click()
  await expect(mainWindow).toHaveURL(/workbench=1/)
  await expect(mainWindow.locator('.workbench-analytics-fab')).toBeFocused()
})

test('analytics stays focused on a single token usage card', async ({ mainWindow }) => {
  await openAnalytics(mainWindow)

  await expect(mainWindow.locator('.token-consumption-card')).toHaveCount(1)
  await expect(mainWindow.locator('.focus-heatmap__grid')).toHaveCount(0)
  await expect(mainWindow.locator('.analytics-section-card')).toHaveCount(0)
})
