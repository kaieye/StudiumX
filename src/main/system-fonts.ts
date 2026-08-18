/**
 * Native system font enumeration for the desktop (Electron main) lane.
 *
 * Mirrors the Xmind approach: walk the OS font directories with `fontkit` and
 * collect each installed font's family name, de-duplicated. The renderer merges
 * this list into the mind-map font picker so a desktop user can pick any locally
 * installed family; the Web lane falls back to the curated `SAFE_FONTS`
 * catalogue (see `mind-map-font-list.ts`).
 *
 * This is a read-only, host-only probe. It never uploads anything, never writes
 * files, and never claims a requested family is actually installed: the picker
 * still preserves unmanaged stacks verbatim and may report a "may fall back"
 * warning per `mind-map-font-provenance.ts`.
 */
import { openSync as openFontSync } from 'fontkit'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SystemFontFamily } from '../shared/teaching-types/system-api'

export type { SystemFontFamily }

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2', '.dfont'])

// Families fontkit reports that are not user-meaningful desktop fonts: dotfile
// system fallbacks and the synthetic "System Font" alias. Keeping them out of
// the picker keeps the list useful (Xmind does the same kind of filtering).
const HIDDEN_FAMILY_PATTERNS = [
  /^\./, // ".SF NS", ".LastResort", ".Keyboard" ...
  /^System Font$/i
]

let cachedFamilies: SystemFontFamily[] | null = null
let scanPromise: Promise<SystemFontFamily[]> | null = null

function platformFontDirectories(): string[] {
  const platform = process.platform
  if (platform === 'darwin') {
    return [
      join(homedir(), 'Library/Fonts'),
      '/Library/Fonts',
      '/System/Library/Fonts'
    ]
  }
  if (platform === 'win32') {
    const windir = process.env.windir ?? process.env.WINDIR ?? 'C:\\Windows'
    return [
      join(windir, 'Fonts'),
      join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts')
    ]
  }
  if (platform === 'linux') {
    return [
      join(homedir(), '.fonts'),
      join(homedir(), '.local', 'share', 'fonts'),
      '/usr/share/fonts',
      '/usr/local/share/fonts'
    ]
  }
  return []
}

function cssSafeValue(family: string): string {
  // A family name with spaces or special chars needs to be quoted in a CSS
  // font-family list. Keep it simple and robust: quote anything that is not a
  // bare ASCII identifier.
  return /^[-_A-Za-z0-9]+$/.test(family) ? family : `"${family.replace(/"/g, '\\"')}"`
}

function isHiddenFamily(family: string): boolean {
  return HIDDEN_FAMILY_PATTERNS.some((pattern) => pattern.test(family))
}

async function walkDirectory(dir: string, families: Map<string, true>): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const fullPath = join(dir, name)
    let info
    try {
      info = await stat(fullPath)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      await walkDirectory(fullPath, families)
      continue
    }
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    if (!FONT_EXTENSIONS.has(ext)) continue
    try {
      const font = openFontSync(fullPath)
      const records = font.fontRecords ?? [font]
      for (const record of records) {
        const family = record.name?.records?.fontFamily?.en
        if (family && !isHiddenFamily(family)) {
          families.set(family, true)
        }
      }
    } catch {
      // Unreadable or unsupported font file: skip silently.
    }
  }
}

async function scanFamilies(): Promise<SystemFontFamily[]> {
  const families = new Map<string, true>()
  const directories = platformFontDirectories()
  for (const dir of directories) {
    await walkDirectory(dir, families)
  }
  const sorted = [...families.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  )
  return sorted.map((family) => ({ family, value: cssSafeValue(family) }))
}

/**
 * Enumerate installed system font families, memoized after the first call.
 * Concurrent callers share one in-flight scan so opening a mind map never
 * triggers two directory walks. Returns an empty list on unsupported platforms
 * (the renderer then falls back to the curated web-safe catalogue).
 */
export async function listSystemFonts(): Promise<SystemFontFamily[]> {
  if (cachedFamilies) return cachedFamilies
  if (!scanPromise) {
    scanPromise = scanFamilies()
      .then((result) => {
        cachedFamilies = result
        return result
      })
      .catch((error) => {
        // Never let a font scan failure break document open: fall back to the
        // empty list so the picker still shows the curated catalogue.
        console.error('[system-fonts] scan failed:', error)
        cachedFamilies = []
        return cachedFamilies
      })
      .finally(() => {
        scanPromise = null
      })
  }
  return scanPromise
}

/** Reset the memoized cache (tests only). */
export function _resetSystemFontCacheForTests(): void {
  cachedFamilies = null
  scanPromise = null
}
