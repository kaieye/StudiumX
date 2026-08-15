import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { computeMindMapLayout } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import { fitMindMapViewport } from '../../src/renderer/src/views/mindmap/mind-map-viewport'
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
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas(document = makeDocument()) {
  return render(
    <MindMapCanvas
      document={document}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
    />
  )
}

describe('MindMapCanvas accessibility', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
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

  it('exposes each rendered topic as an accessible, roving button', () => {
    renderCanvas()

    expect(screen.getByRole('img', { name: 'Overview' })).toBeInTheDocument()
    const root = screen.getByRole('button', { name: 'Root' })
    const child = screen.getByRole('button', { name: 'Child' })

    expect(root).toHaveAttribute('aria-pressed', 'true')
    expect(root).toHaveAttribute('tabindex', '0')
    expect(child).toHaveAttribute('aria-pressed', 'false')
    expect(child).toHaveAttribute('tabindex', '-1')
  })

  it('renders the quick-add disc and centered vector plus as one control', () => {
    const { container } = renderCanvas()
    const root = screen.getByRole('button', { name: 'Root' })
    const action = root.querySelector<SVGGElement>('.mindmap-node-action-group--right')
    const disc = action?.querySelector<SVGCircleElement>('.mindmap-node-action--add')
    const plus = action?.querySelector<SVGPathElement>('.mindmap-node-action-plus')

    expect(action).toBeInTheDocument()
    expect(disc).toBeInTheDocument()
    expect(plus).toBeInTheDocument()
    expect(plus?.getAttribute('d')).toContain(`M ${Number(disc?.getAttribute('cx')) - 4.5}`)
    expect(container.querySelector('.mindmap-node-action-label--add')).not.toBeInTheDocument()
  })

  it.each([
    ['org.xmind.ui.logic.balanced', ['left', 'right']],
    ['org.xmind.ui.logic.left', ['left']],
    ['org.xmind.ui.logic.down', ['bottom']],
    ['org.xmind.ui.logic.up', ['top']],
    ['org.xmind.ui.timeline.horizontal', ['right']],
    ['org.xmind.ui.fishbone.rightHeaded', ['left']]
  ] as const)('places root quick-add controls naturally for %s', (structureClass, directions) => {
    const document = makeDocument()
    document.sheets[0]!.layout.structureClass = structureClass

    renderCanvas(document)

    const root = screen.getByRole('button', { name: 'Root' })
    const actualDirections = [...root.querySelectorAll<SVGGElement>('.mindmap-node-action-group')]
      .map((action) => action.className.baseVal.match(/mindmap-node-action-group--(\w+)/)?.[1])
      .filter((direction): direction is string => Boolean(direction))

    expect(actualDirections).toEqual(directions)
  })

  it('shows an unnamed topic as 未命名 instead of 未命名主题', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.title = ''

    renderCanvas(document)

    const unnamedTopic = screen.getByRole('button', { name: '未命名' })
    expect(unnamedTopic).toHaveTextContent('未命名')
    expect(unnamedTopic).not.toHaveTextContent('未命名主题')
  })

  it('lets pointer users select an accessible topic without entering edit mode', () => {
    renderCanvas()

    const child = screen.getByRole('button', { name: 'Child' })
    child.focus()
    fireEvent.pointerDown(child)

    expect(useMindMapViewStore.getState().selectedNodeId).toBe('child')
    expect(useMindMapViewStore.getState().editingNodeId).toBeNull()
    expect(child).toHaveAttribute('aria-pressed', 'true')
    expect(child).toHaveAttribute('tabindex', '0')
  })

  it('edits a double-clicked topic in place without changing its typography or anchor', async () => {
    const user = userEvent.setup()
    const { container } = renderCanvas()
    const root = screen.getByRole('button', { name: 'Root' })
    const labelBefore = root.querySelector<SVGTextElement>('.mindmap-node-label')
    const labelPositionBefore = {
      x: labelBefore?.getAttribute('x'),
      y: labelBefore?.getAttribute('y'),
      textAnchor: labelBefore?.getAttribute('text-anchor')
    }

    await user.dblClick(root)

    expect(useMindMapViewStore.getState().editingNodeId).toBe('root')
    const editor = screen.getByDisplayValue('Root')
    expect(editor).toHaveStyle({
      color: 'var(--mindmap-theme-text, var(--text))',
      fontFamily: 'var(--mindmap-theme-font, inherit)',
      fontSize: '26px',
      fontWeight: '600',
      letterSpacing: '0.01em',
      lineHeight: '1',
      textAlign: 'center'
    })
    const foreignObject = editor.closest('.mindmap-node-foreign')
    const topicShape = root.querySelector<SVGElement>('.mindmap-node-rect')
    expect(foreignObject).toHaveAttribute('x', topicShape?.getAttribute('x'))
    expect(foreignObject).toHaveAttribute('y', topicShape?.getAttribute('y'))
    expect(foreignObject).toHaveAttribute('width', topicShape?.getAttribute('width'))
    expect(foreignObject).toHaveAttribute('height', topicShape?.getAttribute('height'))

    fireEvent.keyDown(editor, { key: 'Escape' })

    const labelAfter = container.querySelector<SVGTextElement>('.mindmap-node-label')
    expect(labelAfter).toHaveAttribute('x', labelPositionBefore.x)
    expect(labelAfter).toHaveAttribute('y', labelPositionBefore.y)
    expect(labelAfter).toHaveAttribute('text-anchor', labelPositionBefore.textAnchor)
    expect(labelAfter).toHaveStyle({
      fill: 'var(--mindmap-theme-text, var(--text))',
      fontFamily: 'var(--mindmap-theme-font, inherit)',
      fontSize: '26px',
      fontWeight: '600',
      letterSpacing: '0.01em'
    })
  })

  it('selects any double-clicked topic and keeps branch typography while editing', async () => {
    const user = userEvent.setup()
    renderCanvas()

    await user.dblClick(screen.getByRole('button', { name: 'Child' }))

    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'topic',
      topicIds: ['child']
    })
    expect(screen.getByDisplayValue('Child')).toHaveStyle({
      color: '#ffffff',
      fontSize: '16px',
      fontWeight: '500',
      lineHeight: '1',
      textAlign: 'left'
    })
  })

  it('enters edit mode from two primary pointer activations even when no dblclick event is emitted', () => {
    renderCanvas()
    const canvas = screen.getByRole('img', { name: 'Overview' })
    const child = screen.getByRole('button', { name: 'Child' })

    fireEvent.pointerDown(child, { button: 0, clientX: 240, clientY: 160 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 240, clientY: 160 })
    fireEvent.pointerDown(child, { button: 0, clientX: 240, clientY: 160 })

    expect(useMindMapViewStore.getState().editingNodeId).toBe('child')
    expect(screen.getByDisplayValue('Child')).toHaveFocus()
  })

  it('does not mistake a node drag followed by a click for a double-click', () => {
    renderCanvas()
    const canvas = screen.getByRole('img', { name: 'Overview' })
    const child = screen.getByRole('button', { name: 'Child' })

    fireEvent.pointerDown(child, { button: 0, clientX: 240, clientY: 160 })
    fireEvent.pointerMove(canvas, { button: 0, clientX: 264, clientY: 160 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 264, clientY: 160 })
    fireEvent.pointerDown(child, { button: 0, clientX: 240, clientY: 160 })

    expect(useMindMapViewStore.getState().editingNodeId).toBeNull()
    expect(screen.queryByDisplayValue('Child')).not.toBeInTheDocument()
  })

  it('uses Ctrl/Cmd pointer activation to toggle topics in a multi-selection', () => {
    renderCanvas()

    const root = screen.getByRole('button', { name: 'Root' })
    const child = screen.getByRole('button', { name: 'Child' })
    fireEvent.pointerDown(child, { ctrlKey: true })

    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'topic',
      topicIds: ['root', 'child']
    })
    expect(root).toHaveAttribute('aria-pressed', 'true')
    expect(child).toHaveAttribute('aria-pressed', 'true')
    expect(child).toHaveAttribute('tabindex', '0')

    fireEvent.pointerDown(child, { metaKey: true })
    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'topic',
      topicIds: ['root']
    })
    expect(root).toHaveAttribute('aria-pressed', 'true')
    expect(child).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders one selection decoration on the topic instead of a second outer ring', () => {
    const { container } = renderCanvas()

    expect(container.querySelectorAll('.mindmap-node-ring')).toHaveLength(0)
    const selected = container.querySelector('.mindmap-node-group.is-selected')
    expect(selected).not.toBeNull()
    expect(selected).toHaveStyle({ outline: 'none' })
    expect(selected?.querySelector('.mindmap-node-rect')).toHaveStyle({ stroke: 'var(--mm-focus)' })
  })

  it('keeps hover from drawing a second topic highlight beside the selected topic', () => {
    renderCanvas()

    const root = screen.getByRole('button', { name: 'Root' })
    const child = screen.getByRole('button', { name: 'Child' })
    fireEvent.pointerEnter(child)

    expect(root.querySelector('.mindmap-node-rect')).toHaveStyle({ stroke: 'var(--mm-focus)' })
    expect(child.querySelector('.mindmap-node-rect')).not.toHaveStyle({ stroke: 'var(--mm-focus)' })
  })

  it('renders persisted bold, italic, underline, and strikethrough topic styles together', () => {
    const document = makeDocument()
    document.sheets[0]!.root.style = {
      fontWeight: '700',
      fontStyle: 'italic',
      textDecoration: 'line-through underline',
      textTransform: 'uppercase'
    }
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const rootLabel = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent === 'Root')
    expect(rootLabel?.style.fontWeight).toBe('700')
    expect(rootLabel?.style.fontStyle).toBe('italic')
    expect(rootLabel?.style.textDecoration).toBe('line-through underline')
    expect(rootLabel?.style.textTransform).toBe('uppercase')
    expect(rootLabel?.textContent).toBe('Root')
  })

  it('renders the XMind numbering prefix for a numbered child', () => {
    const document = makeDocument()
    document.sheets[0]!.root.numbering = { pattern: 'arabic' }
    document.sheets[0]!.root.children = [
      { id: 'child', title: 'Child', children: [] },
      { id: 'sibling', title: 'Sibling', children: [] }
    ]
    const { container } = renderCanvas(document)

    const childLabel = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent?.includes('Child'))
    const childNumber = childLabel?.querySelector('.mindmap-node-number')
    expect(childNumber?.textContent?.trim()).toBe('1')
    expect(childLabel?.textContent).toContain('Child')

    const siblingLabel = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent?.includes('Sibling'))
    expect(siblingLabel?.querySelector('.mindmap-node-number')?.textContent?.trim()).toBe('2')

    // The root is above any rule so it has no prefix.
    const rootLabel = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent?.trim() === 'Root')
    expect(rootLabel?.querySelector('.mindmap-node-number')).toBeNull()
  })

  it('keeps the number prefix out of the accessible name and the edit field', () => {
    const document = makeDocument()
    document.sheets[0]!.root.numbering = { pattern: 'arabic' }
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child',
      editingNodeId: null
    })
    const { container } = renderCanvas(document)

    const childGroup = [...container.querySelectorAll<SVGGElement>('[role="button"]')]
      .find((g) => g.getAttribute('aria-label') === 'Child')
    expect(childGroup).toBeTruthy()
    expect(childGroup?.getAttribute('aria-label')).toBe('Child')

    // While editing, the static label (and its number) is hidden; only the
    // raw title is shown in the edit input.
    act(() => {
      useMindMapViewStore.setState({ editingNodeId: 'child' })
    })
    expect(screen.getByDisplayValue('Child')).toBeTruthy()
    expect(container.querySelector('.mindmap-node-number')).toBeNull()
  })

  it('uses structural text alignment defaults and honors a local alignment override', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.style = { textAlign: 'right' }
    const { container } = renderCanvas(document)

    const rootLabel = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent === 'Root')
    const childLabel = [...container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent === 'Child')

    expect(rootLabel).toHaveAttribute('text-anchor', 'middle')
    expect(childLabel).toHaveAttribute('text-anchor', 'end')
  })

  it('aligns one-sided branch labels toward the branch direction by default', () => {
    const rightDocument = makeDocument()
    const right = renderCanvas(rightDocument)
    const rightChild = [...right.container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent === 'Child')
    expect(rightChild).toHaveAttribute('text-anchor', 'start')
    right.unmount()

    const leftDocument = makeDocument()
    leftDocument.sheets[0]!.layout.structureClass = 'org.xmind.ui.logic.left'
    const left = renderCanvas(leftDocument)
    const leftChild = [...left.container.querySelectorAll<SVGTextElement>('.mindmap-node-label')]
      .find((label) => label.textContent === 'Child')
    expect(leftChild).toHaveAttribute('text-anchor', 'end')
  })

  it('applies effective topic alignment to the editing input without changing its title', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.style = { textAlign: 'right' }
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child',
      editingNodeId: 'child'
    })

    renderCanvas(document)

    const input = screen.getByDisplayValue('Child')
    expect(input).toHaveStyle({
      color: '#ffffff',
      fontSize: '16px',
      fontWeight: '500',
      lineHeight: '1',
      textAlign: 'right'
    })
    expect(document.sheets[0]!.root.children[0]!.title).toBe('Child')
  })

  it.each([
    ['solid', { stroke: '#123456', borderStyle: 'solid' as const, borderWidth: 3 }, {
      stroke: 'rgb(18, 52, 86)', strokeWidth: '3', strokeDasharray: 'none', filter: ''
    }],
    ['dash', { stroke: '#123456', borderStyle: 'dash' as const, borderWidth: 2 }, {
      stroke: 'rgb(18, 52, 86)', strokeWidth: '2', strokeDasharray: '6 4', filter: ''
    }],
    ['none', { stroke: '#123456', borderStyle: 'none' as const, borderWidth: 3 }, {
      stroke: 'none', strokeWidth: '3', strokeDasharray: '', filter: ''
    }],
    ['hand drawn', { stroke: '#123456', borderStyle: 'hand-drawn-solid' as const, borderWidth: 5 }, {
      stroke: 'rgb(18, 52, 86)', strokeWidth: '5', strokeDasharray: 'none', filter: 'url("#mindmap-topic-hand-drawn")'
    }]
  ])('renders persisted %s topic borders when the topic is not selected', (_label, style, expected) => {
    const document = makeDocument()
    document.sheets[0]!.root.style = style
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })

    const { container } = renderCanvas(document)
    const root = [...container.querySelectorAll<SVGGElement>('.mindmap-node-group')]
      .find((node) => node.textContent?.includes('Root'))
    const shape = root?.querySelector<SVGElement>('.mindmap-node-rect')
    expect(shape?.style.stroke).toBe(expected.stroke)
    expect(shape?.style.strokeWidth).toBe(expected.strokeWidth)
    expect(shape?.style.strokeDasharray).toBe(expected.strokeDasharray)
    expect(shape?.style.filter).toBe(expected.filter)
  })

  it('lets the selection highlight override a dashed hand-drawn topic border', () => {
    const document = makeDocument()
    document.sheets[0]!.root.style = {
      stroke: '#123456',
      borderStyle: 'hand-drawn-dash',
      borderWidth: 5
    }

    const { container } = renderCanvas(document)
    const selectedShape = container.querySelector<SVGElement>('.mindmap-node-group.is-selected .mindmap-node-rect')
    expect(selectedShape?.style.stroke).toBe('var(--mm-focus)')
    expect(selectedShape?.style.strokeWidth).toBe('2')
    expect(selectedShape?.style.strokeDasharray).toBe('none')
    expect(selectedShape?.style.filter).toBe('none')
  })

  it('lets an explicit border override the shape-none fallback stroke attribute', () => {
    const document = makeDocument()
    document.sheets[0]!.root.style = {
      shape: 'none',
      stroke: '#123456',
      borderStyle: 'solid',
      borderWidth: 3
    }
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })

    const { container } = renderCanvas(document)
    const shape = [...container.querySelectorAll<SVGElement>('.mindmap-node-rect')]
      .find((element) => element.parentElement?.textContent?.includes('Root'))
    expect(shape?.getAttribute('stroke')).toBe('none')
    expect(shape?.style.stroke).toBe('rgb(18, 52, 86)')
  })

  it('keeps the viewport center fixed when toolbar zoom reaches 25%', () => {
    const document = makeDocument()
    const onViewportChange = vi.fn()
    const renderWithAction = (viewportAction: { id: number; type: 'zoom-out' } | null) => (
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onViewportChange={onViewportChange}
        viewportAction={viewportAction}
      />
    )
    const { rerender } = render(renderWithAction(null))
    const initialViewport = onViewportChange.mock.calls.at(-1)?.[0]
    if (!initialViewport) throw new Error('expected an initial canvas viewport')
    onViewportChange.mockClear()

    // Eight 1 / 1.2 steps clamp the canvas to its 25% minimum zoom.
    for (let id = 1; id <= 8; id += 1) {
      rerender(renderWithAction({ id, type: 'zoom-out' }))
    }

    const zoomedViewport = onViewportChange.mock.calls.at(-1)?.[0]
    if (!zoomedViewport) throw new Error('expected a zoomed canvas viewport')

    expect(zoomedViewport.width).toBeCloseTo(3200)
    expect(zoomedViewport.height).toBeCloseTo(2400)
    expect(zoomedViewport.x + zoomedViewport.width / 2).toBeCloseTo(
      initialViewport.x + initialViewport.width / 2
    )
    expect(zoomedViewport.y + zoomedViewport.height / 2).toBeCloseTo(
      initialViewport.y + initialViewport.height / 2
    )
  })

  it('centers a newly opened map after the canvas reports its actual size', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let observer: { callback: ResizeObserverCallback } | null = null

    class ControlledResizeObserver {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        observer = this
      }

      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()
    }

    vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
    const document = makeDocument()
    const { container, unmount } = renderCanvas(document)

    try {
      if (!observer) throw new Error('expected canvas resize observer')

      act(() => {
        observer!.callback(
          [{ contentRect: { width: 1200, height: 900 } } as ResizeObserverEntry],
          observer as unknown as ResizeObserver
        )
      })

      const nodes = computeMindMapLayout(document.sheets[0]!).nodes
      const bounds = nodes.reduce(
        (current, node) => ({
          left: Math.min(current.left, node.x),
          top: Math.min(current.top, node.y),
          right: Math.max(current.right, node.x + node.width),
          bottom: Math.max(current.bottom, node.y + node.height)
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
      )
      const expected = fitMindMapViewport(bounds, { width: 1200, height: 900 })
      const transform = container.querySelector('.mindmap-svg > g')?.getAttribute('transform')

      expect(transform).toBe(`translate(${expected.pan.x} ${expected.pan.y}) scale(${expected.zoom})`)
    } finally {
      unmount()
      vi.stubGlobal('ResizeObserver', originalResizeObserver)
    }
  })

  it('keeps the SVG viewBox in sync during the same resize delivery', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let observer: { callback: ResizeObserverCallback } | null = null

    class ControlledResizeObserver {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        observer = this
      }

      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()
    }

    vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
    const { container, unmount } = renderCanvas(makeDocument())

    try {
      if (!observer) throw new Error('expected canvas resize observer')
      const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
      if (!svg) throw new Error('expected mind map SVG')

      observer.callback(
        [{ contentRect: { width: 1200, height: 900 } } as ResizeObserverEntry],
        observer as unknown as ResizeObserver
      )

      expect(svg).toHaveAttribute('viewBox', '0 0 1200 900')
    } finally {
      unmount()
      vi.stubGlobal('ResizeObserver', originalResizeObserver)
    }
  })

  it.each(['quote', 'callout', 'bracket', 'arrow-right', 'arrow-left', 'heart', 'cloud', 'star', 'parallelogram', 'hexagon'] as const)(
    'renders the %s topic shape with a dedicated class',
    (shape) => {
      const document = makeDocument()
      document.sheets[0]!.root.style = { shape }
      useMindMapViewStore.setState({
        selection: { kind: 'canvas' },
        selectedNodeId: null,
        editingNodeId: null
      })

      const { container } = renderCanvas(document)
      const element = [...container.querySelectorAll<SVGElement>('.mindmap-node-rect')]
        .find((node) => node.parentElement?.textContent?.includes('Root'))
      expect(element).not.toBeNull()
      expect(element!.classList.contains(`mindmap-node-shape--${shape}`)).toBe(true)
    }
  )

  it('renders a fill pattern overlay referencing the matching SVG pattern', () => {
    const document = makeDocument()
    document.sheets[0]!.root.style = { shape: 'hexagon', fillPattern: 'diagonal' }
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })

    const { container } = renderCanvas(document)
    const root = [...container.querySelectorAll<SVGElement>('.mindmap-node-rect')]
      .find((node) => node.parentElement?.textContent?.includes('Root'))
    expect(root).not.toBeNull()
    const pattern = root!.parentElement!.querySelector<SVGElement>('.mindmap-node-pattern')
    expect(pattern).not.toBeNull()
    expect(pattern!.style.fill).toContain('mindmap-pattern-diagonal')
  })

  it('renders a pathological document with unknown shape, pattern and font without throwing (stable fallbacks)', () => {
    const document = makeDocument()
    // Unknown shape token on a topic: must fall back to the stable rounded-rect.
    document.sheets[0]!.root.style = {
      shape: 'squiggle-petal',
      fontFamily: 'Imported XMind Font, sans-serif'
    }
    // Unknown branch line pattern on the sheet layout: falls back to solid.
    document.sheets[0]!.layout = {
      ...document.sheets[0]!.layout,
      linePattern: 'wavy-ribbon' as never
    }
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })

    const { container } = renderCanvas(document)
    const root = [...container.querySelectorAll<SVGElement>('.mindmap-node-rect')]
      .find((node) => node.parentElement?.textContent?.includes('Root'))
    expect(root).not.toBeNull()
    // Unknown shape degrades to the stable rounded-rect class.
    expect(root!.classList.contains('mindmap-node-shape--rounded-rect')).toBe(true)
    // The document still renders its topics: no silent crash.
    expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Child' })).toBeInTheDocument()
  })
})
