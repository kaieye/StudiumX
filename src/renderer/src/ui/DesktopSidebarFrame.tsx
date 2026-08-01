import type { ReactNode } from 'react'

/**
 * Shared sidebar frame used by the Electron renderer and the Web shell.
 * Navigation contents stay platform-specific, while sizing, collapsed state,
 * semantics, and the DOM boundary remain identical across both surfaces.
 */
export interface DesktopSidebarFrameProps {
  collapsed: boolean
  ariaLabel: string
  children: ReactNode
  className?: string
}

export function DesktopSidebarFrame({
  collapsed,
  ariaLabel,
  children,
  className = 'sidebar'
}: DesktopSidebarFrameProps) {
  return (
    <aside className={`${className}${collapsed ? ' is-collapsed' : ''}`} aria-label={ariaLabel}>
      {children}
    </aside>
  )
}
