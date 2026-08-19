import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-1',
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
          children: [{ id: 'child', title: 'Child', children: [] }]
        },
        elements: [
          {
            id: 'shape-1',
            type: 'shape',
            shape: 'rect',
            position: { x: 600, y: 220 },
            width: 120,
            height: 80,
            label: 'Shape label',
            labelFormatting: [{ start: 0, end: 5, bold: true, color: '#ff0000' }]
          }
        ],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('MindMapCanvas rich text rendering', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child',
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

  it('renders a topic with span formatting as styled inline runs', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.titleFormatting = [
      { start: 0, end: 2, bold: true, color: '#00ff00' },
      { start: 3, end: 5, fontSize: 18 }
    ]
    render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const child = screen.getByRole('button', { name: 'Child' })
    const richLabel = child.querySelector('.mindmap-node-markdown-label__content')
    expect(richLabel).not.toBeNull()
    const runs = richLabel?.querySelectorAll<HTMLElement>('span[style]')
    const boldRun = Array.from(runs ?? []).find((run) => run.style.fontWeight === 'bold')
    expect(boldRun?.textContent).toBe('Ch')
    expect(boldRun?.style.color).toBe('rgb(0, 255, 0)')
    const sizeRun = Array.from(runs ?? []).find((run) => run.style.fontSize === '18px')
    expect(sizeRun?.textContent).toBe('ld')
  })

  it('falls back to plain SVG text when a topic has no formatting', () => {
    render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    const child = screen.getByRole('button', { name: 'Child' })
    // No formatting → the ordinary SVG text path stays in use.
    expect(child.querySelector('.mindmap-node-label')).not.toBeNull()
    expect(child.querySelector('.mindmap-node-markdown-label__content')).toBeNull()
  })

  it('renders a shape label with span formatting as styled runs', () => {
    render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    const shape = screen.getByRole('button', { name: 'Shape label' })
    const label = shape.querySelector('.mindmap-drawn-shape-label')
    expect(label).not.toBeNull()
    const boldRun = Array.from(label?.querySelectorAll<HTMLElement>('span[style]') ?? [])
      .find((run) => run.style.fontWeight === 'bold')
    expect(boldRun?.textContent).toBe('Shape')
    expect(boldRun?.style.color).toBe('rgb(255, 0, 0)')
  })
})
