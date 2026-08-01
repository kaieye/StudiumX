import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Download,
  GraduationCap,
  Loader2,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SkillSummary } from '../../../../shared/teaching-types'
import { announceSkillCatalogChanged, useSkillCatalog } from '../../skills/skillCatalog'

export function SkillLibrary({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const { catalog, loading, error, refresh } = useSkillCatalog()
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [uninstallingId, setUninstallingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)

  useEffect(() => {
    if (!selectedSkill) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSkill(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedSkill])

  const visibleSkills = useMemo(() => {
    const next = catalog.skills.filter((skill) => skill.id !== 'teach')
    return [...next].sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }, [catalog.skills])

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

  const uninstall = async (skill: SkillSummary): Promise<void> => {
    if (!skill.installed || skill.id === 'teach' || uninstallingId) return
    if (!window.confirm(t('skills.confirmUninstall', { name: skill.name }))) return
    setUninstallingId(skill.id)
    setActionError(null)
    try {
      await window.teachingSystem.uninstallSkill(skill.id)
      announceSkillCatalogChanged()
      await refresh(true)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setUninstallingId(null)
    }
  }

  const getSkillCopy = (skill: SkillSummary) => ({
    name: skill.name,
    description: t(`skills.items.${skill.id}.description`, { defaultValue: skill.description }),
    detail: t(`skills.items.${skill.id}.detail`, { defaultValue: skill.description })
  })
  const getAdmissionNotice = (skill: SkillSummary) => (
    skill.id === 'grilling' ? t('skills.integrationNotice') : skill.orchestration?.reason
  )
  const selectedSkillCopy = selectedSkill ? getSkillCopy(selectedSkill) : null

  return (
    <div className="skill-library-page">
      <button className="resource-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('resources.home.back')}
      </button>
      <header className="skill-library-head">
        <div>
          <h1>{t('skills.title')}</h1>
          <p>{t('skills.detail', { root: catalog.rootPath || '~/.studiumx/skills' })}</p>
        </div>
      </header>

      <div className="skill-library-notice" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <p>{t('skills.integrationNotice')}</p>
      </div>

      {(error || actionError) ? <div className="skill-library-error" role="alert">{actionError || error}</div> : null}

      {loading && catalog.skills.length === 0 ? (
        <div className="skill-library-loading"><Loader2 className="spin" size={20} />{t('skills.loading')}</div>
      ) : visibleSkills.length > 0 ? (
        <div className="skill-card-grid">
          {visibleSkills.map((skill) => {
            const copy = getSkillCopy(skill)
            const isInstalling = installingId === skill.id
            const isUninstalling = uninstallingId === skill.id
            return (
              <article
                className={`skill-library-card${skill.installed ? ' is-installed' : ''}`}
                key={skill.id}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                onClick={() => setSelectedSkill(skill)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedSkill(skill)
                  }
                }}
              >
                <span className="skill-library-card__icon">
                  {skill.icon === 'graduation-cap' ? <GraduationCap size={25} /> : <Sparkles size={25} />}
                </span>
                <div className="skill-library-card__body">
                  <div className="skill-library-card__title">
                    <strong>{copy.name}</strong>
                  </div>
                  <p>{copy.description}</p>
                  {skill.id !== 'grilling' && skill.orchestration?.formalTeachingEligible === false ? (
                    <p className="skill-library-card__admission">
                      {getAdmissionNotice(skill)}
                    </p>
                  ) : null}
                  <span className="skill-library-card__command">{skill.command}</span>
                </div>
                {skill.installed && skill.id !== 'teach' ? (
                  <button
                    className="skill-library-card__action is-installed"
                    type="button"
                    disabled={isUninstalling}
                    onClick={(event) => {
                      event.stopPropagation()
                      void uninstall(skill)
                    }}
                  >
                    {isUninstalling ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                    {isUninstalling ? t('skills.uninstalling') : t('skills.uninstall')}
                  </button>
                ) : (
                  <button
                    className={`skill-library-card__action${skill.installed ? ' is-installed' : ''}`}
                    type="button"
                    disabled={skill.installed || isInstalling || skill.source !== 'builtin'}
                    onClick={(event) => {
                      event.stopPropagation()
                      void install(skill)
                    }}
                  >
                    {isInstalling ? <Loader2 className="spin" size={14} /> : skill.installed ? <Check size={14} /> : <Download size={14} />}
                    {isInstalling ? t('skills.installing') : skill.installed ? t('skills.installed') : t('skills.install')}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="skill-library-empty">{t('skills.noResults')}</div>
      )}

      {selectedSkill ? (
        <div
          className="skill-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedSkill(null)
          }}
        >
          <section
            className="skill-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-detail-title"
            aria-describedby="skill-detail-description"
          >
            <button
              className="skill-detail-close"
              type="button"
              aria-label={t('skills.closeDetails')}
              onClick={() => setSelectedSkill(null)}
            >
              <X size={18} />
            </button>
            <div className="skill-detail-heading">
              <span className="skill-library-card__icon" aria-hidden="true">
                {selectedSkill.icon === 'graduation-cap' ? <GraduationCap size={28} /> : <Sparkles size={28} />}
              </span>
              <div>
                <span className="skill-detail-eyebrow">{t('skills.usageTitle')}</span>
                <h2 id="skill-detail-title">{selectedSkillCopy?.name}</h2>
                <span className="skill-detail-command-label">{t('skills.commandLabel')}</span>
                <code>{selectedSkill.command}</code>
              </div>
            </div>
            <p id="skill-detail-description" className="skill-detail-description">{selectedSkillCopy?.description}</p>
            <div className="skill-detail-section">
              <h3>{t('skills.detailOverview')}</h3>
              <p>{selectedSkillCopy?.detail}</p>
            </div>
            {selectedSkill.orchestration?.formalTeachingEligible === false ? (
              <div className="skill-detail-note">{getAdmissionNotice(selectedSkill)}</div>
            ) : null}
            <p className="skill-detail-hint">{t('skills.detailHint')}</p>
          </section>
        </div>
      ) : null}
    </div>
  )
}
