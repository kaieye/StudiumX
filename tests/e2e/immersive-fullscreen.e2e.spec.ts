import { expect, test } from '../helpers/electron'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(immersiveToggle).toBeVisible()
}

test('immersive room menu toggles the study room fullscreen', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)
  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()

  const controls = mainWindow.locator('.workbench-immersive-controls')
  await controls.hover()

  const enterFullscreen = mainWindow.getByRole('button', { name: '进入全屏' })
  await expect(enterFullscreen).toBeVisible()
  await enterFullscreen.click()

  await expect.poll(() =>
    mainWindow.evaluate(() => document.fullscreenElement?.classList.contains('office-workbench-stage') ?? false)
  ).toBe(true)
  await expect(mainWindow.getByRole('button', { name: '退出全屏' })).toBeVisible()

  await mainWindow.getByRole('button', { name: '退出全屏' }).click()
  await expect.poll(() => mainWindow.evaluate(() => document.fullscreenElement === null)).toBe(true)
})
