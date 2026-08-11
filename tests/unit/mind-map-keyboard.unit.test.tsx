import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMindMapKeyboard, type MindMapKeyboardHandlers } from '../../src/renderer/src/views/mindmap/mind-map-keyboard'

function makeHandlers(): MindMapKeyboardHandlers & { moveFocus: ReturnType<typeof vi.fn> } {
  return {
    insertChild: vi.fn(),
    insertSibling: vi.fn(),
    outdent: vi.fn(),
    insertAbove: vi.fn(),
    toggleCollapse: vi.fn(),
    remove: vi.fn(),
    edit: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    moveFocus: vi.fn()
  }
}

function Harness({ handlers }: { handlers: MindMapKeyboardHandlers }): null {
  useMindMapKeyboard(true, false, handlers)
  return null
}

describe('useMindMapKeyboard focus movement', () => {
  it('routes arrow keys to focus movement and prevents page scrolling', () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(handlers.moveFocus).toHaveBeenCalledWith('down')
  })

  it('leaves arrow keys alone while editing a node', () => {
    const handlers = makeHandlers()
    function EditingHarness(): null {
      useMindMapKeyboard(true, true, handlers)
      return null
    }
    render(<EditingHarness />)

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(handlers.moveFocus).not.toHaveBeenCalled()
  })
})

describe('useMindMapKeyboard inspector toggle', () => {
  it('toggles the inspector on Cmd/Ctrl+period', () => {
    const handlers = makeHandlers()
    handlers.toggleInspector = vi.fn()
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', { key: '.', metaKey: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(handlers.toggleInspector).toHaveBeenCalledTimes(1)
  })

  it('does nothing for period without the modifier', () => {
    const handlers = makeHandlers()
    handlers.toggleInspector = vi.fn()
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', { key: '.', cancelable: true })
    window.dispatchEvent(event)

    expect(handlers.toggleInspector).not.toHaveBeenCalled()
  })
})
