import { expect, test } from '../helpers/electron'

test('immersive mode can switch from the flip clock to the girl video scene', async ({ mainWindow }) => {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }

  await immersiveToggle.click()
  await expect(mainWindow.locator('.workbench-immersive-clock-scene')).toBeVisible()
  await expect(mainWindow.locator('.workbench-clock__display')).toHaveCount(1)
  await expect(mainWindow.locator('.workbench-immersive-video')).toHaveCount(0)

  const immersiveControls = mainWindow.locator('.workbench-immersive-controls')
  const controlsBox = await immersiveControls.boundingBox()
  if (!controlsBox) throw new Error('The immersive controls have no bounding box')
  await mainWindow.mouse.move(controlsBox.x + controlsBox.width / 2, controlsBox.y + controlsBox.height - 28)
  await expect(mainWindow.locator('.workbench-immersive-arc-menu')).toHaveClass(/is-active/)
  await mainWindow.getByRole('button', { name: '选择场景' }).click()
  const scenePicker = mainWindow.getByRole('dialog', { name: '选择场景' })
  await expect(scenePicker).toBeVisible()
  await expect(scenePicker.getByRole('button', { name: /翻页时钟/ })).toBeVisible()
  const clockPreview = scenePicker.locator('.workbench-scene-picker__clock-preview')
  const previewBox = await clockPreview.boundingBox()
  if (!previewBox) throw new Error('The flip-clock preview has no bounding box')
  const clockDigits = await clockPreview.locator('.workbench-clock__digit').all()
  for (const digit of clockDigits) {
    const digitBox = await digit.boundingBox()
    if (!digitBox) throw new Error('A flip-clock digit has no bounding box')
    expect(digitBox.x).toBeGreaterThanOrEqual(previewBox.x)
    expect(digitBox.x + digitBox.width).toBeLessThanOrEqual(previewBox.x + previewBox.width)
  }
  await expect(scenePicker.getByRole('button', { name: /室内自习/ })).toBeVisible()
  await expect(scenePicker.locator('video')).toHaveCount(1)

  await scenePicker.getByRole('button', { name: /室内自习/ }).click()
  await expect(scenePicker).toBeHidden()
  await expect(mainWindow.locator('.workbench-immersive-video')).toBeVisible()
  await expect(mainWindow.locator('.workbench-immersive-clock-scene')).toHaveCount(0)
})
