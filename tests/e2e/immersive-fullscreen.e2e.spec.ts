import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/electron'

async function openWorkbench(mainWindow: Page): Promise<void> {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(immersiveToggle).toBeVisible()
}

async function enterImmersive(mainWindow: Page): Promise<void> {
  await openWorkbench(mainWindow)
  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()
  await expect(mainWindow.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()
}

async function expectStageFullscreen(mainWindow: Page, expected: boolean): Promise<void> {
  await expect.poll(() =>
    mainWindow.evaluate(() =>
      document.fullscreenElement?.classList.contains('office-workbench-stage') ?? false
    )
  ).toBe(expected)
}

async function activeElementLabel(mainWindow: Page): Promise<string | null> {
  return mainWindow.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
}

test('fullscreen exit stays reachable after pointer and focus leave the immersive arc', async ({ mainWindow }) => {
  await enterImmersive(mainWindow)

  const enterFullscreen = mainWindow.getByRole('button', { name: '进入全屏' })
  await expect(enterFullscreen).toBeVisible()
  await enterFullscreen.click()
  await expectStageFullscreen(mainWindow, true)

  await mainWindow.locator('.office-workbench-canvas').focus()
  await mainWindow.mouse.move(8, 8)

  const exitFullscreen = mainWindow.getByRole('button', { name: '退出全屏' })
  await expect(exitFullscreen).toBeVisible()
  await exitFullscreen.click()
  await expectStageFullscreen(mainWindow, false)
  await expect(mainWindow.getByRole('button', { name: '进入全屏' })).toBeVisible()
  await expect.poll(() => activeElementLabel(mainWindow)).toBe('进入全屏')
})

test('browser fullscreenchange restores the trigger, then Escape closes immersive mode', async ({ mainWindow }) => {
  await enterImmersive(mainWindow)

  await mainWindow.getByRole('button', { name: '进入全屏' }).click()
  await expectStageFullscreen(mainWindow, true)
  await mainWindow.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur()
    await document.exitFullscreen()
  })

  await expectStageFullscreen(mainWindow, false)
  await expect(mainWindow.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '进入全屏' })).toBeVisible()
  await expect.poll(() => activeElementLabel(mainWindow)).toBe('进入全屏')

  await mainWindow.keyboard.press('Escape')
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  await expect(immersiveToggle).toBeVisible()
  await expect(immersiveToggle).toBeFocused()
})

test('fullscreen controls survive repeated enter and exit cycles', async ({ mainWindow }) => {
  await enterImmersive(mainWindow)

  for (let cycle = 0; cycle < 2; cycle += 1) {
    const enterFullscreen = mainWindow.getByRole('button', { name: '进入全屏' })
    await expect(enterFullscreen).toBeVisible()
    await enterFullscreen.click()
    await expectStageFullscreen(mainWindow, true)

    await mainWindow.mouse.move(8, 8)
    const exitFullscreen = mainWindow.getByRole('button', { name: '退出全屏' })
    await expect(exitFullscreen).toBeVisible()
    await exitFullscreen.click()
    await expectStageFullscreen(mainWindow, false)
    await expect.poll(() => activeElementLabel(mainWindow)).toBe('进入全屏')
  }
})
