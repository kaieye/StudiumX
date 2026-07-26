import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import type { HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  GlassCard,
  GlassSegmentedControl,
  GlassSwitch,
  GlassTextField
} from '../../ui/liquid-glass'

export function SettingsPanel({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="settings-panel-body">{children}</div>
    </div>
  )
}

export function SettingsCard({
  children,
  className = '',
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <GlassCard {...props} className={`settings-card ${className}`.trim()} tone="default">
      {children}
    </GlassCard>
  )
}

export function SettingsRow({
  label,
  detail,
  children
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export function ToggleSwitch({
  checked,
  disabled = false,
  ariaLabel,
  onChange
}: {
  checked: boolean
  disabled?: boolean
  ariaLabel?: string
  onChange: (checked: boolean) => void
}) {
  return (
    <GlassSwitch
      className="toggle-switch"
      checked={checked}
      disabled={disabled}
      ariaLabel={ariaLabel}
      onChange={onChange}
    />
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
}) {
  return (
    <GlassSegmentedControl
      className="segmented-control"
      value={value}
      onChange={onChange}
      options={options.map((option) => {
        const Icon = option.icon
        return {
          value: option.value,
          label: option.label,
          icon: Icon ? <Icon size={14} /> : undefined
        }
      })}
    />
  )
}

export function SettingsTextInput({
  value,
  placeholder,
  type = 'text',
  onChange
}: {
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  onChange: (value: string) => void
}) {
  return (
    <GlassTextField
      className="settings-input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  position = 'item-aligned'
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
  position?: 'below' | 'item-aligned'
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)))
  const [itemAlignedMenuPosition, setItemAlignedMenuPosition] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listId = useId()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selectedOption = options[selectedIndex] ?? options[0]
  const SelectedIcon = selectedOption?.icon

  useEffect(() => {
    setHighlightedIndex(Math.max(0, options.findIndex((option) => option.value === value)))
  }, [options, value])

  useLayoutEffect(() => {
    if (!open || position !== 'item-aligned') return

    const menuBorder = 1
    const menuPadding = 4
    const optionHeight = 28
    const maxVisibleOptions = 5
    const viewportPadding = 8
    const visibleOptionCount = Math.min(options.length, maxVisibleOptions)
    const visibleOptionsHeight = visibleOptionCount * optionHeight
    const totalOptionsHeight = options.length * optionHeight
    const maxScrollTop = Math.max(0, totalOptionsHeight - visibleOptionsHeight)
    const centeredScrollTop = Math.min(
      Math.max(0, selectedIndex * optionHeight - (visibleOptionsHeight - optionHeight) / 2),
      maxScrollTop
    )
    const menuHeight = menuBorder * 2 + menuPadding * 2 + visibleOptionsHeight

    const updateItemAlignedMenuPosition = (): void => {
      const trigger = triggerRef.current
      if (!trigger) return

      const triggerRect = trigger.getBoundingClientRect()
      // These dimensions mirror ZCode's `Select` primitive: a 32px trigger,
      // a 4px menu inset, and 28px items. Centering the selected item over the
      // trigger makes the open menu read as one continuous list.
      const selectedItemOffset = selectedIndex * optionHeight - centeredScrollTop
      // Keep the portal menu exactly as wide as its trigger. This preserves the
      // closed field's left and right edges while leaving room for the selected
      // item checkmark at the far right.
      const menuWidth = triggerRect.width
      const desiredTop =
        triggerRect.top +
        triggerRect.height / 2 -
        menuBorder -
        menuPadding -
        selectedItemOffset -
        optionHeight / 2
      const desiredLeft = triggerRect.left
      const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding)
      const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)

      menuRef.current?.scrollTo({ top: centeredScrollTop })
      setItemAlignedMenuPosition({
        top: Math.min(Math.max(desiredTop, viewportPadding), maxTop),
        left: Math.min(Math.max(desiredLeft, viewportPadding), maxLeft),
        width: menuWidth
      })
    }

    const handleDocumentScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      updateItemAlignedMenuPosition()
    }

    updateItemAlignedMenuPosition()
    window.addEventListener('resize', updateItemAlignedMenuPosition)
    document.addEventListener('scroll', handleDocumentScroll, true)
    return () => {
      window.removeEventListener('resize', updateItemAlignedMenuPosition)
      document.removeEventListener('scroll', handleDocumentScroll, true)
    }
  }, [open, options.length, position, selectedIndex])

  useLayoutEffect(() => {
    if (!open || position !== 'item-aligned') return
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open, position])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const toggleOpen = (): void => {
    if (!options.length) return
    setOpen((current) => !current)
  }

  const selectOption = (nextValue: T): void => {
    onChange(nextValue)
    setOpen(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!options.length) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        const option = options[highlightedIndex] ?? selectedOption
        if (option) selectOption(option.value)
        return
      }
      setOpen(true)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightedIndex((current) => {
        const baseIndex = current < 0 ? Math.max(0, options.findIndex((option) => option.value === value)) : current
        return (baseIndex + direction + options.length) % options.length
      })
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(Math.max(0, options.length - 1))
    }
  }

  return (
    <div className={`settings-select ${position === 'item-aligned' ? 'settings-select--item-aligned' : ''} ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        className="settings-select-trigger"
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
      >
        <span className="settings-select-trigger-copy">
          {SelectedIcon && <SelectedIcon className="settings-select-option-icon" size={15} />}
          <span className="settings-select-trigger-value">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown className="settings-select-trigger-icon" size={15} />
      </button>

      {open &&
        (() => {
          const menu = (
            <div
              aria-activedescendant={`${listId}-${highlightedIndex}`}
              className={`settings-select-menu ${position === 'item-aligned' ? 'is-item-aligned' : ''}`}
              id={listId}
              ref={menuRef}
              role="listbox"
              style={position === 'item-aligned' && itemAlignedMenuPosition ? itemAlignedMenuPosition : undefined}
            >
              {options.map((option, index) => {
                const selected = option.value === value
                const highlighted = index === highlightedIndex
                const Icon = option.icon
                return (
                  <button
                    aria-selected={selected}
                    className={`settings-select-option ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                    id={`${listId}-${index}`}
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element
                    }}
                    role="option"
                    type="button"
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectOption(option.value)}
                  >
                    <span className="settings-select-option-copy">
                      {Icon && <Icon className="settings-select-option-icon" size={15} />}
                      <span>{option.label}</span>
                    </span>
                    {selected && <Check className="settings-select-check" size={16} />}
                  </button>
                )
              })}
            </div>
          )

          return position === 'item-aligned' ? createPortal(menu, document.body) : menu
        })()}
    </div>
  )
}

export function NumberInput({
  value,
  min,
  max,
  step,
  onChange
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  return (
    <input
      className="settings-number"
      max={max}
      min={min}
      step={step}
      type="number"
      value={draft}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        if (next.trim() === '') return
        const parsed = Number(next)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
      onBlur={() => {
        if (draft.trim() === '') setDraft(String(value))
      }}
    />
  )
}
