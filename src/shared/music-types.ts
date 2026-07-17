export type MusicProvider = 'netease' | 'qq'

export type MusicSong = {
  provider: MusicProvider
  id: string
  name: string
  artist: string
  album: string
  cover: string
  duration: number
  mid?: string
  mediaMid?: string
  qqId?: string
  fee?: number
}

export type MusicPlaylistSummary = {
  provider: MusicProvider
  id: string
  name: string
  cover: string
  trackCount: number
  isFavorite?: boolean
}

export type MusicAccountStatus = {
  provider: MusicProvider
  loggedIn: boolean
  userId: string | null
  nickname: string
  avatar?: string
  playbackKeyReady?: boolean
}

export type MusicLoginResult =
  | { ok: true; provider: MusicProvider; reused?: boolean; partial?: boolean; nickname?: string }
  | { ok: false; provider: MusicProvider; cancelled?: boolean; message?: string; error?: string }

export type MusicSearchResult = {
  provider: MusicProvider
  songs: MusicSong[]
}

export type MusicPlaybackUrlResult = {
  provider: MusicProvider
  url: string
  playable: boolean
  message?: string
  quality?: string
}

export type MusicPlaylistTracksResult = {
  provider: MusicProvider
  loggedIn: boolean
  songs: MusicSong[]
  playlist?: MusicPlaylistSummary
  message?: string
}

export type MusicCloudLibraryResult = {
  provider: MusicProvider
  loggedIn: boolean
  playlists: MusicPlaylistSummary[]
  dailySongs?: MusicSong[]
  likedSongs?: MusicSong[]
  message?: string
}

export type StudiumxMusicApi = {
  getAccountStatus: (provider?: MusicProvider) => Promise<{
    netease: MusicAccountStatus
    qq: MusicAccountStatus
  }>
  openLogin: (provider: MusicProvider) => Promise<MusicLoginResult>
  logout: (provider: MusicProvider) => Promise<{ ok: true }>
  search: (payload: { provider: MusicProvider; keywords: string; limit?: number }) => Promise<MusicSearchResult>
  getPlaybackUrl: (song: MusicSong) => Promise<MusicPlaybackUrlResult>
  getUserPlaylists: (provider: MusicProvider) => Promise<{
    provider: MusicProvider
    loggedIn: boolean
    playlists: MusicPlaylistSummary[]
    message?: string
  }>
  getPlaylistTracks: (payload: {
    provider: MusicProvider
    playlistId: string
    limit?: number
  }) => Promise<MusicPlaylistTracksResult>
  getDailyRecommend: (provider: MusicProvider) => Promise<MusicPlaylistTracksResult>
  getLikedSongs: (provider: MusicProvider) => Promise<MusicPlaylistTracksResult>
}
