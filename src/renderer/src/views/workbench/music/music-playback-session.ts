import type { MusicSong } from '../../../../../shared/music-types'

const playbackStorageKey = 'studiumx.music.playback.v1'
const maxStoredQueueLength = 200

export type MusicPlaybackMode = 'sequence' | 'shuffle' | 'loop'

export type MusicPlaybackSnapshot = {
  queue: MusicSong[]
  currentIndex: number
  currentTime: number
  duration: number
  volume: number
  playbackMode: MusicPlaybackMode
  wasPlaying: boolean
}

const emptyPlaybackSnapshot: MusicPlaybackSnapshot = {
  queue: [],
  currentIndex: -1,
  currentTime: 0,
  duration: 0,
  volume: 0.72,
  playbackMode: 'loop',
  wasPlaying: false
}

let snapshot = readPlaybackSnapshot()
let audio: HTMLAudioElement | null = null
let lastPersistedAt = 0
const snapshotListeners = new Set<() => void>()

function isMusicSong(value: unknown): value is MusicSong {
  if (!value || typeof value !== 'object') return false
  const song = value as Partial<MusicSong>
  return (
    (song.provider === 'netease' || song.provider === 'qq') &&
    typeof song.id === 'string' &&
    typeof song.name === 'string' &&
    typeof song.artist === 'string'
  )
}

function normalizeSnapshot(value: Partial<MusicPlaybackSnapshot>): MusicPlaybackSnapshot {
  const queue = Array.isArray(value.queue)
    ? value.queue.filter(isMusicSong).slice(0, maxStoredQueueLength)
    : []
  const currentIndex = Number.isInteger(value.currentIndex)
    ? Math.max(-1, Math.min(value.currentIndex as number, queue.length - 1))
    : -1
  const currentTime = Number.isFinite(value.currentTime) ? Math.max(0, value.currentTime as number) : 0
  const duration = Number.isFinite(value.duration) ? Math.max(0, value.duration as number) : 0
  const volume = Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume as number)) : 0.72
  const playbackMode: MusicPlaybackMode =
    value.playbackMode === 'sequence' || value.playbackMode === 'shuffle' || value.playbackMode === 'loop'
      ? value.playbackMode
      : 'loop'

  return {
    queue,
    currentIndex,
    currentTime,
    duration,
    volume,
    playbackMode,
    wasPlaying: Boolean(value.wasPlaying)
  }
}

function readPlaybackSnapshot(): MusicPlaybackSnapshot {
  if (typeof window === 'undefined') return emptyPlaybackSnapshot
  try {
    const raw = window.localStorage.getItem(playbackStorageKey)
    if (!raw) return emptyPlaybackSnapshot
    return normalizeSnapshot(JSON.parse(raw) as Partial<MusicPlaybackSnapshot>)
  } catch {
    return emptyPlaybackSnapshot
  }
}

function notifySnapshotListeners(): void {
  for (const listener of snapshotListeners) listener()
}

function replaceSnapshot(nextSnapshot: MusicPlaybackSnapshot): void {
  snapshot = nextSnapshot
  notifySnapshotListeners()
}

function persistPlaybackSnapshot(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(playbackStorageKey, JSON.stringify(snapshot))
  } catch {
    // Storage is a convenience only. Playback must still work in restricted contexts.
  }
}

function persistPlaybackSnapshotThrottled(): void {
  const now = Date.now()
  if (now - lastPersistedAt < 1000) return
  lastPersistedAt = now
  persistPlaybackSnapshot()
}

function syncSnapshotFromAudio(currentAudio: HTMLAudioElement): void {
  replaceSnapshot(
    normalizeSnapshot({
      ...snapshot,
      currentTime: Number.isFinite(currentAudio.currentTime) ? currentAudio.currentTime : snapshot.currentTime,
      duration: Number.isFinite(currentAudio.duration) ? currentAudio.duration : snapshot.duration,
      wasPlaying: !currentAudio.paused && !currentAudio.ended
    })
  )
  persistPlaybackSnapshotThrottled()
}

export function getMusicPlaybackAudio(): HTMLAudioElement {
  if (audio) return audio

  audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = snapshot.volume

  for (const eventName of ['timeupdate', 'durationchange', 'play', 'pause', 'ended'] as const) {
    audio.addEventListener(eventName, () => syncSnapshotFromAudio(audio as HTMLAudioElement))
  }

  window.addEventListener('pagehide', () => {
    syncSnapshotFromAudio(audio as HTMLAudioElement)
    persistPlaybackSnapshot()
  })

  return audio
}

export function getMusicPlaybackSnapshot(): MusicPlaybackSnapshot {
  return snapshot
}

/**
 * Lets any mounted player reflect the durable audio session rather than a
 * component-local copy of its state. This matters when the player unmounts
 * while music continues playing on another page.
 */
export function subscribeMusicPlaybackSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => snapshotListeners.delete(listener)
}

export function updateMusicPlaybackSnapshot(update: Partial<MusicPlaybackSnapshot>): MusicPlaybackSnapshot {
  replaceSnapshot(normalizeSnapshot({ ...snapshot, ...update }))
  persistPlaybackSnapshot()
  return snapshot
}

export function persistMusicPlaybackPosition(): void {
  if (audio) syncSnapshotFromAudio(audio)
  persistPlaybackSnapshot()
}
