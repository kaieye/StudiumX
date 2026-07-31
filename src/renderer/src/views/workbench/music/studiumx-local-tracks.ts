import type { MusicSong } from '../../../../../shared/music-types'

/**
 * Bundled StudiumX local tracks.
 *
 * These ship inside the renderer asset bundle (no external account / IPC) so
 * the study-room player can play real music without depending on a streaming
 * provider. The asset URLs are resolved via `new URL(..., import.meta.url)` so
 * Vite emits the .m4a files in both dev and packaged builds, matching how the
 * pet spritesheets and workbench scene assets are loaded.
 */
const STUDIUMX_LOCAL_TRACK_PREFIX = 'studiumx-local:'

const gardenBenchBlissUrl = new URL(
  '../../../assets/audio/garden-bench-bliss.m4a',
  import.meta.url
).href
const rainsoftLeavesUrl = new URL(
  '../../../assets/audio/rainsoft-leaves.m4a',
  import.meta.url
).href

export const STUDIUMX_LOCAL_TRACKS: MusicSong[] = [
  {
    provider: 'netease',
    id: `${STUDIUMX_LOCAL_TRACK_PREFIX}garden-bench-bliss`,
    name: 'Garden Bench Bliss',
    artist: 'StudiumX',
    album: '',
    cover: '',
    duration: 0
  },
  {
    provider: 'netease',
    id: `${STUDIUMX_LOCAL_TRACK_PREFIX}rainsoft-leaves`,
    name: 'Rainsoft Leaves',
    artist: 'StudiumX',
    album: '',
    cover: '',
    duration: 0
  }
]

const localTrackUrls: Record<string, string> = {
  [`${STUDIUMX_LOCAL_TRACK_PREFIX}garden-bench-bliss`]: gardenBenchBlissUrl,
  [`${STUDIUMX_LOCAL_TRACK_PREFIX}rainsoft-leaves`]: rainsoftLeavesUrl
}

/** A StudiumX local track is resolved from the bundled asset, not a provider. */
export function isStudiumxLocalSong(
  song: Pick<MusicSong, 'id'> | null | undefined
): boolean {
  return Boolean(song && song.id.startsWith(STUDIUMX_LOCAL_TRACK_PREFIX))
}

/** Returns the bundled asset URL for a StudiumX local track, or null. */
export function getStudiumxLocalTrackUrl(song: Pick<MusicSong, 'id'>): string | null {
  return localTrackUrls[song.id] ?? null
}
