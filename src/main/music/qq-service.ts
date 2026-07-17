import type { MusicAccountStatus, MusicPlaylistSummary, MusicSong } from '../../shared/music-types'
import { normalizeCookieText, parseCookieHeader } from './music-cookie-store'

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const QQ_HEADERS: Record<string, string> = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA
}

const QQ_QUALITY_CANDIDATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: 'Lossless FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' }
]

function normalizeQQUin(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  return digits.replace(/^0+/, '') || digits
}

export function normalizeQQCookieInput(cookieText: string): string {
  const cookie = parseCookieHeader(cookieText)
  if (Number(cookie.login_type) === 2 && cookie.wxuin && !cookie.uin) cookie.uin = cookie.wxuin
  if (!cookie.uin && (cookie.qqmusic_uin || cookie.p_uin)) cookie.uin = cookie.qqmusic_uin || cookie.p_uin
  if (cookie.uin) cookie.uin = normalizeQQUin(cookie.uin)
  return Object.entries(cookie)
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('; ')
}

function qqCookieUin(cookie: Record<string, string>): string {
  const raw =
    Number(cookie.login_type) === 2
      ? cookie.wxuin || cookie.uin || cookie.p_uin
      : cookie.uin || cookie.qqmusic_uin || cookie.wxuin || cookie.p_uin
  return normalizeQQUin(raw || '')
}

function qqCookieMusicKey(cookie: Record<string, string>): string {
  return (
    cookie.qm_keyst ||
    cookie.qqmusic_key ||
    cookie.music_key ||
    cookie.p_skey ||
    cookie.skey ||
    cookie.psrf_qqaccess_token ||
    cookie.psrf_qqrefresh_token ||
    cookie.wxrefresh_token ||
    cookie.wxskey ||
    ''
  )
}

function qqCookiePlaybackKey(cookie: Record<string, string>): string {
  return cookie.qm_keyst || cookie.qqmusic_key || cookie.music_key || cookie.wxskey || ''
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(String(value || ''))
  } catch {
    return String(value || '')
  }
}

function qqCookieNickname(cookie: Record<string, string>, uin: string): string {
  return (
    decodeCookieValue(cookie.psrf_qqopenid || '') ||
    decodeCookieValue(cookie.wxopenid || '') ||
    (uin ? `QQ ${uin}` : '')
  )
}

function qqAlbumCover(albumMid: string, size = 300): string {
  return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : ''
}

function mapQQArtists(raw: any[]): Array<{ name: string; id?: string; mid?: string }> {
  return (Array.isArray(raw) ? raw : [])
    .map((artist) => ({
      name: String(artist?.name || artist?.title || ''),
      id: artist?.id ? String(artist.id) : undefined,
      mid: artist?.mid ? String(artist.mid) : undefined
    }))
    .filter((artist) => artist.name)
}

function mapQQSmartSong(item: any): MusicSong {
  const mid = String(item?.mid || item?.songmid || item?.id || '')
  return {
    provider: 'qq',
    id: mid,
    mid,
    qqId: item?.id || item?.docid ? String(item.id || item.docid) : '',
    name: String(item?.name || item?.title || ''),
    artist: String(item?.singer || ''),
    album: '',
    cover: '',
    duration: 0
  }
}

function mapQQTrack(track: any, fallback: Partial<MusicSong> = {}): MusicSong {
  const album = track?.album || {}
  const artists = mapQQArtists(track?.singer || [])
  const mid = String(track?.mid || fallback.mid || fallback.id || '')
  const albumMid = String(album.mid || album.pmid || '')
  return {
    provider: 'qq',
    id: mid,
    mid,
    qqId: track?.id || fallback.qqId ? String(track?.id || fallback.qqId || '') : '',
    mediaMid: String(track?.file?.media_mid || fallback.mediaMid || ''),
    name: String(track?.name || track?.title || fallback.name || ''),
    artist: artists.map((artist) => artist.name).join(' / ') || String(fallback.artist || ''),
    album: String(album.name || album.title || fallback.album || ''),
    cover: qqAlbumCover(albumMid, 300) || String(fallback.cover || ''),
    duration: (Number(track?.interval) || 0) * 1000,
    fee: track?.pay && Number(track.pay.pay_play) ? 1 : 0
  }
}

function mapQQPlaylistTrack(raw: any): MusicSong {
  const source = raw || {}
  const track =
    source.songid || source.songmid || source.mid || source.name
      ? source
      : source.track_info || source.songInfo || source.songinfo || source.song || {}
  const album = track?.album || {}
  const artists = mapQQArtists(track?.singer || track?.singers || [])
  const mid = String(track?.mid || track?.songmid || source.mid || source.songmid || '')
  const albumMid = String(album.mid || track?.albummid || source.albummid || '')
  return {
    provider: 'qq',
    id: mid || String(track?.id || track?.songid || source.id || source.songid || ''),
    mid,
    qqId: String(track?.id || track?.songid || source.id || source.songid || ''),
    mediaMid: String(track?.file?.media_mid || track?.strMediaMid || track?.media_mid || source.strMediaMid || ''),
    name: String(track?.name || track?.title || track?.songname || source.songname || source.title || ''),
    artist:
      artists.map((artist) => artist.name).join(' / ') ||
      String(track?.singername || source.singername || ''),
    album: String(album.name || album.title || track?.albumname || source.albumname || ''),
    cover: qqAlbumCover(albumMid, 300),
    duration: (Number(track?.interval || source.interval) || 0) * 1000,
    fee: track?.pay && Number(track.pay.pay_play) ? 1 : 0
  }
}

function isQQFavoritePlaylistName(name: string): boolean {
  return /我喜欢|我的喜欢|喜欢的音乐|喜爱的音乐|favorite/i.test(String(name || '').trim())
}

function isQzoneBackgroundPlaylist(playlist: { name?: string; creator?: string }): boolean {
  const text = String(`${playlist?.name || ''} ${playlist?.creator || ''}`).toLowerCase()
  return /qzone|空间|背景音乐|background/.test(text)
}

function mapQQPlaylistSummary(playlist: any, _kind: 'created' | 'collect' = 'created'): MusicPlaylistSummary & {
  isLowSignal?: boolean
} {
  const raw = playlist || {}
  const id = raw.dissid || raw.tid || raw.dirid || raw.id || raw.diss_id
  const name = String(raw.diss_name || raw.name || raw.title || '')
  const mapped = {
    provider: 'qq' as const,
    id: id ? String(id) : '',
    name,
    cover: String(raw.diss_cover || raw.logo || raw.picurl || raw.cover || ''),
    trackCount: Number(raw.song_cnt || raw.songnum || raw.total_song_num || raw.song_count || 0),
    isFavorite: isQQFavoritePlaylistName(name)
  }
  return {
    ...mapped,
    isLowSignal: isQzoneBackgroundPlaylist({
      name,
      creator: String(raw.hostname || raw.nick || raw.creator || '')
    })
  }
}

async function fetchText(targetUrl: string | URL, options: RequestInit = {}): Promise<string> {
  const response = await fetch(targetUrl, {
    ...options,
    headers: {
      ...QQ_HEADERS,
      ...(options.headers as Record<string, string> | undefined)
    }
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return text
}

function parseJSONText(text: string): any {
  const raw = String(text || '').trim()
  return JSON.parse(raw.replace(/^callback\(([\s\S]*)\);?$/, '$1'))
}

async function qqMusicRequest(payload: unknown, cookieText = '', useCookie = false): Promise<any> {
  const headers: Record<string, string> = {
    ...QQ_HEADERS,
    'Content-Type': 'application/json'
  }
  if (useCookie && cookieText) headers.Cookie = cookieText
  const text = await fetchText(QQ_MUSICU_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
  return parseJSONText(text)
}

async function qqGetJSON(
  targetUrl: string,
  params: Record<string, string | number> = {},
  cookieText = '',
  options: { headers?: Record<string, string>; useCookie?: boolean } = {}
): Promise<any> {
  const url = new URL(targetUrl)
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null) url.searchParams.set(key, String(value))
  }
  const headers: Record<string, string> = { ...(options.headers || {}) }
  if (options.useCookie !== false && cookieText) headers.Cookie = cookieText
  const text = await fetchText(url, { headers })
  return parseJSONText(text)
}

export function getQQAccount(cookieText: string): MusicAccountStatus {
  const normalized = normalizeQQCookieInput(normalizeCookieText(cookieText))
  const cookie = parseCookieHeader(normalized)
  const userId = qqCookieUin(cookie)
  const musicKey = qqCookieMusicKey(cookie)
  return {
    provider: 'qq',
    loggedIn: Boolean(userId && musicKey),
    userId: userId || null,
    nickname: qqCookieNickname(cookie, userId) || (userId ? `QQ ${userId}` : ''),
    playbackKeyReady: Boolean(userId && qqCookiePlaybackKey(cookie))
  }
}

async function qqSmartboxSearch(keywords: string, limit: number): Promise<MusicSong[]> {
  const url = new URL(QQ_SMARTBOX_URL)
  url.searchParams.set('format', 'json')
  url.searchParams.set('key', keywords)
  url.searchParams.set('g_tk', '5381')
  url.searchParams.set('loginUin', '0')
  url.searchParams.set('hostUin', '0')
  url.searchParams.set('inCharset', 'utf8')
  url.searchParams.set('outCharset', 'utf-8')
  url.searchParams.set('notice', '0')
  url.searchParams.set('platform', 'yqq.json')
  url.searchParams.set('needNewCode', '0')
  const text = await fetchText(url)
  const data = parseJSONText(text)
  const items = data?.data?.song?.itemlist || []
  return (Array.isArray(items) ? items : [])
    .slice(0, Math.max(1, Math.min(limit || 8, 12)))
    .map(mapQQSmartSong)
}

async function qqSongDetail(mid: string, fallback: MusicSong): Promise<MusicSong> {
  if (!mid) return fallback
  const data = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid }
    }
  })
  return mapQQTrack(data?.songinfo?.data?.track_info, fallback)
}

export async function searchQQSongs(keywords: string, limit = 12): Promise<MusicSong[]> {
  const query = String(keywords || '').trim()
  if (!query) return []
  const resultLimit = Math.max(1, Math.min(limit, 20))
  const base = await qqSmartboxSearch(query, resultLimit)
  const detailed = await Promise.all(
    base.map(async (song) => {
      try {
        return await qqSongDetail(song.mid || song.id, song)
      } catch {
        return song
      }
    })
  )
  const seen = new Set<string>()
  return detailed.filter((song) => {
    const key = song?.mid || song?.id || `${song?.name}|${song?.artist}`
    if (!key || seen.has(key) || !song?.name) return false
    seen.add(key)
    return true
  })
}

export async function getQQSongUrl(
  mid: string,
  mediaMid = '',
  cookieText = '',
  qualityPreference = 'exhigh'
): Promise<{ url: string; playable: boolean; message?: string; quality?: string }> {
  const songMid = String(mid || '').trim()
  if (!songMid) return { url: '', playable: false, message: '缺少歌曲 mid' }

  const cookie = parseCookieHeader(normalizeQQCookieInput(cookieText))
  const userId = qqCookieUin(cookie)
  const musicKey = qqCookieMusicKey(cookie)
  const playbackKey = qqCookiePlaybackKey(cookie)

  const preferred =
    qualityPreference === 'lossless'
      ? 'lossless'
      : qualityPreference === 'standard'
        ? 'standard'
        : qualityPreference === 'aac'
          ? 'aac'
          : 'exhigh'
  let start = QQ_QUALITY_CANDIDATES.findIndex((item) => item.level === preferred)
  if (start < 0) start = 2
  const candidates = QQ_QUALITY_CANDIDATES.slice(start)

  const fileCandidates = candidates.map((item) => ({
    ...item,
    filename: `${item.prefix}${mediaMid || songMid}${item.ext}`
  }))

  const param = {
    guid: '10000',
    songmid: fileCandidates.map(() => songMid),
    songtype: fileCandidates.map(() => 0),
    uin: userId || '0',
    loginflag: 1,
    platform: '20',
    filename: fileCandidates.map((item) => item.filename)
  }

  const comm: Record<string, unknown> = {
    uin: userId || '0',
    format: 'json',
    ct: musicKey ? 19 : 24,
    cv: 0
  }
  if (musicKey) comm.authst = musicKey

  const data = await qqMusicRequest(
    {
      comm,
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param
      }
    },
    normalizeQQCookieInput(cookieText),
    true
  )

  const responseData = data?.req_0?.data || {}
  const infos = Array.isArray(responseData.midurlinfo) ? responseData.midurlinfo : []
  const info = infos.find((item: any) => item?.purl) || infos[0]
  const purl = info?.purl
  if (purl) {
    const sip = responseData.sip?.[0] || 'https://ws.stream.qqmusic.qq.com/'
    const fileMeta = fileCandidates.find((item) => item.filename === info.filename) || {}
    return {
      url: `${sip}${purl}`,
      playable: true,
      quality: (fileMeta as any).label || info.filename || ''
    }
  }

  return {
    url: '',
    playable: false,
    message: !musicKey
      ? 'QQ 音乐需要登录后才能获取播放地址'
      : !playbackKey
        ? 'QQ 登录不完整，请重新扫码登录'
        : 'QQ 音乐没有返回可播放地址，可能受版权、会员或地区限制'
  }
}

export async function getQQUserPlaylists(cookieText: string): Promise<{
  loggedIn: boolean
  playlists: MusicPlaylistSummary[]
}> {
  const profile = getQQAccount(cookieText)
  if (!profile.loggedIn || !profile.userId) return { loggedIn: false, playlists: [] }
  const uin = profile.userId
  const cookie = normalizeQQCookieInput(cookieText)

  const createdRequest = qqGetJSON(
    'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
    {
      hostUin: 0,
      hostuin: uin,
      sin: 0,
      size: 200,
      g_tk: 5381,
      loginUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0
    },
    cookie,
    { headers: { Referer: 'https://y.qq.com/portal/profile.html' } }
  )
  const collectedRequest = qqGetJSON(
    'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
    {
      ct: 20,
      cid: 205360956,
      userid: uin,
      reqtype: 3,
      sin: 0,
      ein: 199
    },
    cookie,
    { headers: { Referer: 'https://y.qq.com/portal/profile.html' } }
  )

  const [createdRaw, collectedRaw] = await Promise.allSettled([createdRequest, collectedRequest])
  const created =
    createdRaw.status === 'fulfilled' && Array.isArray(createdRaw.value?.data?.disslist)
      ? createdRaw.value.data.disslist.map((playlist: any) => mapQQPlaylistSummary(playlist, 'created'))
      : []
  const collected =
    collectedRaw.status === 'fulfilled' && Array.isArray(collectedRaw.value?.data?.cdlist)
      ? collectedRaw.value.data.cdlist.map((playlist: any) => mapQQPlaylistSummary(playlist, 'collect'))
      : []

  const seen = new Set<string>()
  const playlists = [...created, ...collected]
    .filter((playlist) => {
      if (!playlist.id || !playlist.name || seen.has(playlist.id) || playlist.isLowSignal) return false
      seen.add(playlist.id)
      return true
    })
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite))
    .map(({ isLowSignal: _ignored, ...playlist }) => playlist)

  return { loggedIn: true, playlists }
}

async function fetchQQPlaylistTracksByMusicu(
  playlistId: string,
  trackLimit: number,
  cookieText: string,
  userId: string
): Promise<any[]> {
  const data = await qqMusicRequest(
    {
      comm: {
        ct: 24,
        cv: 0,
        g_tk: 5381,
        uin: userId,
        format: 'json',
        platform: 'yqq.json'
      },
      req: {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: {
          disstid: playlistId,
          song_begin: 0,
          song_num: trackLimit,
          userinfo: 1,
          tag: 1
        }
      }
    },
    cookieText,
    Boolean(cookieText)
  )
  const songlist = data?.req?.data?.songlist
  return Array.isArray(songlist) ? songlist : []
}

export async function getQQPlaylistTracks(
  playlistId: string,
  cookieText: string,
  limit = 100
): Promise<{ loggedIn: boolean; songs: MusicSong[]; playlist?: MusicPlaylistSummary; message?: string }> {
  const profile = getQQAccount(cookieText)
  if (!profile.loggedIn || !profile.userId) {
    return { loggedIn: false, songs: [], message: '请先登录 QQ 音乐' }
  }
  const id = String(playlistId || '').trim()
  if (!id) return { loggedIn: true, songs: [], message: '缺少歌单 ID' }

  const trackLimit = Math.max(1, Math.min(limit, 200))
  const cookie = normalizeQQCookieInput(cookieText)
  const data = await qqGetJSON(
    'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
    {
      type: 1,
      utf8: 1,
      disstid: id,
      loginUin: profile.userId,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0
    },
    cookie,
    { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } }
  )
  const detail = data?.cdlist?.[0] || {}
  let rawTracks = Array.isArray(detail.songlist) ? detail.songlist : []
  if (rawTracks.length < trackLimit) {
    try {
      const musicuTracks = await fetchQQPlaylistTracksByMusicu(id, trackLimit, cookie, profile.userId)
      if (musicuTracks.length > rawTracks.length) rawTracks = musicuTracks
    } catch {
      // keep legacy result
    }
  }

  const songs = rawTracks
    .map(mapQQPlaylistTrack)
    .filter((song: MusicSong) => song.name && (song.mid || song.id))
    .slice(0, trackLimit)

  return {
    loggedIn: true,
    songs,
    playlist: {
      provider: 'qq',
      id,
      name: String(detail.dissname || detail.diss_name || detail.name || ''),
      cover: String(detail.logo || detail.diss_cover || ''),
      trackCount: Number(detail.total_song_num || detail.songnum || detail.song_count || rawTracks.length || songs.length)
    }
  }
}
