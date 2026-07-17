/// <reference types="vite/client" />

import type { TeachingSystemApi } from '../../shared/teaching-types'
import type { StudiumxMusicApi } from '../../shared/music-types'

declare global {
  interface Window {
    teachingSystem: TeachingSystemApi
    studiumxMusic: StudiumxMusicApi
  }
}
