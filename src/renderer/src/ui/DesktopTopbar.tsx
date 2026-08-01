import type { ReactNode } from 'react'

/** Shared topbar frame for Electron and Web surfaces. */
export function DesktopTopbar({
  leading,
  actions,
  className = '',
  leadingClassName = '',
  actionsClassName = ''
}: {
  leading?: ReactNode
  actions?: ReactNode
  className?: string
  leadingClassName?: string
  actionsClassName?: string
}) {
  return (
    <header className={`topbar${className ? ` ${className}` : ''}`}>
      <div className={`crumb${leadingClassName ? ` ${leadingClassName}` : ''}`}>{leading}</div>
      {actions ? <div className={`topbar-actions${actionsClassName ? ` ${actionsClassName}` : ''}`}>{actions}</div> : null}
    </header>
  )
}
