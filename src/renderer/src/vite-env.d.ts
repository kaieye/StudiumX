/// <reference types="vite/client" />

import type { TeachingSystemApi } from '../../shared/teaching-types'
import type { StudiumxMusicApi } from '../../shared/music-types'
import type {
  WebRemoteControlRuntimeStatus,
  WebRemoteControlStartPayload
} from '../../shared/web-remote-control'

declare global {
  interface Window {
    teachingSystem: TeachingSystemApi
    studiumxMusic: StudiumxMusicApi
    studiumxWebRemoteControl?: {
      start: (payload?: WebRemoteControlStartPayload) => Promise<WebRemoteControlRuntimeStatus>
      stop: () => Promise<void>
      resetPairing: (payload?: WebRemoteControlStartPayload) => Promise<WebRemoteControlRuntimeStatus>
      getStatus: () => Promise<WebRemoteControlRuntimeStatus>
      onStatusChanged: (handler: (status: WebRemoteControlRuntimeStatus) => void) => () => void
    }
  }
}

export {}
