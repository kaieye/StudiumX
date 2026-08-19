import { ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InspectorValue } from './mind-map-inspector-values'
import {
  fieldStateDescription,
  selectedOptionDescription
} from './mind-map-keyboard-navigation'
import { MindMapColorPickerBody } from './mind-map-color-picker'

const RECENT_TOPIC_COLORS_KEY = 'mindmap.recentTopicColors'


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
  const [open, setOpen] = useState(false)
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
          <MindMapColorPickerBody
            color={concrete ?? fallback}
            presets={presets}
            nativeInputId={`${id}-native`}
            alphaInputId={`${id}-alpha`}
            recentStorageKey={RECENT_TOPIC_COLORS_KEY}
            alphaLabel={t('mindmap.themePanel.alphaLabel')}
            alphaInputLabel={t('mindmap.themePanel.alphaInputLabel')}
            nativeRowLabel={t('mindmap.topicStyle.customColor')}
            hexInputLabel={t('mindmap.topicStyle.customColorHex')}
            alphaStep={5}
            onColorChange={onChange}
          />
        </div>
      ), document.body) : null}
    </div>
  )
}
