import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { tags as highlightTags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

const markdownHighlight = HighlightStyle.define([
  { tag: highlightTags.heading1, color: 'var(--text)', fontSize: '1.28em', fontWeight: '700' },
  { tag: highlightTags.heading2, color: 'var(--text)', fontSize: '1.14em', fontWeight: '700' },
  { tag: [highlightTags.heading3, highlightTags.heading4, highlightTags.heading5, highlightTags.heading6], color: 'var(--text)', fontWeight: '700' },
  { tag: highlightTags.strong, color: 'var(--text)', fontWeight: '700' },
  { tag: highlightTags.emphasis, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: highlightTags.strikethrough, color: 'var(--text-soft)', textDecoration: 'line-through' },
  { tag: [highlightTags.link, highlightTags.url], color: 'var(--accent)' },
  { tag: highlightTags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: highlightTags.monospace, color: 'var(--accent)' },
  { tag: highlightTags.list, color: 'var(--accent)' },
  { tag: [highlightTags.meta, highlightTags.contentSeparator], color: 'var(--text-soft)' }
])

function buildEditorTheme() {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: '13px'
    },
    '.cm-scroller': {
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: '1.75',
      padding: '42px 30px 72px'
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
      minHeight: '100%'
    },
    '.cm-line': {
      padding: '0'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
      borderLeftWidth: '1.5px'
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: '0',
      color: 'var(--text-soft)',
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: '11px',
      paddingRight: '8px'
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'transparent'
    },
    '.cm-activeLineGutter': {
      color: 'var(--text)'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(79, 124, 245, 0.22)'
    },
    '.cm-panels': {
      borderColor: 'var(--line)',
      backgroundColor: 'var(--surface-solid)',
      color: 'var(--text)'
    },
    '.cm-search': {
      padding: '8px 10px',
      gap: '8px'
    },
    '.cm-search label': {
      color: 'var(--text-muted)',
      fontSize: '12px'
    },
    '.cm-textfield': {
      border: '1px solid var(--line)',
      borderRadius: '8px',
      backgroundColor: 'var(--surface-subtle)',
      color: 'var(--text)',
      padding: '4px 8px'
    },
    '.cm-button': {
      border: '1px solid var(--line)',
      borderRadius: '8px',
      backgroundImage: 'none',
      backgroundColor: 'var(--surface-solid)',
      color: 'var(--text)',
      padding: '4px 8px',
      fontSize: '12px'
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(225, 169, 90, 0.28)'
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'rgba(79, 124, 245, 0.26)'
    }
  })
}

export function MarkdownEditor({
  value,
  onChange,
  onSave
}: {
  value: string
  onChange: (next: string) => void
  onSave: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        syntaxHighlighting(markdownHighlight, { fallback: true }),
        markdown(),
        EditorView.lineWrapping,
        search({ top: true }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current()
              return true
            }
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab
        ]),
        buildEditorTheme(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        })
      ]
    })

    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    })
  }, [value])

  return <div className="markdown-code-editor" ref={hostRef} />
}
