import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type IconPickerOption = {
  value: string
  label: string
  icon: ReactNode
  category?: string
}

type Category = { key: string; label: string }

type MindMapIconPickerProps = {
  /** Accessible + visible field label rendered next to the trigger. */
  label: string
  value?: string
  isMixed?: boolean
  /** Fallback label shown when there is no concrete value (inherit / mixed). */
  displayLabel?: string
  options: IconPickerOption[]
  categories?: Category[]
  searchable?: boolean
  disabled?: boolean
  /** Number of grid columns for the option tiles (default 4; e.g. 2 for a 2×2 connector menu). */
  columns?: number
  /** Show a "clear field override" action at the top of the popover. */
  showClear?: boolean
  clearLabel?: string
  onClear?: () => void
  /** Dialog popover a11y label. */
  dialogLabel: string
  /** Label shown in the trigger when a concrete value exists. */
  optionLabelKey?: (value: string) => string
  /** Build the trigger's accessible name from the resolved trigger label. */
  buildTriggerName?: (triggerLabel: string) => string
  /** Accessible description for the trigger (state: inherited / none / mixed). */
  triggerDescription?: string
  /** Accessible description shown on the active option. */
  selectedDescription?: string
  /** Accessible name for the search box. */
  searchAriaLabel?: string
  onChange: (value: string | undefined) => void
}

/**
 * A StudiumX graphical picker: a compact trigger button that opens an
 * animated popover showing each option as a concrete shape glyph instead of a
 * bare text label. Handles search, category grouping, keyboard navigation,
 * Escape and outside-click dismissal. Owns only transient UI state; callers
 * keep the canonical command/reducer/persistence mutation lane.
 */
export function MindMapIconPicker({
  label,
  value,
  isMixed = false,
  displayLabel,
  options,
  categories,
  searchable = true,
  disabled = false,
  columns = 4,
  showClear = false,
  clearLabel,
  onClear,
  dialogLabel,
  optionLabelKey,
  buildTriggerName,
  triggerDescription,
  selectedDescription,
  searchAriaLabel,
  onChange
}: MindMapIconPickerProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedOption = options.find((option) => option.value === value)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingOptions = options.filter((option) => {
    if (!normalizedQuery) return true
    return (
      option.label.toLocaleLowerCase().includes(normalizedQuery) ||
      option.value.toLocaleLowerCase().includes(normalizedQuery)
    )
  })

  const triggerLabel = isMixed
    ? t('mindmap.topicStyle.mixed')
    : selectedOption
      ? optionLabelKey
        ? optionLabelKey(selectedOption.value)
        : selectedOption.label
      : displayLabel ?? ''

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

  const select = (next: string): void => {
    if (next !== value || isMixed) onChange(next)
    closeAndRestoreFocus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndRestoreFocus()
      return
    }
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-icon-option]') ?? [])]
    if (buttons.length === 0) return
    event.preventDefault()
    const activeIndex = buttons.indexOf(document.activeElement as HTMLElement)
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const startingIndex = activeIndex === -1 ? (direction > 0 ? -1 : 0) : activeIndex
    buttons[(startingIndex + direction + buttons.length) % buttons.length]?.focus()
  }

  const renderOptionButton = (option: IconPickerOption) => {
    const selected = !isMixed && option.value === value
    return (
      <button
        key={option.value}
        type="button"
        data-icon-option
        role="option"
        aria-selected={selected}
        title={option.label}
        aria-label={option.label}
        aria-description={selected ? (selectedDescription ?? undefined) : undefined}
        className={`mindmap-icon-picker__option${selected ? ' is-active' : ''}`}
        onClick={() => select(option.value)}
      >
        {option.icon}
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className="mindmap-icon-picker"
      onKeyDown={onKeyDown}
    >
      <span className="mindmap-icon-picker__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-icon-picker__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="mindmap-icon-picker-options"
        aria-label={buildTriggerName ? buildTriggerName(triggerLabel) : label}
        aria-description={triggerDescription}
        disabled={disabled}
        onClick={() => {
          setQuery('')
          setOpen((previous) => !previous)
        }}
      >
        {!isMixed && selectedOption ? (
          <span className="mindmap-icon-picker__trigger-icon">{selectedOption.icon}</span>
        ) : null}
        <span className="mindmap-icon-picker__trigger-value">{triggerLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id="mindmap-icon-picker-options"
          className="mindmap-icon-picker__popover"
          style={columns <= 2 ? { width: 168 } : undefined}
          role="dialog"
          aria-label={dialogLabel}
        >
          {searchable ? (
            <label className="mindmap-icon-picker__search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={t('mindmap.topicStyle.shapeSearchPlaceholder')}
                aria-label={searchAriaLabel ?? t('mindmap.topicStyle.shapeSearch')}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          ) : null}

          {showClear ? (
            <button
              type="button"
              className="mindmap-icon-picker__clear"
              onClick={() => {
                onClear?.()
                closeAndRestoreFocus()
              }}
            >
              {clearLabel ?? t('mindmap.topicStyle.clearField')}
            </button>
          ) : null}

          {matchingOptions.length === 0 ? (
            <p className="mindmap-icon-picker__empty" role="status">
              {t('mindmap.topicStyle.shapeNoResults')}
            </p>
          ) : categories && categories.length > 0 ? (
            <div className="mindmap-icon-picker__options" role="listbox" aria-label={dialogLabel}>
              {categories.map((category) => {
                const categoryOptions = matchingOptions.filter(
                  (option) => option.category === category.key
                )
                if (categoryOptions.length === 0) return null
                return (
                  <div key={category.key} className="mindmap-icon-picker__category">
                    <span className="mindmap-icon-picker__category-label">{category.label}</span>
                    <div className="mindmap-icon-picker__grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                      {categoryOptions.map(renderOptionButton)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div
              className="mindmap-icon-picker__options mindmap-icon-picker__options--flat"
              role="listbox"
              aria-label={dialogLabel}
            >
              <div className="mindmap-icon-picker__grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {matchingOptions.map(renderOptionButton)}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
