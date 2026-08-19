import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { MindMapTextSpan, MindMapTextSpanStyle } from '../../../../shared/mindmap/domain/types'
import {
  applyStyleToEditorRange,
  computeRichTextSelectionState,
  editorHasFocusSelection,
  parseRichTextDom,
  serializeRichTextToHtml,
  type RichTextSelectionState
} from './mind-map-rich-text-dom'

export type MindMapRichTextEditorHandle = {
  /** Apply (or toggle) a style over the current selection. */
  applyStyle: (style: MindMapTextSpanStyle, toggle?: boolean) => boolean
  /** Focus the editor and select all of its content. */
  focusAndSelectAll: () => void
  /** The underlying contentEditable element (for sizing/measurement). */
  root: HTMLDivElement | null
}

export type MindMapRichTextEditorProps = {
  text: string
  spans: MindMapTextSpan[]
  /** Base text style applied to the editor (font family/size/weight/color…). */
  baseStyle?: CSSProperties
  placeholder?: string
  ariaLabel?: string
  className?: string
  /** Whether the editor is multiline (shapes). Nodes commit on Enter instead. */
  multiline?: boolean
  /** Select the whole label when the editor gains focus (fresh edit). */
  selectAllOnFocus?: boolean
  /** Focus the editor on mount (matches the previous textarea autoFocus). */
  autoFocus?: boolean
  /** Reports every model change (typing or formatting). */
  onModelChange?: (text: string, spans: MindMapTextSpan[]) => void
  /** Reports selection presence/rect/format state for the floating toolbar. */
  onSelectionChange?: (state: RichTextSelectionState) => void
  /** Forwarded keyboard events; the owner decides Enter/Escape semantics. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /** Fired when the editor loses focus, with the blur event and final model. */
  onBlur?: (event: React.FocusEvent<HTMLDivElement>, text: string, spans: MindMapTextSpan[]) => void
}

/**
 * Xmind-style inline rich text editor for mind map labels (topics and drawn
 * shapes).
 *
 * The editor is a contentEditable `<div>`. While the user types, the DOM is
 * the live source of truth and the model is re-derived on every input.
 * Formatting (from the floating toolbar or Cmd/Ctrl+B) is applied *model
 * first*: the DOM is parsed into spans, the pure span algebra computes the new
 * formatting, the DOM is re-rendered and the selection restored over the same
 * character range — so the model and the DOM never drift apart.
 */
export const MindMapRichTextEditor = forwardRef<
  MindMapRichTextEditorHandle,
  MindMapRichTextEditorProps
>(function MindMapRichTextEditor(
  {
    text,
    spans,
    baseStyle,
    placeholder,
    ariaLabel,
    className,
    multiline = true,
    selectAllOnFocus = true,
    autoFocus = false,
    onModelChange,
    onSelectionChange,
    onKeyDown,
    onBlur
  },
  ref
) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(false)
  const onModelChangeRef = useRef(onModelChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onBlurRef = useRef(onBlur)
  const onKeyDownRef = useRef(onKeyDown)
  onModelChangeRef.current = onModelChange
  onSelectionChangeRef.current = onSelectionChange
  onBlurRef.current = onBlur
  onKeyDownRef.current = onKeyDown

  const lastReportedRef = useRef<{ text: string; spans: MindMapTextSpan[] } | null>(null)
  /** Last known non-collapsed selection offsets, kept when the editor blurs so
   *  the right-side panel can still target the selected text. Cleared once the
   *  caret is back inside the editor with no selection (collapsed). */
  const lastSelectionOffsetsRef = useRef<{ start: number; end: number } | null>(null)

  const reportSelection = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const state = computeRichTextSelectionState(root)
    if (state.active && state.start !== null && state.end !== null) {
      lastSelectionOffsetsRef.current = { start: state.start, end: state.end }
    } else if (!state.active && editorHasFocusSelection(root)) {
      // A focused editor with a collapsed caret has no selectable text; drop
      // any earlier selection so panel edits no longer target a stale range.
      lastSelectionOffsetsRef.current = null
    }
    // else: the editor blurred (e.g. into the right panel) — keep the last
    // selection so the panel can still target it.
    onSelectionChangeRef.current?.(state)
  }, [])

  const reportModel = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const { text: nextText, spans: nextSpans } = parseRichTextDom(root)
    lastReportedRef.current = { text: nextText, spans: nextSpans }
    onModelChangeRef.current?.(nextText, nextSpans)
    reportSelection()
  }, [reportSelection])

  const spansEqual = useCallback((a: MindMapTextSpan[], b: MindMapTextSpan[]): boolean => {
    return JSON.stringify(a) === JSON.stringify(b)
  }, [])

  // Seed the editor DOM from the props, and re-seed whenever the props change
  // in a way the editor did not itself produce (e.g. the owner starts editing
  // a different node, or undo/redo restores a different title). While the user
  // types or formats, `reportModel` records the last emitted model so the
  // echoed props are recognised and the DOM (and the caret) is left alone.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const last = lastReportedRef.current
    const propsChanged = last === null || last.text !== text || !spansEqual(last.spans, spans)
    if (!propsChanged) return

    lastReportedRef.current = { text, spans }
    root.innerHTML = serializeRichTextToHtml(text, spans)
    if (!mountedRef.current) {
      mountedRef.current = true
      if (selectAllOnFocus) {
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(root)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
      if (autoFocus) root.focus()
      // Initial selection report so the toolbar can react on first paint.
      reportSelection()
    } else {
      // External re-seed (e.g. a different node started editing): put the
      // caret at the end so the user can continue typing immediately.
      const selection = window.getSelection()
      if (selection) {
        const range = document.createRange()
        range.selectNodeContents(root)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, spans])

  // Track selection changes (mouse drags, keyboard moves, clicks) so the
  // floating toolbar follows the text selection and updates its state.
  useEffect(() => {
    const onDocumentSelectionChange = (): void => {
      const root = rootRef.current
      if (root && editorHasFocusSelection(root)) reportSelection()
      else onSelectionChangeRef.current?.({
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
      })
    }
    document.addEventListener('selectionchange', onDocumentSelectionChange)
    return () => document.removeEventListener('selectionchange', onDocumentSelectionChange)
  }, [reportSelection])

  const handleInput = useCallback((): void => {
    reportModel()
  }, [reportModel])

  const handleFocus = useCallback((): void => {
    const root = rootRef.current
    if (!root || !selectAllOnFocus) return
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(root)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [selectAllOnFocus])

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const root = rootRef.current
    if (!root) return
    const plainText = event.clipboardData.getData('text/plain')
    if (!plainText) return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return

    range.deleteContents()
    const textNode = document.createTextNode(plainText)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    reportModel()
  }, [reportModel])

  const applyStyle = useCallback(
    (style: MindMapTextSpanStyle, toggle = false): boolean => {
      const root = rootRef.current
      if (!root) return false
      // Prefer the live DOM selection; when the editor is not focused (e.g.
      // the user is interacting with the right-side panel) fall back to the
      // last known selection offsets so the panel still targets the selection.
      const liveRange = editorHasFocusSelection(root)
        ? undefined
        : lastSelectionOffsetsRef.current ?? undefined
      const applied = applyStyleToEditorRange(root, style, toggle, liveRange)
      if (applied) reportModel()
      return applied
    },
    [reportModel]
  )

  const focusAndSelectAll = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    root.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(root)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  useImperativeHandle(
    ref,
    () => ({ applyStyle, focusAndSelectAll, root: rootRef.current }),
    [applyStyle, focusAndSelectAll]
  )

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    // Cmd/Ctrl+B toggles bold regardless of the owner's key handling.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      event.stopPropagation()
      applyStyle({ bold: true }, true)
      return
    }
    onKeyDownRef.current?.(event)
  }, [applyStyle])

  return (
    <div
      ref={rootRef}
      className={`mindmap-richtext${className ? ` ${className}` : ''}${multiline ? '' : ' is-single-line'}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      spellCheck={false}
      style={baseStyle}
      onInput={handleInput}
      onFocus={handleFocus}
      onBlur={(event: ReactFocusEvent<HTMLDivElement>) => {
        const root = rootRef.current
        if (!root) return
        const model = parseRichTextDom(root)
        onBlurRef.current?.(event, model.text, model.spans)
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        // Let the caret move normally but keep selection reporting in sync.
        reportSelection()
        event.stopPropagation()
      }}
      onDoubleClick={(event) => {
        // A double-click inside the editor must not bubble to the node/shape
        // group, whose own double-click handler would restart the edit with
        // the old title/label and discard the in-progress text.
        event.stopPropagation()
      }}
      onMouseUp={reportSelection}
      onKeyUp={reportSelection}
    />
  )
})
