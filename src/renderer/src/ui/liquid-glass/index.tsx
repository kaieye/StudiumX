/**
 * Liquid Glass UI primitives — Web port of liquid_glass_widgets
 * (https:// / Flutter package design language).
 *
 * These are CSS-based approximations suitable for Electron/Chromium.
 * Prefer composing these over ad-hoc solid cards when surfaces sit over
 * imagery or soft gradients.
 */
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes
} from 'react'

export type GlassTone = 'default' | 'strong' | 'soft' | 'flat'
export type GlassButtonVariant = 'default' | 'primary' | 'ghost'
export type GlassButtonSize = 'md' | 'sm'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function materialClass(tone: GlassTone = 'default'): string {
  if (tone === 'strong') return 'lg-material lg-material--strong'
  if (tone === 'soft') return 'lg-material lg-material--soft'
  if (tone === 'flat') return 'lg-material lg-material--flat'
  return 'lg-material'
}

export function GlassContainer({
  children,
  tone = 'default',
  className = '',
  padding,
  style,
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  padding?: CSSProperties['padding']
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cx(materialClass(tone), 'lg-container', className)}
      style={padding != null ? { ...style, padding } : style}
    >
      {children}
    </div>
  )
}

export function GlassCard({
  children,
  tone = 'default',
  className = '',
  body = false,
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  body?: boolean
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx(materialClass(tone), 'lg-card', className)}>
      {body ? <div className="lg-card__body">{children}</div> : children}
    </div>
  )
}

export function GlassGroupedSection({
  children,
  tone = 'default',
  className = '',
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx(materialClass(tone), 'lg-grouped-section', className)}>
      {children}
    </div>
  )
}

export function GlassListTile({
  leading,
  title,
  subtitle,
  trailing,
  className = '',
  onClick,
  ...props
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  className?: string
  onClick?: () => void
} & HTMLAttributes<HTMLDivElement>) {
  const interactive = Boolean(onClick)
  return (
    <div
      {...props}
      className={cx('lg-list-tile', className)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      {leading != null ? <div className="lg-list-tile__leading">{leading}</div> : <span />}
      <div className="lg-list-tile__copy">
        <strong>{title}</strong>
        {subtitle != null ? <span>{subtitle}</span> : null}
      </div>
      {trailing != null ? <div className="lg-list-tile__trailing">{trailing}</div> : null}
    </div>
  )
}

export function GlassDivider({ className = '', ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={cx('lg-divider', className)} />
}

export function GlassButton({
  children,
  variant = 'default',
  size = 'md',
  iconOnly = false,
  className = '',
  type = 'button',
  ...props
}: {
  children?: ReactNode
  variant?: GlassButtonVariant
  size?: GlassButtonSize
  iconOnly?: boolean
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const tone: GlassTone = variant === 'ghost' ? 'flat' : variant === 'primary' ? 'default' : 'soft'
  return (
    <button
      {...props}
      type={type}
      className={cx(
        variant === 'primary' || variant === 'ghost' ? '' : materialClass(tone),
        'lg-button',
        variant === 'primary' && 'lg-button--primary lg-material',
        variant === 'ghost' && 'lg-button--ghost',
        size === 'sm' && 'lg-button--sm',
        iconOnly && 'lg-button--icon',
        className
      )}
    >
      {children}
    </button>
  )
}

export function GlassIconButton({
  children,
  className = '',
  size = 'md',
  ...props
}: {
  children?: ReactNode
  size?: GlassButtonSize
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <GlassButton {...props} iconOnly size={size} className={className}>
      {children}
    </GlassButton>
  )
}

export function GlassButtonGroup({
  children,
  className = '',
  ...props
}: {
  children?: ReactNode
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx(materialClass('soft'), 'lg-button-group', className)}>
      {children}
    </div>
  )
}

export function GlassSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = ''
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cx(materialClass('soft'), 'lg-segmented', className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function GlassSwitch({
  checked,
  disabled = false,
  ariaLabel,
  onChange,
  className = ''
}: {
  checked: boolean
  disabled?: boolean
  ariaLabel?: string
  onChange: (checked: boolean) => void
  className?: string
}) {
  return (
    <button
      className={cx('lg-switch', className)}
      data-state={checked ? 'checked' : 'unchecked'}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function GlassChip({
  children,
  className = '',
  ...props
}: {
  children?: ReactNode
  className?: string
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={cx(materialClass('soft'), 'lg-chip', className)}>
      {children}
    </span>
  )
}

export function GlassBadge({
  children,
  className = '',
  ...props
}: {
  children?: ReactNode
  className?: string
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={cx('lg-badge', className)}>
      {children}
    </span>
  )
}

export function GlassTextField({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('lg-input', className)} />
}

export function GlassTextArea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('lg-textarea', className)} />
}

export function GlassSearchBar({
  value,
  onChange,
  placeholder,
  leading,
  trailing,
  className = '',
  inputProps
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder'>
}) {
  return (
    <div className={cx(materialClass('soft'), 'lg-search-bar', className)}>
      {leading}
      <input
        {...inputProps}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {trailing}
    </div>
  )
}

export function GlassAppBar({
  title,
  leading,
  actions,
  tone = 'soft',
  className = ''
}: {
  title?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  tone?: GlassTone
  className?: string
}) {
  return (
    <header className={cx(materialClass(tone), 'lg-app-bar', className)}>
      {leading}
      {title != null ? <div className="lg-app-bar__title">{title}</div> : <div className="lg-app-bar__title" />}
      {actions}
    </header>
  )
}

export function GlassToolbar({
  children,
  tone = 'soft',
  className = '',
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx(materialClass(tone), 'lg-toolbar', className)}>
      {children}
    </div>
  )
}

export function GlassTabBar({
  items,
  value,
  onChange,
  className = ''
}: {
  items: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <nav className={cx(materialClass('soft'), 'lg-tab-bar', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className={item.id === value ? 'is-active' : ''}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}

export function GlassBottomBar({
  children,
  tone = 'strong',
  className = '',
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <footer {...props} className={cx(materialClass(tone), 'lg-bottom-bar', className)}>
      {children}
    </footer>
  )
}

export function GlassBackdrop({
  children,
  className = '',
  onClick,
  ...props
}: {
  children?: ReactNode
  className?: string
  onClick?: () => void
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cx('lg-backdrop', className)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClick?.()
      }}
    >
      {children}
    </div>
  )
}

export function GlassDialog({
  children,
  tone = 'strong',
  className = '',
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} role="dialog" className={cx(materialClass(tone), 'lg-dialog', className)}>
      {children}
    </div>
  )
}

export function GlassSheet({
  children,
  tone = 'strong',
  className = '',
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} role="dialog" className={cx(materialClass(tone), 'lg-sheet', className)}>
      {children}
    </div>
  )
}

export function GlassToast({
  children,
  tone = 'strong',
  className = '',
  ...props
}: {
  children?: ReactNode
  tone?: GlassTone
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx(materialClass(tone), 'lg-toast', className)}>
      {children}
    </div>
  )
}

export function GlassProgress({
  value,
  className = '',
  ...props
}: {
  value: number
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      {...props}
      className={cx('lg-progress', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function GlassScaffold({
  children,
  className = '',
  ...props
}: {
  children?: ReactNode
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('lg-scaffold', className)}>
      {children}
    </div>
  )
}
