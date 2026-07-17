export const musicInvokeChannels = {
  getAccountStatus: 'music:get-account-status',
  openLogin: 'music:open-login',
  logout: 'music:logout',
  search: 'music:search',
  getPlaybackUrl: 'music:get-playback-url',
  getUserPlaylists: 'music:get-user-playlists',
  getPlaylistTracks: 'music:get-playlist-tracks',
  getDailyRecommend: 'music:get-daily-recommend',
  getLikedSongs: 'music:get-liked-songs'
} as const

export type MusicInvokeChannel = (typeof musicInvokeChannels)[keyof typeof musicInvokeChannels]
