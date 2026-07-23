/**
 * Immersive scene id types for OfficeWorkbench.
 * Built-in ids are owned by immersive-custom-media-store (single source of truth).
 */

export type {
  BuiltInImmersiveSceneId,
  BuiltInImmersiveScenePreference,
  ImmersiveCustomMediaKind,
  ImmersiveScenePreference
} from './immersive-custom-media-store'

import type { BuiltInImmersiveSceneId, ImmersiveCustomMediaKind } from './immersive-custom-media-store'

export type ImmersivePhase = 'closed' | 'open' | 'closing'

export type ImmersiveSceneId = BuiltInImmersiveSceneId | `custom:${string}`

/** Runtime custom scene with object URL for display. */
export type ImmersiveCustomMediaItem = {
  id: string
  kind: ImmersiveCustomMediaKind
  url: string
  name: string
}

export const IMMERSIVE_MEDIA_ACCEPT = 'image/*,video/*'
export const IMMERSIVE_MEDIA_MAX_BYTES = 200 * 1024 * 1024
export const IMMERSIVE_CLOSE_FALLBACK_DURATION_MS = 1_200

export function classifyImmersiveMediaFile(file: File): ImmersiveCustomMediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  const lower = file.name.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(lower)) return 'image'
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(lower)) return 'video'
  return null
}

export function sceneNameFromFileName(fileName: string): string {
  const trimmed = fileName.trim()
  const extensionIndex = trimmed.lastIndexOf('.')
  return extensionIndex > 0 ? trimmed.slice(0, extensionIndex) : trimmed
}