/// <reference types="vite/client" />

import type { StudiumxMusicApi } from '../../src/shared/music-types'

declare global {
  interface Window {
    /** Optional in browsers; provided by Electron preload in the desktop app. */
    studiumxMusic?: StudiumxMusicApi
  }
}

export {}
