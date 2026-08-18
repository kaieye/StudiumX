import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { renderMarkdownInlineHtml } from '../../src/renderer/src/markdown-preview'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-15T00:00:00.000Z'
const originalOpenExternal = useAppStore.getState().openExternal

function makeDocument(title: string): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-markdown',
    revision: 1,
    title: 'Markdown map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Markdown topics',
        root: { id: 'root', title, children: [] },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('mind-map topic markdown', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root'] },
      selectedNodeId: 'root',
      editingNodeId: null
    })
  })

  afterEach(() => {
    useAppStore.setState({ openExternal: originalOpenExternal })
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })
  })

  it('renders bold, mark, and inline math inside a topic frame', () => {
    const title = '**重点** =高亮= $x^2+y^2$'
    render(
      <MindMapCanvas
        document={makeDocument(title)}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const topic = screen.getByRole('button', { name: title })
    const label = topic.querySelector<HTMLElement>('.mindmap-node-markdown-label')

    expect(label).toBeInTheDocument()
    expect(label?.querySelector('strong')).toHaveTextContent('重点')
    expect(label?.querySelector('mark')).toHaveTextContent('高亮')
    expect(label?.querySelector('.markdown-math .katex')).toBeInTheDocument()
  })

  it('renders links, emphasis, strikethrough, and inline code inside a topic frame', () => {
    const title = '*斜体* ~~删除~~ `code` [网页](https://example.com) https://openai.com'
    render(
      <MindMapCanvas
        document={makeDocument(title)}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const topic = screen.getByRole('button', { name: title })
    const label = topic.querySelector<HTMLElement>('.mindmap-node-markdown-label')

    expect(label?.querySelector('em')).toHaveTextContent('斜体')
    expect(label?.querySelector('s')).toHaveTextContent('删除')
    expect(label?.querySelector('code')).toHaveTextContent('code')
    const links = label?.querySelectorAll('a') ?? []
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://example.com')
    expect(links[1]).toHaveAttribute('href', 'https://openai.com')
  })

  it('renders dollar-delimited formula blocks inside a topic frame', () => {
    const title = '$$\n\\frac{a}{b}\n$$'
    render(
      <MindMapCanvas
        document={makeDocument(title)}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const topic = screen.getByRole('button', { name: title })
    expect(topic.querySelector('.markdown-math--block .katex-display')).toBeInTheDocument()
  })

  it('opens rendered web links through the external-destination adapter', () => {
    const openExternal = vi.fn(async () => undefined)
    useAppStore.setState({ openExternal })
    const title = '[网页](https://example.com)'
    render(
      <MindMapCanvas
        document={makeDocument(title)}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const topic = screen.getByRole('button', { name: title })
    fireEvent.click(topic.querySelector('a')!)

    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
  })

  it('edits the canonical raw markdown text in place', () => {
    const title = '**Bold** =mark= $x$'
    render(
      <MindMapCanvas
        document={makeDocument(title)}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: title }))

    expect(screen.getByDisplayValue(title)).toHaveClass('mindmap-node-input')
  })

  it('escapes raw HTML while rendering inline markdown', () => {
    const html = renderMarkdownInlineHtml('<img src=x onerror="alert(1)"> **safe**')

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('<strong>safe</strong>')
  })
})
