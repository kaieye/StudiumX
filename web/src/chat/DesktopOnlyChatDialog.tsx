import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { Monitor, X } from 'lucide-react'

interface DesktopOnlyChatContextValue {
  openDesktopOnlyChatDialog: () => void
}

const DesktopOnlyChatContext = createContext<DesktopOnlyChatContextValue | null>(null)

/**
 * Web never starts or continues an agent conversation. This provider gives every
 * chat affordance the same explicit, accessible desktop-only explanation instead
 * of accidentally routing it into a server/agent capability.
 */
export function DesktopOnlyChatDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openDesktopOnlyChatDialog = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])

  return (
    <DesktopOnlyChatContext.Provider value={{ openDesktopOnlyChatDialog }}>
      {children}
      <DesktopOnlyChatDialog open={open} onClose={close} />
    </DesktopOnlyChatContext.Provider>
  )
}

export function useDesktopOnlyChatDialog(): DesktopOnlyChatContextValue {
  const context = useContext(DesktopOnlyChatContext)
  if (!context) {
    throw new Error('useDesktopOnlyChatDialog must be used inside DesktopOnlyChatDialogProvider')
  }
  return context
}

export function DesktopOnlyChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      )
      if (focusable.length === 0) return
      const current = document.activeElement
      const index = focusable.indexOf(current as HTMLElement)
      const nextIndex = event.shiftKey
        ? (index <= 0 ? focusable.length - 1 : index - 1)
        : (index === focusable.length - 1 ? 0 : index + 1)
      event.preventDefault()
      focusable[nextIndex]?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="web-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="web-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-only-chat-title"
        aria-describedby="desktop-only-chat-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="web-dialog-icon" aria-hidden="true"><Monitor size={21} /></div>
        <button
          ref={closeButtonRef}
          type="button"
          className="web-dialog-close"
          onClick={onClose}
          aria-label="关闭提示"
          title="关闭"
        >
          <X size={18} />
        </button>
        <h2 id="desktop-only-chat-title">仅限桌面端可使用对话服务</h2>
        <p id="desktop-only-chat-description">
          学习助手对话需要桌面端的本地学习工作区与安全能力。请在 StudiumX Desktop 中打开对话服务；Web 端继续提供已支持的学习计划、课程、自习和分析功能。
        </p>
        <div className="web-dialog-actions">
          <button type="button" className="web-primary-button" onClick={onClose}>我知道了</button>
        </div>
      </section>
    </div>
  )
}
