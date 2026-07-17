import { expect, test } from '../helpers/electron'

const resourceSubpages = [
  { cardTitle: '风格样式库', pageSelector: '.resource-style-page' },
  { cardTitle: '技能库', pageSelector: '.skill-library-page' },
  { cardTitle: '宠物', pageSelector: '.pet-library-page' }
] as const

test('keeps resource subpage scrollbars below the Windows drag region', async ({ mainWindow }) => {
  await mainWindow.getByRole('button', { name: '资源', exact: true }).click()
  await expect(mainWindow.locator('.resource-home')).toBeVisible()

  for (const subpage of resourceSubpages) {
    await mainWindow.locator('.resource-entry-card').filter({ hasText: subpage.cardTitle }).click()
    await expect(mainWindow.locator(subpage.pageSelector)).toBeVisible()

    const geometry = await mainWindow.evaluate(() => {
      const mainArea = document.querySelector<HTMLElement>('.main-area[data-view="resources"]')
      const dragRegion = document.querySelector<HTMLElement>('.windows-window-chrome')
      if (!mainArea || !dragRegion) throw new Error('Resource main area or Windows drag region is unavailable')

      return {
        mainTop: mainArea.getBoundingClientRect().top,
        dragBottom: dragRegion.getBoundingClientRect().bottom,
        section: mainArea.dataset.resourceSection
      }
    })

    expect(geometry.section).not.toBe('home')
    expect(geometry.mainTop).toBeGreaterThanOrEqual(geometry.dragBottom)
    await mainWindow.getByRole('button', { name: '返回资源', exact: true }).click()
    await expect(mainWindow.locator('.resource-home')).toBeVisible()
  }
})
