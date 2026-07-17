import { expect, test } from '../helpers/electron'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const immersiveToggle = mainWindow.getByRole('button', { name: '进入沉浸模式' })
  if (await immersiveToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(immersiveToggle).toBeVisible()
}

test('video picker next to the immersive arrow selects a local backdrop', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const controls = mainWindow.locator('.workbench-immersive-controls')
  const videoButton = mainWindow.getByRole('button', { name: '选择视频' })
  await controls.hover()
  await expect(videoButton).toBeVisible()
  await expect(videoButton).toHaveClass(/workbench-immersive-arc-action--video/)
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
