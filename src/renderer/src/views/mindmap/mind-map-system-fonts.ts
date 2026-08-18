import { useEffect, useState } from 'react'
import type { SystemFontFamily } from '../../../../shared/teaching-types/system-api'
import type { FontCatalogueEntry } from './mind-map-font-list'
import { SAFE_FONT_STACKS } from './mind-map-font-list'
import { registerManagedSystemFontStacks } from './mind-map-font-provenance'

/**
 * Desktop-enumerated system fonts, lifted into the renderer's font catalogue.
 *
 * The host (`src/main/system-fonts.ts`) walks the OS font directories with
 * fontkit and returns CSS-ready family values; the Web lane returns `[]` and
 * the picker falls back to the curated `SAFE_FONTS`. This module memoizes the
 * one IPC call across every picker instance (topic / element / theme / default
 * node) so opening a document triggers at most one directory walk.
 */

let cachedEntries: FontCatalogueEntry[] | null = null
let loadPromise: Promise<FontCatalogueEntry[]> | null = null

function toEntries(families: readonly SystemFontFamily[]): FontCatalogueEntry[] {
  // Skip any system family whose CSS value already matches a curated SAFE_FONTS
  // stack verbatim — those are already offered (and managed) by the catalogue,
  // so a duplicate would only split search hits and confuse provenance.
  const knownStacks = new Set(SAFE_FONT_STACKS)
  const seen = new Set<string>()
  const out: FontCatalogueEntry[] = []
  for (const { family, value } of families) {
    if (!family || seen.has(value)) continue
    seen.add(value)
    if (knownStacks.has(value)) continue
    out.push({
      id: `sys:${value}`,
      stack: value,
      label: family,
      category: 'system-installed'
    })
  }
  return out
}

async function loadEntries(): Promise<FontCatalogueEntry[]> {
  if (cachedEntries) return cachedEntries
  if (!loadPromise) {
    loadPromise = Promise.resolve(window.teachingSystem?.listSystemFonts?.())
      .then((families) => toEntries(families ?? []))
      .then((entries) => {
        // Register system stacks as managed so provenance/degradation does
        // not flag a host-installed family as "may fall back".
        registerManagedSystemFontStacks(entries.map((entry) => entry.stack))
        cachedEntries = entries
        return entries
      })
      .catch(() => {
        // Never block the picker on a font probe failure: degrade to the
        // curated catalogue only.
        cachedEntries = []
        return cachedEntries
      })
      .finally(() => {
        loadPromise = null
      })
  }
  return loadPromise
}

/**
 * React hook returning the host-enumerated system fonts as catalogue entries.
 * Empty on the Web lane and until the first desktop scan resolves; callers
 * always render `SAFE_FONTS` first so the picker is never blank.
 */
export function useSystemFontEntries(): readonly FontCatalogueEntry[] {
  const [entries, setEntries] = useState<readonly FontCatalogueEntry[]>(() => cachedEntries ?? [])
  useEffect(() => {
    let active = true
    if (cachedEntries) {
      setEntries(cachedEntries)
      return
    }
    void loadEntries().then((result) => {
      if (active && result.length !== entries.length) setEntries(result)
    })
    return () => {
      active = false
    }
  }, [entries.length])
  return entries
}

/** Reset the memoized cache (tests only). */
export function _resetSystemFontEntryCacheForTests(): void {
  cachedEntries = null
  loadPromise = null
}

// Kick off the desktop font probe as soon as this module is imported so the
// catalogue is usually ready before the first mind-map picker mounts. The Web
// lane resolves to [] immediately and harmlessly. Gated on the API existing
// so unit tests that stub `window.teachingSystem` partially stay deterministic.
if (typeof window !== 'undefined' && typeof window.teachingSystem?.listSystemFonts === 'function') {
  void loadEntries()
}
