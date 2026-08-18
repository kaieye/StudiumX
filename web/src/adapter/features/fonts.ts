import type { TeachingSystemApi } from '@shared/teaching-types/system-api'

/**
 * Web font capability.
 *
 * The Web lane cannot enumerate locally installed fonts (no fontkit, no OS
 * directory access) and must not phone home to ask. It therefore returns an
 * empty list, and the renderer falls back to the curated web-safe catalogue
 * (`SAFE_FONTS` in `mind-map-font-list.ts`). This keeps the mind-map font
 * picker usable in the browser without a host font probe.
 */
export const feature: Partial<TeachingSystemApi> = {
  listSystemFonts: async () => []
}
