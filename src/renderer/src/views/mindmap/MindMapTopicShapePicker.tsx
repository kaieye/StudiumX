import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { InspectorValue } from './mind-map-inspector-values'

type ShapeCategory = 'basic' | 'annotation' | 'directional' | 'decorative' | 'flow'

type ShapeOption = {
  value: string
  labelKey: string
  category: ShapeCategory
}

export const MIND_MAP_TOPIC_SHAPE_OPTIONS: readonly ShapeOption[] = [
  { value: 'rounded-rect', labelKey: 'shapeRoundedRect', category: 'basic' },
  { value: 'rect', labelKey: 'shapeRect', category: 'basic' },
  { value: 'ellipse', labelKey: 'shapeEllipse', category: 'basic' },
  { value: 'diamond', labelKey: 'shapeDiamond', category: 'basic' },
  { value: 'underline', labelKey: 'shapeUnderline', category: 'basic' },
  { value: 'none', labelKey: 'shapeNone', category: 'basic' },
  { value: 'quote', labelKey: 'shapeQuote', category: 'annotation' },
  { value: 'callout', labelKey: 'shapeCallout', category: 'annotation' },
  { value: 'bracket', labelKey: 'shapeBracket', category: 'annotation' },
  { value: 'arrow-right', labelKey: 'shapeArrowRight', category: 'directional' },
  { value: 'arrow-left', labelKey: 'shapeArrowLeft', category: 'directional' },
  { value: 'heart', labelKey: 'shapeHeart', category: 'decorative' },
  { value: 'cloud', labelKey: 'shapeCloud', category: 'decorative' },
  { value: 'star', labelKey: 'shapeStar', category: 'decorative' },
  { value: 'parallelogram', labelKey: 'shapeParallelogram', category: 'flow' },
  { value: 'hexagon', labelKey: 'shapeHexagon', category: 'flow' }
]

const SHAPE_CATEGORIES: readonly ShapeCategory[] = [
  'basic',
  'annotation',
  'directional',
  'decorative',
  'flow'
]

type MindMapTopicShapePickerProps = {
  value: InspectorValue<string>
  onChange: (value: string | undefined) => void
}

/**
 * A compact, searchable shape picker. It owns only transient UI state; callers
 * retain the canonical command/reducer/persistence mutation lane.
 */
export function MindMapTopicShapePicker({ value, onChange }: MindMapTopicShapePickerProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedShape = value.state === 'concrete' ? value.value : value.state === 'none' ? 'none' : undefined
  const selectedOption = MIND_MAP_TOPIC_SHAPE_OPTIONS.find((option) => option.value === selectedShape)
  const valueLabel = value.state === 'mixed'
    ? t('mindmap.topicStyle.mixed')
    : value.state === 'inherited'
      ? t('mindmap.topicStyle.inherit')
      : selectedOption
        ? t(`mindmap.topicStyle.${selectedOption.labelKey}`)
        : t('mindmap.topicStyle.shapeImported', { shape: selectedShape ?? '' })
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingOptions = MIND_MAP_TOPIC_SHAPE_OPTIONS.filter((option) => {
    if (!normalizedQuery) return true
    const label = t(`mindmap.topicStyle.${option.labelKey}`).toLocaleLowerCase()
    return label.includes(normalizedQuery) || option.value.includes(normalizedQuery)
  })

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const closeAndRestoreFocus = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const selectShape = (next: string | undefined): void => {
    if (next !== selectedShape) onChange(next)
    closeAndRestoreFocus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndRestoreFocus()
      return
    }
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return

    const options = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    if (options.length === 0) return
    event.preventDefault()
    const activeIndex = options.indexOf(document.activeElement as HTMLElement)
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const startingIndex = activeIndex === -1 ? (direction > 0 ? -1 : 0) : activeIndex
    options[(startingIndex + direction + options.length) % options.length]?.focus()
  }

  return (
    <div ref={rootRef} className="mindmap-topic-shape-picker" onKeyDown={onKeyDown}>
      <span className="mm-row__label">{t('mindmap.topicStyle.shapeLabel')}</span>
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-topic-shape-picker__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="mindmap-topic-shape-picker-options"
        aria-label={`${t('mindmap.topicStyle.shapeLabel')} ${valueLabel}`}
        onClick={() => {
          setQuery('')
          setOpen((previous) => !previous)
        }}
      >
        <span className="mindmap-topic-shape-picker__value">{valueLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id="mindmap-topic-shape-picker-options"
          className="mindmap-topic-shape-picker__popover"
          role="dialog"
          aria-label={t('mindmap.topicStyle.shapePicker')}
        >
          <label className="mindmap-topic-shape-picker__search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={t('mindmap.topicStyle.shapeSearchPlaceholder')}
              aria-label={t('mindmap.topicStyle.shapeSearch')}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          {matchingOptions.length === 0 ? (
            <p className="mindmap-topic-shape-picker__empty" role="status">
              {t('mindmap.topicStyle.shapeNoResults')}
            </p>
          ) : (
            <div className="mindmap-topic-shape-picker__options" role="listbox" aria-label={t('mindmap.topicStyle.shapeOptions')}>
              <div className="mindmap-topic-shape-picker__category">
                <span className="mindmap-topic-shape-picker__category-label">
                  {t('mindmap.topicStyle.shapeInherit')}
                </span>
                <button
                  type="button"
                  role="option"
                  aria-selected={value.state === 'inherited'}
                  className={value.state === 'inherited' ? 'is-active' : ''}
                  onClick={() => selectShape(undefined)}
                >
                  {t('mindmap.topicStyle.inherit')}
                </button>
              </div>
              {SHAPE_CATEGORIES.map((category) => {
                const categoryOptions = matchingOptions.filter((option) => option.category === category)
                if (categoryOptions.length === 0) return null
                return (
                  <div key={category} className="mindmap-topic-shape-picker__category">
                    <span className="mindmap-topic-shape-picker__category-label">
                      {t(`mindmap.topicStyle.shapeCategories.${category}`)}
                    </span>
                    {categoryOptions.map((option) => {
                      const selected = option.value === selectedShape
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={selected ? 'is-active' : ''}
                          onClick={() => selectShape(option.value)}
                        >
                          {t(`mindmap.topicStyle.${option.labelKey}`)}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
