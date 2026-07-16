import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

const EXIT_TRANSITION_MS = 180

type ConversationInterruptionDockProps = {
  active: boolean
  interruption: ReactNode
  children: ReactNode
}

/**
 * Keeps the normal composer in the layout while ask/permission UI floats over
 * the same bottom dock. This prevents the message thread from being resized
 * when an interruption appears, and retains the card briefly for its exit
 * animation after the request has been resolved.
 */
export function ConversationInterruptionDock({
  active,
  interruption,
  children
}: ConversationInterruptionDockProps) {
  const lastInterruption = useRef<ReactNode>(interruption)
  const [present, setPresent] = useState(active)

  if (active && interruption !== null && interruption !== undefined) {
    lastInterruption.current = interruption
  }

  useEffect(() => {
    if (active) {
      setPresent(true)
      return
    }
    if (!present) return
    const timer = window.setTimeout(() => setPresent(false), EXIT_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [active, present])

  return (
    <div className={`conversation-interruption-dock${active ? ' has-interruption' : ''}`}>
      <div
        className={`conversation-interruption-dock__base${active ? ' is-suspended' : ''}`}
        aria-hidden={active || undefined}
        inert={active || undefined}
      >
        {children}
      </div>
      {present ? (
        <div
          className={`conversation-interruption-dock__overlay${active ? ' is-entering' : ' is-exiting'}`}
          data-testid="conversation-interruption-overlay"
          aria-live="polite"
        >
          {lastInterruption.current}
        </div>
      ) : null}
    </div>
  )
}
