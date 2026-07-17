import { expect } from '@playwright/test'
import { test } from '../helpers/electron'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const musicToggle = mainWindow.locator('.workbench-music-toggle-card')
  if (await musicToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(musicToggle).toBeVisible()
}

test('rotates the music artwork while playback is active', async ({ mainWindow }) => {
  await openWorkbench(mainWindow)

  const artwork = mainWindow.locator('.workbench-music-toggle-art-disc')
  await expect(artwork).toBeVisible()

  await artwork.evaluate((element) => element.classList.add('is-playing'))
  await expect.poll(() => artwork.evaluate((element) => {
    const style = getComputedStyle(element)
    return { animationName: style.animationName, playState: style.animationPlayState }
  })).toEqual({ animationName: 'workbench-music-spin', playState: 'running' })

  const sample = async () => artwork.evaluate((element) => {
    const animation = element.getAnimations()[0]
    const effect = animation?.effect
    const keyframes = effect instanceof KeyframeEffect ? effect.getKeyframes() : undefined

    return {
      currentTime: animation?.currentTime,
      playState: animation?.playState,
      timing: effect?.getComputedTiming(),
      keyframes,
      transform: getComputedStyle(element).transform,
      inlineTransform: (element as HTMLElement).style.transform,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  })
  const initial = await sample()
  await mainWindow.waitForTimeout(350)
  const later = await sample()
  expect(later.transform, JSON.stringify({ initial, later })).not.toBe(initial.transform)
})
