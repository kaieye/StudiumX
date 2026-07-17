import { expect, test } from '../helpers/electron'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(immersiveToggle).toBeVisible()
}

test('video picker in the immersive action ring selects a local backdrop', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const controls = mainWindow.locator('.workbench-immersive-controls')
  const videoButton = mainWindow.getByRole('button', { name: '选择视频' })
  await controls.hover()
  await expect(videoButton).toBeVisible()
  await expect(videoButton).toHaveClass(/workbench-immersive-arc-action--video/)
  await mainWindow.waitForTimeout(260)

  const arrow = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  const arcButtons = await Promise.all([
    mainWindow.getByRole('button', { name: '隐藏自习室卡片' }).boundingBox(),
    mainWindow.getByRole('button', { name: '进入全屏' }).boundingBox(),
    videoButton.boundingBox(),
    mainWindow.getByRole('button', { name: '快捷记事' }).boundingBox()
  ])
  const arrowBounds = await arrow.boundingBox()
  if (!arrowBounds || arcButtons.some((bounds) => !bounds)) {
    throw new Error('The immersive action ring has no bounding boxes')
  }
  const arrowCenter = { x: arrowBounds.x + arrowBounds.width / 2, y: arrowBounds.y + arrowBounds.height / 2 }
  const centers = arcButtons.map((bounds) => ({ x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }))
  const radii = centers.map((center) => Math.hypot(center.x - arrowCenter.x, center.y - arrowCenter.y))
  const gaps = centers.slice(1).map((center, index) => Math.hypot(center.x - centers[index].x, center.y - centers[index].y))
  expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(2)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(2)

  await videoButton.click()

  const picker = mainWindow.getByRole('dialog', { name: '选择视频' })
  await expect(picker).toBeVisible()
  await expect(picker).toContainText('当前视频：内置氛围视频')

  const localVideoInput = picker.getByLabel('从本地选择视频')
  await expect(localVideoInput).toHaveAttribute('accept', 'video/*,.mp4,.webm,.mov,.m4v')
  await localVideoInput.setInputFiles({
    name: 'focus-session.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('test-video')
  })

  await expect(picker).toBeHidden()
  await controls.hover()
  await videoButton.click()
  await expect(picker).toContainText('当前视频：focus-session.mp4')
  await expect(mainWindow.locator('.workbench-immersive-video')).toHaveAttribute('src', /^blob:/)

  await mainWindow.keyboard.press('Escape')
  await expect(picker).toBeHidden()
})
