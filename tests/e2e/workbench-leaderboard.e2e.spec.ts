import { test, expect } from '../helpers/electron'

type Bounds = { x: number; y: number; width: number; height: number }

type LeaderboardFrames = {
  header: Bounds[]
  panel: Bounds[]
  radius: string[]
}

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const leaderboardToggle = mainWindow.getByRole('button', { name: '自习室榜单' })
  if (await leaderboardToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(leaderboardToggle).toBeVisible()
}

const range = (values: number[]): number => Math.max(...values) - Math.min(...values)

test('leaderboard disclosure expands without shifting its outline, header, or detail content', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const toggle = mainWindow.getByRole('button', { name: '自习室榜单' })
  const leaderboard = mainWindow.locator('.workbench-leaderboard')
  const initialRadius = await leaderboard.evaluate((card) => getComputedStyle(card).borderTopLeftRadius)

  const captureFrames = async (): Promise<LeaderboardFrames> =>
    mainWindow.evaluate(async () => {
      const card = document.querySelector<HTMLElement>('.workbench-leaderboard')
      const header = document.querySelector<HTMLElement>('.workbench-leaderboard-toggle')
      const panel = document.querySelector<HTMLElement>('.workbench-leaderboard-panel')
      if (!card || !header || !panel) throw new Error('Leaderboard controls are unavailable')

      const headerFrames: Bounds[] = []
      const panelFrames: Bounds[] = []
      const radiusFrames: string[] = []
      for (let frame = 0; frame < 24; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const headerBounds = header.getBoundingClientRect()
        const panelBounds = panel.getBoundingClientRect()
        headerFrames.push({
          x: headerBounds.x,
          y: headerBounds.y,
          width: headerBounds.width,
          height: headerBounds.height
        })
        panelFrames.push({
          x: panelBounds.x,
          y: panelBounds.y,
          width: panelBounds.width,
          height: panelBounds.height
        })
        radiusFrames.push(getComputedStyle(card).borderTopLeftRadius)
      }
      return { header: headerFrames, panel: panelFrames, radius: radiusFrames }
    })

  await toggle.evaluate((button: HTMLButtonElement) => button.click())
  await expect(leaderboard).toHaveClass(/is-open/)
  const openingFrames = await captureFrames()

  await toggle.evaluate((button: HTMLButtonElement) => button.click())
  await expect(leaderboard).toHaveClass(/is-closing/)
  const closingFrames = await captureFrames()

  for (const { header, panel, radius } of [openingFrames, closingFrames]) {
    expect(range(header.map((frame) => frame.x))).toBeLessThan(1)
    expect(range(header.map((frame) => frame.y))).toBeLessThan(1)
    expect(range(header.map((frame) => frame.width))).toBeLessThan(1)
    expect(range(header.map((frame) => frame.height))).toBeLessThan(1)
    expect(range(panel.map((frame) => frame.y))).toBeLessThan(1)
    expect(radius).toEqual(Array(radius.length).fill(initialRadius))
  }
})
