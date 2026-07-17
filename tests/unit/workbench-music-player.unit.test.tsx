import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicPlaybackSnapshot } from '../../src/renderer/src/views/workbench/music/music-playback-session'

const longSongName = '这是一个足够长的歌曲名称，用于验证左下角播放器标题滚动时不会和播放控制按钮重叠'

const finalSequenceSnapshot: MusicPlaybackSnapshot = {
  queue: [
    {
      provider: 'netease',
      id: 'first-song',
      name: '第一首歌',
      artist: '测试歌手',
      album: '',
      cover: '',
      duration: 180
    },
    {
      provider: 'netease',
      id: 'last-song',
      name: longSongName,
      artist: '测试歌手',
      album: '',
      cover: '',
      duration: 240
    }
  ],
  currentIndex: 1,
  currentTime: 240,
  duration: 240,
  volume: 0.72,
  playbackMode: 'sequence',
  wasPlaying: true
}

describe('WorkbenchMusicPlayer', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('duplicates an overflowing compact title so it can scroll continuously to the left', async () => {
    const pausedSnapshot = { ...finalSequenceSnapshot, wasPlaying: false }
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('workbench-music-marquee') ? 120 : 0
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.classList.contains('workbench-music-marquee') ? 420 : 0
      }
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      DOMRect.fromRect({ width: 120, height: 20 })
    )

    try {
      window.localStorage.setItem('studiumx.music.playback.v1', JSON.stringify(pausedSnapshot))
      const { WorkbenchMusicPlayer } = await import('../../src/renderer/src/views/workbench/WorkbenchMusicPlayer')
      const { container } = render(<WorkbenchMusicPlayer />)

      const title = container.querySelector('.workbench-music-toggle-title')
      const marquee = title?.querySelector('.workbench-music-marquee')
      const track = marquee?.querySelector('.workbench-music-marquee-track')
      expect(title).not.toBeNull()
      expect(marquee).toHaveAttribute('title', longSongName)
      await waitFor(() => expect(marquee).toHaveClass('is-scrolling'))
      expect(track?.querySelectorAll('.workbench-music-marquee-copy')).toHaveLength(2)
    } finally {
      if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      else delete (HTMLElement.prototype as Partial<HTMLElement>).clientWidth
      if (originalScrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth)
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollWidth
    }
  })

  it('disables native audio looping so sequence mode stops after the last queued song ends', async () => {
    window.localStorage.setItem('studiumx.music.playback.v1', JSON.stringify(finalSequenceSnapshot))
    const playback = await import('../../src/renderer/src/views/workbench/music/music-playback-session')
    const audio = playback.getMusicPlaybackAudio()
    audio.src = 'https://example.test/last-song.mp3'
    audio.loop = true

    const { WorkbenchMusicPlayer } = await import('../../src/renderer/src/views/workbench/WorkbenchMusicPlayer')
    render(<WorkbenchMusicPlayer />)

    await waitFor(() => expect(audio.loop).toBe(false))
    audio.dispatchEvent(new Event('ended'))

    await waitFor(() => {
      expect(playback.getMusicPlaybackSnapshot()).toMatchObject({
        currentIndex: finalSequenceSnapshot.currentIndex,
        playbackMode: 'sequence',
        wasPlaying: false
      })
    })
  })
})