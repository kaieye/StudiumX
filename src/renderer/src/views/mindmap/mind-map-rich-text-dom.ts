/**
 * DOM <-> rich text model helpers for the mind map inline text editor.
 *
 * The editor is a contentEditable `<div>`; the DOM is the live source of truth
 * while editing. This module bridges that DOM and the pure span model in
 * `shared/mindmap/text-spans.ts`:
 *
 * - `serializeRichTextToHtml` renders `{ text, spans }` into editor HTML
 *   (escaped text, `<span style>` wrappers, `<br>` for newlines);
 * - `parseRichTextDom` walks the editor DOM back into `{ text, spans }`,
 *   mapping `<br>` to `\n` and reading effective inline styles;
 * - `applyStyleToEditorRange` applies or strips a style over the current
 *   selection (Xmind-style), keeping the DOM as the source of truth;
 * - selection helpers report the anchor rect and the formatting state the
 *   floating toolbar displays.
 *
 * Only the four span style keys are modelled (color / bold / font family /
 * font size); any other inline style is ignored by the parser.
 */
import {
  applyTextSpanStyle,
  hasTextSpanStyle,
  splitTextIntoSegments,
  textSpanStylesEqual
} from '../../../../shared/mindmap/text-spans'
import type { MindMapTextSpan, MindMapTextSpanStyle } from '../../../../shared/mindmap/domain/types'

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char)
}

function spanStyleCss(style: MindMapTextSpanStyle): string {
  const parts: string[] = []
  if (style.color !== undefined) parts.push(`color:${style.color}`)
  if (style.bold !== undefined) parts.push(`font-weight:${style.bold ? 'bold' : 'normal'}`)
  if (style.italic !== undefined) parts.push(`font-style:${style.italic ? 'italic' : 'normal'}`)
  if (style.underline !== undefined || style.strikethrough !== undefined) {
    const decorations: string[] = []
    if (style.underline) decorations.push('underline')
    if (style.strikethrough) decorations.push('line-through')
    parts.push(`text-decoration:${decorations.length > 0 ? decorations.join(' ') : 'none'}`)
  }
  if (style.fontFamily !== undefined) {
    parts.push(`font-family:${escapeHtml(style.fontFamily)}`)
  }
  if (style.fontSize !== undefined) parts.push(`font-size:${style.fontSize}px`)
  return parts.join(';')
}

/**
 * Preserve the exact colour string the user picked. Browsers normalise a hex
 * value set on `style.color` back to `rgb(...)`, so the raw value is kept in a
 * `data-mm-color` attribute and preferred by the parser — this keeps the model
 * (and persisted documents) storing the original hex the user chose.
 */
function spanStyleAttributes(style: MindMapTextSpanStyle): string {
  if (style.color === undefined) return ''
  return ` data-mm-color="${escapeHtml(style.color)}"`
}

/**
 * Serialise `{ text, spans }` into the HTML the contentEditable editor
 * renders. Newlines become `<br>` so the editor DOM stays well-formed while
 * `white-space` handling stays out of the way.
 */
export function serializeRichTextToHtml(
  text: string,
  spans: readonly MindMapTextSpan[]
): string {
  if (text.length === 0) return ''
  const segments = textSegmentsForDom(text, spans)
  let html = ''
  for (const segment of segments) {
    const escaped = escapeHtml(segment.text).replace(/\n/g, '<br>')
    const css = spanStyleCss(segment.style)
    if (css.length === 0) {
      html += escaped
    } else {
      html += `<span style="${css}"${spanStyleAttributes(segment.style)}>${escaped}</span>`
    }
  }
  return html
}

// Local copy of the shared segment builder to avoid a circular import shape
// (text-spans imports the domain type only; this module imports text-spans
// types). Reuse the shared implementation for a single source of truth.
function textSegmentsForDom(
  text: string,
  spans: readonly MindMapTextSpan[]
): Array<{ text: string; style: MindMapTextSpanStyle }> {
  return splitTextIntoSegments(text, spans).map((segment) => ({
    text: segment.text,
    style: segment.style
  }))
}

type WalkedRun = {
  text: string
  style: MindMapTextSpanStyle
}

function isBoldWeight(weight: string): boolean {
  const value = weight.trim().toLowerCase()
  if (value === 'bold' || value === 'bolder') return true
  if (value === 'normal' || value === 'lighter') return false
  const numeric = Number.parseInt(value, 10)
  return Number.isFinite(numeric) && numeric >= 600
}

function isItalicStyle(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'italic' || normalized === 'oblique'
}

function parseTextDecoration(value: string): { underline?: boolean; strikethrough?: boolean } {
  const parts = value.trim().toLowerCase().split(/\s+/)
  return {
    ...(parts.includes('underline') ? { underline: true } : {}),
    ...(parts.includes('line-through') ? { strikethrough: true } : {})
  }
}

function readElementStyle(element: Element): MindMapTextSpanStyle {
  const style: MindMapTextSpanStyle = {}
  const raw = element instanceof HTMLElement ? element.style : undefined
  if (!raw) {
    // Semantic tags imply formatting even without an inline style.
    if (element.tagName === 'B' || element.tagName === 'STRONG') style.bold = true
    if (element.tagName === 'I' || element.tagName === 'EM') style.italic = true
    if (element.tagName === 'U') style.underline = true
    if (element.tagName === 'S' || element.tagName === 'DEL' || element.tagName === 'STRIKE') {
      style.strikethrough = true
    }
    return style
  }
  // Prefer the preserved raw colour over the browser-normalised rgb(...).
  const rawColor = element.getAttribute('data-mm-color')
  if (rawColor) style.color = rawColor
  else if (raw.color) style.color = raw.color
  if (raw.fontWeight) style.bold = isBoldWeight(raw.fontWeight)
  if (raw.fontStyle) style.italic = isItalicStyle(raw.fontStyle)
  if (raw.textDecoration) {
    const decoration = parseTextDecoration(raw.textDecoration)
    if (decoration.underline !== undefined) style.underline = decoration.underline
    if (decoration.strikethrough !== undefined) style.strikethrough = decoration.strikethrough
  }
  if (raw.fontFamily) style.fontFamily = raw.fontFamily
  const fontSize = raw.fontSize
  if (fontSize) {
    const match = /^([\d.]+)px$/i.exec(fontSize.trim())
    if (match) {
      const value = Number.parseFloat(match[1]!)
      if (Number.isFinite(value) && value > 0) style.fontSize = value
    }
  }
  if (element.tagName === 'B' || element.tagName === 'STRONG') style.bold = true
  if (element.tagName === 'I' || element.tagName === 'EM') style.italic = true
  if (element.tagName === 'U') style.underline = true
  if (element.tagName === 'S' || element.tagName === 'DEL' || element.tagName === 'STRIKE') {
    style.strikethrough = true
  }
  return style
}

function mergeWalkStyle(
  inherited: MindMapTextSpanStyle,
  own: MindMapTextSpanStyle
): MindMapTextSpanStyle {
  return { ...inherited, ...own }
}

/**
 * Walk the editor DOM collecting `{ text, style }` runs. `<br>` maps to `\n`
 * so the parsed text exactly matches what the model stores. The root element's
 * own inline style is the editor's *base* style, never span formatting, so it
 * is intentionally not inherited by the walk (callers iterate the root's
 * children instead of the root itself).
 */
function walkRuns(node: Node, inherited: MindMapTextSpanStyle, out: WalkedRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? ''
    if (value.length > 0) out.push({ text: value, style: inherited })
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const element = node as Element
  if (element.tagName === 'BR') {
    out.push({ text: '\n', style: inherited })
    return
  }
  const style = mergeWalkStyle(inherited, readElementStyle(element))
  for (const child of Array.from(element.childNodes)) {
    walkRuns(child, style, out)
  }
}

/** Coalesce consecutive runs that share an identical style. */
function coalesceRuns(runs: WalkedRun[]): WalkedRun[] {
  const result: WalkedRun[] = []
  for (const run of runs) {
    const last = result[result.length - 1]
    if (last !== undefined && textSpanStylesEqual(last.style, run.style)) {
      last.text += run.text
    } else {
      result.push({ ...run, text: run.text })
    }
  }
  return result
}

/** Walk the editor DOM back into the `{ text, spans }` model. */
export function parseRichTextDom(root: HTMLElement): { text: string; spans: MindMapTextSpan[] } {
  const runs: WalkedRun[] = []
  for (const child of Array.from(root.childNodes)) {
    walkRuns(child, {}, runs)
  }
  const coalesced = coalesceRuns(runs)
  let text = ''
  const spans: MindMapTextSpan[] = []
  for (const run of coalesced) {
    const start = text.length
    text += run.text
    const end = text.length
    const style = run.style
    if (
      end > start &&
      hasTextSpanStyle(style)
    ) {
      const span: MindMapTextSpan = { start, end }
      if (style.color !== undefined) span.color = style.color
      if (style.bold !== undefined) span.bold = style.bold
      if (style.italic !== undefined) span.italic = style.italic
      if (style.underline !== undefined) span.underline = style.underline
      if (style.strikethrough !== undefined) span.strikethrough = style.strikethrough
      if (style.fontFamily !== undefined) span.fontFamily = style.fontFamily
      if (style.fontSize !== undefined) span.fontSize = style.fontSize
      spans.push(span)
    }
  }
  return { text, spans }
}

function charLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').length
  if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') return 1
  if (node.nodeType === Node.ELEMENT_NODE) {
    let total = 0
    for (const child of Array.from(node.childNodes)) total += charLengthOf(child)
    return total
  }
  return 0
}

/**
 * Map a DOM boundary (container + offset) to a character offset in the
 * editor's model text (`<br>` counts as one `\n` character, matching
 * `parseRichTextDom`).
 */
function boundaryCharOffset(root: HTMLElement, boundaryNode: Node, boundaryOffset: number): number {
  let offset = 0
  const visit = (node: Node): boolean => {
    if (node === boundaryNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += Math.max(0, Math.min(boundaryOffset, (node.nodeValue ?? '').length))
      } else if (boundaryOffset > 0) {
        // Element boundary: count the characters before the boundary.
        for (let i = 0; i < boundaryOffset; i += 1) {
          const child = node.childNodes[i]
          if (child) offset += charLengthOf(child)
        }
      }
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.nodeValue ?? '').length
      return false
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName === 'BR') {
        offset += 1
        return false
      }
      for (const child of Array.from(node.childNodes)) {
        if (visit(child)) return true
      }
    }
    return false
  }
  visit(root)
  return offset
}

/** Locate the DOM node + inner offset for a model character offset. */
function locateCharOffset(
  root: HTMLElement,
  offset: number
): { node: Node; nodeOffset: number } {
  let remaining = offset
  const visit = (node: Node): { node: Node; nodeOffset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.nodeValue ?? '').length
      if (remaining <= length) return { node, nodeOffset: remaining }
      remaining -= length
      return null
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      if (remaining <= 1) return { node, nodeOffset: remaining }
      remaining -= 1
      return null
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const child of Array.from(node.childNodes)) {
        const hit = visit(child)
        if (hit) return hit
      }
    }
    return null
  }
  return visit(root) ?? { node: root, nodeOffset: 0 }
}

function setSelectionByCharOffsets(root: HTMLElement, start: number, end: number): void {
  const selection = root.ownerDocument?.defaultView?.getSelection() ?? window.getSelection()
  if (!selection) return
  const range = root.ownerDocument.createRange()
  const startLoc = locateCharOffset(root, start)
  const endLoc = locateCharOffset(root, end)
  try {
    range.setStart(startLoc.node, startLoc.nodeOffset)
    range.setEnd(endLoc.node, endLoc.nodeOffset)
  } catch {
    // A boundary landing exactly on a <br> element is not representable as a
    // text boundary; fall back to the surrounding node without throwing.
    range.selectNodeContents(root)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Apply (or toggle) `style` over a character range in the editor.
 *
 * This is intentionally model-driven: the current DOM is parsed into the span
 * model, the pure {@link applyTextSpanStyle} algebra computes the new spans
 * (splitting/merging/toggling runs), the editor DOM is re-rendered from the
 * new model, and the selection is restored over the same character range.
 * Keeping the DOM as a view avoids the fragile ancestor-element mutation of
 * extract/reinsert editing.
 *
 * When `range` is omitted the editor's live DOM selection is used; when the
 * editor is not focused (e.g. the user is interacting with the right-side
 * panel) an explicit `{ start, end }` keeps the formatting targeting the last
 * selected text.
 *
 * Returns `false` when there is no usable non-collapsed range, `true` otherwise.
 */
export function applyStyleToEditorRange(
  root: HTMLElement,
  style: MindMapTextSpanStyle,
  toggle = false,
  range?: { start: number; end: number }
): boolean {
  let start: number
  let end: number
  if (range && range.end > range.start) {
    start = range.start
    end = range.end
  } else {
    const selection = root.ownerDocument?.defaultView?.getSelection() ?? window.getSelection()
    if (!selection || selection.rangeCount === 0) return false
    const domRange = selection.getRangeAt(0)
    if (domRange.collapsed || !root.contains(domRange.commonAncestorContainer)) return false
    start = boundaryCharOffset(root, domRange.startContainer, domRange.startOffset)
    end = boundaryCharOffset(root, domRange.endContainer, domRange.endOffset)
  }
  if (end <= start) return false

  const { text, spans } = parseRichTextDom(root)
  const nextSpans = applyTextSpanStyle(text, spans, start, end, style, toggle)

  // Re-render from the model, then restore the selection over the same range.
  root.innerHTML = serializeRichTextToHtml(text, nextSpans)
  setSelectionByCharOffsets(root, start, end)
  return true
}

/** The format state the floating toolbar displays for the current selection. */
export type RichTextSelectionState = {
  /** Whether a non-collapsed selection exists inside the editor. */
  active: boolean
  /** Viewport rect of the selection, for positioning the floating toolbar. */
  rect: DOMRect | null
  /** Character offsets of the selection into the editor's model text. */
  start: number | null
  end: number | null
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  color: string | undefined
  fontFamily: string | undefined
  fontSize: number | undefined
  /** Mixed flag: whether the selection carries more than one value for a key. */
  mixed: boolean
}

/** Span-level style at `element`, stopping before the editor root so the
 *  root's base style (font family/size/weight/color) is never mistaken for
 *  per-character formatting. */
function styleAtElement(element: Element, root: HTMLElement): MindMapTextSpanStyle {
  const stack: Element[] = []
  let cursor: Element | null = element
  while (cursor && cursor !== root) {
    stack.push(cursor)
    cursor = cursor.parentElement
  }
  let style: MindMapTextSpanStyle = {}
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    style = mergeWalkStyle(style, readElementStyle(stack[i]!))
  }
  return style
}

/**
 * Compute the selection state for the editor: whether a usable selection
 * exists, its viewport rect, the selection's character offsets, and the
 * span-level formatting at the selection start (used to render the floating
 * toolbar's active state and to drive right-panel text edits).
 */
export function computeRichTextSelectionState(
  root: HTMLElement
): RichTextSelectionState {
  const selection = root.ownerDocument?.defaultView?.getSelection() ?? window.getSelection()
  const fallback: RichTextSelectionState = {
    active: false,
    rect: null,
    start: null,
    end: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    color: undefined,
    fontFamily: undefined,
    fontSize: undefined,
    mixed: false
  }
  if (!selection || selection.rangeCount === 0) return fallback
  const range = selection.getRangeAt(0)
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return fallback

  let rect: DOMRect | null = null
  try {
    rect = range.getBoundingClientRect()
  } catch {
    rect = null
  }
  if (rect && rect.width === 0 && rect.height === 0) rect = null

  const start = boundaryCharOffset(root, range.startContainer, range.startOffset)
  const end = boundaryCharOffset(root, range.endContainer, range.endOffset)

  // Span-level formatting at the selection start node.
  const anchorNode = range.startContainer
  const element =
    anchorNode.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : (anchorNode.parentElement ?? root)
  const style = element === root ? {} : styleAtElement(element, root)

  return {
    active: true,
    rect,
    start,
    end,
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    strikethrough: style.strikethrough === true,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    mixed: false
  }
}

/** Whether a caret currently sits inside `root` (used to keep the toolbar). */
export function editorHasFocusSelection(root: HTMLElement): boolean {
  const selection = root.ownerDocument?.defaultView?.getSelection() ?? window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const node = selection.getRangeAt(0).startContainer
  return root.contains(node)
}
