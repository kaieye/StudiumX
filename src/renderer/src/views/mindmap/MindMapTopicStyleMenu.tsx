import { ChevronDown, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InspectorValue } from './mind-map-inspector-values'
import {
  fieldStateDescription,
  selectedOptionDescription
} from './mind-map-keyboard-navigation'

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RECENT_TOPIC_COLORS_KEY = 'mindmap.recentTopicColors'
const MAX_RECENT_TOPIC_COLORS = 8

/**
 * The locale catalogs declare the recent-color label with a single-brace
 * placeholder (`Recent color {color}`), while i18next only interpolates
 * `{{...}}` by default. Resolve the value regardless of catalog shape.
 */
function interpolateRecentColorLabel(label: string, color: string): string {
  return label.replace('{color}', color)
}

function expandHexDigits(digits: string): string {
  return digits.length === 3
    ? digits.split('').map((part) => `${part}${part}`).join('')
    : digits
}

/** The native color well needs an opaque 6-digit value; strip any alpha. */
function hexColorWellValue(color: string): string {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return '#000000'
  return `#${expandHexDigits(match[1]!).slice(0, 6).toLowerCase()}`
}

/** Current alpha of a hex color as a percentage; defaults to 100%. */
function colorAlphaPercent(color: string): number {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return 100
  const digits = expandHexDigits(match[1]!)
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return Math.round(alpha * 100)
}

/** Rewrite a hex color as 8-digit #RRGGBBAA with the given percentage alpha. */
function colorWithAlpha(color: string, percent: number): string | null {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return null
  const digits = expandHexDigits(match[1]!).slice(0, 6).toUpperCase()
  const alpha = Math.max(0, Math.min(255, Math.round((percent / 100) * 255)))
  return `#${digits}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

function recordRecentTopicColor(colors: readonly string[], color: string): string[] {
  const normalized = color.toUpperCase()
  return [
    normalized,
    ...colors.filter((candidate) => candidate.toUpperCase() !== normalized)
  ].slice(0, MAX_RECENT_TOPIC_COLORS)
}

function loadRecentTopicColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_TOPIC_COLORS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const colors = parsed
      .filter((value): value is string => typeof value === 'string' && HEX_COLOR_PATTERN.test(value))
      .map((color) => color.toUpperCase())
    return [...new Set(colors)].slice(0, MAX_RECENT_TOPIC_COLORS)
  } catch {
    // localStorage may be unavailable or hold malformed data; start empty.
    return []
  }
}

function persistRecentTopicColors(colors: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_TOPIC_COLORS_KEY, JSON.stringify(colors))
  } catch {
    // localStorage may be unavailable; the in-memory list still works.
  }
}

function clearRecentTopicColors(): void {
  try {
    localStorage.removeItem(RECENT_TOPIC_COLORS_KEY)
  } catch {
    // localStorage may be unavailable; the in-memory list is already cleared.
  }
}

export type MindMapTopicStyleMenuOption<T extends string | number> = {
  value: T
  label: string
  ariaLabel?: string
  preview?: ReactNode
}

type MenuFooterProps = {
  close: () => void
}

type MindMapTopicStyleMenuProps<T extends string | number> = {
  id: string
  label: string
  /** Persisted topic-local value; used to decide whether reset is available. */
  value: InspectorValue<T>
  /** Concrete canvas value shown by the control. */
  displayValue?: InspectorValue<T>
  options: readonly MindMapTopicStyleMenuOption<T>[]
  onChange: (value: T | undefined) => void
  disabled?: boolean
  className?: string
  optionsClassName?: string
  optionClassName?: string
  renderPreview?: (value: T | undefined, state: InspectorValue<T>) => ReactNode
  renderOption?: (option: MindMapTopicStyleMenuOption<T>, selected: boolean) => ReactNode
  footer?: (props: MenuFooterProps) => ReactNode
}

/**
 * Compact topic-style picker whose choices remain out of the inspector until
 * requested. It owns only popover behavior; style mutations stay with the
 * inspector's command path.
 */
export function MindMapTopicStyleMenu<T extends string | number>({
  id,
  label,
  value,
  displayValue,
  options,
  onChange,
  disabled = false,
  className,
  optionsClassName,
  optionClassName,
  renderPreview,
  renderOption,
  footer
}: MindMapTopicStyleMenuProps<T>) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'above' | 'below'>('below')
  const [popoverMaxHeight, setPopoverMaxHeight] = useState<number | null>(null)

  const display = displayValue ?? value
  const hasLocalOverride = value.state !== 'inherited' && value.state !== 'default'
  const concreteValue = display.state === 'concrete' ? display.value : undefined
  const selectedOption = options.find((option) => Object.is(option.value, concreteValue))
  const valueLabel = display.state === 'mixed'
    ? t('mindmap.topicStyle.mixed')
    : selectedOption?.label ?? (display.state === 'none'
        ? t('mindmap.topicStyle.shapeNone')
        : String(concreteValue ?? ''))

  useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    const popover = root?.querySelector<HTMLElement>('.mindmap-topic-style-menu__popover')
    const scrollSurface = root?.closest<HTMLElement>('.mindmap-inspector-tab-content')
    if (!root || !popover || !scrollSurface) return

    const updatePlacement = (): void => {
      const rootRect = root.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      const surfaceRect = scrollSurface.getBoundingClientRect()
      const availableBelow = Math.max(0, surfaceRect.bottom - rootRect.bottom - 5)
      const availableAbove = Math.max(0, rootRect.top - surfaceRect.top - 5)
      const nextPlacement = popoverRect.height > availableBelow && availableAbove > availableBelow
        ? 'above'
        : 'below'
      const availableHeight = nextPlacement === 'above' ? availableAbove : availableBelow

      setPlacement((current) => current === nextPlacement ? current : nextPlacement)
      setPopoverMaxHeight((current) => current === availableHeight ? current : availableHeight)
    }

    updatePlacement()
    scrollSurface.addEventListener('scroll', updatePlacement, { passive: true })
    window.addEventListener('resize', updatePlacement)
    return () => {
      scrollSurface.removeEventListener('scroll', updatePlacement)
      window.removeEventListener('resize', updatePlacement)
    }
  }, [open])

  const closeAndRestoreFocus = (): void => {
    setOpen(false)
    setPlacement('below')
    setPopoverMaxHeight(null)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const selected = rootRef.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]:not(:disabled)'
    )
    const first = rootRef.current?.querySelector<HTMLElement>('[role="option"]:not(:disabled)')
    ;(selected ?? first)?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) closeAndRestoreFocus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const selectValue = (next: T | undefined): void => {
    if (next === undefined) {
      if (hasLocalOverride) onChange(undefined)
    } else if (display.state === 'mixed' || !Object.is(next, concreteValue)) {
      onChange(next)
    }
    closeAndRestoreFocus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndRestoreFocus()
      return
    }
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return
    if ((event.target as HTMLElement).matches('input, textarea, select')) return

    const menuOptions = [...(rootRef.current?.querySelectorAll<HTMLElement>(
      '[role="option"]:not(:disabled)'
    ) ?? [])]
    if (menuOptions.length === 0) return
    event.preventDefault()
    const activeIndex = menuOptions.indexOf(document.activeElement as HTMLElement)
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const startingIndex = activeIndex === -1 ? (direction > 0 ? -1 : 0) : activeIndex
    menuOptions[(startingIndex + direction + menuOptions.length) % menuOptions.length]?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={`mindmap-topic-style-menu${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
    >
      <span className="mm-row__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-topic-style-menu__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={`${id}-options`}
        aria-label={`${label} ${valueLabel}`}
        aria-description={fieldStateDescription(value.state, {
          inherited: t('mindmap.topicStyle.stateInherited'),
          none: t('mindmap.topicStyle.stateNone'),
          mixed: t('mindmap.topicStyle.mixed')
        })}
        onClick={() => {
          setPlacement('below')
          setPopoverMaxHeight(null)
          setOpen((previous) => !previous)
        }}
      >
        {renderPreview ? (
          <span className="mindmap-topic-style-menu__trigger-preview" aria-hidden="true">
            {renderPreview(concreteValue, display)}
          </span>
        ) : null}
        <span className="mindmap-topic-style-menu__value">{valueLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={`${id}-options`}
          className={`mindmap-topic-style-menu__popover${placement === 'above' ? ' is-above' : ''}`}
          role="dialog"
          aria-label={label}
          style={popoverMaxHeight === null ? undefined : { maxHeight: `${popoverMaxHeight}px` }}
        >
          <div
            className={`mindmap-topic-style-menu__options${optionsClassName ? ` ${optionsClassName}` : ''}`}
            role="listbox"
            aria-label={label}
          >
            {hasLocalOverride ? (
              <button
                type="button"
                className={`mindmap-topic-style-menu__option${optionClassName ? ` ${optionClassName}` : ''}`}
                onClick={() => selectValue(undefined)}
              >
                <span>{t('mindmap.topicStyle.clearField')}</span>
              </button>
            ) : null}
            {options.map((option) => {
              const selected = concreteValue !== undefined && Object.is(option.value, concreteValue)
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  className={`mindmap-topic-style-menu__option${optionClassName ? ` ${optionClassName}` : ''}${selected ? ' is-active' : ''}`}
                  aria-label={option.ariaLabel ?? option.label}
                  aria-selected={selected}
                  aria-description={selectedOptionDescription(selected, t('mindmap.topicStyle.selected'))}
                  onClick={() => selectValue(option.value)}
                >
                  {renderOption ? renderOption(option, selected) : (
                    <>
                      {option.preview ? <span className="mindmap-topic-style-menu__option-preview" aria-hidden="true">{option.preview}</span> : null}
                      <span>{option.label}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
          {footer ? footer({ close: closeAndRestoreFocus }) : null}
        </div>
      ) : null}
    </div>
  )
}

type MindMapTopicColorPickerProps = {
  id: string
  label: string
  value: InspectorValue<string>
  displayValue?: InspectorValue<string>
  presets: readonly string[]
  fallback: string
  disabled?: boolean
  onChange: (value: string | undefined) => void
}

/** Color picker variant that keeps the preset palette, native picker, alpha and recent colors in a glass menu. */
export function MindMapTopicColorPicker({
  id,
  label,
  value,
  displayValue,
  presets,
  fallback,
  disabled = false,
  onChange
}: MindMapTopicColorPickerProps) {
  const { t } = useTranslation()
  const display = displayValue ?? value
  const concrete = display.state === 'concrete' ? display.value : undefined
  const colors = concrete && !presets.includes(concrete) ? [...presets, concrete] : presets
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentTopicColors)

  const recordRecent = (color: string): void => {
    const next = recordRecentTopicColor(recentColors, color)
    setRecentColors(next)
    persistRecentTopicColors(next)
  }

  /** Apply a concrete color and remember it; clearing (`undefined`) only forwards. */
  const recordAndChange = (next: string | undefined): void => {
    if (next !== undefined) recordRecent(next)
    onChange(next)
  }

  const alpha = colorAlphaPercent(concrete ?? fallback)

  return (
    <MindMapTopicStyleMenu
      id={id}
      label={label}
      value={value}
      displayValue={displayValue}
      options={colors.map((color) => ({ value: color, label: color, ariaLabel: color }))}
      onChange={recordAndChange}
      disabled={disabled}
      className="mindmap-topic-style-menu--color"
      optionsClassName="mindmap-topic-style-menu__options--colors"
      optionClassName="mindmap-topic-style-menu__option--color"
      renderPreview={(selected, state) => (
        <span
          className={`mindmap-topic-style-menu__color-preview${state.state === 'mixed' ? ' is-mixed' : ''}`}
          style={{ background: selected ?? fallback } as CSSProperties}
        />
      )}
      renderOption={(option) => (
        <span
          className="mindmap-topic-style-menu__color-swatch"
          style={{ background: option.value } as CSSProperties}
          aria-hidden="true"
        />
      )}
      footer={({ close }) => (
        <>
          <label className="mindmap-topic-style-menu__custom-color">
            <span>{t('mindmap.topicStyle.customColor')}</span>
            <input
              type="color"
              value={hexColorWellValue(concrete ?? fallback)}
              aria-label={t('mindmap.topicStyle.customColor')}
              onChange={(event) => {
                recordAndChange(event.currentTarget.value)
                close()
              }}
            />
          </label>
          <div className="mm-row mindmap-theme-alpha-row">
            <label className="mm-row__label" htmlFor={`${id}-alpha`}>
              {t('mindmap.themePanel.alpha')}
            </label>
            <span className="mindmap-theme-alpha-row__control">
              <input
                id={`${id}-alpha`}
                type="range"
                min={0}
                max={100}
                step={5}
                aria-label={t('mindmap.themePanel.alphaLabel')}
                title={t('mindmap.themePanel.alphaLabel')}
                value={alpha}
                onChange={(event) => {
                  const next = colorWithAlpha(concrete ?? fallback, Number(event.currentTarget.value))
                  if (next) recordAndChange(next)
                }}
              />
              <output className="mindmap-theme-alpha-row__value" htmlFor={`${id}-alpha`}>
                {alpha}%
              </output>
            </span>
          </div>
          {recentColors.length > 0 ? (
            <div className="mindmap-theme-recent-row">
              <span className="mm-row__label">{t('mindmap.themePanel.recentColors')}</span>
              <div className="mindmap-theme-recent-row__controls">
                <div
                  className="mindmap-theme-presets"
                  role="group"
                  aria-label={t('mindmap.themePanel.recentColors')}
                >
                  {recentColors.map((color) => {
                    const selected = concrete !== undefined && concrete.toUpperCase() === color
                    return (
                      <button
                        key={color}
                        type="button"
                        className={selected ? 'is-selected' : ''}
                        aria-label={interpolateRecentColorLabel(
                          t('mindmap.themePanel.recentColor', { color }),
                          color
                        )}
                        aria-pressed={selected}
                        onClick={() => {
                          recordAndChange(color)
                          close()
                        }}
                        style={{ background: color }}
                      />
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="mindmap-theme-color-editor__clear"
                  title={t('mindmap.themePanel.clearRecent')}
                  aria-label={t('mindmap.themePanel.clearRecent')}
                  onClick={() => {
                    setRecentColors([])
                    clearRecentTopicColors()
                  }}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    />
  )
}
