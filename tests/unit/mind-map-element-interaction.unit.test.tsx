import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { MIND_MAP_ELEMENT_INTERACTION } from '../../src/renderer/src/views/mindmap/mind-map-element-interaction'
import { computeMindMapLayout } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { MIND_MAP_PROPOSAL_ELEMENT_TYPES } from '../../src/shared/mindmap/commands/mind-map-proposal'
import type { MindMapCommand } from '../../src/shared/mindmap/commands'
import type { MindMapDocumentV2, MindMapElement } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(
  elements: MindMapElement[] = []
): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-interaction',
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
            { id: 'child-a', title: 'Child A', children: [] },
            { id: 'child-b', title: 'Child B', children: [] }
          ]
        },
        elements,
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas(elements: MindMapElement[], panMode = true) {
  return render(
    <MindMapCanvas
      document={makeDocument(elements)}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
      panMode={panMode}
    />
  )
}

type CanvasSelection = ReturnType<typeof useMindMapViewStore.getState>['selection']

function selectedElementIds(selection: CanvasSelection): string[] {
  if (selection.kind === 'element') return [selection.elementId]
  if (selection.kind === 'elements' || selection.kind === 'hybrid') return [...selection.elementIds]
  return []
}

/** One representative element per interaction-registry kind. */
const ELEMENT_FIXTURES: Record<keyof typeof MIND_MAP_ELEMENT_INTERACTION, MindMapElement> = {
  relationship: { id: 'e-1', type: 'relationship', from: 'child-a', to: 'child-b', label: 'relates to' },
  boundary: { id: 'e-1', type: 'boundary', topicId: 'child-a', label: 'Core range' },
  summary: { id: 'e-1', type: 'summary', from: 'child-a', to: 'child-b', label: 'Both topics' },
  callout: { id: 'e-1', type: 'callout', topicId: 'child-a', text: 'Keep in mind', position: { x: 620, y: 260 } },
  shape: { id: 'e-1', type: 'shape', shape: 'rect', position: { x: 620, y: 260 }, width: 120, height: 80 },
  connector: { id: 'e-1', type: 'connector', start: { x: 620, y: 260 }, end: { x: 760, y: 360 } },
  'free-topic': { id: 'e-1', type: 'free-topic', topicId: 'child-a', position: { x: 620, y: 260 } }
}

function sweepMarquee(
  container: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number }
): void {
  const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
  if (!svg) throw new Error('expected mind map SVG')
  fireEvent.pointerDown(svg, { button: 0, pointerId: 80, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(svg, { pointerId: 80, clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(svg, { pointerId: 80, clientX: to.x, clientY: to.y })
}

describe('MindMapElement interaction registry', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
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

  it.each(Object.keys(MIND_MAP_ELEMENT_INTERACTION) as Array<keyof typeof MIND_MAP_ELEMENT_INTERACTION>)(
    'makes the %s kind selectable through its declared interaction',
    (kind) => {
      const spec = MIND_MAP_ELEMENT_INTERACTION[kind]
      const element = ELEMENT_FIXTURES[kind]

      if (spec.presence === 'delegated') {
        // A delegated kind paints nothing of its own; its contract is that it
        // disappears with the surface that renders it (the referenced topic).
        const document = makeDocument([element])
        const result = applyMindMapCommand(document, {
          type: 'topic.remove',
          sheetId: 'sheet-1',
          topicId: 'child-a'
        } satisfies MindMapCommand)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.document.sheets[0]!.elements.some((candidate) => candidate.id === 'e-1')).toBe(false)
        return
      }

      const { container } = renderCanvas([element])
      const hit = container.querySelector<SVGElement>(spec.hitSelector)
      if (!hit) throw new Error(`expected hit target ${spec.hitSelector} for the ${kind} kind`)

      fireEvent.pointerDown(hit, { button: 0, pointerId: 70 })
      expect(useMindMapViewStore.getState().selection).toEqual({
        kind: 'element',
        elementId: 'e-1',
        elementType: kind
      })
    }
  )

  it('keeps every AI-proposal-writable element kind canvas-selectable', () => {
    // This is the anti-drift fuse: the AI can only create kinds listed in the
    // proposal element types, so each of them must be a hit-target kind in the
    // interaction registry. A kind that joins this list without full canvas
    // interaction would let the model write elements the learner cannot
    // select or remove.
    for (const kind of MIND_MAP_PROPOSAL_ELEMENT_TYPES) {
      const spec = MIND_MAP_ELEMENT_INTERACTION[kind]
      expect(spec.presence, `${kind} must be selectable on the canvas`).toBe('hit-target')
    }
  })

  it('marquee sweep picks up a callout intersecting the box', () => {
    const { container } = renderCanvas([ELEMENT_FIXTURES.callout], false)
    // The fixture callout sits at (620, 260) with a 192x52 box; this sweep
    // crosses it without reaching any topic on the left.
    sweepMarquee(container, { x: 560, y: 200 }, { x: 860, y: 380 })

    expect(selectedElementIds(useMindMapViewStore.getState().selection)).toContain('e-1')
  })

  it('marquee sweep does not grab a boundary frame the box does not fully contain', () => {
    const document = makeDocument([ELEMENT_FIXTURES.boundary])
    const layout = computeMindMapLayout(document.sheets[0]!)
    const boundary = layout.boundaries.find((candidate) => candidate.id === 'e-1')
    if (!boundary) throw new Error('expected a computed boundary rect')
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        panMode={false}
      />
    )
    // Sweep a box inside the frame (it still catches the framed topic), so
    // the enclosing boundary must not join the selection.
    sweepMarquee(
      container,
      { x: boundary.x + boundary.width * 0.2, y: boundary.y + boundary.height * 0.2 },
      { x: boundary.x + boundary.width * 0.8, y: boundary.y + boundary.height * 0.8 }
    )

    expect(selectedElementIds(useMindMapViewStore.getState().selection)).not.toContain('e-1')
  })

  it('marquee sweep selects a boundary frame the box fully contains', () => {
    const document = makeDocument([ELEMENT_FIXTURES.boundary])
    const layout = computeMindMapLayout(document.sheets[0]!)
    const boundary = layout.boundaries.find((candidate) => candidate.id === 'e-1')
    if (!boundary) throw new Error('expected a computed boundary rect')
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        panMode={false}
      />
    )
    sweepMarquee(
      container,
      { x: boundary.x - 60, y: boundary.y - 60 },
      { x: boundary.x + boundary.width + 60, y: boundary.y + boundary.height + 60 }
    )

    expect(selectedElementIds(useMindMapViewStore.getState().selection)).toContain('e-1')
  })
})
