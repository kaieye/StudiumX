import { ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InspectorValue } from './mind-map-inspector-values'

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
    : selectedOption?.label ?? String(concreteValue ?? '')

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

/** Color picker variant that keeps the preset palette and native picker in a glass menu. */
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

  return (
    <MindMapTopicStyleMenu
      id={id}
      label={label}
      value={value}
      displayValue={displayValue}
      options={colors.map((color) => ({ value: color, label: color, ariaLabel: color }))}
      onChange={onChange}
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
        <label className="mindmap-topic-style-menu__custom-color">
          <span>{t('mindmap.topicStyle.customColor')}</span>
          <input
            type="color"
            value={concrete ?? fallback}
            aria-label={t('mindmap.topicStyle.customColor')}
            onChange={(event) => {
              onChange(event.currentTarget.value)
              close()
            }}
          />
        </label>
      )}
    />
  )
}
