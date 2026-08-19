import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyStyleToEditorRange,
  computeRichTextSelectionState,
  parseRichTextDom,
  serializeRichTextToHtml
} from '../../src/renderer/src/views/mindmap/mind-map-rich-text-dom'

function makeEditor(html: string): HTMLDivElement {
  const div = document.createElement('div')
  div.setAttribute('contenteditable', 'true')
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

function selectRange(root: HTMLElement, startOffset: number, endOffset: number): void {
  const range = document.createRange()
  const textNode = Array.from(root.childNodes).find((n) => n.nodeType === Node.TEXT_NODE)
  const firstText = textNode as Text | undefined
  if (!firstText) throw new Error('no text node')
  range.setStart(firstText, startOffset)
  range.setEnd(firstText, endOffset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** Select within the first text node matching `selector` (e.g. a span). */
function selectWithin(root: HTMLElement, selector: string, startOffset: number, endOffset: number): void {
  const target = root.querySelector<HTMLElement>(selector)
  const textNode = target?.firstChild
  if (!target || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
    throw new Error(`no text node under ${selector}`)
  }
  const range = document.createRange()
  range.setStart(textNode, startOffset)
  range.setEnd(textNode, endOffset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('mind-map-rich-text-dom', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('serialises plain text with no wrappers', () => {
    expect(serializeRichTextToHtml('hello', [])).toBe('hello')
  })

  it('serialises spans as styled elements and newlines as <br>', () => {
    const html = serializeRichTextToHtml('ab\ncd', [
      { start: 0, end: 2, bold: true, color: 'red' }
    ])
    expect(html).toBe(
      '<span style="color:red;font-weight:bold" data-mm-color="red">ab</span><br>cd'
    )
  })

  it('escapes html in text', () => {
    expect(serializeRichTextToHtml('a<b>&"', [])).toBe('a&lt;b&gt;&amp;&quot;')
  })

  it('parses plain text back into the model', () => {
    const editor = makeEditor('hello')
    expect(parseRichTextDom(editor)).toEqual({ text: 'hello', spans: [] })
  })

  it('parses styled spans back into the model', () => {
    const editor = makeEditor(
      '<span style="color:red;font-weight:bold">ab</span>cd'
    )
    expect(parseRichTextDom(editor)).toEqual({
      text: 'abcd',
      spans: [{ start: 0, end: 2, color: 'red', bold: true }]
    })
  })

  it('parses <br> as newline', () => {
    const editor = makeEditor('ab<br>cd')
    expect(parseRichTextDom(editor)).toEqual({ text: 'ab\ncd', spans: [] })
  })

  it('parses semantic <b> as bold', () => {
    const editor = makeEditor('a<b>b</b>c')
    expect(parseRichTextDom(editor)).toEqual({
      text: 'abc',
      spans: [{ start: 1, end: 2, bold: true }]
    })
  })

  it('applies a style over the selection', () => {
    const editor = makeEditor('hello world')
    selectRange(editor, 0, 5)
    const applied = applyStyleToEditorRange(editor, { bold: true })
    expect(applied).toBe(true)
    expect(parseRichTextDom(editor)).toEqual({
      text: 'hello world',
      spans: [{ start: 0, end: 5, bold: true }]
    })
  })

  it('toggles bold off when the whole selection is already bold', () => {
    const editor = makeEditor('<span style="font-weight:bold">hello</span> world')
    selectWithin(editor, 'span', 0, 5)
    const applied = applyStyleToEditorRange(editor, { bold: true }, true)
    expect(applied).toBe(true)
    expect(parseRichTextDom(editor)).toEqual({
      text: 'hello world',
      spans: []
    })
  })

  it('applies bold over a mixed selection instead of toggling off', () => {
    const editor = makeEditor('<span style="font-weight:bold">hello</span> world')
    // Select the whole editor: "hello" bold + " world" not → toggling must ADD bold.
    const range = document.createRange()
    range.selectNodeContents(editor)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    const applied = applyStyleToEditorRange(editor, { bold: true }, true)
    expect(applied).toBe(true)
    const parsed = parseRichTextDom(editor)
    expect(parsed.spans).toEqual([{ start: 0, end: 11, bold: true }])
  })

  it('applies color while preserving the raw hex in the model', () => {
    const editor = makeEditor('hello')
    selectRange(editor, 1, 4)
    applyStyleToEditorRange(editor, { color: '#ff0000' })
    const parsed = parseRichTextDom(editor)
    expect(parsed.spans).toEqual([{ start: 1, end: 4, color: '#ff0000' }])
  })

  it('reports the selection state with a rect', () => {
    const editor = makeEditor('hello')
    selectRange(editor, 0, 2)
    const state = computeRichTextSelectionState(editor)
    expect(state.active).toBe(true)
    expect(state.bold).toBe(false)
  })

  it('reports bold state at the selection start', () => {
    const editor = makeEditor('<span style="font-weight:bold">hello</span> world')
    selectWithin(editor, 'span', 1, 3)
    const state = computeRichTextSelectionState(editor)
    expect(state.active).toBe(true)
    expect(state.bold).toBe(true)
  })

  it('serialising then parsing round-trips the model', () => {
    const text = 'line1\nline2 with **markers**'
    const spans = [
      { start: 0, end: 5, bold: true, color: '#ff0000' },
      { start: 12, end: 18, fontFamily: 'serif', fontSize: 18 }
    ]
    const editor = makeEditor(serializeRichTextToHtml(text, spans))
    const parsed = parseRichTextDom(editor)
    expect(parsed.text).toBe(text)
    expect(parsed.spans).toEqual(spans)
  })

  it('round-trips italic, underline and strikethrough spans', () => {
    const text = 'styled text'
    const spans = [
      { start: 0, end: 6, italic: true },
      { start: 7, end: 11, underline: true, strikethrough: true }
    ]
    const editor = makeEditor(serializeRichTextToHtml(text, spans))
    const parsed = parseRichTextDom(editor)
    expect(parsed.text).toBe(text)
    expect(parsed.spans).toEqual(spans)
  })

  it('parses semantic <i>, <u> and <s> tags into span styles', () => {
    const editor = makeEditor('a<i>b</i><u>c</u><s>d</s>e')
    const parsed = parseRichTextDom(editor)
    expect(parsed.text).toBe('abcde')
    expect(parsed.spans).toEqual([
      { start: 1, end: 2, italic: true },
      { start: 2, end: 3, underline: true },
      { start: 3, end: 4, strikethrough: true }
    ])
  })
})
