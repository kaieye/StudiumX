import { useCallback, useEffect, useState } from 'react'

import type { SkillCatalogResult } from '../../../shared/teaching-types'

export const SKILL_CATALOG_CHANGED_EVENT = 'studiumx:skill-catalog-changed'

const EMPTY_CATALOG: SkillCatalogResult = { rootPath: '', skills: [] }
let cachedCatalog: SkillCatalogResult | null = null
let pendingCatalog: Promise<SkillCatalogResult> | null = null

export async function loadSkillCatalog(force = false): Promise<SkillCatalogResult> {
  if (!force && cachedCatalog) return cachedCatalog
  if (!force && pendingCatalog) return pendingCatalog
  const api = window.teachingSystem
  if (!api) return EMPTY_CATALOG
  pendingCatalog = api.listSkills()
    .then((catalog) => {
      cachedCatalog = catalog
      return catalog
    })
    .finally(() => {
      pendingCatalog = null
    })
  return pendingCatalog
}

export function announceSkillCatalogChanged(): void {
  cachedCatalog = null
  window.dispatchEvent(new Event(SKILL_CATALOG_CHANGED_EVENT))
}

export function useSkillCatalog() {
  const [catalog, setCatalog] = useState<SkillCatalogResult>(cachedCatalog ?? EMPTY_CATALOG)
  const [loading, setLoading] = useState(!cachedCatalog)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      setCatalog(await loadSkillCatalog(force))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
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
