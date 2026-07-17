import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export const WORKBENCH_DISCLOSURE_REVEAL_DURATION_MS = 300

type WorkbenchDisclosureReveal = {
  open: boolean
  isClosing: boolean
  revealHeight: number
  revealRef: RefObject<HTMLDivElement | null>
  revealInnerRef: RefObject<HTMLDivElement | null>
  toggle: () => void
}

type UseWorkbenchDisclosureRevealOptions = {
  defaultOpen?: boolean
  /** Keeps a disclosure at a stable revealed height instead of measuring its contents. */
  fixedHeight?: number
}

export function useWorkbenchDisclosureReveal(
  options: UseWorkbenchDisclosureRevealOptions = {}
): WorkbenchDisclosureReveal {
  const fixedHeight =
    typeof options.fixedHeight === 'number' ? Math.max(0, options.fixedHeight) : undefined
  const [open, setOpen] = useState(Boolean(options.defaultOpen))
  const [isClosing, setIsClosing] = useState(false)
  const [revealHeight, setRevealHeight] = useState(0)
  const revealRef = useRef<HTMLDivElement>(null)
  const revealInnerRef = useRef<HTMLDivElement>(null)
  const collapseTimerRef = useRef<number | undefined>(undefined)

  const clearCollapseTimer = useCallback((): void => {
    if (collapseTimerRef.current === undefined) return
    window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = undefined
  }, [])

  useEffect(() => clearCollapseTimer, [clearCollapseTimer])

  useLayoutEffect(() => {
    if (!open) return

    // Some disclosures are a self-contained viewport. Their content can change
    // without changing the outer card geometry (for example, tab switches).
    if (fixedHeight !== undefined) {
      setRevealHeight(fixedHeight)
      return
    }

    if (!revealInnerRef.current) return

    const revealInner = revealInnerRef.current
    const syncRevealHeight = (): void => {
      setRevealHeight(revealInner.scrollHeight)
    }

    syncRevealHeight()

    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(syncRevealHeight)
    resizeObserver.observe(revealInner)
    return () => resizeObserver.disconnect()
  }, [fixedHeight, open])

  const toggle = useCallback((): void => {
    clearCollapseTimer()

    if (open) {
      setOpen(false)
      setIsClosing(true)
      setRevealHeight(0)
      collapseTimerRef.current = window.setTimeout(() => {
        setIsClosing(false)
        collapseTimerRef.current = undefined
      }, WORKBENCH_DISCLOSURE_REVEAL_DURATION_MS)
      return
    }

    setIsClosing(false)
    setRevealHeight(fixedHeight ?? revealInnerRef.current?.scrollHeight ?? 0)
    setOpen(true)
  }, [clearCollapseTimer, fixedHeight, open])

  return {
    open,
    isClosing,
    revealHeight,
    revealRef,
    revealInnerRef,
    toggle
  }
}
