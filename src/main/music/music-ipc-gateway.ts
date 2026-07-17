import { ipcMain } from 'electron'
import { musicInvokeChannels } from '../../shared/music-ipc-contract'
import type { MusicProvider, MusicSong } from '../../shared/music-types'
import { MusicService } from './music-service'

function asProvider(value: unknown): MusicProvider {
  return value === 'qq' ? 'qq' : 'netease'
}

export function registerMusicIpcGateway(service = new MusicService()): MusicService {
  ipcMain.removeHandler(musicInvokeChannels.getAccountStatus)
  ipcMain.removeHandler(musicInvokeChannels.openLogin)
  ipcMain.removeHandler(musicInvokeChannels.logout)
  ipcMain.removeHandler(musicInvokeChannels.search)
  ipcMain.removeHandler(musicInvokeChannels.getPlaybackUrl)
  ipcMain.removeHandler(musicInvokeChannels.getUserPlaylists)
  ipcMain.removeHandler(musicInvokeChannels.getPlaylistTracks)
  ipcMain.removeHandler(musicInvokeChannels.getDailyRecommend)
  ipcMain.removeHandler(musicInvokeChannels.getLikedSongs)

  ipcMain.handle(musicInvokeChannels.getAccountStatus, async (_event, provider?: MusicProvider) =>
    service.getAccountStatus(provider ? asProvider(provider) : undefined)
  )

  ipcMain.handle(musicInvokeChannels.openLogin, async (event, provider: MusicProvider) =>
    service.openLogin(event, asProvider(provider))
  )

  ipcMain.handle(musicInvokeChannels.logout, async (_event, provider: MusicProvider) =>
    service.logout(asProvider(provider))
  )

  ipcMain.handle(
    musicInvokeChannels.search,
    async (
      _event,
      payload: { provider: MusicProvider; keywords: string; limit?: number }
    ) =>
      service.search({
        provider: asProvider(payload?.provider),
        keywords: String(payload?.keywords || ''),
        limit: payload?.limit
      })
  )

  ipcMain.handle(musicInvokeChannels.getPlaybackUrl, async (_event, song: MusicSong) =>
    service.getPlaybackUrl(song)
  )

  ipcMain.handle(musicInvokeChannels.getUserPlaylists, async (_event, provider: MusicProvider) =>
    service.getUserPlaylists(asProvider(provider))
  )

  ipcMain.handle(
    musicInvokeChannels.getPlaylistTracks,
    async (
      _event,
      payload: { provider: MusicProvider; playlistId: string; limit?: number }
    ) =>
      service.getPlaylistTracks({
        provider: asProvider(payload?.provider),
        playlistId: String(payload?.playlistId || ''),
        limit: payload?.limit
      })
  )

  ipcMain.handle(musicInvokeChannels.getDailyRecommend, async (_event, provider: MusicProvider) =>
    service.getDailyRecommend(asProvider(provider))
  )

  ipcMain.handle(musicInvokeChannels.getLikedSongs, async (_event, provider: MusicProvider) =>
    service.getLikedSongs(asProvider(provider))
  )

  return service
}
