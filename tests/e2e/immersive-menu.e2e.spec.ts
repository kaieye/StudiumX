import { expect, test } from '../helpers/electron'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(immersiveToggle).toBeVisible()
}

test('music dock keeps its compact controls fixed while its panel expands', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const musicCard = mainWindow.locator('.workbench-music-card')
  const musicFooter = mainWindow.locator('.workbench-music-footer')
  const expandMusic = mainWindow.getByRole('button', { name: '展开音乐面板' })
  await expect(musicCard).toBeVisible()

  const compactDisc = musicCard.locator('.workbench-music-toggle-art-disc')
  await compactDisc.evaluate((element) => element.classList.add('is-playing'))
  await expect(compactDisc).toHaveCSS('animation-name', 'workbench-music-spin')
  await compactDisc.evaluate((element) => element.classList.remove('is-playing'))

  const before = await musicFooter.boundingBox()
  if (!before) throw new Error('The music footer has no bounding box')

  await expandMusic.click()
  await expect(musicCard).toHaveClass(/is-open/)
  await expect(musicCard.locator('.workbench-music-controls')).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '调节音量' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: /播放模式：.+，点击切换/ })).toBeVisible()
  await expect(mainWindow.getByRole('slider', { name: '播放进度' })).toHaveCSS('height', '14px')

  const musicTabs = musicCard.locator('.workbench-music-tabs')
  await expect(musicTabs).toHaveAttribute('data-active-tab', 'player')
  const tabHighlight = await musicTabs.evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    return { borderRadius: style.borderRadius, transition: style.transition }
  })
  expect(tabHighlight.borderRadius).toBe('999px')
  expect(tabHighlight.transition).toContain('transform')
  await mainWindow.waitForTimeout(350)
  const expandedCard = await musicCard.boundingBox()
  if (!expandedCard) throw new Error('The expanded music card has no bounding box')

  await mainWindow.getByRole('button', { name: '调节音量' }).click()
  const volumePopover = mainWindow.locator('#workbench-music-volume-popover')
  const volumeButton = mainWindow.getByRole('button', { name: '调节音量' })
  const volumeSlider = mainWindow.getByRole('slider', { name: '音量' })
  await expect(volumeSlider).toBeVisible()
  await expect(volumePopover).toHaveCSS('position', 'absolute')
  await expect(volumeSlider).toHaveCSS('height', '14px')
  const volumeButtonBounds = await volumeButton.boundingBox()
  const volumePopoverBounds = await volumePopover.boundingBox()
  if (!volumeButtonBounds || !volumePopoverBounds) throw new Error('The volume controls have no bounding box')
  expect(volumePopoverBounds.x).toBeGreaterThan(volumeButtonBounds.x + volumeButtonBounds.width)
  const muteButton = mainWindow.getByRole('button', { name: '静音' })
  await expect(muteButton).toBeVisible()
  await muteButton.click()
  await expect(mainWindow.getByRole('button', { name: '取消静音' })).toBeVisible()
  const cardWithVolumePopover = await musicCard.boundingBox()
  if (!cardWithVolumePopover) throw new Error('The music card disappeared while opening volume')
  expect(Math.abs(cardWithVolumePopover.height - expandedCard.height)).toBeLessThan(1)

  await mainWindow.getByRole('tab', { name: '搜索', exact: true }).click()
  await expect(musicTabs).toHaveAttribute('data-active-tab', 'search')
  await expect(volumePopover).toBeHidden()
  await mainWindow.waitForTimeout(80)
  const searchCard = await musicCard.boundingBox()
  if (!searchCard) throw new Error('The music card disappeared while switching tabs')
  expect(Math.abs(searchCard.height - expandedCard.height)).toBeLessThan(1)

  await mainWindow.getByRole('tab', { name: '账号', exact: true }).click()
  await mainWindow.waitForTimeout(80)
  const accountCard = await musicCard.boundingBox()
  if (!accountCard) throw new Error('The music card disappeared while switching tabs')
  expect(Math.abs(accountCard.height - expandedCard.height)).toBeLessThan(1)

  const after = await musicFooter.boundingBox()
  if (!after) throw new Error('The expanded music footer has no bounding box')

  expect(Math.abs(after.y - before.y)).toBeLessThan(1)
})

test('music dock footer stays stationary throughout both disclosure transitions', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const musicCard = mainWindow.locator('.workbench-music-card')
  const captureFooterPositions = async (buttonLabel: string): Promise<number[]> =>
    mainWindow.evaluate(async (label) => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (element) => element.getAttribute('aria-label') === label
      )
      const footer = document.querySelector<HTMLElement>('.workbench-music-footer')
      if (!button || !footer) throw new Error('Music player controls are unavailable')

      button.click()
      const positions: number[] = []
      for (let frame = 0; frame < 24; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        positions.push(footer.getBoundingClientRect().y)
      }
      return positions
    }, buttonLabel)

  const openingPositions = await captureFooterPositions('展开音乐面板')
  await expect(musicCard).toHaveClass(/is-open/)
  const closingPositions = await captureFooterPositions('收起音乐面板')
  await expect(musicCard).not.toHaveClass(/is-open/)

  const positionRange = (positions: number[]): number => Math.max(...positions) - Math.min(...positions)
  expect(positionRange(openingPositions)).toBeLessThan(1)
  expect(positionRange(closingPositions)).toBeLessThan(1)
})

test('immersive room menu distributes icon controls and exposes quick notes', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()
  const controls = mainWindow.locator('.workbench-immersive-controls')
  await expect(controls).toHaveClass(/is-open/)

  await controls.hover()
  const toggleCards = mainWindow.getByRole('button', { name: '隐藏自习室卡片' })
  const musicDock = mainWindow.locator('.workbench-music-dock')
  await expect(toggleCards).toBeVisible()
  await expect(musicDock).toBeVisible()
  const musicDockBounds = await musicDock.boundingBox()
  if (!musicDockBounds) throw new Error('The music dock has no bounding box in immersive mode')
  const topElementIsInMusicDock = await mainWindow.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest('.workbench-music-dock') !== null,
    {
      x: musicDockBounds.x + musicDockBounds.width / 2,
      y: musicDockBounds.y + musicDockBounds.height / 2
    }
  )
  expect(topElementIsInMusicDock).toBe(true)

  const arrowBounds = await mainWindow.getByRole('button', { name: '收起沉浸模式' }).boundingBox()
  const initialToggleBounds = await toggleCards.boundingBox()
  if (!arrowBounds || !initialToggleBounds) throw new Error('The immersive controls have no bounding box')
  const actionRadius = Math.hypot(
    initialToggleBounds.x + initialToggleBounds.width / 2 - (arrowBounds.x + arrowBounds.width / 2),
    initialToggleBounds.y + initialToggleBounds.height / 2 - (arrowBounds.y + arrowBounds.height / 2)
  )
  // Compare against the actual rendered arrow size so this remains robust to Electron's display scale.
  expect(actionRadius / arrowBounds.width).toBeLessThan(1)

  // Move through the full path from the arrow into the radial action. The transparent
  // semicircular hit area must keep the menu open for the entire journey.
  const arrowCenter = {
    x: arrowBounds.x + arrowBounds.width / 2,
    y: arrowBounds.y + arrowBounds.height / 2
  }
  const toggleCenter = {
    x: initialToggleBounds.x + initialToggleBounds.width / 2,
    y: initialToggleBounds.y + initialToggleBounds.height / 2
  }
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await mainWindow.mouse.move(
      arrowCenter.x + (toggleCenter.x - arrowCenter.x) * progress,
      arrowCenter.y + (toggleCenter.y - arrowCenter.y) * progress
    )
    await expect(toggleCards).toBeVisible()
  }

  await toggleCards.click()
  await expect(mainWindow.locator('.office-workbench-stage')).toHaveClass(/are-room-cards-hidden/)
  await expect(mainWindow.locator('.workbench-pomodoro-card')).toBeHidden()
  await expect(mainWindow.locator('.workbench-task-card')).toBeHidden()
  await expect(mainWindow.locator('.workbench-leaderboard')).toBeHidden()
  await expect(musicDock).toBeHidden()
  await expect(mainWindow.getByRole('button', { name: '显示自习室卡片' })).toBeVisible()

  const quickNoteButton = mainWindow.getByRole('button', { name: '快捷记事' })
  await expect(quickNoteButton).toBeVisible()
  await quickNoteButton.click()
  await expect(mainWindow.getByRole('complementary', { name: '快捷记事' })).toBeVisible()
  await mainWindow.getByRole('textbox', { name: '快捷记事内容' }).fill('复习第 3 章的关键公式')
  await expect(mainWindow.getByRole('textbox', { name: '快捷记事内容' })).toHaveValue('复习第 3 章的关键公式')

  await mainWindow.getByRole('button', { name: '收起沉浸模式' }).click()
  const collapsedArrow = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  await expect(collapsedArrow).toBeVisible()
  await controls.hover()
  await expect(mainWindow.getByRole('button', { name: '隐藏自习室卡片' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '快捷记事' })).toBeVisible()
})
