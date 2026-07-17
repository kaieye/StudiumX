import type {
  MusicAccountStatus,
  MusicLoginResult,
  MusicPlaybackUrlResult,
  MusicPlaylistSummary,
  MusicPlaylistTracksResult,
  MusicProvider,
  MusicSearchResult,
  MusicSong,
  StudiumxMusicApi
} from '../../../../../shared/music-types'

function musicApi(): StudiumxMusicApi | null {
  if (typeof window === 'undefined') return null
  return window.studiumxMusic ?? null
}

export async function musicGetAccountStatus(provider?: MusicProvider): Promise<{
  netease: MusicAccountStatus
  qq: MusicAccountStatus
}> {
  const api = musicApi()
  if (!api) {
    return {
      netease: { provider: 'netease', loggedIn: false, userId: null, nickname: '' },
      qq: { provider: 'qq', loggedIn: false, userId: null, nickname: '' }
    }
  }
  return api.getAccountStatus(provider)
}

export async function musicOpenLogin(provider: MusicProvider): Promise<MusicLoginResult> {
  const api = musicApi()
  if (!api) return { ok: false, provider, message: '音乐服务不可用' }
  return api.openLogin(provider)
}

export async function musicLogout(provider: MusicProvider): Promise<{ ok: true }> {
  const api = musicApi()
  if (!api) return { ok: true }
  return api.logout(provider)
}

export async function musicSearch(
  provider: MusicProvider,
  keywords: string,
  limit = 20
): Promise<MusicSearchResult> {
  const api = musicApi()
  if (!api) return { provider, songs: [] }
  return api.search({ provider, keywords, limit })
}

export async function musicGetPlaybackUrl(song: MusicSong): Promise<MusicPlaybackUrlResult> {
  const api = musicApi()
  if (!api) return { provider: song.provider, url: '', playable: false, message: '音乐服务不可用' }
  return api.getPlaybackUrl(song)
}

export async function musicGetUserPlaylists(provider: MusicProvider): Promise<{
  provider: MusicProvider
  loggedIn: boolean
  playlists: MusicPlaylistSummary[]
  message?: string
}> {
  const api = musicApi()
  if (!api) return { provider, loggedIn: false, playlists: [], message: '音乐服务不可用' }
  return api.getUserPlaylists(provider)
}

export async function musicGetPlaylistTracks(
  provider: MusicProvider,
  playlistId: string,
  limit = 100
): Promise<MusicPlaylistTracksResult> {
  const api = musicApi()
  if (!api) return { provider, loggedIn: false, songs: [], message: '音乐服务不可用' }
  return api.getPlaylistTracks({ provider, playlistId, limit })
}

export async function musicGetDailyRecommend(provider: MusicProvider): Promise<MusicPlaylistTracksResult> {
  const api = musicApi()
  if (!api) return { provider, loggedIn: false, songs: [], message: '音乐服务不可用' }
  return api.getDailyRecommend(provider)
}

export async function musicGetLikedSongs(provider: MusicProvider): Promise<MusicPlaylistTracksResult> {
  const api = musicApi()
  if (!api) return { provider, loggedIn: false, songs: [], message: '音乐服务不可用' }
  return api.getLikedSongs(provider)
}

export function formatMusicDuration(msOrSec: number): string {
  const totalSeconds = msOrSec > 10000 ? Math.floor(msOrSec / 1000) : Math.floor(msOrSec)
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function songKey(song: Pick<MusicSong, 'provider' | 'id'>): string {
  return `${song.provider}:${song.id}`
}
