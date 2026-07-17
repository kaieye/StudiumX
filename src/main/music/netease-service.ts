import type { MusicAccountStatus, MusicPlaylistSummary, MusicSong } from '../../shared/music-types'
import { normalizeCookieText } from './music-cookie-store'

const NETEASE_HEADERS: Record<string, string> = {
  Referer: 'https://music.163.com/',
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Connection: 'close'
}

const PLAYABLE_URL_TTL_MS = 1000 * 60 * 10
const playableUrlCache = new Map<string, { url: string | null; expiresAt: number }>()

function createNeteaseHeaders(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  const normalized = normalizeCookieText(cookie)
  return {
    ...NETEASE_HEADERS,
    ...(normalized ? { Cookie: normalized } : {}),
    ...extra
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJsonWithRetry(url: string, options: RequestInit = {}, retries = 2): Promise<any> {
  let lastData: any = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    lastData = data
    if (response.ok && data?.code !== 400) return data
    if (attempt < retries) await wait(180 * (attempt + 1))
  }
  return lastData || {}
}

export function mapNeteaseSong(song: any): MusicSong {
  const artists = song?.artists || song?.ar || []
  const album = song?.album || song?.al || {}
  return {
    provider: 'netease',
    id: String(song?.id ?? ''),
    name: String(song?.name || ''),
    artist: artists.map((artist: any) => artist?.name).filter(Boolean).join(' / '),
    album: String(album?.name || ''),
    cover: String(album?.picUrl || album?.blurPicUrl || album?.img80x80 || ''),
    duration: Number(song?.duration || song?.dt || 0),
    fee: song?.fee
  }
}

function mapNeteasePlaylist(playlist: any): MusicPlaylistSummary {
  return {
    provider: 'netease',
    id: String(playlist?.id ?? ''),
    name: String(playlist?.name || ''),
    trackCount: Number(playlist?.trackCount || 0),
    cover: String(playlist?.coverImgUrl || playlist?.picUrl || playlist?.cover || '')
  }
}

function readTrackId(track: any): string {
  const id = typeof track === 'object' && track !== null ? track.id : track
  const numeric = Number(id)
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : ''
}

function collectTrackIds(playlist: any, limit: number): string[] {
  const source = Array.isArray(playlist?.trackIds) && playlist.trackIds.length > 0
    ? playlist.trackIds
    : Array.isArray(playlist?.tracks)
      ? playlist.tracks
      : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of source) {
    const id = readTrackId(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= limit) break
  }
  return ids
}

export async function getNeteaseAccount(cookie: string): Promise<MusicAccountStatus> {
  const normalized = normalizeCookieText(cookie)
  if (!normalized) {
    return { provider: 'netease', loggedIn: false, userId: null, nickname: '' }
  }
  try {
    const response = await fetch('https://music.163.com/api/nuser/account/get', {
      headers: createNeteaseHeaders(normalized)
    })
    const data = await response.json()
    const userId = data?.profile?.userId || data?.account?.id || null
    return {
      provider: 'netease',
      loggedIn: Boolean(userId),
      userId: userId ? String(userId) : null,
      nickname: String(data?.profile?.nickname || '')
    }
  } catch {
    return { provider: 'netease', loggedIn: false, userId: null, nickname: '' }
  }
}

export async function getNeteasePlayableUrl(id: string, cookie = '', bitrate = '320000'): Promise<string | null> {
  const normalizedCookie = normalizeCookieText(cookie)
  const br = ['320000', '192000', '128000'].includes(bitrate) ? bitrate : '320000'
  const cacheKey = `${id}::${normalizedCookie}::${br}`
  const cached = playableUrlCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const encodedId = encodeURIComponent(id)
  const url = `https://music.163.com/api/song/enhance/player/url?id=${encodedId}&ids=%5B${encodedId}%5D&br=${br}`
  const data = await fetchJsonWithRetry(url, { headers: createNeteaseHeaders(normalizedCookie) })
  const playableUrl = data?.data?.[0]?.url || null
  playableUrlCache.set(cacheKey, { url: playableUrl, expiresAt: Date.now() + PLAYABLE_URL_TTL_MS })
  return playableUrl
}

async function filterPlayableSongs(rawSongs: any[], resultLimit: number, cookie: string): Promise<MusicSong[]> {
  const playable: MusicSong[] = []
  const batchSize = 8
  for (let i = 0; i < rawSongs.length && playable.length < resultLimit; i += batchSize) {
    const batch = rawSongs.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (song) => ({
        song: mapNeteaseSong(song),
        playableUrl: await getNeteasePlayableUrl(String(song.id), cookie)
      }))
    )
    for (const result of results) {
      if (result.playableUrl && result.song.id && result.song.name) playable.push(result.song)
      if (playable.length >= resultLimit) break
    }
  }
  return playable
}

export async function searchNeteaseSongs(keywords: string, limit = 20, cookie = ''): Promise<MusicSong[]> {
  const query = String(keywords || '').trim()
  if (!query) return []
  const resultLimit = Math.max(1, Math.min(limit, 30))
  const upstreamLimit = Math.min(resultLimit * 5, 80)
  const body = new URLSearchParams({
    s: query,
    type: '1',
    offset: '0',
    total: 'true',
    limit: String(upstreamLimit),
    _: String(Date.now())
  })

  const data = await fetchJsonWithRetry('https://music.163.com/api/search/get/web', {
    method: 'POST',
    headers: createNeteaseHeaders(cookie, {
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body
  })
  const primarySongs = Array.isArray(data?.result?.songs) ? data.result.songs : []

  const fallbackUrl = new URL('https://music.163.com/api/cloudsearch/pc')
  fallbackUrl.searchParams.set('s', query)
  fallbackUrl.searchParams.set('type', '1')
  fallbackUrl.searchParams.set('offset', '0')
  fallbackUrl.searchParams.set('total', 'true')
  fallbackUrl.searchParams.set('limit', String(upstreamLimit))
  fallbackUrl.searchParams.set('_', String(Date.now()))
  const fallbackData = await fetchJsonWithRetry(fallbackUrl.toString(), {
    headers: createNeteaseHeaders(cookie)
  })
  const fallbackSongs = Array.isArray(fallbackData?.result?.songs) ? fallbackData.result.songs : []

  const songsById = new Map<string, any>()
  for (const song of [...primarySongs, ...fallbackSongs]) {
    if (song?.id && !songsById.has(String(song.id))) songsById.set(String(song.id), song)
  }

  const candidates = [...songsById.values()]
  if (candidates.length === 0) return []

  // Prefer playable songs when cookie available; fall back to mapped candidates.
  try {
    const playable = await filterPlayableSongs(candidates, resultLimit, cookie)
    if (playable.length > 0) return playable
  } catch {
    // ignore playability filter failures
  }

  return candidates
    .map(mapNeteaseSong)
    .filter((song) => song.id && song.name)
    .slice(0, resultLimit)
}

export async function getNeteaseUserPlaylists(cookie: string): Promise<{
  valid: boolean
  playlists: MusicPlaylistSummary[]
}> {
  const account = await getNeteaseAccount(cookie)
  if (!account.loggedIn || !account.userId) return { valid: false, playlists: [] }

  const playlists: any[] = []
  const pageLimit = 1000
  for (let offset = 0; offset < 5000; offset += pageLimit) {
    const response = await fetch(
      `https://music.163.com/api/user/playlist?uid=${encodeURIComponent(account.userId)}&limit=${pageLimit}&offset=${offset}`,
      { headers: createNeteaseHeaders(cookie) }
    )
    const data = await response.json()
    const page = Array.isArray(data?.playlist) ? data.playlist : []
    playlists.push(...page)
    if (page.length < pageLimit) break
  }

  return {
    valid: true,
    playlists: playlists.map(mapNeteasePlaylist).filter((item) => item.id && item.name)
  }
}

async function fetchNeteaseSongDetails(ids: string[], cookie: string): Promise<any[]> {
  const tracks: any[] = []
  const batchSize = 400
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    const detailUrl = `https://music.163.com/api/song/detail?ids=${encodeURIComponent(
      JSON.stringify(batch.map((id) => Number(id)))
    )}`
    const data = await fetchJsonWithRetry(detailUrl, { headers: createNeteaseHeaders(cookie) })
    if (Array.isArray(data?.songs)) tracks.push(...data.songs)
  }
  return tracks
}

export async function getNeteasePlaylistTracks(
  playlistId: string,
  cookie: string,
  limit = 100
): Promise<{ songs: MusicSong[]; trackCount: number }> {
  const resultLimit = Math.max(1, Math.min(limit, 200))
  const response = await fetch(
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(playlistId)}&n=${resultLimit}`,
    { headers: createNeteaseHeaders(cookie) }
  )
  const data = await response.json()
  const playlist = data?.playlist || {}
  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : []
  const orderedIds = collectTrackIds(playlist, resultLimit)
  const detailTracks =
    orderedIds.length > tracks.length ? await fetchNeteaseSongDetails(orderedIds, cookie) : []

  const byId = new Map<string, any>()
  for (const track of [...tracks, ...detailTracks]) {
    const id = readTrackId(track)
    if (id && !byId.has(id)) byId.set(id, track)
  }

  const songs = orderedIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(mapNeteaseSong)
    .filter((song) => song.id && song.name)
    .slice(0, resultLimit)

  return {
    songs,
    trackCount: Number(playlist.trackCount || orderedIds.length || songs.length)
  }
}

export async function getNeteaseDailyRecommend(cookie: string, limit = 30): Promise<MusicSong[]> {
  const account = await getNeteaseAccount(cookie)
  if (!account.loggedIn) return []
  const response = await fetch('https://music.163.com/api/v3/discovery/recommend/songs', {
    headers: createNeteaseHeaders(cookie)
  })
  const data = await response.json()
  const rawSongs = data?.data?.dailySongs || data?.recommend || []
  const mapped = (Array.isArray(rawSongs) ? rawSongs : []).map(mapNeteaseSong)
  try {
    return await filterPlayableSongs(
      (Array.isArray(rawSongs) ? rawSongs : []).slice(0, Math.max(limit * 2, limit)),
      limit,
      cookie
    )
  } catch {
    return mapped.filter((song) => song.id && song.name).slice(0, limit)
  }
}

export async function getNeteaseLikedSongs(cookie: string, limit = 100): Promise<MusicSong[]> {
  const userPlaylists = await getNeteaseUserPlaylists(cookie)
  if (!userPlaylists.valid || userPlaylists.playlists.length === 0) return []
  const liked = userPlaylists.playlists[0]
  const result = await getNeteasePlaylistTracks(liked.id, cookie, limit)
  return result.songs
}
