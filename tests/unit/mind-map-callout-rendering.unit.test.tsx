import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(
  elements: MindMapDocumentV2['sheets'][number]['elements'] = []
): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-callout',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root',
          children: [
            { id: 'visible', title: 'Visible topic', children: [] },
            {
              id: 'collapsed',
              title: 'Collapsed topic',
              collapsed: true,
              children: [{ id: 'hidden', title: 'Hidden topic', children: [] }]
            }
          ]
        },
        elements,
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas(elements: MindMapDocumentV2['sheets'][number]['elements']) {
  return render(
    <MindMapCanvas
      document={makeDocument(elements)}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
    />
  )
}

describe('MindMapCanvas callout rendering', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root'] },
      selectedNodeId: 'root',
      editingNodeId: null
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })
  })

  it('renders a callout with a leader anchored to its visible topic', () => {
    const { container } = renderCanvas([
      {
        id: 'callout-1',
        type: 'callout',
        topicId: 'visible',
        text: 'Review this definition',
        position: { x: 420, y: 80 }
      }
    ])

    expect(container.querySelectorAll('.mindmap-callout')).toHaveLength(1)
    expect(container.querySelectorAll('.mindmap-callout-leader')).toHaveLength(1)
    expect(container.querySelector('.mindmap-callout-text')).toHaveTextContent('Review this definition')
    expect(screen.getByRole('button', { name: 'Review this definition' })).toBeInTheDocument()
  })

  it('skips callouts whose topic is missing or hidden by collapse', () => {
    const { container } = renderCanvas([
      { id: 'missing', type: 'callout', topicId: 'not-in-tree', text: 'Missing topic' },
      { id: 'hidden', type: 'callout', topicId: 'hidden', text: 'Hidden topic' }
    ])

    expect(container.querySelectorAll('.mindmap-callout')).toHaveLength(0)
    expect(screen.queryByText('Missing topic')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden topic')).not.toBeInTheDocument()
  })

  it('lets the document global font override preset layer fonts while preserving a local topic override', () => {
    const document = makeDocument([])
    document.theme = {
      id: 'preset',
      fontFamily: 'Global Font',
      topicStyles: {
        central: { fontFamily: 'Preset Root Font' },
        main: { fontFamily: 'Preset Main Font' }
      }
    }
    document.sheets[0]!.root.children[0]!.style = { fontFamily: 'Local Topic Font' }

    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const labels = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
    const rootLabel = labels.find((label) => label.textContent === 'Root')
    const localLabel = labels.find((label) => label.textContent === 'Visible topic')
    const inheritedLabel = labels.find((label) => label.textContent === 'Collapsed topic')

    expect(rootLabel?.style.fontFamily).toBe('\"Global Font\"')
    expect(localLabel?.style.fontFamily).toBe('\"Local Topic Font\"')
    expect(inheritedLabel?.style.fontFamily).toBe('\"Global Font\"')
  })

  it('does not render a callout layer when no callout elements are present', () => {
    const { container } = renderCanvas([])

    expect(container.querySelector('.mindmap-callout-group')).not.toBeInTheDocument()
  })
  it('consumes every persisted callout style field', () => {
    const { container } = renderCanvas([{
      id: 'styled-callout', type: 'callout', topicId: 'visible', text: 'Styled',
      style: { stroke: '#123456', strokeWidth: 3, fill: '#FEDCBA', textColor: '#334455',
        fontFamily: 'Georgia, serif', fontSize: 17, dashed: true }
    }])
    expect(container.querySelector('.mindmap-callout-leader')).toHaveStyle({
      stroke: '#123456', strokeWidth: '3', strokeDasharray: '5 4'
    })
    expect(container.querySelector('.mindmap-callout')).toHaveStyle({
      stroke: '#123456', strokeWidth: '3', fill: '#FEDCBA', strokeDasharray: '5 4'
    })
    expect(container.querySelector('.mindmap-callout-text')).toHaveStyle({
      fill: '#334455', fontFamily: 'Georgia, serif', fontSize: '17px'
    })
  })

  it('renders an invisible whole-box hit target that selects the callout on pointer down', () => {
    const { container } = renderCanvas([
      { id: 'callout-1', type: 'callout', topicId: 'visible', text: 'Review this definition', position: { x: 420, y: 80 } }
    ])
    const hit = container.querySelector<SVGPathElement>('.mindmap-callout-hit')
    if (!hit) throw new Error('expected callout hit target')

    expect(hit).toHaveAttribute('fill', 'transparent')
    expect(hit).toHaveAttribute('pointer-events', 'all')

    fireEvent.pointerDown(hit, { button: 0, pointerId: 63 })
    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'element',
      elementId: 'callout-1',
      elementType: 'callout'
    })
  })

})
