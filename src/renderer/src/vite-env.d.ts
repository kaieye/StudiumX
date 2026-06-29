/// <reference types="vite/client" />

import type { TeachingSystemApi } from '../../shared/teaching-types'

declare global {
  interface Window {
    teachingSystem: TeachingSystemApi
  }
}
