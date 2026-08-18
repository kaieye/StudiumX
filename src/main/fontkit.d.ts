/**
 * Ambient declaration for `fontkit` (v2). The package ships ESM JavaScript
 * without bundled TypeScript declarations, so we declare the narrow surface
 * used by `src/main/system-fonts.ts` here. Kept in `src/main` so it only
 * applies to the main-process module graph (fontkit is never imported by the
 * renderer or preload).
 */
declare module 'fontkit' {
  export interface FontNameRecord {
    records: {
      fontFamily?: { en?: string }
      postScriptName?: { en?: string }
    }
  }

  export interface FontInstance {
    /** Present for collection formats (.ttc / .dfont); otherwise `undefined`. */
    fontRecords?: FontInstance[]
    name?: FontNameRecord
  }

  export function openSync(filePath: string, postScriptName?: string): FontInstance
  export function open(
    filePath: string,
    postScriptName: string | ((err: Error | null, font: FontInstance) => void),
    cb?: (err: Error | null, font: FontInstance) => void
  ): Promise<FontInstance> | void
}
