import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapRichTextEditor, type MindMapRichTextEditorHandle } from '../../src/renderer/src/views/mindmap/MindMapRichTextEditor'
import { MindMapTextFormatToolbar } from '../../src/renderer/src/views/mindmap/MindMapTextFormatToolbar'
import type { RichTextSelectionState } from '../../src/renderer/src/views/mindmap/mind-map-rich-text-dom'

// The toolbar portals to document.body; @testing-library's auto-cleanup only
// removes its own container, so remove leftover portal toolbars explicitly.
afterEach(() => {
  cleanup()
  document.querySelectorAll('.mindmap-text-format-toolbar').forEach((element) => element.remove())
})

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

function selectionState(overrides: Partial<RichTextSelectionState> = {}): RichTextSelectionState {
  return {
    active: true,
    rect: { left: 100, top: 100, width: 60, height: 18, right: 160, bottom: 118, x: 100, y: 100, toJSON: () => ({}) } as DOMRect,
    start: 0,
    end: 5,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    color: undefined,
    fontFamily: undefined,
    fontSize: undefined,
    mixed: false,
    ...overrides
  }
}

describe('MindMapRichTextEditor', () => {
  it('renders formatted spans on mount', () => {
    render(
      <MindMapRichTextEditor
        text="Hello world"
        spans={[{ start: 0, end: 5, bold: true, color: 'red' }]}
        ariaLabel="edit"
      />
    )
    const editor = document.querySelector<HTMLElement>('.mindmap-richtext')
    expect(editor).not.toBeNull()
    const boldSpan = editor?.querySelector('span[style*="font-weight:bold"]')
    expect(boldSpan?.textContent).toBe('Hello')
    expect(boldSpan?.getAttribute('style')).toContain('color:red')
    expect(editor?.textContent).toBe('Hello world')
  })

  it('reports the model on input', () => {
    const onModelChange = vi.fn()
    render(
      <MindMapRichTextEditor
        text="abc"
        spans={[]}
        ariaLabel="edit"
        onModelChange={onModelChange}
      />
    )
    const editor = document.querySelector<HTMLElement>('.mindmap-richtext')!
    editor.textContent = 'abcd'
    fireEvent.input(editor)
    expect(onModelChange).toHaveBeenCalledWith('abcd', [])
  })

  it('applies a style to the selection through the imperative handle', () => {
    const onModelChange = vi.fn()
    const handle: { current: MindMapRichTextEditorHandle | null } = { current: null }
    render(
      <MindMapRichTextEditor
        ref={handle}
        text="hello"
        spans={[]}
        ariaLabel="edit"
        onModelChange={onModelChange}
      />
    )
    const editor = document.querySelector<HTMLElement>('.mindmap-richtext')!
    // Select the whole content.
    const range = document.createRange()
    range.selectNodeContents(editor)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    const applied = handle.current?.applyStyle({ bold: true })
    expect(applied).toBe(true)
    expect(editor.querySelector('span[style*="font-weight:bold"]')?.textContent).toBe('hello')
    expect(onModelChange).toHaveBeenCalledWith('hello', [{ start: 0, end: 5, bold: true }])
  })

  it('re-seeds the DOM when the props change externally', () => {
    const { rerender } = render(
      <MindMapRichTextEditor text="Alpha" spans={[]} ariaLabel="edit" />
    )
    const editor = document.querySelector<HTMLElement>('.mindmap-richtext')!
    expect(editor.textContent).toBe('Alpha')
    rerender(
      <MindMapRichTextEditor text="Beta" spans={[{ start: 0, end: 2, bold: true }]} ariaLabel="edit" />
    )
    expect(editor.textContent).toBe('Beta')
    expect(editor.querySelector('span[style*="font-weight:bold"]')?.textContent).toBe('Be')
  })

  it('toggles bold with Cmd+B', () => {
    const onModelChange = vi.fn()
    render(
      <MindMapRichTextEditor text="hello" spans={[]} ariaLabel="edit" onModelChange={onModelChange} />
    )
    const editor = document.querySelector<HTMLElement>('.mindmap-richtext')!
    const range = document.createRange()
    range.selectNodeContents(editor)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.keyDown(editor, { key: 'b', metaKey: true })
    expect(editor.querySelector('span[style*="font-weight:bold"]')).not.toBeNull()
    expect(onModelChange).toHaveBeenCalledWith('hello', [{ start: 0, end: 5, bold: true }])
  })

  it('reports the final model on blur', () => {
    const onBlur = vi.fn()
    render(
      <MindMapRichTextEditor text="abc" spans={[]} ariaLabel="edit" onBlur={onBlur} />
    )
    const editor = document.querySelector<HTMLElement>('.mindmap-richtext')!
    editor.textContent = 'xyz'
    fireEvent.input(editor)
    fireEvent.blur(editor)
    expect(onBlur).toHaveBeenCalledWith(expect.anything(), 'xyz', [])
  })
})

describe('MindMapTextFormatToolbar', () => {
  it('renders nothing without an active selection', () => {
    const { container } = render(
      <MindMapTextFormatToolbar
        selection={null}
        onApplyStyle={vi.fn()}
        onToggleBold={vi.fn()}
        onToggleItalic={vi.fn()}
      />
    )
    expect(container.querySelector('.mindmap-text-format-toolbar')).toBeNull()
  })

  it('toggles bold from the toolbar button', async () => {
    const user = userEvent.setup()
    const onToggleBold = vi.fn()
    render(
      <MindMapTextFormatToolbar
        selection={selectionState({ bold: true })}
        onApplyStyle={vi.fn()}
        onToggleBold={onToggleBold}
        onToggleItalic={vi.fn()}
      />
    )
    const boldButton = screen.getByRole('button', { name: /Bold/i })
    await user.click(boldButton)
    expect(onToggleBold).toHaveBeenCalledTimes(1)
  })

  it('toggles italic from the toolbar button', async () => {
    const user = userEvent.setup()
    const onToggleItalic = vi.fn()
    render(
      <MindMapTextFormatToolbar
        selection={selectionState({ italic: true })}
        onApplyStyle={vi.fn()}
        onToggleBold={vi.fn()}
        onToggleItalic={onToggleItalic}
      />
    )
    const italicButton = screen.getByRole('button', { name: /Italic/i })
    await user.click(italicButton)
    expect(onToggleItalic).toHaveBeenCalledTimes(1)
  })

  it('applies a preset color from the color menu (shared background-color picker UI)', async () => {
    const user = userEvent.setup()
    const onApplyStyle = vi.fn()
    render(
      <MindMapTextFormatToolbar
        selection={selectionState()}
        onApplyStyle={onApplyStyle}
        onToggleBold={vi.fn()}
        onToggleItalic={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /Text color/i }))
    // The popover is the same preset + HEX + opacity + recent-colours control
    // as the canvas background-colour picker.
    expect(screen.getByRole('dialog', { name: 'Text color' })).toBeInTheDocument()
    const preset = screen.getByRole('button', { name: 'Preset color #E53935' })
    await user.click(preset)
    expect(onApplyStyle).toHaveBeenCalledWith({ color: '#E53935' })
  })

  it('applies a font family from the font menu', async () => {
    const user = userEvent.setup()
    const onApplyStyle = vi.fn()
    render(
      <MindMapTextFormatToolbar
        selection={selectionState()}
        onApplyStyle={onApplyStyle}
        onToggleBold={vi.fn()}
        onToggleItalic={vi.fn()}
        defaultFontLabel="Inter"
      />
    )
    await user.click(screen.getByRole('button', { name: 'Font' }))
    const items = screen.getAllByRole('menuitem')
    // First item is the real default font ("Inter"); pick a concrete font.
    expect(items[0]).toHaveTextContent('Inter')
    await user.click(items[1]!)
    expect(onApplyStyle).toHaveBeenCalledWith({ fontFamily: expect.any(String) })
  })

  it('applies a font size from the size menu', async () => {
    const user = userEvent.setup()
    const onApplyStyle = vi.fn()
    render(
      <MindMapTextFormatToolbar
        selection={selectionState()}
        onApplyStyle={onApplyStyle}
        onToggleBold={vi.fn()}
        onToggleItalic={vi.fn()}
        defaultFontSize={16}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Font size' }))
    const items = screen.getAllByRole('menuitem')
    // First item is the real default size; pick a concrete size.
    expect(items[0]).toHaveTextContent('16px')
    await user.click(items[1]!)
    expect(onApplyStyle).toHaveBeenCalledWith({ fontSize: expect.any(Number) })
  })
})
