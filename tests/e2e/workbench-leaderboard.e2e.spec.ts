import { test, expect } from '../helpers/electron'

type Bounds = { x: number; y: number; width: number; height: number }

type LeaderboardFrames = {
  card: Bounds[]
  header: Bounds[]
  panel: Bounds[]
  radius: string[]
}

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const workbenchPage = mainWindow.locator('.office-workbench-page')
  if (!await workbenchPage.isVisible()) {
    await mainWindow.getByRole('button', { name: '自习室', exact: true }).click()
  }
  await expect(workbenchPage).toBeVisible()
  await expect(workbenchPage.getByRole('button', { name: '自习室榜单' })).toBeVisible()
}

const range = (values: number[]): number => Math.max(...values) - Math.min(...values)


type WorkbenchMotionFrame = {
  pageY: number
  stageY: number
  canvasY: number
  toolsY: number
  timerY: number
  taskY: number
  windowScrollY: number
  mainScrollTop: number
  toolsScrollTop: number
}

test('leaderboard disclosure expands without shifting its outline, header, or detail content', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const toggle = mainWindow.getByRole('button', { name: '自习室榜单' })
  const leaderboard = mainWindow.locator('.workbench-leaderboard')
  // The leaderboard must use the exact disclosure primitives as the timer and
  // task cards. This protects its header from generic pressed-scale rules while
  // the content height is being animated.
  await expect(toggle).toHaveClass(/workbench-disclosure-toggle/)
  await expect(leaderboard.locator('.workbench-leaderboard-reveal')).toHaveClass(/workbench-disclosure-reveal/)
  await expect(leaderboard.locator('.workbench-leaderboard-reveal-inner')).toHaveClass(/workbench-disclosure-reveal-inner/)
  await expect(toggle).toHaveCSS('-webkit-app-region', 'no-drag')
  const initialRadius = await leaderboard.evaluate((card) => getComputedStyle(card).borderTopLeftRadius)
  const [leaderboardMaterial, timerMaterial] = await Promise.all([
    leaderboard.evaluate((card) => {
      const style = getComputedStyle(card)
      return {
        backgroundImage: style.backgroundImage,
        borderColor: style.borderTopColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow
      }
    }),
    mainWindow.locator('.workbench-pomodoro-card').evaluate((card) => {
      const style = getComputedStyle(card)
      return {
        backgroundImage: style.backgroundImage,
        borderColor: style.borderTopColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow
      }
    })
  ])
  expect(initialRadius).toBe('999px')
  expect(leaderboardMaterial).toEqual(timerMaterial)
  const [leaderboardHeader, timerHeader] = await Promise.all([
    toggle.boundingBox(),
    mainWindow.locator('.workbench-pomodoro-toggle').boundingBox()
  ])
  expect(leaderboardHeader?.height).toBe(timerHeader?.height)

  const captureWorkbenchMotion = async (): Promise<WorkbenchMotionFrame[]> => {
    await mainWindow.evaluate(() => {
      type MotionWindow = Window & { __workbenchMotionFrames?: WorkbenchMotionFrame[] }
      const motionWindow = window as MotionWindow
      const page = document.querySelector<HTMLElement>('.office-workbench-page')
      const stage = document.querySelector<HTMLElement>('.office-workbench-stage')
      const canvas = document.querySelector<HTMLElement>('.office-workbench-canvas')
      const tools = document.querySelector<HTMLElement>('.workbench-tools')
      const timer = document.querySelector<HTMLElement>('.workbench-pomodoro-card')
      const task = document.querySelector<HTMLElement>('.workbench-task-card')
      const main = document.querySelector<HTMLElement>('.main-area')
      if (!page || !stage || !canvas || !tools || !timer || !task || !main) {
        throw new Error('Workbench motion probes are unavailable')
      }

      const capture = (): void => {
        const frames = motionWindow.__workbenchMotionFrames
        if (!frames) return
        frames.push({
          pageY: page.getBoundingClientRect().y,
          stageY: stage.getBoundingClientRect().y,
          canvasY: canvas.getBoundingClientRect().y,
          toolsY: tools.getBoundingClientRect().y,
          timerY: timer.getBoundingClientRect().y,
          taskY: task.getBoundingClientRect().y,
          windowScrollY: window.scrollY,
          mainScrollTop: main.scrollTop,
          toolsScrollTop: tools.scrollTop
        })
        if (frames.length < 36) requestAnimationFrame(capture)
      }

      motionWindow.__workbenchMotionFrames = []
      capture()
    })

    await expect.poll(() => mainWindow.evaluate(() => {
      const motionWindow = window as Window & { __workbenchMotionFrames?: WorkbenchMotionFrame[] }
      return motionWindow.__workbenchMotionFrames?.length ?? 0
    })).toBe(36)

    return mainWindow.evaluate(() => {
      const motionWindow = window as Window & { __workbenchMotionFrames?: WorkbenchMotionFrame[] }
      return motionWindow.__workbenchMotionFrames ?? []
    })
  }

  const captureFrames = async (): Promise<LeaderboardFrames> =>
    mainWindow.evaluate(async () => {
      const card = document.querySelector<HTMLElement>('.workbench-leaderboard')
      const header = document.querySelector<HTMLElement>('.workbench-leaderboard-toggle')
      const panel = document.querySelector<HTMLElement>('.workbench-leaderboard-panel')
      if (!card || !header || !panel) throw new Error('Leaderboard controls are unavailable')

      const cardFrames: Bounds[] = []
      const headerFrames: Bounds[] = []
      const panelFrames: Bounds[] = []
      const radiusFrames: string[] = []
      for (let frame = 0; frame < 24; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const cardBounds = card.getBoundingClientRect()
        const headerBounds = header.getBoundingClientRect()
        const panelBounds = panel.getBoundingClientRect()
        cardFrames.push({
          x: cardBounds.x,
          y: cardBounds.y,
          width: cardBounds.width,
          height: cardBounds.height
        })
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
      return { card: cardFrames, header: headerFrames, panel: panelFrames, radius: radiusFrames }
    })

  const openingMotionPromise = captureWorkbenchMotion()
  await toggle.evaluate((button: HTMLButtonElement) => {
    button.focus({ preventScroll: true })
    button.click()
  })
  await expect(leaderboard).toHaveClass(/is-open/)
  const [openingMotion, openingFrames] = await Promise.all([
    openingMotionPromise,
    captureFrames()
  ])

  await toggle.evaluate((button: HTMLButtonElement) => {
    button.focus({ preventScroll: true })
    button.click()
  })
  await expect(leaderboard).toHaveClass(/is-closing/)
  const closingFrames = await captureFrames()

  expect(openingMotion).toHaveLength(36)
  for (const metric of [
    'pageY',
    'stageY',
    'canvasY',
    'toolsY',
    'timerY',
    'taskY',
    'windowScrollY',
    'mainScrollTop',
    'toolsScrollTop'
  ] as const) {
    expect(range(openingMotion.map((frame) => frame[metric]))).toBeLessThan(1)
  }

  for (const { card, header, panel, radius } of [openingFrames, closingFrames]) {
    // The disclosure grows its own glass surface, exactly like the timer and
    // task cards. Its fixed width and anchored header must stay steady while
    // the detail content reveals below the compact row.
    expect(range(card.map((frame) => frame.x))).toBeLessThan(1)
    expect(range(card.map((frame) => frame.width))).toBeLessThan(1)
    expect(range(card.map((frame) => frame.height))).toBeGreaterThan(2)
    expect(Math.max(...card.map((frame) => frame.height))).toBeGreaterThan(
      Math.min(...header.map((frame) => frame.height))
    )
    expect(range(header.map((frame) => frame.x))).toBeLessThan(1)
    expect(range(header.map((frame) => frame.y))).toBeLessThan(1)
    expect(range(header.map((frame) => frame.width))).toBeLessThan(1)
    expect(range(header.map((frame) => frame.height))).toBeLessThan(1)
    expect(range(panel.map((frame) => frame.y))).toBeLessThanOrEqual(10)
    expect(radius).toEqual(Array(radius.length).fill('24px'))
  }
})
