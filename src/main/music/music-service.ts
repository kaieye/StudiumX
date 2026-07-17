import { BrowserWindow } from 'electron'
import type {
  MusicAccountStatus,
  MusicLoginResult,
  MusicPlaybackUrlResult,
  MusicPlaylistSummary,
  MusicPlaylistTracksResult,
  MusicProvider,
  MusicSearchResult,
  MusicSong
} from '../../shared/music-types'
import { MusicCookieStore } from './music-cookie-store'
import {
  getNeteaseAccount,
  getNeteaseDailyRecommend,
  getNeteaseLikedSongs,
  getNeteasePlayableUrl,
  getNeteasePlaylistTracks,
  getNeteaseUserPlaylists,
  searchNeteaseSongs
} from './netease-service'
import {
  clearMusicLoginSession,
  openNeteaseMusicLoginWindow,
  openQQMusicLoginWindow
} from './music-login'
import {
  getQQAccount,
  getQQPlaylistTracks,
  getQQSongUrl,
  getQQUserPlaylists,
  searchQQSongs
} from './qq-service'

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export class MusicService {
  private readonly cookies = new MusicCookieStore()

  async getAccountStatus(_provider?: MusicProvider): Promise<{
    netease: MusicAccountStatus
    qq: MusicAccountStatus
  }> {
    const all = await this.cookies.getAll()
    const [netease, qq] = await Promise.all([
      getNeteaseAccount(all.netease),
      Promise.resolve(getQQAccount(all.qq))
    ])
    return { netease, qq }
  }

  async openLogin(
    event: Electron.IpcMainInvokeEvent,
    provider: MusicProvider
  ): Promise<MusicLoginResult> {
    const owner = senderWindow(event)
    if (provider === 'netease') {
      const result = await openNeteaseMusicLoginWindow(owner)
      if (!result.ok) {
        return {
          ok: false,
          provider,
          cancelled: result.cancelled,
          message: result.message,
          error: result.error
        }
      }
      await this.cookies.set('netease', result.cookie)
      const account = await getNeteaseAccount(result.cookie)
      return {
        ok: true,
        provider,
        reused: result.reused,
        nickname: account.nickname
      }
    }

    const result = await openQQMusicLoginWindow(owner)
    if (!result.ok) {
      return {
        ok: false,
        provider,
        cancelled: result.cancelled,
        message: result.message,
        error: result.error
      }
    }
    await this.cookies.set('qq', result.cookie)
    const account = getQQAccount(result.cookie)
    return {
      ok: true,
      provider,
      reused: result.reused,
      partial: result.partial,
      nickname: account.nickname
    }
  }

  async logout(provider: MusicProvider): Promise<{ ok: true }> {
    await this.cookies.clear(provider)
    await clearMusicLoginSession(provider)
    return { ok: true }
  }

  async search(payload: {
    provider: MusicProvider
    keywords: string
    limit?: number
  }): Promise<MusicSearchResult> {
    const provider = payload.provider === 'qq' ? 'qq' : 'netease'
    const keywords = String(payload.keywords || '').trim()
    const limit = Number(payload.limit) || 20
    if (!keywords) return { provider, songs: [] }

    if (provider === 'qq') {
      const songs = await searchQQSongs(keywords, limit)
      return { provider, songs }
    }

    const cookie = await this.cookies.get('netease')
    const songs = await searchNeteaseSongs(keywords, limit, cookie)
    return { provider, songs }
  }

  async getPlaybackUrl(song: MusicSong): Promise<MusicPlaybackUrlResult> {
    const provider = song.provider === 'qq' ? 'qq' : 'netease'
    if (provider === 'qq') {
      const cookie = await this.cookies.get('qq')
      const mid = song.mid || song.id
      const result = await getQQSongUrl(mid, song.mediaMid || '', cookie)
      return {
        provider,
        url: result.url,
        playable: result.playable,
        message: result.message,
        quality: result.quality
      }
    }

    const cookie = await this.cookies.get('netease')
    const url = await getNeteasePlayableUrl(String(song.id), cookie)
    return {
      provider,
      url: url || '',
      playable: Boolean(url),
      message: url ? undefined : '无法获取播放地址，可能需要登录或受版权限制'
    }
  }

  async getUserPlaylists(provider: MusicProvider): Promise<{
    provider: MusicProvider
    loggedIn: boolean
    playlists: MusicPlaylistSummary[]
    message?: string
  }> {
    if (provider === 'qq') {
      const cookie = await this.cookies.get('qq')
      const result = await getQQUserPlaylists(cookie)
      return {
        provider,
        loggedIn: result.loggedIn,
        playlists: result.playlists,
        message: result.loggedIn ? undefined : '请先登录 QQ 音乐'
      }
    }

    const cookie = await this.cookies.get('netease')
    const result = await getNeteaseUserPlaylists(cookie)
    // First playlist is typically "liked songs"
    const playlists = result.playlists.slice(1)
    return {
      provider,
      loggedIn: result.valid,
      playlists,
      message: result.valid ? undefined : '请先登录网易云音乐'
    }
  }

  async getPlaylistTracks(payload: {
    provider: MusicProvider
    playlistId: string
    limit?: number
  }): Promise<MusicPlaylistTracksResult> {
    const provider = payload.provider === 'qq' ? 'qq' : 'netease'
    const limit = Number(payload.limit) || 100
    if (provider === 'qq') {
      const cookie = await this.cookies.get('qq')
      const result = await getQQPlaylistTracks(payload.playlistId, cookie, limit)
      return {
        provider,
        loggedIn: result.loggedIn,
        songs: result.songs,
        playlist: result.playlist,
        message: result.message
      }
    }

    const cookie = await this.cookies.get('netease')
    const account = await getNeteaseAccount(cookie)
    if (!account.loggedIn) {
      return { provider, loggedIn: false, songs: [], message: '请先登录网易云音乐' }
    }
    const result = await getNeteasePlaylistTracks(payload.playlistId, cookie, limit)
    return {
      provider,
      loggedIn: true,
      songs: result.songs,
      playlist: {
        provider: 'netease',
        id: payload.playlistId,
        name: '',
        cover: '',
        trackCount: result.trackCount
      }
    }
  }

  async getDailyRecommend(provider: MusicProvider): Promise<MusicPlaylistTracksResult> {
    if (provider === 'qq') {
      return {
        provider,
        loggedIn: false,
        songs: [],
        message: 'QQ 音乐暂不支持每日推荐，请打开歌单浏览'
      }
    }
    const cookie = await this.cookies.get('netease')
    const account = await getNeteaseAccount(cookie)
    if (!account.loggedIn) {
      return { provider, loggedIn: false, songs: [], message: '请先登录网易云音乐' }
    }
    const songs = await getNeteaseDailyRecommend(cookie, 30)
    return { provider, loggedIn: true, songs }
  }

  async getLikedSongs(provider: MusicProvider): Promise<MusicPlaylistTracksResult> {
    if (provider === 'qq') {
      const cookie = await this.cookies.get('qq')
      const library = await getQQUserPlaylists(cookie)
      if (!library.loggedIn) {
        return { provider, loggedIn: false, songs: [], message: '请先登录 QQ 音乐' }
      }
      const favorite = library.playlists.find((item) => item.isFavorite) || library.playlists[0]
      if (!favorite) {
        return { provider, loggedIn: true, songs: [], message: '未找到喜欢的音乐歌单' }
      }
      const tracks = await getQQPlaylistTracks(favorite.id, cookie, 100)
      return {
        provider,
        loggedIn: true,
        songs: tracks.songs,
        playlist: favorite
      }
    }

    const cookie = await this.cookies.get('netease')
    const account = await getNeteaseAccount(cookie)
    if (!account.loggedIn) {
      return { provider, loggedIn: false, songs: [], message: '请先登录网易云音乐' }
    }
    const songs = await getNeteaseLikedSongs(cookie, 100)
    return { provider, loggedIn: true, songs }
  }
}
