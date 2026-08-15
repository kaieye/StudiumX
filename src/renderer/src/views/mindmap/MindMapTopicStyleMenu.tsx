import { ChevronDown, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
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

/**
 * Topic color picker styled to match the canvas background-color control: a
 * compact rounded swatch opens a portaled popover with a preset palette,
 * native color well, opacity slider and recent colors. Topic-specific state
 * (inherited / mixed values and clearing the local override) is preserved
 * alongside the canvas-style layout.
 */
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
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const nativeColorDraftRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentTopicColors)
  const [hexDraft, setHexDraft] = useState(hexColorWellValue(fallback))
  // The popover is portaled to `document.body` and fixed-positioned so it can
  // overlay the mind-map canvas instead of being clipped by the inspector's
  // scroll container (`mindmap-inspector-tab-content` has `overflow-y: auto`).
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null)

  const display = displayValue ?? value
  const concrete = display.state === 'concrete' ? display.value : undefined
  const mixed = display.state === 'mixed'
  const valueLabel = mixed
    ? t('mindmap.topicStyle.mixed')
    : concrete ?? t('mindmap.topicStyle.inherit')

  const positionPopover = useCallback((): void => {
    const popover = popoverRef.current
    const trigger = triggerRef.current
    if (!popover || !trigger) return
    // Measure the rendered popover so viewport clamping uses its true size.
    const { width, height } = popover.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const viewportPadding = 8
    const gap = 6
    // Align the popover's right edge with the swatch's right edge.
    let left = triggerRect.right - width
    let top = triggerRect.bottom + gap
    // Prefer opening downward; flip above the trigger on overflow.
    if (top + height > window.innerHeight - viewportPadding) {
      top = triggerRect.top - height - gap
    }
    top = Math.max(viewportPadding, top)
    left = Math.min(
      Math.max(left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    )
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      right: 'auto',
      zIndex: 1000
    })
  }, [])

  // Position the portaled popover and keep it glued to the swatch while open.
  useLayoutEffect(() => {
    if (!open) return
    positionPopover()
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      positionPopover()
    }
    window.addEventListener('resize', positionPopover)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, positionPopover])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Reload the recent list from storage each time the popover opens. A reorder
  // persisted for the next session (recent-swatch switch) should only take
  // effect on the next open, never reshuffling the list while it is open.
  useEffect(() => {
    if (open) setRecentColors(loadRecentTopicColors())
  }, [open])

  // Keep the hex editor in sync with the committed color (preset / native well
  // / recent swatch). Typing in the hex field drives `hexDraft` locally, so it
  // is only reset here on external color changes.
  useEffect(() => {
    setHexDraft(hexColorWellValue(concrete ?? fallback))
  }, [concrete, fallback])

  const recordRecent = (color: string): void => {
    setRecentColors((previous) => {
      const next = recordRecentTopicColor(previous, color)
      if (next.length === previous.length && next.every((candidate, index) => candidate === previous[index])) {
        return previous
      }
      persistRecentTopicColors(next)
      return next
    })
  }

  /** Apply a concrete color choice (e.g. a preset) and record it, keeping the
   * popover open so the learner can keep refining. */
  const commitColor = (color: string): void => {
    onChange(color)
    recordRecent(color)
  }

  /** Live-preview a refinement (opacity) without recording recent colors. */
  const applyColor = (color: string): void => {
    onChange(color)
  }

  const previewNativeColor = (color: string): void => {
    const normalized = color.toUpperCase()
    nativeColorDraftRef.current = normalized
    onChange(normalized)
  }

  const commitNativeColor = (color: string): void => {
    const normalized = color.toUpperCase()
    const pending = nativeColorDraftRef.current
    nativeColorDraftRef.current = null
    if (pending || normalized !== hexColorWellValue(concrete ?? fallback).toUpperCase()) {
      recordRecent(pending ?? normalized)
    }
  }

  /** Commit a finished opacity adjustment as a new recent color. */
  const commitAlpha = (): void => {
    recordRecent(concrete ?? fallback)
  }

  /** Apply a typed hex value, or revert the field to the effective color. */
  const commitHexDraft = (): void => {
    if (HEX_COLOR_PATTERN.test(hexDraft)) {
      const normalized = hexDraft.toUpperCase()
      setHexDraft(normalized)
      commitColor(normalized)
      return
    }
    setHexDraft(hexColorWellValue(concrete ?? fallback))
  }

  /** Apply an existing recent swatch without reshuffling the visible list. */
  const selectRecent = (color: string): void => {
    onChange(color)
    persistRecentTopicColors(recordRecentTopicColor(recentColors, color))
  }

  const clearRecentColors = (): void => {
    setRecentColors([])
    clearRecentTopicColors()
  }

  const alpha = colorAlphaPercent(concrete ?? fallback)
  const selectedPreset = mixed ? null : hexColorWellValue(concrete ?? fallback).toUpperCase()
  const swatchStyle: CSSProperties = mixed
    ? {
        backgroundImage: 'repeating-linear-gradient(135deg, var(--surface-muted) 0 3px, var(--line-muted) 3px 6px)'
      }
    : { background: concrete ?? fallback }

  return (
    <div ref={rootRef} className="mindmap-topic-color">
      <span className="mm-row__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-topic-color__swatch"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label} ${valueLabel}`}
        aria-description={fieldStateDescription(value.state, {
          inherited: t('mindmap.topicStyle.stateInherited'),
          none: t('mindmap.topicStyle.stateNone'),
          mixed: t('mindmap.topicStyle.mixed')
        })}
        style={swatchStyle}
        onClick={() => setOpen((previous) => !previous)}
      />
      {open ? createPortal((
        <div
          ref={popoverRef}
          className="mindmap-theme-bg-picker__popover"
          style={popoverStyle ?? undefined}
          role="dialog"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              triggerRef.current?.focus()
            }
          }}
        >
          <div
            className="mindmap-theme-bg-picker__presets"
            role="group"
            aria-label={t('mindmap.themePanel.presetColors')}
          >
            {presets.map((color) => {
              const selected = selectedPreset !== null && selectedPreset === color.toUpperCase()
              return (
                <button
                  key={color}
                  type="button"
                  className={selected ? 'is-selected' : undefined}
                  aria-label={`${t('mindmap.themePanel.presetColor')} ${color}`}
                  aria-pressed={selected}
                  title={color}
                  style={{ background: color }}
                  onClick={() => commitColor(color)}
                />
              )
            })}
          </div>
          <div className="mindmap-theme-bg-picker__controls">
            <div className="mindmap-theme-bg-picker__row">
              <label className="mm-row__label" htmlFor={`${id}-native`}>
                {t('mindmap.topicStyle.customColor')}
              </label>
              <span className="mindmap-theme-bg-picker__row-controls">
                <input
                  id={`${id}-native`}
                  type="color"
                  aria-label={t('mindmap.topicStyle.customColor')}
                  value={hexColorWellValue(concrete ?? fallback)}
                  onChange={(event) => previewNativeColor(event.currentTarget.value)}
                  onBlur={(event) => commitNativeColor(event.currentTarget.value)}
                />
                <input
                  className="mindmap-theme-color-editor__hex"
                  aria-label={t('mindmap.topicStyle.customColorHex')}
                  value={hexDraft}
                  spellCheck={false}
                  onChange={(event) => setHexDraft(event.currentTarget.value)}
                  onBlur={commitHexDraft}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitHexDraft()
                    event.currentTarget.blur()
                  }}
                />
              </span>
            </div>
            <div className="mindmap-theme-bg-picker__alpha">
              <label className="mindmap-theme-bg-picker__alpha-label" htmlFor={`${id}-alpha`}>
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
                  style={{
                    background: `linear-gradient(to right, var(--accent, #438eff) 0 ${alpha}%, color-mix(in srgb, var(--text) 14%, transparent) ${alpha}% 100%)`
                  }}
                  onChange={(event) => {
                    const next = colorWithAlpha(concrete ?? fallback, Number(event.currentTarget.value))
                    if (next) applyColor(next)
                  }}
                  onPointerUp={commitAlpha}
                  onBlur={commitAlpha}
                />
                <label
                  className="mindmap-theme-alpha-row__value"
                  aria-label={t('mindmap.themePanel.alphaInputLabel')}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    aria-label={t('mindmap.themePanel.alphaInputLabel')}
                    value={alpha}
                    onChange={(event) => {
                      if (!Number.isNaN(event.currentTarget.valueAsNumber)) {
                        const next = colorWithAlpha(concrete ?? fallback, event.currentTarget.valueAsNumber)
                        if (next) applyColor(next)
                      }
                    }}
                    onBlur={commitAlpha}
                  />
                  <span aria-hidden="true">%</span>
                </label>
              </span>
            </div>
          </div>
          <div className="mindmap-theme-bg-picker__recent">
            <div className="mindmap-theme-bg-picker__recent-head">
              <span>{t('mindmap.themePanel.recentColors')}</span>
              {recentColors.length > 0 ? (
                <button
                  type="button"
                  className="mindmap-theme-bg-picker__recent-clear"
                  aria-label={t('mindmap.themePanel.clearRecent')}
                  title={t('mindmap.themePanel.clearRecent')}
                  onClick={clearRecentColors}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {recentColors.length > 0 ? (
              <div
                className="mindmap-theme-bg-picker__recent-colors"
                role="group"
                aria-label={t('mindmap.themePanel.recentColors')}
              >
                {recentColors.map((color) => {
                  const selected = concrete !== undefined && concrete.toUpperCase() === color
                  return (
                    <button
                      key={color}
                      type="button"
                      className={selected ? 'is-selected' : undefined}
                      aria-label={interpolateRecentColorLabel(
                        t('mindmap.themePanel.recentColor', { color }),
                        color
                      )}
                      aria-pressed={selected}
                      title={color}
                      style={{ background: color }}
                      onClick={() => selectRecent(color)}
                    />
                  )
                })}
              </div>
            ) : (
              <span className="mindmap-theme-bg-picker__recent-empty">
                {t('mindmap.themePanel.noRecentColors')}
              </span>
            )}
          </div>
        </div>
      ), document.body) : null}
    </div>
  )
}
