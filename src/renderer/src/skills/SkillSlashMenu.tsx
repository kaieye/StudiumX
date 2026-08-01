import { GraduationCap, Sparkles } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  filterSkillSlashMatches,
  leadingSkillIdSequence,
  skillCommandValue,
  skillSlashQuery
} from '../../../shared/skill-command'
import type { SkillSummary } from '../../../shared/teaching-types'
import type { SkillOrchestrationMode } from '../../../shared/teaching-types/skill-orchestration'
import { useSkillCatalog } from './skillCatalog'

export function useSkillSlashInput(options: {
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  /** Current composer mode; raw slash capabilities never switch it implicitly. */
  mode: SkillOrchestrationMode
}) {
  const { catalog } = useSkillCatalog()
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedValue, setDismissedValue] = useState<string | null>(null)
  const query = skillSlashQuery(options.value)
  // Slash discovery is the installed Skill catalogue, not the formal-teaching
  // capability picker. This intentionally includes personal packs in
  // ~/.studiumx/skills and installed packs whose orchestration mode differs
  // from the active composer.
  const installedSlashSkills = catalog.skills
  // Keep the host-admission projection separate from discovery: only governed
  // skills valid for the current mode may be sent as formal selection IDs.
  const admittedFormalSkillIds = useMemo(
    () =>
      catalog.skills.filter(
        (skill) =>
          skill.orchestration?.formalTeachingEligible === true &&
          skill.orchestration.selectionSurface !== 'hidden' &&
          skill.orchestration.trustLevel === 'host_governed' &&
          skill.orchestration.allowedModes.includes(options.mode)
      ),
    [catalog.skills, options.mode]
  )
  const matches = useMemo(
    () => filterSkillSlashMatches(options.value, installedSlashSkills),
    [installedSlashSkills, options.value]
  )
  const open = query !== null && dismissedValue !== options.value

  useEffect(() => {
    setActiveIndex(0)
  }, [options.value])

  const pick = (skill: SkillSummary): void => {
    options.onChange(skillCommandValue(skill))
    setDismissedValue(null)
    window.requestAnimationFrame(() => {
      const input = options.inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }

  /** Returns completed raw input only for Enter, so the composer can submit it once. */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean | string => {
    if (!open) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedValue(options.value)
      return true
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return true
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + delta + matches.length) % matches.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const selected = matches[activeIndex]
      if (!selected) return true
      const completed = skillCommandValue(selected)
      pick(selected)
      // Pi-compatible behavior: Tab completes only; Enter completes and submits.
      return event.key === 'Enter' ? completed.trim() : true
    }
    return false
  }

  return {
    menu: open ? (
      <SkillSlashMenu
        skills={matches}
        activeIndex={activeIndex}
        onHover={setActiveIndex}
        onPick={pick}
      />
    ) : null,
    handleKeyDown,
    skillIdsFor: (value: string) => leadingSkillIdSequence(value, admittedFormalSkillIds)
  }
}

function SkillSlashMenu({
  skills,
  activeIndex,
  onHover,
  onPick
}: {
  skills: SkillSummary[]
  activeIndex: number
  onHover: (index: number) => void
  onPick: (skill: SkillSummary) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="skill-slash-menu" role="listbox" aria-label={t('skills.slash.aria')}>
      <div className="skill-slash-menu__head">
        <span>{t('skills.slash.title')}</span>
        <kbd>/</kbd>
      </div>
      {skills.length > 0 ? skills.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`skill-slash-menu__item${index === activeIndex ? ' is-active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(skill)
          }}
          onMouseMove={() => onHover(index)}
        >
          <span className="skill-slash-menu__icon">
            {skill.icon === 'graduation-cap' ? <GraduationCap size={17} /> : <Sparkles size={17} />}
          </span>
          <span className="skill-slash-menu__copy">
            <strong>{skillCommandValue(skill).trim()}</strong>
            <span>{skill.description}</span>
          </span>
          {skill.argumentHint ? <small>{skill.argumentHint}</small> : null}
        </button>
      )) : (
        <div className="skill-slash-menu__empty">{t('skills.slash.empty')}</div>
      )}
    </div>
  )
}
