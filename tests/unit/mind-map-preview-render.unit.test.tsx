import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  MindMapDocumentV2,
  MindMapElement
} from '../../src/shared/mindmap/domain/types'
import type { MindMapCardPreview } from '../../src/shared/mindmap/mind-map-types'
import { MindMapPreview } from '../../src/renderer/src/views/mindmap/mind-map-preview-render'

const NOW = '2026-08-20T00:00:00.000Z'

function makeDocument(elements: MindMapElement[]): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-preview-elements',
    revision: 1,
    title: 'Preview elements',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'studiumx-default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: {
          id: 'root',
          title: 'Root',
          children: [
            { id: 'child-1', title: 'First branch', children: [] },
            { id: 'child-2', title: 'Second branch', children: [] }
          ]
        },
        elements,
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function previewFrom(document: MindMapDocumentV2): MindMapCardPreview {
  const sheet = document.sheets[0]!
  return {
    theme: document.theme,
    root: sheet.root,
    layout: sheet.layout,
    elements: sheet.elements
  }
}

function renderPreview(document: MindMapDocumentV2) {
  return render(
    <MindMapPreview preview={previewFrom(document)} title={document.title} />
  )
}

describe('MindMapPreview element rendering', () => {
  it('renders a free-drawn shape from the first-sheet elements', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'shape-1',
        type: 'shape',
        shape: 'rect',
        position: { x: 600, y: 220 },
        width: 120,
        height: 80,
        label: 'Free shape'
      }
    ]))

    expect(container.querySelectorAll('.mindmap-drawn-shape')).toHaveLength(1)
    expect(container.querySelector('.mindmap-drawn-shape-label')).toHaveTextContent('Free shape')
  })

  it('renders a free connector between two topics', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'connector-1',
        type: 'connector',
        start: { x: 0, y: 0, anchor: { targetType: 'topic', targetId: 'child-1' } },
        end: { x: 0, y: 0, anchor: { targetType: 'topic', targetId: 'child-2' } },
        label: 'Connector'
      }
    ]))

    expect(container.querySelectorAll('.mindmap-drawn-line')).toHaveLength(1)
  })

  it('renders a relationship connector with its label', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'rel-1',
        type: 'relationship',
        from: 'child-1',
        to: 'child-2',
        label: 'related to'
      }
    ]))

    expect(container.querySelectorAll('.mindmap-relationship')).toHaveLength(1)
    expect(container.querySelector('.mindmap-relationship-label')).toHaveTextContent('related to')
  })

  it('renders a boundary enclosing the bounded subtree', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'boundary-1',
        type: 'boundary',
        topicId: 'child-1',
        label: 'Boundary'
      }
    ]))

    expect(container.querySelectorAll('.mindmap-boundary')).toHaveLength(1)
    expect(container.querySelector('.mindmap-boundary-label')).toHaveTextContent('Boundary')
  })

  it('renders a summary brace over a sibling range', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'summary-1',
        type: 'summary',
        from: 'child-1',
        to: 'child-2',
        label: 'Summary'
      }
    ]))

    expect(container.querySelectorAll('.mindmap-summary-brace')).toHaveLength(1)
  })

  it('renders a callout with its leader and text', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'callout-1',
        type: 'callout',
        topicId: 'child-1',
        text: 'Review this',
        position: { x: 420, y: 80 }
      }
    ]))

    expect(container.querySelectorAll('.mindmap-callout')).toHaveLength(1)
    expect(container.querySelectorAll('.mindmap-callout-leader')).toHaveLength(1)
    expect(container.querySelector('.mindmap-callout-text')).toHaveTextContent('Review this')
  })

  it('renders topic nodes and tree edges alongside the elements', () => {
    const { container } = renderPreview(makeDocument([
      {
        id: 'shape-1',
        type: 'shape',
        shape: 'ellipse',
        position: { x: 600, y: 220 },
        width: 100,
        height: 60
      }
    ]))

    expect(container.querySelectorAll('.mindmap-edge, .mindmap-edge--tapered').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('rect.mindmap-node-rect, rect').length).toBeGreaterThan(0)
    expect(container.querySelector('.mindmap-home-card__svg')).toBeInTheDocument()
  })

  it('renders a placeholder when the document has no root topic', () => {
    const { container } = render(
      <MindMapPreview preview={undefined} title="Empty" />
    )
    expect(container.querySelector('.mindmap-home-card__svg')).toBeInTheDocument()
  })
})
