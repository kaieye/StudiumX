import {
  ArrowLeft,
  Check,
  Download,
  FolderOpen,
  GraduationCap,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SkillCategory, SkillSummary } from '../../../../shared/teaching-types'
import { announceSkillCatalogChanged, useSkillCatalog } from '../../skills/skillCatalog'

type CategoryFilter = 'all' | SkillCategory

const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'learning', 'productivity', 'development', 'lifestyle', 'other']

export function SkillLibrary({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const { catalog, loading, error, refresh } = useSkillCatalog()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [installedOnly, setInstalledOnly] = useState(false)
  const [sort, setSort] = useState<'featured' | 'name'>('featured')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const next = catalog.skills.filter((skill) => {
      if (installedOnly && !skill.installed) return false
      if (category !== 'all' && skill.category !== category) return false
      if (!normalizedQuery) return true
      return `${skill.name} ${skill.description} ${skill.author}`.toLocaleLowerCase().includes(normalizedQuery)
    })
    return [...next].sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name)
      : Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }, [catalog.skills, category, installedOnly, query, sort])

  const install = async (skill: SkillSummary): Promise<void> => {
    if (skill.installed || skill.source !== 'builtin' || installingId) return
    setInstallingId(skill.id)
    setActionError(null)
    try {
      await window.teachingSystem.installSkill(skill.id)
      announceSkillCatalogChanged()
      await refresh(true)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setInstallingId(null)
    }
  }

  const installedCount = catalog.skills.filter((skill) => skill.installed).length

  return (
    <div className="skill-library-page">
      <button className="resource-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('resources.home.back')}
      </button>
      <header className="skill-library-head">
        <div>
          <span className="skill-library-eyebrow">{t('skills.eyebrow')}</span>
          <h1>{t('skills.title')}</h1>
          <p>{t('skills.detail', { root: catalog.rootPath || '~/.studiumx/skills' })}</p>
        </div>
        <button
          className="skill-library-folder"
          type="button"
          disabled={!catalog.rootPath}
          onClick={() => catalog.rootPath && void window.teachingSystem.openPath(catalog.rootPath)}
        >
          <FolderOpen size={16} />
          {t('skills.openFolder')}
        </button>
      </header>

      <div className="skill-library-toolbar">
        <div className="skill-category-pills" role="group" aria-label={t('skills.categories.aria')}>
          {CATEGORY_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={category === filter ? 'is-active' : ''}
              onClick={() => setCategory(filter)}
            >
              {t(`skills.categories.${filter}`)}
            </button>
          ))}
        </div>
        <div className="skill-library-controls">
          <label className="skill-library-search">
            <Search size={15} />
            <input value={query} placeholder={t('skills.search')} onChange={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <label className="skill-library-sort">
            <SlidersHorizontal size={14} />
            <select value={sort} onChange={(event) => setSort(event.currentTarget.value as 'featured' | 'name')}>
              <option value="featured">{t('skills.sort.featured')}</option>
              <option value="name">{t('skills.sort.name')}</option>
            </select>
          </label>
          <button
            className={`skill-library-mine${installedOnly ? ' is-active' : ''}`}
            type="button"
            onClick={() => setInstalledOnly((value) => !value)}
          >
            {t('skills.mine', { count: installedCount })}
          </button>
        </div>
      </div>

      {(error || actionError) ? <div className="skill-library-error" role="alert">{actionError || error}</div> : null}

      {loading && catalog.skills.length === 0 ? (
        <div className="skill-library-loading"><Loader2 className="spin" size={20} />{t('skills.loading')}</div>
      ) : visibleSkills.length > 0 ? (
        <div className="skill-card-grid">
          {visibleSkills.map((skill) => {
            const isInstalling = installingId === skill.id
            return (
              <article className={`skill-library-card${skill.installed ? ' is-installed' : ''}`} key={skill.id}>
                <span className="skill-library-card__icon">
                  {skill.icon === 'graduation-cap' ? <GraduationCap size={25} /> : <Sparkles size={25} />}
                </span>
                <div className="skill-library-card__body">
                  <div className="skill-library-card__title">
                    <strong>{skill.name}</strong>
                  </div>
                  <p>{skill.description}</p>
                  <div className="skill-library-card__meta">
                    <span>{skill.author}</span>
                    <span>{t(`skills.categories.${skill.category}`)}</span>
                  </div>
                </div>
                <button
                  className={`skill-library-card__action${skill.installed ? ' is-installed' : ''}`}
                  type="button"
                  disabled={skill.installed || isInstalling || skill.source !== 'builtin'}
                  onClick={() => void install(skill)}
                >
                  {isInstalling ? <Loader2 className="spin" size={14} /> : skill.installed ? <Check size={14} /> : <Download size={14} />}
                  {isInstalling ? t('skills.installing') : skill.installed ? t('skills.installed') : t('skills.install')}
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="skill-library-empty">{t('skills.noResults')}</div>
      )}
    </div>
  )
}
