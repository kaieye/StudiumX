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
  // Only the exit control stays pinned; hide/scene/note must not remain hover-hit targets.
  await expect(mainWindow.getByRole('button', { name: '隐藏自习室卡片' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '选择场景' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '快捷记事' })).toHaveCount(0)
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

test('leaving fullscreen room for analytics and returning restores a clean enter cycle', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  // Expand tasks first so analytics remains reachable after immersive + fullscreen.
  const taskToggle = mainWindow.locator('.workbench-task-toggle-card')
  if ((await taskToggle.getAttribute('aria-expanded')) !== 'true') {
    await taskToggle.click()
  }
  await expect(mainWindow.locator('.workbench-task-analytics-button')).toBeVisible()

  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()
  await expect(mainWindow.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()

  await mainWindow.getByRole('button', { name: '进入全屏' }).click()
  await expectStageFullscreen(mainWindow, true)
  await expect(mainWindow.getByRole('button', { name: '退出全屏' })).toBeVisible()
  await expect(mainWindow.locator('.workbench-immersive-controls')).toHaveClass(/is-fullscreen/)

  // Leave the room while still in fullscreen.
  await mainWindow.getByRole('button', { name: '打开学习分析' }).click()
  await expect(mainWindow).toHaveURL(/workbench=analytics/)
  await expect(mainWindow.locator('.study-analytics-page')).toBeVisible()
  await expectStageFullscreen(mainWindow, false)

  await mainWindow.getByRole('button', { name: /返回自习室|Back to study room/i }).click()
  await expect(mainWindow).toHaveURL(/workbench=1/)

  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  await expect(immersiveToggle).toBeVisible()
  await immersiveToggle.click()

  const enterFullscreen = mainWindow.getByRole('button', { name: '进入全屏' })
  await expect(enterFullscreen).toBeVisible()
  await expect(mainWindow.locator('.workbench-immersive-controls')).not.toHaveClass(/is-fullscreen/)
  await expect(enterFullscreen).toHaveAttribute('aria-pressed', 'false')

  await enterFullscreen.click()
  await expectStageFullscreen(mainWindow, true)
  const exitFullscreen = mainWindow.getByRole('button', { name: '退出全屏' })
  await expect(exitFullscreen).toBeVisible()
  await expect(mainWindow.locator('.workbench-immersive-controls')).toHaveClass(/is-fullscreen/)
  await expect.poll(() => activeElementLabel(mainWindow)).toBe('退出全屏')
})
