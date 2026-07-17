import {
  ChevronUp,
  Disc3,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  Music2,
  Pause,
  Play,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  UserRound,
  Volume2,
  VolumeX
} from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  MusicAccountStatus,
  MusicPlaylistSummary,
  MusicProvider,
  MusicSong
} from '../../../../shared/music-types'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'
import type { MusicPlaybackMode } from './music/music-playback-session'
import {
  getMusicPlaybackAudio,
  getMusicPlaybackSnapshot,
  persistMusicPlaybackPosition,
  subscribeMusicPlaybackSnapshot,
  updateMusicPlaybackSnapshot
} from './music/music-playback-session'
import {
  formatMusicDuration,
  musicGetAccountStatus,
  musicGetDailyRecommend,
  musicGetLikedSongs,
  musicGetPlaybackUrl,
  musicGetPlaylistTracks,
  musicGetUserPlaylists,
  musicLogout,
  musicOpenLogin,
  musicSearch,
  songKey
} from './music/music-client'
import './music/workbench-music-player.css'

type PanelTab = 'player' | 'search' | 'library' | 'account'

const WORKBENCH_MUSIC_REVEAL_HEIGHT = 436

const playbackModeOrder: MusicPlaybackMode[] = ['sequence', 'shuffle', 'loop']
const playbackModeLabel: Record<MusicPlaybackMode, string> = {
  sequence: '顺序',
  shuffle: '随机',
  loop: '循环'
}

function getRandomQueueIndex(queueLength: number, currentIndex: number): number | null {
  if (queueLength <= 0) return null
  if (queueLength === 1) return 0

  let nextIndex = currentIndex
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * queueLength)
  }
  return nextIndex
}

function getNextQueueIndex(
  queueLength: number,
  currentIndex: number,
  mode: MusicPlaybackMode
): number | null {
  if (queueLength <= 0) return null
  if (mode === 'shuffle') return getRandomQueueIndex(queueLength, currentIndex)
  if (currentIndex < 0) return 0
  if (currentIndex < queueLength - 1) return currentIndex + 1
  return mode === 'loop' ? 0 : null
}

function getPreviousQueueIndex(
  queueLength: number,
  currentIndex: number,
  mode: MusicPlaybackMode
): number | null {
  if (queueLength <= 0) return null
  if (mode === 'shuffle') return getRandomQueueIndex(queueLength, currentIndex)
  if (currentIndex > 0) return currentIndex - 1
  return mode === 'loop' ? queueLength - 1 : 0
}

const PROVIDER_LABEL: Record<MusicProvider, string> = {
  netease: '网易云',
  qq: 'QQ 音乐'
}

function emptyAccount(provider: MusicProvider): MusicAccountStatus {
  return { provider, loggedIn: false, userId: null, nickname: '' }
}

function MusicTitleMarquee({ title, isPlaying }: { title: string; isPlaying: boolean }) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    const label = labelRef.current
    if (!viewport || !label) return

    const updateOverflow = () => {
      setIsOverflowing(label.getBoundingClientRect().width > viewport.clientWidth + 1)
    }

    updateOverflow()
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(viewport)
    observer.observe(label)
    return () => observer.disconnect()
  }, [title])

  const shouldScroll = isPlaying && isOverflowing

  return (
    <span
      ref={viewportRef}
      className={`workbench-music-marquee${shouldScroll ? ' is-scrolling' : ''}`}
      title={title}
    >
      <span className="workbench-music-marquee-track">
        <span ref={labelRef} className="workbench-music-marquee-copy">
          {title}
        </span>
        {shouldScroll ? (
          <span className="workbench-music-marquee-copy" aria-hidden="true">
            {title}
          </span>
        ) : null}
      </span>
    </span>
  )
}

export function WorkbenchMusicPlayer() {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } =
    useWorkbenchDisclosureReveal({ fixedHeight: WORKBENCH_MUSIC_REVEAL_HEIGHT })

  const initialPlaybackRef = useRef(getMusicPlaybackSnapshot())
  const restorePlaybackRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const volumeControlRef = useRef<HTMLDivElement>(null)
  const volumeBeforeMuteRef = useRef(initialPlaybackRef.current.volume || 0.5)
  const queueRef = useRef<MusicSong[]>([])
  const currentIndexRef = useRef(-1)
  const playbackModeRef = useRef<MusicPlaybackMode>(initialPlaybackRef.current.playbackMode)
  const playAtIndexRef = useRef<(index: number, sourceQueue?: MusicSong[]) => Promise<void>>(
    async () => undefined
  )

  const [tab, setTab] = useState<PanelTab>('player')
  const [provider, setProvider] = useState<MusicProvider>('netease')
  const [accounts, setAccounts] = useState<{ netease: MusicAccountStatus; qq: MusicAccountStatus }>({
    netease: emptyAccount('netease'),
    qq: emptyAccount('qq')
  })
  const [queue, setQueue] = useState<MusicSong[]>(() => initialPlaybackRef.current.queue)
  const [currentIndex, setCurrentIndex] = useState(() => initialPlaybackRef.current.currentIndex)
  const isPlaying = useSyncExternalStore(
    subscribeMusicPlaybackSnapshot,
    () => getMusicPlaybackSnapshot().wasPlaying,
    () => false
  )
  const [currentTime, setCurrentTime] = useState(() => initialPlaybackRef.current.currentTime)
  const [duration, setDuration] = useState(() => initialPlaybackRef.current.duration)
  const [volume, setVolume] = useState(() => initialPlaybackRef.current.volume)
  const [playbackMode, setPlaybackMode] = useState<MusicPlaybackMode>(
    () => initialPlaybackRef.current.playbackMode
  )
  const [isVolumeOpen, setIsVolumeOpen] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [busy, setBusy] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MusicSong[]>([])
  const [playlists, setPlaylists] = useState<MusicPlaylistSummary[]>([])
  const [librarySongs, setLibrarySongs] = useState<MusicSong[]>([])
  const [libraryTitle, setLibraryTitle] = useState('歌单')

  useEffect(() => {
    if (!isVolumeOpen) return

    const closeWhenClickingAway = (event: PointerEvent): void => {
      if (event.target instanceof Node && volumeControlRef.current?.contains(event.target)) return
      setIsVolumeOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsVolumeOpen(false)
    }

    window.addEventListener('pointerdown', closeWhenClickingAway)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeWhenClickingAway)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isVolumeOpen])

  useEffect(() => {
    if (!open) setIsVolumeOpen(false)
  }, [open])

  const toggleMute = useCallback((): void => {
    setVolume((currentVolume) => {
      if (currentVolume > 0) {
        volumeBeforeMuteRef.current = currentVolume
        return 0
      }
      return volumeBeforeMuteRef.current || 0.5
    })
  }, [])

  const currentSong = currentIndex >= 0 ? queue[currentIndex] ?? null : null
  const activeAccount = accounts[provider]

  useEffect(() => {
    queueRef.current = queue
    updateMusicPlaybackSnapshot({ queue })
  }, [queue])

  useEffect(() => {
    currentIndexRef.current = currentIndex
    updateMusicPlaybackSnapshot({ currentIndex })
  }, [currentIndex])

  useEffect(() => {
    playbackModeRef.current = playbackMode
    updateMusicPlaybackSnapshot({ playbackMode })
  }, [playbackMode])

  const refreshAccounts = useCallback(async (): Promise<void> => {
    try {
      const next = await musicGetAccountStatus()
      setAccounts(next)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '账号状态获取失败')
    }
  }, [])

  useEffect(() => {
    void refreshAccounts()
  }, [refreshAccounts])

  useEffect(() => {
    const audio = getMusicPlaybackAudio()
    audio.volume = volume
    audioRef.current = audio

    const onTimeUpdate = (): void => {
      const nextTime = audio.currentTime || 0
      setCurrentTime(nextTime)
      updateMusicPlaybackSnapshot({ currentTime: nextTime })
    }
    const onDuration = (): void => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0
      setDuration(nextDuration)
      updateMusicPlaybackSnapshot({ duration: nextDuration })
    }
    const onPlay = (): void => {
      updateMusicPlaybackSnapshot({ wasPlaying: true })
    }
    const onPause = (): void => {
      updateMusicPlaybackSnapshot({ wasPlaying: false })
    }
    const onEnded = (): void => {
      const nextIndex = getNextQueueIndex(
        queueRef.current.length,
        currentIndexRef.current,
        playbackModeRef.current
      )
      if (nextIndex === null) {
        updateMusicPlaybackSnapshot({ wasPlaying: false })
        return
      }
      void playAtIndexRef.current(nextIndex, queueRef.current)
    }
    const onError = (): void => {
      updateMusicPlaybackSnapshot({ wasPlaying: false })
      setStatusText('播放失败，可能需要登录或受版权限制')
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onDuration)
    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('playing', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      persistMusicPlaybackPosition()
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onDuration)
      audio.removeEventListener('durationchange', onDuration)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('playing', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audioRef.current = null
    }
    // volume is applied via a separate effect; keep audio element stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
    updateMusicPlaybackSnapshot({ volume })
  }, [volume])

  const loadAndPlay = useCallback(async (
    song: MusicSong,
    options: { resumeAt?: number; shouldPlay?: boolean } = {}
  ): Promise<boolean> => {
    const audio = audioRef.current
    if (!audio) return false
    setBusy(true)
    setStatusText('正在获取播放地址…')
    try {
      const result = await musicGetPlaybackUrl(song)
      if (!result.playable || !result.url) {
        setStatusText(result.message || '无法播放该歌曲')
        return false
      }
      audio.src = result.url
      audio.load()

      const resumeAt = options.resumeAt ?? 0
      if (resumeAt > 0) {
        if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve) => {
            const finish = (): void => {
              audio.removeEventListener('loadedmetadata', finish)
              resolve()
            }
            audio.addEventListener('loadedmetadata', finish, { once: true })
            window.setTimeout(finish, 3_000)
          })
        }
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.05))
        }
      }

      if (options.shouldPlay !== false) {
        await audio.play()
        // A resolved play() promise is authoritative even if Chromium delays
        // its media event; the session subscription updates every mounted UI.
        updateMusicPlaybackSnapshot({ wasPlaying: true })
      }
      updateMusicPlaybackSnapshot({ currentTime: audio.currentTime || resumeAt, wasPlaying: options.shouldPlay !== false })
      setStatusText('')
      return true
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '播放失败')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (restorePlaybackRef.current) return
    restorePlaybackRef.current = true

    const savedPlayback = getMusicPlaybackSnapshot()
    const savedSong = savedPlayback.queue[savedPlayback.currentIndex]
    const audio = audioRef.current
    if (!audio || !savedSong) return

    if (audio.src || audio.currentSrc) {
      setCurrentTime(audio.currentTime || savedPlayback.currentTime)
      setDuration(Number.isFinite(audio.duration) ? audio.duration : savedPlayback.duration)
      updateMusicPlaybackSnapshot({ wasPlaying: !audio.paused && !audio.ended })
      return
    }

    void loadAndPlay(savedSong, {
      resumeAt: savedPlayback.currentTime,
      shouldPlay: savedPlayback.wasPlaying
    })
  }, [loadAndPlay])

  const playAtIndex = useCallback(
    async (index: number, sourceQueue: MusicSong[] = queueRef.current): Promise<void> => {
      if (index < 0 || index >= sourceQueue.length) {
        updateMusicPlaybackSnapshot({ wasPlaying: false })
        return
      }
      setCurrentIndex(index)
      currentIndexRef.current = index
      updateMusicPlaybackSnapshot({ queue: sourceQueue, currentIndex: index, currentTime: 0, duration: 0 })
      const song = sourceQueue[index]
      const ok = await loadAndPlay(song)
      if (!ok && index + 1 < sourceQueue.length) {
        await playAtIndex(index + 1, sourceQueue)
      }
    },
    [loadAndPlay]
  )

  useEffect(() => {
    playAtIndexRef.current = playAtIndex
  }, [playAtIndex])

  const playQueue = useCallback(
    async (songs: MusicSong[], startIndex = 0): Promise<void> => {
      if (songs.length === 0) {
        setStatusText('没有可播放的歌曲')
        return
      }
      setQueue(songs)
      queueRef.current = songs
      setTab('player')
      await playAtIndex(startIndex, songs)
    },
    [playAtIndex]
  )

  const togglePlay = useCallback(async (): Promise<void> => {
    const audio = audioRef.current
    if (!audio) return
    if (!currentSong) {
      if (queue.length > 0) await playAtIndex(0, queue)
      return
    }
    if (audio.paused) {
      if (!audio.src) {
        await loadAndPlay(currentSong)
        return
      }
      try {
        await audio.play()
        // Keep the cover state in lockstep with a successful resume even if
        // Chromium delays the corresponding media event.
        updateMusicPlaybackSnapshot({ wasPlaying: true })
      } catch {
        setStatusText('播放被浏览器拦截，请再点一次')
      }
      return
    }
    audio.pause()
  }, [currentSong, loadAndPlay, playAtIndex, queue])

  const playPrevious = useCallback(async (): Promise<void> => {
    const nextIndex = getPreviousQueueIndex(queue.length, currentIndex, playbackMode)
    if (nextIndex === null) return
    await playAtIndex(nextIndex, queue)
  }, [currentIndex, playbackMode, playAtIndex, queue])

  const playNext = useCallback(async (): Promise<void> => {
    const nextIndex = getNextQueueIndex(queue.length, currentIndex, playbackMode)
    if (nextIndex === null) return
    await playAtIndex(nextIndex, queue)
  }, [currentIndex, playbackMode, playAtIndex, queue])

  const seekTo = useCallback((ratio: number): void => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    const nextTime = Math.max(0, Math.min(1, ratio)) * audio.duration
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    updateMusicPlaybackSnapshot({ currentTime: nextTime })
  }, [])

  const handleSearch = useCallback(async (): Promise<void> => {
    const keywords = searchQuery.trim()
    if (!keywords) {
      setStatusText('请输入搜索关键词')
      return
    }
    setBusy(true)
    setStatusText('搜索中…')
    try {
      const result = await musicSearch(provider, keywords, 24)
      setSearchResults(result.songs)
      setStatusText(result.songs.length === 0 ? '未找到相关歌曲' : `找到 ${result.songs.length} 首`)
      setTab('search')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '搜索失败')
    } finally {
      setBusy(false)
    }
  }, [provider, searchQuery])

  const handleLogin = useCallback(
    async (target: MusicProvider): Promise<void> => {
      setBusy(true)
      setStatusText(`正在打开 ${PROVIDER_LABEL[target]} 登录…`)
      try {
        const result = await musicOpenLogin(target)
        await refreshAccounts()
        if (result.ok) {
          setProvider(target)
          setStatusText(
            result.reused
              ? `${PROVIDER_LABEL[target]} 已登录`
              : result.partial
                ? `${PROVIDER_LABEL[target]} 登录不完整，建议重试`
                : `${PROVIDER_LABEL[target]} 登录成功${result.nickname ? ` · ${result.nickname}` : ''}`
          )
        } else if (!result.cancelled) {
          setStatusText(result.message || result.error || '登录失败')
        } else {
          setStatusText('已取消登录')
        }
      } catch (error) {
        setStatusText(error instanceof Error ? error.message : '登录失败')
      } finally {
        setBusy(false)
      }
    },
    [refreshAccounts]
  )

  const handleLogout = useCallback(
    async (target: MusicProvider): Promise<void> => {
      setBusy(true)
      try {
        await musicLogout(target)
        await refreshAccounts()
        setStatusText(`已退出 ${PROVIDER_LABEL[target]}`)
      } catch (error) {
        setStatusText(error instanceof Error ? error.message : '退出失败')
      } finally {
        setBusy(false)
      }
    },
    [refreshAccounts]
  )

  const loadLibraryPlaylists = useCallback(async (): Promise<void> => {
    setBusy(true)
    setStatusText('加载歌单…')
    try {
      const result = await musicGetUserPlaylists(provider)
      setPlaylists(result.playlists)
      setLibrarySongs([])
      setLibraryTitle('我的歌单')
      setStatusText(result.message || (result.playlists.length === 0 ? '暂无歌单' : ''))
      setTab('library')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '歌单加载失败')
    } finally {
      setBusy(false)
    }
  }, [provider])

  const openPlaylist = useCallback(
    async (playlist: MusicPlaylistSummary): Promise<void> => {
      setBusy(true)
      setStatusText(`加载「${playlist.name}」…`)
      try {
        const result = await musicGetPlaylistTracks(provider, playlist.id, 100)
        setLibrarySongs(result.songs)
        setLibraryTitle(playlist.name)
        setStatusText(result.message || `${result.songs.length} 首`)
        setTab('library')
      } catch (error) {
        setStatusText(error instanceof Error ? error.message : '歌单加载失败')
      } finally {
        setBusy(false)
      }
    },
    [provider]
  )

  const openDaily = useCallback(async (): Promise<void> => {
    setBusy(true)
    setStatusText('加载每日推荐…')
    try {
      const result = await musicGetDailyRecommend(provider)
      setLibrarySongs(result.songs)
      setPlaylists([])
      setLibraryTitle('每日推荐')
      setStatusText(result.message || `${result.songs.length} 首`)
      setTab('library')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }, [provider])

  const openLiked = useCallback(async (): Promise<void> => {
    setBusy(true)
    setStatusText('加载喜欢的音乐…')
    try {
      const result = await musicGetLikedSongs(provider)
      setLibrarySongs(result.songs)
      setPlaylists([])
      setLibraryTitle('喜欢的音乐')
      setStatusText(result.message || `${result.songs.length} 首`)
      setTab('library')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }, [provider])

  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0
  const progressStyle = { '--music-progress': `${progressRatio * 100}%` } as CSSProperties
  const volumeStyle = { '--music-volume': `${volume * 100}%` } as CSSProperties
  const PlaybackModeIcon =
    playbackMode === 'shuffle' ? Shuffle : playbackMode === 'loop' ? Repeat : ListMusic
  const collapsedMeta = useMemo(() => {
    if (currentSong) return currentSong.name
    if (activeAccount.loggedIn) return `${PROVIDER_LABEL[provider]} · 已登录`
    return '搜索 / 登录'
  }, [activeAccount.loggedIn, currentSong, provider])

  return (
    <section
      className={`workbench-disclosure-card workbench-music-card${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}`}
      aria-label="自习室音乐播放器"
    >
      <div
        ref={revealRef}
        className="workbench-disclosure-reveal workbench-music-reveal"
        style={{ height: `${revealHeight}px` }}
        aria-hidden={!open}
        inert={!open}
      >
        <div ref={revealInnerRef} className="workbench-disclosure-reveal-inner workbench-music-reveal-inner">
          <div id="workbench-music-panel" className="workbench-disclosure-panel workbench-music-panel">
            <div className="workbench-music-head">
              <div>
                <span>
                  <Music2 size={13} aria-hidden="true" />
                  平台
                </span>
              </div>
              <div className="workbench-music-provider-switch" role="group" aria-label="音乐平台">
                {(['netease', 'qq'] as MusicProvider[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={provider === item ? 'is-active' : undefined}
                    onClick={() => setProvider(item)}
                  >
                    {PROVIDER_LABEL[item]}
                  </button>
                ))}
              </div>
            </div>

            <div className="workbench-music-now">
              <div className="workbench-music-cover" aria-hidden="true">
                <span className={`workbench-music-cover-disc${isPlaying ? ' is-playing' : ''}`}>
                  {currentSong?.cover ? (
                    <img src={currentSong.cover} alt="" />
                  ) : (
                    <Disc3 size={28} />
                  )}
                </span>
              </div>
              <div className="workbench-music-now-meta">
                <div className="workbench-music-now-title-row">
                  <strong>
                    <MusicTitleMarquee title={currentSong?.name || '尚未播放'} isPlaying={isPlaying} />
                  </strong>
                  <div className="workbench-music-now-actions">
                    <button
                      type="button"
                      className="workbench-music-now-action"
                      onClick={() => {
                        setPlaybackMode((mode) => {
                          const index = playbackModeOrder.indexOf(mode)
                          return playbackModeOrder[(index + 1) % playbackModeOrder.length]
                        })
                      }}
                      aria-label={`播放模式：${playbackModeLabel[playbackMode]}，点击切换`}
                      title={`播放模式：${playbackModeLabel[playbackMode]}`}
                    >
                      <PlaybackModeIcon size={15} />
                    </button>
                    <div ref={volumeControlRef} className="workbench-music-volume-control">
                      <button
                        type="button"
                        className="workbench-music-now-action"
                        onClick={() => setIsVolumeOpen((value) => !value)}
                        aria-label="调节音量"
                        aria-controls="workbench-music-volume-popover"
                        aria-expanded={isVolumeOpen}
                        title="调节音量"
                      >
                        {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      </button>
                      {isVolumeOpen ? (
                        <div
                          id="workbench-music-volume-popover"
                          className="workbench-music-volume-popover"
                          role="dialog"
                          aria-label="音量调节"
                        >
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={volume}
                            style={volumeStyle}
                            className="workbench-music-volume-slider"
                            aria-label="音量"
                            onChange={(event) => setVolume(Number(event.target.value))}
                          />
                          <output className="workbench-music-volume-value" aria-live="polite">
                            {Math.round(volume * 100)}%
                          </output>
                          <button
                            type="button"
                            className="workbench-music-mute-button"
                            onClick={toggleMute}
                            aria-label={volume === 0 ? '取消静音' : '静音'}
                            title={volume === 0 ? '取消静音' : '静音'}
                          >
                            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <small>
                  {currentSong
                    ? `${currentSong.artist}${currentSong.album ? ` · ${currentSong.album}` : ''}`
                    : '搜索歌曲，或登录后打开歌单'}
                </small>
              </div>
            </div>

            <div className="workbench-music-progress">
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={progressRatio}
                style={progressStyle}
                aria-label="播放进度"
                onChange={(event) => seekTo(Number(event.target.value))}
              />
              <div className="workbench-music-time">
                <span>{formatMusicDuration(currentTime)}</span>
                <span>{formatMusicDuration(duration)}</span>
              </div>
            </div>

            <div
              className="workbench-music-tabs"
              role="tablist"
              aria-label="音乐面板"
              data-active-tab={tab}
            >
              {(
                [
                  ['player', '播放'],
                  ['search', '搜索'],
                  ['library', '曲库'],
                  ['account', '账号']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'is-active' : undefined}
                  onClick={() => {
                    setIsVolumeOpen(false)
                    setTab(id)
                    if (id === 'library' && playlists.length === 0 && librarySongs.length === 0) {
                      void loadLibraryPlaylists()
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'player' ? (
              <div className="workbench-music-list" role="list" aria-label="当前队列">
                {queue.length === 0 ? (
                  <div className="workbench-music-empty">队列为空，去搜索或打开歌单吧</div>
                ) : (
                  queue.map((song, index) => (
                    <button
                      key={`${songKey(song)}:${index}`}
                      type="button"
                      className={`workbench-music-row${index === currentIndex ? ' is-current' : ''}`}
                      onClick={() => void playAtIndex(index, queue)}
                    >
                      <span className="workbench-music-row-meta">
                        <strong>{song.name}</strong>
                        <small>· {song.artist}</small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            {tab === 'search' ? (
              <div>
                <form
                  className="workbench-music-search-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleSearch()
                  }}
                >
                  <Search size={16} aria-hidden="true" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={`搜索${PROVIDER_LABEL[provider]}歌曲`}
                    aria-label="搜索歌曲"
                  />
                  <button type="submit" disabled={busy}>
                    搜索
                  </button>
                </form>
                <div className="workbench-music-list" role="list" aria-label="搜索结果">
                  {searchResults.length === 0 ? (
                    <div className="workbench-music-empty">输入关键词搜索歌曲</div>
                  ) : (
                    searchResults.map((song, index) => (
                      <button
                        key={songKey(song)}
                        type="button"
                        className="workbench-music-row"
                        onClick={() => void playQueue(searchResults, index)}
                      >
                        <span className="workbench-music-row-meta">
                          <strong>{song.name}</strong>
                          <small>
                            {song.artist}
                            {song.album ? ` · ${song.album}` : ''}
                          </small>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {tab === 'library' ? (
              <div>
                <div className="workbench-music-library-actions">
                  <button type="button" onClick={() => void loadLibraryPlaylists()} disabled={busy}>
                    我的歌单
                  </button>
                  <button type="button" onClick={() => void openLiked()} disabled={busy}>
                    喜欢
                  </button>
                  {provider === 'netease' ? (
                    <button type="button" onClick={() => void openDaily()} disabled={busy}>
                      每日推荐
                    </button>
                  ) : null}
                </div>
                {librarySongs.length > 0 ? (
                  <>
                    <div className="workbench-music-section-title">{libraryTitle}</div>
                    <div className="workbench-music-list" role="list" aria-label={libraryTitle}>
                      {librarySongs.map((song, index) => (
                        <button
                          key={songKey(song)}
                          type="button"
                          className="workbench-music-row"
                          onClick={() => void playQueue(librarySongs, index)}
                        >
                          <span className="workbench-music-row-meta">
                            <strong>{song.name}</strong>
                            <small>· {song.artist}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="workbench-music-list" role="list" aria-label="歌单列表">
                    {playlists.length === 0 ? (
                      <div className="workbench-music-empty">
                        {activeAccount.loggedIn ? '暂无歌单' : '登录后可查看歌单'}
                      </div>
                    ) : (
                      playlists.map((playlist) => (
                        <button
                          key={`${playlist.provider}:${playlist.id}`}
                          type="button"
                          className="workbench-music-row"
                          onClick={() => void openPlaylist(playlist)}
                        >
                          <span className="workbench-music-row-meta">
                            <strong>{playlist.name}</strong>
                            <small>
                              {playlist.trackCount > 0 ? `${playlist.trackCount} 首` : '歌单'}
                            </small>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {tab === 'account' ? (
              <div className="workbench-music-account">
                {(['netease', 'qq'] as MusicProvider[]).map((item) => {
                  const account = accounts[item]
                  return (
                    <div key={item} className="workbench-music-account-card">
                      <div className="workbench-music-account-meta">
                        <UserRound size={16} aria-hidden="true" />
                        <div>
                          <strong>{PROVIDER_LABEL[item]}</strong>
                          <small>
                            {account.loggedIn
                              ? account.nickname || account.userId || '已登录'
                              : '未登录'}
                          </small>
                        </div>
                      </div>
                      {account.loggedIn ? (
                        <button type="button" onClick={() => void handleLogout(item)} disabled={busy}>
                          <LogOut size={14} />
                          退出
                        </button>
                      ) : (
                        <button type="button" onClick={() => void handleLogin(item)} disabled={busy}>
                          <LogIn size={14} />
                          扫码登录
                        </button>
                      )}
                    </div>
                  )
                })}
                <p className="workbench-music-account-hint">
                  Cookie 仅保存在本机，用于获取歌单与播放地址。不要分享登录状态。
                </p>
              </div>
            ) : null}

            {statusText ? (
              <div className="workbench-music-status" role="status">
                {busy ? <Loader2 size={12} className="is-spinning" /> : null}
                <span>{statusText}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="workbench-music-footer">
        <button
          type="button"
          className="workbench-disclosure-toggle workbench-music-toggle-card"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="workbench-music-panel"
        >
          <span className="workbench-music-toggle-art" aria-hidden="true">
            <span className={`workbench-music-toggle-art-disc${isPlaying ? ' is-playing' : ''}`}>
              {currentSong?.cover ? (
                <img src={currentSong.cover} alt="" />
              ) : (
                <Music2 size={14} />
              )}
            </span>
          </span>
          <strong className="workbench-music-toggle-title">
            <MusicTitleMarquee title={collapsedMeta} isPlaying={isPlaying} />
          </strong>
        </button>
        <div className="workbench-music-mini-transport" role="group" aria-label="播放控制">
          <button
            type="button"
            className="workbench-music-mini-skip"
            onClick={() => void playPrevious()}
            aria-label="上一首"
            disabled={queue.length === 0}
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            className="workbench-music-mini-play"
            onClick={() => void togglePlay()}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            className="workbench-music-mini-skip"
            onClick={() => void playNext()}
            aria-label="下一首"
            disabled={queue.length === 0}
          >
            <SkipForward size={14} />
          </button>
        </div>
        <button
          type="button"
          className="workbench-music-expand"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="workbench-music-panel"
          aria-label={open ? '收起音乐面板' : '展开音乐面板'}
        >
          <ChevronUp className="workbench-disclosure-chevron" size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

