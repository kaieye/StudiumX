import { useCallback, useRef, useState } from 'react'

/**
 * Promise + sheet dialog helper: open with a payload, settle via resolve/cancel.
 * Mirrors the repeated open/payload/resolverRef pattern used by OfficeWorkbench sheets.
 */
export function useDialogAsk<TPayload, TResult>() {
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<TPayload | null>(null)
  const resolveRef = useRef<((result: TResult) => void) | null>(null)

  const ask = useCallback((nextPayload: TPayload): Promise<TResult> => {
    return new Promise<TResult>((resolve) => {
      resolveRef.current = resolve
      setPayload(nextPayload)
      setOpen(true)
    })
  }, [])

  const resolve = useCallback((result: TResult) => {
    const pending = resolveRef.current
    resolveRef.current = null
    setOpen(false)
    setPayload(null)
    pending?.(result)
  }, [])

  const cancel = useCallback(() => {
    resolveRef.current = null
    setOpen(false)
    setPayload(null)
  }, [])

  return {
    open,
    payload,
    ask,
    resolve,
    cancel
  }
}
