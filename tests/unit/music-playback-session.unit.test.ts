import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageKey = 'studiumx.music.playback.v1'

const savedPlayback = {
  queue: [
    {
      provider: 'netease' as const,
      id: 'song-42',
      name: '夜航星',
      artist: '不才',
      album: '示例专辑',
      cover: '',
      duration: 243
    }
  ],
  currentIndex: 0,
  currentTime: 91.25,
  duration: 243,
  volume: 0.48,
  playbackMode: 'shuffle' as const,
  wasPlaying: true
}

describe('music playback session', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('rehydrates the last song and its exact position after a renderer restart', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(savedPlayback))

    const playback = await import('../../src/renderer/src/views/workbench/music/music-playback-session')

    expect(playback.getMusicPlaybackSnapshot()).toEqual(savedPlayback)
  })

  it('defaults prior saved sessions to loop mode when no mode was stored', async () => {
    const { playbackMode: _playbackMode, ...legacyPlayback } = savedPlayback
    window.localStorage.setItem(storageKey, JSON.stringify(legacyPlayback))

    const playback = await import('../../src/renderer/src/views/workbench/music/music-playback-session')

    expect(playback.getMusicPlaybackSnapshot().playbackMode).toBe('loop')
  })

  it('uses one durable audio object and persists updates made while the UI is absent', async () => {
    const playback = await import('../../src/renderer/src/views/workbench/music/music-playback-session')

    const firstAudio = playback.getMusicPlaybackAudio()
    const secondAudio = playback.getMusicPlaybackAudio()
    playback.updateMusicPlaybackSnapshot({
      ...savedPlayback,
      currentTime: 137.5,
      playbackMode: 'loop',
      wasPlaying: false
    })

    expect(secondAudio).toBe(firstAudio)
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toMatchObject({
      queue: savedPlayback.queue,
      currentIndex: 0,
      currentTime: 137.5,
      playbackMode: 'loop',
      wasPlaying: false
    })
  })

  it('notifies mounted player views immediately when the durable audio starts or pauses', async () => {
    const playback = await import('../../src/renderer/src/views/workbench/music/music-playback-session')
    const audio = playback.getMusicPlaybackAudio()
    const states: boolean[] = []
    const unsubscribe = playback.subscribeMusicPlaybackSnapshot(() => {
      states.push(playback.getMusicPlaybackSnapshot().wasPlaying)
    })

    Object.defineProperty(audio, 'paused', { configurable: true, value: false })
    Object.defineProperty(audio, 'ended', { configurable: true, value: false })
    audio.dispatchEvent(new Event('play'))

    expect(playback.getMusicPlaybackSnapshot().wasPlaying).toBe(true)
    expect(states).toContain(true)

    Object.defineProperty(audio, 'paused', { configurable: true, value: true })
    audio.dispatchEvent(new Event('pause'))

    expect(playback.getMusicPlaybackSnapshot().wasPlaying).toBe(false)
    expect(states).toContain(false)

    unsubscribe()
  })
})
