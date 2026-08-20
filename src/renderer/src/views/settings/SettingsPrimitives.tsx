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
  children
}: {
  title: string
  // Kept in the public shape for callers and translations that still provide
  // the legacy copy. Settings pages intentionally render title-only headers.
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <h2>{title}</h2>
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
  ariaLabel,
  onChange
}: {
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  ariaLabel?: string
  onChange: (value: string) => void
}) {
  return (
    <GlassTextField
      aria-label={ariaLabel}
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
  ariaLabel,
  position = 'item-aligned'
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
  ariaLabel?: string
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
        aria-label={ariaLabel}
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

type SettingsComboBoxMenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

const SETTINGS_COMBOBOX_MENU_MAX_HEIGHT = 280
const SETTINGS_COMBOBOX_MENU_GAP = 8
const SETTINGS_COMBOBOX_VIEWPORT_PADDING = 8
const SETTINGS_COMBOBOX_OPTION_HEIGHT = 40
const SETTINGS_COMBOBOX_MENU_CHROME = 18

export function SettingsComboBox({
  value,
  options,
  placeholder,
  ariaLabel,
  onInput,
  onSelect
}: {
  value: string
  options: string[]
  placeholder?: string
  ariaLabel?: string
  onInput: (value: string) => void
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [menuPosition, setMenuPosition] = useState<SettingsComboBoxMenuPosition | null>(null)
  // Draft text remains authoritative until the settings round-trip acknowledges
  // the exact value typed or selected by the learner. This prevents a slower,
  // earlier IPC response from reverting a later free-form model entry.
  const [draft, setDraft] = useState(value)
  const [awaitingCommit, setAwaitingCommit] = useState(false)
  // Live filter as the user types. Kept separate from `value` so opening the
  // dropdown always shows the full model list — the committed value must not
  // hide the other models (e.g. opening with 'glm-5.1' must not filter out
  // 'glm-5.2').
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listId = useId()

  const normalizedQuery = query.trim().toLowerCase()
  const matchingOptions = normalizedQuery
    ? options.filter((option) => option.toLowerCase().includes(normalizedQuery))
    : options
  const visibleOptions = matchingOptions.length > 0 ? matchingOptions : options

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlightedIndex(0)
    }
  }, [open])

  useEffect(() => {
    if (value === draft) {
      if (awaitingCommit) setAwaitingCommit(false)
      return
    }
    if (!awaitingCommit) setDraft(value)
  }, [awaitingCommit, draft, value])

  useEffect(() => {
    setHighlightedIndex((current) => Math.min(current, Math.max(0, visibleOptions.length - 1)))
  }, [visibleOptions.length])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }

    const updateMenuPosition = (): void => {
      const trigger = rootRef.current?.querySelector<HTMLInputElement>('.settings-combobox-input')
      if (!trigger) return

      const triggerRect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const estimatedMenuHeight = Math.min(
        SETTINGS_COMBOBOX_MENU_MAX_HEIGHT,
        visibleOptions.length * SETTINGS_COMBOBOX_OPTION_HEIGHT + SETTINGS_COMBOBOX_MENU_CHROME
      )
      const availableBelow = Math.max(
        0,
        viewportHeight - triggerRect.bottom - SETTINGS_COMBOBOX_MENU_GAP - SETTINGS_COMBOBOX_VIEWPORT_PADDING
      )
      const availableAbove = Math.max(
        0,
        triggerRect.top - SETTINGS_COMBOBOX_MENU_GAP - SETTINGS_COMBOBOX_VIEWPORT_PADDING
      )
      const opensAbove = availableBelow < estimatedMenuHeight && availableAbove > availableBelow
      const availableSpace = opensAbove ? availableAbove : availableBelow
      const maxHeight = Math.max(
        SETTINGS_COMBOBOX_OPTION_HEIGHT,
        Math.min(SETTINGS_COMBOBOX_MENU_MAX_HEIGHT, availableSpace)
      )
      const menuWidth = Math.min(
        triggerRect.width,
        Math.max(0, viewportWidth - SETTINGS_COMBOBOX_VIEWPORT_PADDING * 2)
      )
      const maxTop = Math.max(
        SETTINGS_COMBOBOX_VIEWPORT_PADDING,
        viewportHeight - maxHeight - SETTINGS_COMBOBOX_VIEWPORT_PADDING
      )
      const desiredTop = opensAbove
        ? triggerRect.top - SETTINGS_COMBOBOX_MENU_GAP - maxHeight
        : triggerRect.bottom + SETTINGS_COMBOBOX_MENU_GAP
      const maxLeft = Math.max(
        SETTINGS_COMBOBOX_VIEWPORT_PADDING,
        viewportWidth - menuWidth - SETTINGS_COMBOBOX_VIEWPORT_PADDING
      )

      setMenuPosition({
        top: Math.min(Math.max(desiredTop, SETTINGS_COMBOBOX_VIEWPORT_PADDING), maxTop),
        left: Math.min(Math.max(triggerRect.left, SETTINGS_COMBOBOX_VIEWPORT_PADDING), maxLeft),
        width: menuWidth,
        maxHeight
      })
    }

    const handleDocumentScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      updateMenuPosition()
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    document.addEventListener('scroll', handleDocumentScroll, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      document.removeEventListener('scroll', handleDocumentScroll, true)
    }
  }, [open, visibleOptions.length])

  useLayoutEffect(() => {
    if (open) optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  const selectOption = (option: string): void => {
    onSelect(option)
    setDraft(option)
    setAwaitingCommit(true)
    setQuery('')
    setOpen(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightedIndex((current) => (current + direction + visibleOptions.length) % visibleOptions.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open) {
        const option = visibleOptions[highlightedIndex]
        // If the typed query still matches a visible option, select it normally.
        // Otherwise commit the free-form typed value (already saved via onInput).
        if (option && (!normalizedQuery || option.toLowerCase().includes(normalizedQuery))) {
          selectOption(option)
        } else {
          setOpen(false)
        }
      } else {
        setOpen(true)
      }
    }
  }

  return (
    <div className={`settings-combobox ${open ? 'is-open' : ''}`} ref={rootRef}>
      <GlassTextField
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="settings-input settings-combobox-input"
        placeholder={placeholder}
        role="combobox"
        value={draft}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setDraft(event.target.value)
          setAwaitingCommit(true)
          setQuery(event.target.value)
          onInput(event.target.value)
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="settings-combobox-toggle"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown className="settings-combobox-toggle-icon" size={15} />
      </button>

      {open &&
        menuPosition &&
        visibleOptions.length > 0 &&
        (() => {
          const menu = (
            <div
              aria-activedescendant={`${listId}-${highlightedIndex}`}
              className="settings-combobox-menu is-portal"
              id={listId}
              ref={menuRef}
              role="listbox"
              style={menuPosition}
            >
              {visibleOptions.map((option, index) => {
                const selected = option === value
                const highlighted = index === highlightedIndex
                return (
                  <button
                    aria-selected={selected}
                    className={`settings-select-option ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                    id={`${listId}-${index}`}
                    key={option}
                    ref={(element) => {
                      optionRefs.current[index] = element
                    }}
                    role="option"
                    type="button"
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    <span className="settings-select-option-copy">
                      <span>{option}</span>
                    </span>
                    {selected && <Check className="settings-select-check" size={16} />}
                  </button>
                )
              })}
            </div>
          )
          return createPortal(menu, document.body)
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
