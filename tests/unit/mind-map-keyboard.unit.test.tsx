import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMindMapKeyboard, type MindMapKeyboardHandlers } from '../../src/renderer/src/views/mindmap/mind-map-keyboard'

const realGetSelection = window.getSelection

afterEach(() => {
  window.getSelection = realGetSelection
})

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
    copyStyle: vi.fn(),
    pasteStyle: vi.fn(),
    resetStyle: vi.fn(),
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

describe('useMindMapKeyboard topic style clipboard', () => {
  it.each([
    ['c', 'copyStyle'],
    ['v', 'pasteStyle']
  ] as const)('routes Cmd/Ctrl+Alt+%s to %s without invoking the content clipboard', (key, action) => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      altKey: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(handlers[action]).toHaveBeenCalledTimes(1)
    expect(key === 'c' ? handlers.copy : handlers.paste).not.toHaveBeenCalled()
  })

  it('routes Cmd/Ctrl+Alt+0 to reset style', () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', {
      key: '0',
      metaKey: true,
      altKey: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(handlers.resetStyle).toHaveBeenCalledTimes(1)
  })
})

describe('useMindMapKeyboard text selection copy/cut', () => {
  function mockTextSelection(text: string): void {
    const toString = vi.fn(() => text)
    window.getSelection = vi.fn(() => ({
      isCollapsed: text.length === 0,
      rangeCount: text.length === 0 ? 0 : 1,
      toString
    }) as unknown as Selection)
  }

  it.each(['c', 'x'] as const)('leaves Cmd/Ctrl+%s to the browser when text is selected', (key) => {
    const handlers = makeHandlers()
    mockTextSelection('selected sentence in the AI panel')
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(key === 'c' ? handlers.copy : handlers.cut).not.toHaveBeenCalled()
  })

  it('still copies the mind-map node when there is no text selection', () => {
    const handlers = makeHandlers()
    mockTextSelection('')
    render(<Harness handlers={handlers} />)

    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(handlers.copy).toHaveBeenCalledTimes(1)
  })
})
