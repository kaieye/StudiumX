import { expect } from '@playwright/test'
import { test } from '../helpers/electron'

const longSongName = '这是一个足够长的歌曲名称，用于验证左下角播放器标题滚动时不会和播放控制按钮重叠'

async function openWorkbench(mainWindow: import('@playwright/test').Page): Promise<void> {
  const musicToggle = mainWindow.locator('.workbench-music-toggle-card')
  if (await musicToggle.count() === 0) {
    await mainWindow.getByRole('button', { name: '自习室' }).click()
  }
  await expect(musicToggle).toBeVisible()
}

test('keeps an overflowing compact song title out of the transport controls and scrolling even when reduced motion is requested', async ({ mainWindow }) => {
  await mainWindow.emulateMedia({ reducedMotion: 'reduce' })
  await mainWindow.evaluate((songName) => {
    localStorage.setItem('studiumx.music.playback.v1', JSON.stringify({
      queue: [{
        provider: 'netease',
        id: 'long-song',
        name: songName,
        artist: '测试歌手',
        album: '',
        cover: '',
        duration: 240
      }],
      currentIndex: 0,
      currentTime: 0,
      duration: 240,
      volume: 0.72,
      playbackMode: 'sequence',
      wasPlaying: false
    }))
  }, longSongName)
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await openWorkbench(mainWindow)

  const marquee = mainWindow.locator('.workbench-music-toggle-title .workbench-music-marquee')
  await expect(marquee).toHaveAttribute('title', longSongName)
  await expect(marquee).toHaveClass(/is-scrolling/)

  const compactLayout = await mainWindow.evaluate(() => {
    const title = document.querySelector<HTMLElement>('.workbench-music-toggle-title')
    const transport = document.querySelector<HTMLElement>('.workbench-music-mini-transport')
    const expand = document.querySelector<HTMLElement>('.workbench-music-expand')
    const track = document.querySelector<HTMLElement>('.workbench-music-toggle-title .workbench-music-marquee-track')
    if (!title || !transport || !expand || !track) throw new Error('Compact music player elements are unavailable')

    return {
      titleRight: title.getBoundingClientRect().right,
      transportLeft: transport.getBoundingClientRect().left,
      expandLeft: expand.getBoundingClientRect().left,
      animationName: getComputedStyle(track).animationName,
      animationPlayState: getComputedStyle(track).animationPlayState
    }
  })

  expect(compactLayout.titleRight).toBeLessThanOrEqual(compactLayout.transportLeft)
  expect(compactLayout.transportLeft).toBeLessThan(compactLayout.expandLeft)
  expect(compactLayout.animationName).toBe('workbench-music-title-marquee')
  expect(compactLayout.animationPlayState).toBe('running')

  const track = marquee.locator('.workbench-music-marquee-track')
  const initialTransform = await track.evaluate((element) => getComputedStyle(element).transform)
  await mainWindow.waitForTimeout(450)
  const laterTransform = await track.evaluate((element) => getComputedStyle(element).transform)
  expect(laterTransform).not.toBe(initialTransform)
})