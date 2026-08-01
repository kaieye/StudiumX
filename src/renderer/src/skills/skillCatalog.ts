import { useCallback, useEffect, useRef, useState } from 'react'

import type { SkillCatalogResult } from '../../../shared/teaching-types'

export const SKILL_CATALOG_CHANGED_EVENT = 'studiumx:skill-catalog-changed'

const EMPTY_CATALOG: SkillCatalogResult = { rootPath: '', skills: [] }
let cachedCatalog: SkillCatalogResult | null = null
let pendingCatalog: Promise<SkillCatalogResult> | null = null
let catalogRequestVersion = 0

export async function loadSkillCatalog(force = false): Promise<SkillCatalogResult> {
  if (!force && cachedCatalog) return cachedCatalog
  if (!force && pendingCatalog) return pendingCatalog
  const api = window.teachingSystem
  if (!api) return EMPTY_CATALOG
  const requestVersion = ++catalogRequestVersion
  const request = api.listSkills()
    .then((catalog) => {
      // A forced refresh may overlap the initial load. Only the newest
      // response is allowed to repopulate the shared cache.
      if (requestVersion === catalogRequestVersion) cachedCatalog = catalog
      return catalog
    })
    .finally(() => {
      if (pendingCatalog === request) pendingCatalog = null
    })
  pendingCatalog = request
  return request
}

export function announceSkillCatalogChanged(): void {
  // Invalidate any response started before the catalog mutation.
  catalogRequestVersion += 1
  cachedCatalog = null
  window.dispatchEvent(new Event(SKILL_CATALOG_CHANGED_EVENT))
}

export function useSkillCatalog() {
  const [catalog, setCatalog] = useState<SkillCatalogResult>(cachedCatalog ?? EMPTY_CATALOG)
  const [loading, setLoading] = useState(!cachedCatalog)
  const [error, setError] = useState<string | null>(null)
  const refreshVersion = useRef(0)

  const refresh = useCallback(async (force = false) => {
    const version = ++refreshVersion.current
    setLoading(true)
    setError(null)
    try {
      const nextCatalog = await loadSkillCatalog(force)
      if (version !== refreshVersion.current) return
      setCatalog(nextCatalog)
    } catch (reason) {
      if (version !== refreshVersion.current) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (version === refreshVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    const handleChanged = () => void refresh(true)
    window.addEventListener(SKILL_CATALOG_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(SKILL_CATALOG_CHANGED_EVENT, handleChanged)
  }, [refresh])

  return { catalog, loading, error, refresh }
}
