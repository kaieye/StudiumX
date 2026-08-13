/**
 * Keyboard shortcut hook for the mind-map workbench (plan §5.1).
 *
 * A single window-level keydown listener maps the documented shortcuts to the
 * same command entry points used by the canvas/toolbar. Editing inputs and
 * textarea/select/contenteditable targets are ignored so typing in the AI
 * panel or the inline node editor keeps its normal behaviour.
 */
import { useEffect } from 'react'
import type { MindMapFocusDirection } from './mind-map-keyboard-navigation'

export type MindMapKeyboardHandlers = {
  insertChild: () => void
  insertSibling: () => void
  outdent: () => void
  insertAbove: () => void
  toggleCollapse: () => void
  remove: () => void
  edit: () => void
  undo: () => void
  redo: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  duplicate: () => void
  copyStyle: () => void
  pasteStyle: () => void
  resetStyle: () => void
  moveFocus?: (direction: MindMapFocusDirection) => void
  toggleInspector?: () => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function useMindMapKeyboard(
  enabled: boolean,
  editing: boolean,
  handlers: MindMapKeyboardHandlers
): void {
  useEffect(() => {
    if (!enabled) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if (editing) return

      const mod = event.metaKey || event.ctrlKey
      const key = event.key

      if (!mod && handlers.moveFocus) {
        const direction: MindMapFocusDirection | null =
          key === 'ArrowUp'
            ? 'up'
            : key === 'ArrowDown'
              ? 'down'
              : key === 'ArrowLeft'
                ? 'left'
                : key === 'ArrowRight'
                  ? 'right'
                  : null
        if (direction !== null) {
          event.preventDefault()
          handlers.moveFocus(direction)
          return
        }
      }

      if (key === 'Tab') {
        if (mod) return
        event.preventDefault()
        if (event.shiftKey) handlers.outdent()
        else handlers.insertChild()
        return
      }

      // Insert key: insert child (Xmind-style shortcut)
      if (key === 'Insert') {
        if (mod) return
        event.preventDefault()
        if (event.shiftKey) handlers.insertSibling()
        else handlers.insertChild()
        return
      }

      if (key === 'Enter' && !mod) {
        event.preventDefault()
        handlers.insertSibling()
        return
      }

      if (mod && key === 'Enter') {
        event.preventDefault()
        handlers.insertAbove()
        return
      }

      if (key === ' ' || key === 'Spacebar') {
        if (mod) return
        event.preventDefault()
        handlers.toggleCollapse()
        return
      }

      if (key === 'Delete' || key === 'Backspace') {
        if (mod) return
        event.preventDefault()
        handlers.remove()
        return
      }

      if (key === 'F2') {
        event.preventDefault()
        handlers.edit()
        return
      }

      if (mod && key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) handlers.redo()
        else handlers.undo()
        return
      }

      if (mod && key.toLowerCase() === 'y') {
        event.preventDefault()
        handlers.redo()
        return
      }

      if (mod && event.altKey && key.toLowerCase() === 'c') {
        event.preventDefault()
        handlers.copyStyle()
        return
      }

      if (mod && event.altKey && key.toLowerCase() === 'v') {
        event.preventDefault()
        handlers.pasteStyle()
        return
      }

      if (mod && event.altKey && key === '0') {
        event.preventDefault()
        handlers.resetStyle()
        return
      }

      if (mod && key.toLowerCase() === 'c') {
        event.preventDefault()
        handlers.copy()
        return
      }

      if (mod && key.toLowerCase() === 'x') {
        event.preventDefault()
        handlers.cut()
        return
      }

      if (mod && key.toLowerCase() === 'v') {
        event.preventDefault()
        handlers.paste()
        return
      }

      if (mod && key.toLowerCase() === 'd') {
        event.preventDefault()
        handlers.duplicate()
        return
      }

      // P2 §5.4: ⌘. / Ctrl+. toggles the right inspector (Xmind-style).
      if (mod && key === '.') {
        if (handlers.toggleInspector) {
          event.preventDefault()
          handlers.toggleInspector()
        }
        return
      }
    }

    window.addEventListener('keydown', onKeyDown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as EventListener)
  }, [enabled, editing, handlers])
}
