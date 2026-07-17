import { expect, test } from '../helpers/electron'

test('immersive mode renders the flip clock as its only scene', async ({ mainWindow }) => {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }

  await immersiveToggle.click()
  await expect(mainWindow.locator('.workbench-immersive-clock-scene')).toBeVisible()
  await expect(mainWindow.locator('.workbench-clock__display')).toHaveCount(1)
  await expect(mainWindow.locator('.workbench-immersive-video')).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '选择场景' }).click()
  const scenePicker = mainWindow.getByRole('dialog', { name: '选择场景' })
  await expect(scenePicker).toBeVisible()
  await expect(scenePicker.getByText('当前场景：翻页时钟')).toBeVisible()
  await expect(scenePicker.getByRole('button', { name: /翻页时钟/ })).toBeVisible()
  await expect(scenePicker.locator('video')).toHaveCount(0)

  await scenePicker.getByRole('button', { name: /翻页时钟/ }).click()
  await expect(scenePicker).toBeHidden()
})
