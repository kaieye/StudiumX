import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { edgeStrokeWidth } from '../../src/renderer/src/views/mindmap/mind-map-edge-styles'
import { computeMindMapLayout, mindMapTopicLineHeight } from '../../src/renderer/src/views/mindmap/mind-map-layout'
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
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function makeDocumentWithDrawnShape(): MindMapDocumentV2 {
  const document = makeDocument()
  document.sheets[0]!.elements = [{
    id: 'shape-1',
    type: 'shape',
    shape: 'rect',
    position: { x: 600, y: 220 },
    width: 120,
    height: 80
  }]
  return document
}

function makeDocumentWithEditableDrawnShape(): MindMapDocumentV2 {
  const document = makeDocumentWithDrawnShape()
  document.sheets[0]!.elements[0] = {
    ...document.sheets[0]!.elements[0]!,
    label: 'Initial label'
  }
  return document
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

/** The active rich text (contentEditable) editor inside the canvas. */
function getRichTextEditor(): HTMLElement {
  const editor = document.querySelector<HTMLElement>('.mindmap-richtext')
  if (!editor) throw new Error('rich text editor not found')
  return editor
}

/** Replace the editor content and fire an input event (jsdom has no
 *  contentEditable editing, so the DOM must be mutated explicitly). */
function setRichText(editor: HTMLElement, text: string): void {
  editor.textContent = text
  fireEvent.input(editor)
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
    ['studiumx.layout.logic.balanced', ['left', 'right']],
    ['studiumx.layout.logic.left', ['left']],
    ['studiumx.layout.logic.down', ['bottom']],
    ['studiumx.layout.logic.up', ['top']],
    ['studiumx.layout.timeline.horizontal', ['right']],
    ['studiumx.layout.fishbone.rightHeaded', ['left']]
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

  it('uses invisible edge targets for resize instead of showing a resize handle', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null
    })
    const { container } = renderCanvas()
    const root = screen.getByRole('button', { name: 'Root' })

    expect(root.querySelectorAll('.mindmap-node-resize-hitarea')).toHaveLength(2)
    expect(container.querySelector('.mindmap-node-resize-handle')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-node-resize-grip')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('resizes an unselected topic directly from its edge and commits once on release', () => {
    const updateNode = vi.fn()
    const originalUpdateNode = useMindMapViewStore.getState().updateNode
    useMindMapViewStore.setState({
      updateNode,
      selection: { kind: 'canvas' },
      selectedNodeId: null
    })

    try {
      const { container } = renderCanvas()
      const canvas = screen.getByRole('img', { name: 'Overview' })
      const child = screen.getByRole('button', { name: 'Child' })
      const initialWidth = Number(child.querySelector('.mindmap-node-rect')?.getAttribute('width'))
      const rightEdge = child.querySelectorAll<SVGRectElement>('.mindmap-node-resize-hitarea')[1]
      if (!rightEdge) throw new Error('expected child right resize edge')

      fireEvent.pointerDown(rightEdge, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 164, clientY: 100 })

      const previewWidth = Number(child.querySelector('.mindmap-node-rect')?.getAttribute('width'))
      expect(previewWidth).toBeGreaterThan(initialWidth)
      expect(updateNode).not.toHaveBeenCalled()
      expect(container.querySelector('.mindmap-node-group.is-resizing')).toBeInTheDocument()

      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 164, clientY: 100 })

      expect(updateNode).toHaveBeenCalledTimes(1)
      expect(updateNode).toHaveBeenCalledWith('child', {
        style: { widthMode: 'fixed', width: previewWidth }
      })
      expect(useMindMapViewStore.getState().selectedNodeId).toBeNull()
      expect(container.querySelector('.mindmap-node-group.is-resizing')).not.toBeInTheDocument()
    } finally {
      useMindMapViewStore.setState({ updateNode: originalUpdateNode })
    }
  })

  it('wraps a narrow topic label and grows the node height to contain every line', () => {
    const document = makeDocument()
    document.sheets[0]!.root.title = 'A long root topic that must wrap inside its narrow node'
    document.sheets[0]!.root.style = { widthMode: 'fixed', width: 72 }

    renderCanvas(document)

    const root = screen.getByRole('button', { name: document.sheets[0]!.root.title })
    const shape = root.querySelector<SVGElement>('.mindmap-node-rect')
    const label = root.querySelector<SVGTextElement>('.mindmap-node-label')
    const lines = label?.querySelectorAll<SVGTSpanElement>('.mindmap-node-label-line') ?? []

    expect(shape).toHaveAttribute('width', '72')
    expect(Number(shape?.getAttribute('height'))).toBeGreaterThan(56)
    expect(lines.length).toBeGreaterThan(1)
    expect([...lines].every((line) => line.getAttribute('x') === label?.getAttribute('x'))).toBe(true)
  })

  it('justifies every wrapped line but the last on aligned (non-centred) labels', () => {
    // A branch topic (left-aligned) whose CJK title wraps at the 360px
    // auto-width cap: all lines except the final one stretch across the label
    // width; the final line keeps its natural width. Centred labels (root)
    // never justify.
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.title = '字'.repeat(45)
    document.sheets[0]!.root.title = '根'.repeat(45)

    renderCanvas(document)

    const branchLabel = screen
      .getByRole('button', { name: '字'.repeat(45) })
      .querySelector<SVGTextElement>('.mindmap-node-label')
    const branchLines = branchLabel?.querySelectorAll<SVGTSpanElement>('.mindmap-node-label-line') ?? []
    expect(branchLines.length).toBeGreaterThan(1)
    for (const [index, line] of [...branchLines].entries()) {
      if (index < branchLines.length - 1) {
        expect(line.getAttribute('textLength')).toBe(String(360 - 20))
        expect(line.getAttribute('lengthAdjust')).toBe('spacing')
      } else {
        expect(line.getAttribute('textLength')).toBeNull()
      }
    }

    // The centred root keeps natural line widths.
    const rootLabel = screen
      .getByRole('button', { name: '根'.repeat(45) })
      .querySelector<SVGTextElement>('.mindmap-node-label')
    const rootLines = rootLabel?.querySelectorAll<SVGTSpanElement>('.mindmap-node-label-line') ?? []
    expect(rootLines.length).toBeGreaterThan(1)
    expect([...rootLines].every((line) => line.getAttribute('textLength') === null)).toBe(true)
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
    const editor = getRichTextEditor()
    expect(editor).toHaveTextContent('Root')
    expect(editor).toHaveStyle({
      color: 'var(--mindmap-theme-text, var(--text))',
      fontFamily: 'var(--mindmap-theme-font, inherit)',
      fontSize: '26px',
      fontWeight: '600',
      letterSpacing: '0.01em',
      lineHeight: '34px',
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

  it('grows an auto-sized topic while its edited title gets longer', async () => {
    const user = userEvent.setup()
    renderCanvas()

    const root = screen.getByRole('button', { name: 'Root' })
    const shape = root.querySelector<SVGElement>('.mindmap-node-rect')
    const initialWidth = Number(shape?.getAttribute('width'))

    await user.dblClick(root)

    const editor = getRichTextEditor()
    setRichText(editor, 'A much longer topic title that should expand while typing')

    const expandedWidth = Number(shape?.getAttribute('width'))
    expect(expandedWidth).toBeGreaterThan(initialWidth)
    expect(editor.closest('.mindmap-node-foreign')).toHaveAttribute('width', String(expandedWidth))
  })

  it('inserts a new line with Shift+Enter without committing the edit', async () => {
    const user = userEvent.setup()
    renderCanvas()

    const root = screen.getByRole('button', { name: 'Root' })
    const shape = root.querySelector<SVGElement>('.mindmap-node-rect')
    const initialHeight = Number(shape?.getAttribute('height'))

    await user.dblClick(root)

    const editor = getRichTextEditor()
    setRichText(editor, 'Root\nSecond line')
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })

    expect(editor.textContent).toBe('Root\nSecond line')
    expect(useMindMapViewStore.getState().editingNodeId).toBe('root')
    expect(Number(shape?.getAttribute('height'))).toBeGreaterThan(initialHeight)
  })

  it('selects any double-clicked topic and keeps branch typography while editing', async () => {
    const user = userEvent.setup()
    renderCanvas()

    await user.dblClick(screen.getByRole('button', { name: 'Child' }))

    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'topic',
      topicIds: ['child']
    })
    expect(getRichTextEditor()).toHaveStyle({
      color: '#ffffff',
      fontSize: '16px',
      fontWeight: '500',
      lineHeight: '22px',
      textAlign: 'left'
    })
  })

  it('commits the buffered edit when the editing target is switched away without a blur', async () => {
    // Regression: clicking the toolbar "add child" button switches editingNodeId
    // directly; if the editor blur never settles the draft first, the typed text
    // used to be silently dropped. The session buffer must recover it.
    const user = userEvent.setup()
    const updateNode = vi.fn()
    const originalUpdateNode = useMindMapViewStore.getState().updateNode
    useMindMapViewStore.setState({ updateNode })

    try {
      renderCanvas()
      await user.dblClick(screen.getByRole('button', { name: 'Child' }))
      const editor = getRichTextEditor()
      setRichText(editor, 'Typed draft')

      // Simulate the store switching the edit target (insert action) with no
      // intervening blur commit.
      act(() => {
        useMindMapViewStore.setState({ editingNodeId: 'root' })
      })

      expect(updateNode).toHaveBeenCalledWith('child', { title: 'Typed draft' })
    } finally {
      useMindMapViewStore.setState({ updateNode: originalUpdateNode })
    }
  })

  it('exposes commitPendingEdit so the toolbar settles the draft before inserting', async () => {
    const user = userEvent.setup()
    const handleRef = { current: null as null | { commitPendingEdit: () => void } }
    const updateNode = vi.fn()
    const originalUpdateNode = useMindMapViewStore.getState().updateNode
    useMindMapViewStore.setState({ updateNode })

    try {
      render(
        <MindMapCanvas
          ref={handleRef}
          document={makeDocument()}
          activeSheetIndex={0}
          onActiveSheetChange={() => undefined}
        />
      )
      await user.dblClick(screen.getByRole('button', { name: 'Child' }))
      const editor = getRichTextEditor()
      setRichText(editor, 'Draft before insert')

      act(() => {
        handleRef.current?.commitPendingEdit()
      })

      expect(updateNode).toHaveBeenCalledTimes(1)
      expect(updateNode).toHaveBeenCalledWith('child', { title: 'Draft before insert' })
      expect(useMindMapViewStore.getState().editingNodeId).toBeNull()
    } finally {
      useMindMapViewStore.setState({ updateNode: originalUpdateNode })
    }
  })

  it('does not re-commit the draft after Escape cancels the edit', async () => {
    const user = userEvent.setup()
    const updateNode = vi.fn()
    const originalUpdateNode = useMindMapViewStore.getState().updateNode
    useMindMapViewStore.setState({ updateNode })

    try {
      renderCanvas()
      await user.dblClick(screen.getByRole('button', { name: 'Child' }))
      const editor = getRichTextEditor()
      setRichText(editor, 'Cancelled draft')
      fireEvent.keyDown(editor, { key: 'Escape' })

      expect(useMindMapViewStore.getState().editingNodeId).toBeNull()
      expect(updateNode).not.toHaveBeenCalled()
    } finally {
      useMindMapViewStore.setState({ updateNode: originalUpdateNode })
    }
  })

  it('enters edit mode from two primary pointer activations even when no dblclick event is emitted', () => {
    renderCanvas()
    const canvas = screen.getByRole('img', { name: 'Overview' })
    const child = screen.getByRole('button', { name: 'Child' })

    fireEvent.pointerDown(child, { button: 0, clientX: 240, clientY: 160 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 240, clientY: 160 })
    fireEvent.pointerDown(child, { button: 0, clientX: 240, clientY: 160 })

    expect(useMindMapViewStore.getState().editingNodeId).toBe('child')
    expect(getRichTextEditor()).toHaveFocus()
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
    // Selection no longer repaints the node border; a dashed ring sits just
    // outside it so the real border stays editable in the style inspector.
    expect(selected?.querySelector('.mindmap-node-rect')).not.toHaveStyle({ stroke: 'var(--mm-focus)' })
    expect(selected?.querySelector('.mindmap-node-selection')).not.toBeNull()
  })

  it('keeps hover from drawing a second topic highlight beside the selected topic', () => {
    renderCanvas()

    const root = screen.getByRole('button', { name: 'Root' })
    const child = screen.getByRole('button', { name: 'Child' })
    fireEvent.pointerEnter(child)

    expect(root.querySelector('.mindmap-node-rect')).not.toHaveStyle({ stroke: 'var(--mm-focus)' })
    expect(root.querySelector('.mindmap-node-selection')).not.toBeNull()
    expect(child.querySelector('.mindmap-node-rect')).not.toHaveStyle({ stroke: 'var(--mm-focus)' })
    expect(child.querySelector('.mindmap-node-selection')).toBeNull()
  })

  it('renders underline topics as a continuous branch with the label resting above it', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.style = { shape: 'underline' }
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })

    const layout = computeMindMapLayout(document.sheets[0]!)
    const childNode = layout.nodes.find((node) => node.id === 'child')
    if (!childNode) throw new Error('expected child layout node')

    const { container } = renderCanvas(document)
    const child = screen.getByRole('button', { name: 'Child' })
    const underline = child.querySelector<SVGLineElement>('.mindmap-node-shape--underline')
    const label = child.querySelector<SVGTextElement>('.mindmap-node-label')
    const edge = container.querySelector<SVGPathElement>('.mindmap-edge')
    const baselineY = childNode.y + childNode.height

    expect(underline).toHaveAttribute('x1', String(childNode.x))
    expect(underline).toHaveAttribute('y1', String(baselineY))
    expect(edge?.getAttribute('d')).toMatch(new RegExp(`${childNode.x} ${baselineY}$`))
    expect(underline?.style.stroke).toBe(edge?.style.stroke)
    expect(underline?.style.strokeWidth).toBe(String(edgeStrokeWidth(childNode.depth)))
    expect(label?.style.fill).toBe('var(--mindmap-theme-text, var(--text))')
    expect(Number(label?.getAttribute('y'))).toBeLessThan(baselineY)
    expect(baselineY - Number(label?.getAttribute('y'))).toBe(
      3 + mindMapTopicLineHeight(childNode.depth) / 2
    )

    const labelY = Number(label?.getAttribute('y'))
    act(() => {
      useMindMapViewStore.setState({
        selection: { kind: 'topic', topicIds: ['child'] },
        selectedNodeId: 'child',
        editingNodeId: 'child'
      })
    })
    const editorRegion = child.querySelector<SVGForeignObjectElement>('.mindmap-node-input-foreign')
    const editorCenterY = Number(editorRegion?.getAttribute('y'))
      + Number(editorRegion?.getAttribute('height')) / 2
    expect(editorCenterY).toBe(labelY)
    expect(getRichTextEditor()).toHaveTextContent('Child')
  })

  it('renders a tapered edge as a curved taper, not a straight line, with fill and no stroke halo', () => {
    const document = makeDocument()
    document.sheets[0]!.layout = { structureClass: 'studiumx.layout.logic.right', tapered: true }

    const layout = computeMindMapLayout(document.sheets[0]!)
    const fromNode = layout.nodes.find((node) => node.id === 'root')!
    const toNode = layout.nodes.find((node) => node.id === 'child')!

    const { container } = renderCanvas(document)
    const taperedPath = container.querySelector<SVGPathElement>('.mindmap-edge--tapered')
    expect(taperedPath).not.toBeNull()

    const d = taperedPath!.getAttribute('d') ?? ''
    // A curved taper uses a cubic bezier segment (C), not a flat polyline (only L/Z).
    expect(d).toMatch(/C/)
    expect(d).not.toMatch(/^M [^ ]+ [^ ]+ L [^ ]+ [^ ]+ L [^ ]+ [^ ]+ L [^ ]+ [^ ]+ Z$/)

    // No colour halo: the taper uses fill, and stroke must be explicitly cleared
    // so the inherited `.mindmap-edge` line colour does not bleed around it.
    expect(taperedPath!.style.fill).not.toBe('')
    expect(taperedPath!.style.stroke).toBe('none')
    expect(taperedPath!.style.strokeWidth).toBe('')
    expect(taperedPath!.getAttribute('stroke')).toBeNull()
  })

  it('does not replace an underline topic branch color with the selection highlight', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.style = { shape: 'underline' }
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child',
      editingNodeId: null
    })

    renderCanvas(document)

    const child = screen.getByRole('button', { name: 'Child' })
    const underline = child.querySelector<SVGLineElement>('.mindmap-node-shape--underline')
    expect(underline?.style.stroke).not.toBe('var(--mm-focus)')
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

  it('renders the native numbering prefix for a numbered child', () => {
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
    expect(getRichTextEditor()).toHaveTextContent('Child')
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
    leftDocument.sheets[0]!.layout.structureClass = 'studiumx.layout.logic.left'
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

    const input = getRichTextEditor()
    expect(input).toHaveStyle({
      color: '#ffffff',
      fontSize: '16px',
      fontWeight: '500',
      lineHeight: '22px',
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

  it('keeps a dashed hand-drawn topic border visible while the node is selected', () => {
    const document = makeDocument()
    document.sheets[0]!.root.style = {
      stroke: '#123456',
      borderStyle: 'hand-drawn-dash',
      borderWidth: 5
    }

    const { container } = renderCanvas(document)
    const selectedShape = container.querySelector<SVGElement>('.mindmap-node-group.is-selected .mindmap-node-rect')
    // Selection no longer repaints the border: the real colour, width and
    // pattern stay visible so the topic-style inspector can edit them in place.
    expect(selectedShape?.style.stroke).toBe('rgb(18, 52, 86)')
    expect(selectedShape?.style.strokeWidth).toBe('5')
    expect(selectedShape?.style.strokeDasharray).toBe('6 4')
    expect(selectedShape?.style.filter).toBe('url("#mindmap-topic-hand-drawn")')
    expect(selectedShape?.parentElement?.querySelector('.mindmap-node-selection')).not.toBeNull()
  })

  it('lets an explicit border override the shape-none dashed fallback outline', () => {
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
    // The no-shape element itself carries no stroke (it is the dashed CSS
    // fallback outline) and keeps its transparent fill…
    expect(shape?.getAttribute('fill')).toBe('none')
    // …but an explicit solid border still overrides stroke and clears the dash.
    expect(shape?.style.stroke).toBe('rgb(18, 52, 86)')
    expect(shape?.style.strokeDasharray).toBe('none')
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
      fontFamily: 'Imported native Font, sans-serif'
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

  it('renders a linked node summary with a brace and an ordinary topic output', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children.push(
      { id: 'selected-two', title: 'Second selected', children: [] },
      { id: 'summary-output', title: '节点总结', children: [] }
    )
    document.sheets[0]!.elements = [
      {
        id: 'summary-1',
        type: 'summary',
        from: 'child',
        to: 'selected-two',
        summaryTopicId: 'summary-output'
      }
    ]

    const { container } = renderCanvas(document)
    const outputNode = container.querySelector<SVGGElement>('[data-node-id="summary-output"]')

    expect(outputNode).toBeInTheDocument()
    expect(outputNode).toHaveAccessibleName('节点总结')
    expect(container.querySelector('.mindmap-summary-brace')).toBeInTheDocument()
    expect(container.querySelector('.mindmap-summary-connector')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-summary-node')).not.toBeInTheDocument()

    fireEvent.pointerDown(outputNode!)
    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'topic',
      topicIds: ['summary-output']
    })
  })

  it('moves a summary brace beyond children and spans their outer edges', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children = [
      {
        id: 'first',
        title: 'First selected',
        children: [{ id: 'new-detail', title: 'New detail', children: [] }]
      },
      { id: 'second', title: 'Second selected', children: [] },
      { id: 'summary-output', title: '节点总结', children: [] }
    ]
    document.sheets[0]!.elements = [
      {
        id: 'summary-1',
        type: 'summary',
        from: 'first',
        to: 'second',
        summaryTopicId: 'summary-output'
      }
    ]

    const { container } = renderCanvas(document)
    const detailRect = container.querySelector<SVGRectElement>(
      '[data-node-id="new-detail"] .mindmap-node-rect'
    )
    const bracePath = container.querySelector<SVGPathElement>('.mindmap-summary-brace')
    const braceData = bracePath?.getAttribute('d') ?? ''
    const braceStart = braceData.match(/^M ([\d.-]+) ([\d.-]+)/)
    const braceEnd = braceData.match(/([\d.-]+) ([\d.-]+)$/)
    const braceX = Number(braceStart?.[1])
    const braceTop = Number(braceStart?.[2])
    const braceBottom = Number(braceEnd?.[2])
    const detailRight = Number(detailRect?.getAttribute('x')) + Number(detailRect?.getAttribute('width'))
    const coveredRects = ['first', 'new-detail', 'second'].map((topicId) =>
      container.querySelector<SVGRectElement>(`[data-node-id="${topicId}"] .mindmap-node-rect`)
    )
    const coveredTop = Math.min(...coveredRects.map((rect) => Number(rect?.getAttribute('y'))))
    const coveredBottom = Math.max(...coveredRects.map((rect) =>
      Number(rect?.getAttribute('y')) + Number(rect?.getAttribute('height'))
    ))

    expect(braceX - detailRight).toBe(20)
    expect(braceTop).toBe(coveredTop)
    expect(braceBottom).toBe(coveredBottom)
  })

  it('mirrors linked node summaries on a left-side branch', () => {
    const document = makeDocument()
    document.sheets[0]!.layout.structureClass = 'studiumx.layout.logic.left'
    document.sheets[0]!.root.children = [
      { id: 'first', title: 'First selected', children: [] },
      { id: 'second', title: 'Second selected', children: [] },
      { id: 'summary-output', title: '节点总结', children: [] }
    ]
    document.sheets[0]!.elements = [
      {
        id: 'summary-1',
        type: 'summary',
        from: 'first',
        to: 'second',
        summaryTopicId: 'summary-output'
      }
    ]

    const { container } = renderCanvas(document)
    const summary = container.querySelector('.mindmap-summary-group')
    const sourceRect = container.querySelector<SVGRectElement>('[data-node-id="first"] .mindmap-node-rect')
    const outputRect = container.querySelector<SVGRectElement>('[data-node-id="summary-output"] .mindmap-node-rect')

    expect(summary).toHaveAttribute('data-summary-side', 'left')
    expect(Number(outputRect?.getAttribute('x')) + Number(outputRect?.getAttribute('width')))
      .toBeLessThan(Number(sourceRect?.getAttribute('x')))
  })

  it('scrolls the canvas instead of zooming when the vertical wheel is used', () => {
    const { container } = renderCanvas()
    const svg = container.querySelector('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')

    // Scrolling down (positive deltaY) reveals content below the current view.
    fireEvent.wheel(svg, { deltaY: 120, deltaX: 0, deltaMode: 0 })
    expect(container.querySelector('.mindmap-svg > g')?.getAttribute('transform'))
      .toBe('translate(0 -120) scale(1)')

    // Scrolling up (negative deltaY) reveals content above the current view.
    fireEvent.wheel(svg, { deltaY: -40, deltaX: 0, deltaMode: 0 })
    expect(container.querySelector('.mindmap-svg > g')?.getAttribute('transform'))
      .toBe('translate(0 -80) scale(1)')
  })

  it('pans horizontally when a tilt wheel reports a horizontal delta', () => {
    const { container } = renderCanvas()
    const svg = container.querySelector('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')

    fireEvent.wheel(svg, { deltaY: 0, deltaX: 60, deltaMode: 0 })
    expect(container.querySelector('.mindmap-svg > g')?.getAttribute('transform'))
      .toBe('translate(-60 0) scale(1)')
  })

  it('pans by default instead of drawing a marquee for a primary background drag', () => {
    const { container } = renderCanvas()
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')

    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 80, clientY: 90 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 130 })

    expect(container.querySelector('.mindmap-selection-box')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-svg > g')?.getAttribute('transform'))
      .toBe('translate(60 40) scale(1)')
  })

  it('draws a marquee instead of panning for a primary background drag in box-selection mode', () => {
    const { container } = render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        panMode={false}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')

    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 80, clientY: 90 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 130 })

    expect(container.querySelector('.mindmap-selection-box')).toBeInTheDocument()
    expect(container.querySelector('.mindmap-svg > g')?.getAttribute('transform'))
      .toBe('translate(0 0) scale(1)')
  })

  it('still zooms when Ctrl/Cmd + wheel is used (trackpad pinch)', () => {
    const { container } = renderCanvas()
    const svg = container.querySelector('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')

    fireEvent.wheel(svg, { deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: true })
    const transform = container.querySelector('.mindmap-svg > g')?.getAttribute('transform')
    expect(transform).toMatch(/scale\(1\.1\)$/)
  })

  it('marquee-selects drawn shapes that intersect the box in box-selection mode', () => {
    const document = makeDocument()
    document.sheets[0]!.elements = [
      {
        id: 'shape-1',
        type: 'shape',
        shape: 'rect',
        position: { x: 600, y: 220 },
        width: 120,
        height: 80
      },
      {
        id: 'shape-2',
        type: 'shape',
        shape: 'ellipse',
        position: { x: 600, y: 340 },
        width: 120,
        height: 80
      }
    ]
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        panMode={false}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')
    // The fixture shapes sit at y: 220 and y: 340 (document coords). With pan
    // 0:0 and zoom 1, sweep a marquee that fully encloses both shapes but no
    // topic, so the drag becomes a multi-element selection.
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 590, clientY: 210 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 730, clientY: 430 })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 730, clientY: 430 })

    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'elements',
      elementIds: ['shape-1', 'shape-2']
    })
  })

  it('marquee-selects a connector that crosses the box in box-selection mode', () => {
    const document = makeDocument()
    document.sheets[0]!.elements = [{
      id: 'connector-1',
      type: 'connector',
      start: { x: 600, y: 220 },
      end: { x: 740, y: 360 },
      style: { lineShape: 'straight', endArrow: 'triangle' }
    }]
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        panMode={false}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')
    // The connector runs from (600,220) to (740,360). A marquee that crosses
    // its midsegment but encloses no topic or shape selects it as an element.
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 650, clientY: 280 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 700, clientY: 320 })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 700, clientY: 320 })

    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'element',
      elementId: 'connector-1',
      elementType: 'connector'
    })
  })

  it('marquee-selects a topic, a shape, and a connector together as a hybrid selection', () => {
    const document = makeDocument()
    document.sheets[0]!.elements = [
      {
        id: 'shape-1',
        type: 'shape',
        shape: 'rect',
        position: { x: 600, y: 220 },
        width: 120,
        height: 80
      },
      {
        id: 'connector-1',
        type: 'connector',
        start: { x: 600, y: 220 },
        end: { x: 760, y: 380 },
        style: { lineShape: 'straight', endArrow: 'triangle' }
      }
    ]
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        panMode={false}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')
    // Sweep a wide marquee starting on the canvas (left of the root) that
    // fully encloses the shape and the connector's path while also covering
    // the root topic, so all three kinds are caught by one drag.
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 780, clientY: 420 })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 780, clientY: 420 })

    const selection = useMindMapViewStore.getState().selection
    expect(selection.kind).toBe('hybrid')
    if (selection.kind !== 'hybrid') throw new Error('expected hybrid selection')
    expect(selection.elementIds).toEqual(expect.arrayContaining(['shape-1', 'connector-1']))
    expect(selection.topicIds.length).toBeGreaterThan(0)
  })
})

describe('MindMapCanvas drawing tools', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
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

  function targetBounds(target: SVGRectElement): { x: number; y: number; width: number; height: number } {
    const value = (name: 'x' | 'y' | 'width' | 'height'): number => {
      const raw = target.getAttribute(name)
      if (raw === null) throw new Error(`missing ${name} on line snap target`)
      return Number(raw)
    }
    return {
      x: value('x'),
      y: value('y'),
      width: value('width'),
      height: value('height')
    }
  }

  function isOnTargetBorder(
    point: { x: number; y: number },
    target: { x: number; y: number; width: number; height: number }
  ): boolean {
    const epsilon = 0.001
    const inside = point.x >= target.x - epsilon
      && point.x <= target.x + target.width + epsilon
      && point.y >= target.y - epsilon
      && point.y <= target.y + target.height + epsilon
    const onEdge = Math.abs(point.x - target.x) <= epsilon
      || Math.abs(point.x - (target.x + target.width)) <= epsilon
      || Math.abs(point.y - target.y) <= epsilon
      || Math.abs(point.y - (target.y + target.height)) <= epsilon
    return inside && onEdge
  }

  it('captures a shape gesture that begins over a topic and commits its normalized draft', () => {
    const onCreateShape = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        drawingShape="diamond"
        onCreateShape={onCreateShape}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')
    const child = screen.getByRole('button', { name: 'Child' })

    fireEvent.pointerDown(child, { button: 0, pointerId: 21, clientX: 240, clientY: 160 })
    fireEvent.pointerMove(svg, { pointerId: 21, clientX: 160, clientY: 100 })

    expect(container.querySelector('.mindmap-shape-draft')).toBeInTheDocument()
    // The capture-phase tool handler prevents the topic's normal selection/drag
    // handler from claiming the gesture.
    expect(useMindMapViewStore.getState().selectedNodeId).toBe('root')

    fireEvent.pointerUp(svg, { pointerId: 21, clientX: 160, clientY: 100 })

    expect(onCreateShape).toHaveBeenCalledTimes(1)
    expect(onCreateShape).toHaveBeenCalledWith({
      shape: 'diamond',
      position: { x: 160, y: 100 },
      width: 80,
      height: 60
    })
    expect(container.querySelector('.mindmap-shape-draft')).not.toBeInTheDocument()
  })

  it('draws from a topic to a free shape, highlights the snap target, and anchors both endpoints', () => {
    const onCreateLine = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        lineTool={{ active: true, lineShape: 'straight', endArrow: 'triangle' }}
        onCreateLine={onCreateLine}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const topicTarget = container.querySelector<SVGRectElement>(
      'rect[data-mindmap-line-snap-target="topic:root"]'
    )
    const shapeTarget = container.querySelector<SVGRectElement>(
      'rect[data-mindmap-line-snap-target="shape:shape-1"]'
    )
    if (!svg || !topicTarget || !shapeTarget) throw new Error('expected line snap targets')

    const topicBounds = targetBounds(topicTarget)
    const shapeBounds = targetBounds(shapeTarget)
    const topicCenter = {
      x: topicBounds.x + topicBounds.width / 2,
      y: topicBounds.y + topicBounds.height / 2
    }
    const shapeCenter = {
      x: shapeBounds.x + shapeBounds.width / 2,
      y: shapeBounds.y + shapeBounds.height / 2
    }

    fireEvent.pointerDown(topicTarget, { button: 0, pointerId: 22, clientX: topicCenter.x, clientY: topicCenter.y })
    fireEvent.pointerMove(shapeTarget, { pointerId: 22, clientX: shapeCenter.x, clientY: shapeCenter.y })

    const highlight = container.querySelector<SVGRectElement>('.mindmap-line-snap-highlight')
    expect(container.querySelector('.mindmap-line-draft')).toBeInTheDocument()
    expect(highlight).toHaveAttribute('x', String(shapeBounds.x - 3))
    expect(highlight).toHaveAttribute('y', String(shapeBounds.y - 3))
    expect(highlight).toHaveAttribute('width', String(shapeBounds.width + 6))
    expect(highlight).toHaveAttribute('height', String(shapeBounds.height + 6))

    fireEvent.pointerUp(shapeTarget, { pointerId: 22, clientX: shapeCenter.x, clientY: shapeCenter.y })

    expect(onCreateLine).toHaveBeenCalledTimes(1)
    const draft = onCreateLine.mock.calls[0]?.[0]
    if (!draft) throw new Error('expected a connector draft')
    expect(draft.style).toMatchObject({ lineShape: 'straight', endArrow: 'triangle' })
    expect(draft.from.target).toEqual({ id: 'root', kind: 'topic' })
    expect(draft.to.target).toEqual({ id: 'shape-1', kind: 'shape' })
    expect(isOnTargetBorder(draft.from, topicBounds)).toBe(true)
    expect(isOnTargetBorder(draft.to, shapeBounds)).toBe(true)
  })

  it('captures a connector started over a free shape and attaches it to a topic', () => {
    const onCreateLine = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        lineTool={{ active: true, lineShape: 'curved', endArrow: 'none' }}
        onCreateLine={onCreateLine}
      />
    )
    const topicTarget = container.querySelector<SVGRectElement>(
      'rect[data-mindmap-line-snap-target="topic:root"]'
    )
    const shapeTarget = container.querySelector<SVGRectElement>(
      'rect[data-mindmap-line-snap-target="shape:shape-1"]'
    )
    if (!topicTarget || !shapeTarget) throw new Error('expected line snap targets')

    const topicBounds = targetBounds(topicTarget)
    const shapeBounds = targetBounds(shapeTarget)
    const topicCenter = {
      x: topicBounds.x + topicBounds.width / 2,
      y: topicBounds.y + topicBounds.height / 2
    }
    const shapeCenter = {
      x: shapeBounds.x + shapeBounds.width / 2,
      y: shapeBounds.y + shapeBounds.height / 2
    }

    fireEvent.pointerDown(shapeTarget, { button: 0, pointerId: 23, clientX: shapeCenter.x, clientY: shapeCenter.y })
    fireEvent.pointerMove(topicTarget, { pointerId: 23, clientX: topicCenter.x, clientY: topicCenter.y })
    fireEvent.pointerUp(topicTarget, { pointerId: 23, clientX: topicCenter.x, clientY: topicCenter.y })

    expect(onCreateLine).toHaveBeenCalledTimes(1)
    const draft = onCreateLine.mock.calls[0]?.[0]
    if (!draft) throw new Error('expected a connector draft')
    expect(draft.style).toMatchObject({ lineShape: 'curved', endArrow: 'none' })
    expect(draft.from.target).toEqual({ id: 'shape-1', kind: 'shape' })
    expect(draft.to.target).toEqual({ id: 'root', kind: 'topic' })
    expect(isOnTargetBorder(draft.from, shapeBounds)).toBe(true)
    expect(isOnTargetBorder(draft.to, topicBounds)).toBe(true)
  })

  it('starts a free connector gesture on the empty canvas with a live preview', () => {
    const onCreateLine = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        lineTool={{ active: true, lineShape: 'straight', endArrow: 'none' }}
        onCreateLine={onCreateLine}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')

    fireEvent.pointerDown(svg, { button: 0, pointerId: 24, clientX: 720, clientY: 420 })
    fireEvent.pointerMove(svg, { pointerId: 24, clientX: 900, clientY: 520 })

    // The free line is previewed live while the gesture is open.
    expect(container.querySelector('.mindmap-line-draft')).toBeInTheDocument()

    fireEvent.pointerUp(svg, { pointerId: 24, clientX: 900, clientY: 520 })

    // One standalone connector is committed with free (anchor-less) endpoints.
    expect(onCreateLine).toHaveBeenCalledTimes(1)
    expect(onCreateLine).toHaveBeenCalledWith(expect.objectContaining({
      from: { x: 720, y: 420 },
      to: { x: 900, y: 520 },
      style: expect.objectContaining({ lineShape: 'straight' })
    }))
  })

  it('previews a free-shape move locally and persists one update on release', () => {
    const onUpdateShape = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateShape={onUpdateShape}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')
    const shape = screen.getByRole('button', { name: 'Initial label' })

    fireEvent.pointerDown(shape, { button: 0, pointerId: 31, clientX: 620, clientY: 240 })
    fireEvent.pointerMove(svg, { pointerId: 31, clientX: 660, clientY: 265 })

    expect(onUpdateShape).not.toHaveBeenCalled()
    expect(container.querySelector('.mindmap-drawn-shape')).toHaveAttribute(
      'd',
      'M 640 245 H 760 V 325 H 640 Z'
    )

    fireEvent.pointerUp(svg, { pointerId: 31, clientX: 660, clientY: 265 })

    expect(onUpdateShape).toHaveBeenCalledTimes(1)
    expect(onUpdateShape).toHaveBeenCalledWith('shape-1', {
      position: { x: 640, y: 245 },
      width: 120,
      height: 80
    })
  })

  it('reprojects a shape-anchored connector during a local move preview', () => {
    const onUpdateShape = vi.fn()
    const document = makeDocumentWithEditableDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-1',
      type: 'connector',
      start: {
        x: 720,
        y: 260,
        anchor: { targetType: 'shape', targetId: 'shape-1' }
      },
      end: {
        x: 900,
        y: 260,
        anchor: { targetType: 'topic', targetId: 'root' }
      },
      style: { lineShape: 'straight', endArrow: 'triangle' }
    })

    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateShape={onUpdateShape}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const line = container.querySelector<SVGPathElement>('.mindmap-drawn-line')
    if (!svg || !line) throw new Error('expected mind map SVG and anchored connector')
    const initialPath = line.getAttribute('d')
    const shape = screen.getByRole('button', { name: 'Initial label' })

    fireEvent.pointerDown(shape, { button: 0, pointerId: 34, clientX: 620, clientY: 240 })
    fireEvent.pointerMove(svg, { pointerId: 34, clientX: 660, clientY: 265 })

    // The document callback remains deferred, yet the anchored endpoint has
    // already been resolved from the transient moved rectangle.
    expect(onUpdateShape).not.toHaveBeenCalled()
    expect(line).not.toHaveAttribute('d', initialPath ?? '')

    fireEvent.pointerUp(svg, { pointerId: 34, clientX: 660, clientY: 265 })
    expect(onUpdateShape).toHaveBeenCalledTimes(1)
  })

  it('keeps snapped connector arrows outside their target and does not clip wide marker styles', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'element', elementId: 'connector-marker-1', elementType: 'connector' },
      selectedNodeId: null
    })
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-marker-1',
      type: 'connector',
      start: { x: 0, y: 0, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 600, y: 260, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'straight', endArrow: 'triangle' }
    })

    const { container } = renderCanvas(document)
    const line = container.querySelector<SVGPathElement>('.mindmap-drawn-line')
    const triangle = container.querySelector<SVGMarkerElement>('#mindmap-rel-arrow-triangle')
    const herringbone = container.querySelector<SVGMarkerElement>('#mindmap-rel-arrow-herringbone')
    const attached = container.querySelector<SVGMarkerElement>('#mindmap-rel-arrow-attached')

    expect(line).toHaveAttribute('marker-end', 'url(#mindmap-rel-arrow-triangle)')
    // The marker anchors at its broad base while the visible path is inset by
    // the same base-to-tip distance. The shaft cannot occupy the taper, so the
    // silhouette ends in a clean point at the snapped target border.
    expect(triangle).toHaveAttribute('refX', '1')
    expect(triangle).toHaveAttribute('markerWidth', '8')
    expect(triangle).toHaveAttribute('markerHeight', '8')
    expect(herringbone).toHaveAttribute('overflow', 'visible')
    expect(attached).toHaveAttribute('overflow', 'visible')
    expect(herringbone?.querySelector('path')).toHaveAttribute('fill', 'none')
    expect(herringbone?.querySelector('path')).toHaveAttribute('stroke', 'context-stroke')

    const endpoint = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-endpoint="to"][data-mindmap-line-id="connector-marker-1"]'
    )
    const pathValues = line?.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (!endpoint || pathValues.length !== 4) {
      throw new Error('expected a selected straight connector and its endpoint handle')
    }
    const pathFrom = { x: pathValues[0]!, y: pathValues[1]! }
    const markerBase = { x: pathValues[2]!, y: pathValues[3]! }
    const length = Math.hypot(markerBase.x - pathFrom.x, markerBase.y - pathFrom.y)
    const arrowTip = {
      x: markerBase.x + ((markerBase.x - pathFrom.x) / length) * 6.96,
      y: markerBase.y + ((markerBase.y - pathFrom.y) / length) * 6.96
    }

    // The triangle marker follows the diagonal line tangent. Its visual tip
    // must land on the exact same semantic point as the draggable edit handle,
    // even though the snapped target exposes a horizontal border normal.
    expect(arrowTip.x).toBeCloseTo(Number(endpoint.getAttribute('cx')), 6)
    expect(arrowTip.y).toBeCloseTo(Number(endpoint.getAttribute('cy')), 6)
  })

  it('keeps a curved connector end tangent aimed into its target border', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-curved-direction-1',
      type: 'connector',
      start: { x: 0, y: 0, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 600, y: 260, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'curved', endArrow: 'triangle' }
    })

    const { container } = renderCanvas(document)
    const line = container.querySelector<SVGPathElement>('.mindmap-drawn-line')
    const path = line?.getAttribute('d')
    if (!path) throw new Error('expected an anchored curved connector')

    const segments = path.split(' C ')
    if (segments.length !== 3) throw new Error('expected two cubic curve segments')
    const values = segments[2]!.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (values.length !== 6) throw new Error('expected terminal cubic control points')

    const terminalControl = { x: values[2]!, y: values[3]! }
    const endpoint = { x: values[4]!, y: values[5]! }

    // This target sits to the right of the root. The visible shaft stops at
    // the triangle base, 6.96 px before the border, while the marker tip still
    // reaches x=600. The final cubic control remains behind that base so the
    // arrow continues to point into the shape.
    expect(endpoint.x).toBeCloseTo(600 - 6.96)
    expect(endpoint.x + 6.96).toBeCloseTo(600)
    expect(terminalControl.x).toBeLessThan(endpoint.x)
  })

  it('does not let a rounded curve cap protrude past an end arrow', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-curved-cap-1',
      type: 'connector',
      start: { x: 360, y: 120 },
      end: { x: 360, y: 420 },
      style: { lineShape: 'curved', endArrow: 'triangle', strokeWidth: 10 }
    })

    const { container } = renderCanvas(document)
    const line = container.querySelector<SVGPathElement>('.mindmap-drawn-line')
    if (!line) throw new Error('expected a curved connector with an end arrow')

    // A round cap extends half the stroke width beyond the path endpoint,
    // leaving a visible stub in front of the marker tip. Arrowed connectors
    // must use a butt cap so the painted stroke stops exactly at the endpoint.
    expect(line.style.strokeLinecap).toBe('butt')
  })

  it('gives persisted connectors a wide invisible stroke hit target so they can be selected and removed', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-hit-1',
      type: 'connector',
      start: { x: 100, y: 120, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 520, y: 220, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'straight', endArrow: 'triangle' }
    })

    const { container } = renderCanvas(document)
    const hitTarget = container.querySelector<SVGPathElement>('.mindmap-drawn-line-hit')
    if (!hitTarget) throw new Error('expected connector hit target')

    expect(hitTarget).toHaveAttribute('fill', 'none')
    expect(hitTarget).toHaveAttribute('stroke', 'transparent')
    expect(Number(hitTarget.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(12)
    expect(hitTarget).toHaveAttribute('pointer-events', 'stroke')

    fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 48 })
    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'element',
      elementId: 'connector-hit-1',
      elementType: 'connector'
    })
  })

  it('translates both endpoints when dragging a straight connector body without changing its shape', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-body-drag-1',
      type: 'connector',
      start: { x: 100, y: 120, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 520, y: 220, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'straight', endArrow: 'triangle' }
    })
    const onUpdateLine = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateLine={onUpdateLine}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const lineHit = container.querySelector<SVGPathElement>('.mindmap-drawn-line-hit')
    if (!svg || !lineHit) throw new Error('expected connector hit target and SVG')

    // Clicking (pointerDown) must not immediately change the line shape.
    const grab = { x: 320, y: 180 }
    fireEvent.pointerDown(lineHit, {
      button: 0,
      pointerId: 58,
      clientX: grab.x,
      clientY: grab.y
    })

    // A straight line never shows a curve control point, even when selected.
    let controlBeforeMove = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-control="connector-body-drag-1"]'
    )
    expect(controlBeforeMove).toBeNull()

    const delta = { x: 48, y: -36 }
    const dragged = {
      x: grab.x + delta.x,
      y: grab.y + delta.y
    }

    fireEvent.pointerMove(svg, {
      pointerId: 58,
      clientX: dragged.x,
      clientY: dragged.y
    })
    expect(onUpdateLine).not.toHaveBeenCalled()

    // The straight line still has no curve control point after a body drag.
    const controlAfterMove = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-control="connector-body-drag-1"]'
    )
    expect(controlAfterMove).toBeNull()

    fireEvent.pointerUp(svg, {
      pointerId: 58,
      clientX: dragged.x,
      clientY: dragged.y
    })

    expect(onUpdateLine).toHaveBeenCalledTimes(1)
    // The update translates both endpoints (detached from anchors) without
    // changing the line shape. No `style` patch is emitted.
    const [lineId, patch] = onUpdateLine.mock.calls[0]!
    expect(lineId).toBe('connector-body-drag-1')
    expect(patch).not.toHaveProperty('style')
    expect(patch.from).toBeDefined()
    expect(patch.to).toBeDefined()
    // Both endpoints are now floating (no anchor) since the body drag
    // detaches them from their targets to translate freely.
    expect(patch.from).not.toHaveProperty('target')
    expect(patch.to).not.toHaveProperty('target')
  })

  it('translates both endpoints when dragging an angled connector body without changing its shape', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-angled-drag-1',
      type: 'connector',
      start: { x: 100, y: 120, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 520, y: 220, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'angled', endArrow: 'triangle' }
    })
    const onUpdateLine = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateLine={onUpdateLine}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const lineHit = container.querySelector<SVGPathElement>('.mindmap-drawn-line-hit')
    if (!svg || !lineHit) throw new Error('expected connector hit target and SVG')

    const grab = { x: 320, y: 180 }
    fireEvent.pointerDown(lineHit, {
      button: 0,
      pointerId: 59,
      clientX: grab.x,
      clientY: grab.y
    })

    // An angled line has no curve control point.
    let controlBeforeMove = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-control="connector-angled-drag-1"]'
    )
    expect(controlBeforeMove).toBeNull()

    const delta = { x: 48, y: -36 }
    const dragged = {
      x: grab.x + delta.x,
      y: grab.y + delta.y
    }

    fireEvent.pointerMove(svg, {
      pointerId: 59,
      clientX: dragged.x,
      clientY: dragged.y
    })
    fireEvent.pointerUp(svg, {
      pointerId: 59,
      clientX: dragged.x,
      clientY: dragged.y
    })

    expect(onUpdateLine).toHaveBeenCalledTimes(1)
    // The update translates both endpoints (detached from anchors) without
    // changing the line shape. No `style` patch is emitted.
    const [lineId, patch] = onUpdateLine.mock.calls[0]!
    expect(lineId).toBe('connector-angled-drag-1')
    expect(patch).not.toHaveProperty('style')
    expect(patch.from).toBeDefined()
    expect(patch.to).toBeDefined()
    expect(patch.from).not.toHaveProperty('target')
    expect(patch.to).not.toHaveProperty('target')
  })

  it('shows a draggable middle point that adjusts and persists a curved connector', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-curve-1',
      type: 'connector',
      start: { x: 0, y: 0, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 600, y: 260, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'curved', endArrow: 'triangle' }
    })
    const onUpdateLine = vi.fn()
    const { container, rerender } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateLine={onUpdateLine}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const lineHit = container.querySelector<SVGPathElement>('.mindmap-drawn-line-hit')
    const line = container.querySelector<SVGPathElement>('.mindmap-drawn-line')
    if (!svg || !lineHit || !line) throw new Error('expected curved connector and SVG')

    fireEvent.pointerDown(lineHit, { button: 0, pointerId: 60 })

    const control = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-control="connector-curve-1"]'
    )
    const fromEndpoint = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-endpoint="from"][data-mindmap-line-id="connector-curve-1"]'
    )
    const toEndpoint = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-endpoint="to"][data-mindmap-line-id="connector-curve-1"]'
    )
    if (!control || !fromEndpoint || !toEndpoint) {
      throw new Error('expected curve control and endpoint handles')
    }

    const initialPath = line.getAttribute('d')
    const initialControl = {
      x: Number(control.getAttribute('cx')),
      y: Number(control.getAttribute('cy'))
    }
    const endpointMidpoint = {
      x: (Number(fromEndpoint.getAttribute('cx')) + Number(toEndpoint.getAttribute('cx'))) / 2,
      y: (Number(fromEndpoint.getAttribute('cy')) + Number(toEndpoint.getAttribute('cy'))) / 2
    }
    expect(initialControl).not.toEqual(endpointMidpoint)

    const dragged = { x: initialControl.x + 60, y: initialControl.y - 80 }
    fireEvent.pointerDown(control, {
      button: 0,
      pointerId: 61,
      clientX: initialControl.x,
      clientY: initialControl.y
    })
    fireEvent.pointerMove(svg, {
      pointerId: 61,
      clientX: dragged.x,
      clientY: dragged.y
    })

    expect(onUpdateLine).not.toHaveBeenCalled()
    expect(line).not.toHaveAttribute('d', initialPath ?? '')
    const draggedPath = line.getAttribute('d')
    expect(control).toHaveAttribute('cx', String(dragged.x))
    expect(control).toHaveAttribute('cy', String(dragged.y))

    fireEvent.pointerUp(svg, {
      pointerId: 61,
      clientX: dragged.x,
      clientY: dragged.y
    })

    expect(onUpdateLine).toHaveBeenCalledTimes(1)
    expect(onUpdateLine).toHaveBeenCalledWith('connector-curve-1', {
      curveControlOffset: {
        x: dragged.x - endpointMidpoint.x,
        y: dragged.y - endpointMidpoint.y
      }
    })

    const persistedDocument = structuredClone(document)
    const persistedConnector = persistedDocument.sheets[0]!.elements.find(
      (element) => element.id === 'connector-curve-1'
    )
    if (!persistedConnector || persistedConnector.type !== 'connector') {
      throw new Error('expected persisted curved connector')
    }
    persistedConnector.curveControlOffset = {
      x: dragged.x - endpointMidpoint.x,
      y: dragged.y - endpointMidpoint.y
    }
    rerender(
      <MindMapCanvas
        document={persistedDocument}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateLine={onUpdateLine}
      />
    )

    expect(container.querySelector('.mindmap-drawn-line')).toHaveAttribute('d', draggedPath ?? '')
    expect(container.querySelector('[data-mindmap-line-control="connector-curve-1"]'))
      .toHaveAttribute('cx', String(dragged.x))
  })

  it('discards a curved connector middle-point preview when the pointer is cancelled', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-curve-cancel',
      type: 'connector',
      start: { x: 0, y: 0, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 600, y: 260, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'curved', endArrow: 'triangle' }
    })
    const onUpdateLine = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateLine={onUpdateLine}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const lineHit = container.querySelector<SVGPathElement>('.mindmap-drawn-line-hit')
    if (!svg || !lineHit) throw new Error('expected curved connector and SVG')

    fireEvent.pointerDown(lineHit, { button: 0, pointerId: 62 })
    const control = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-control="connector-curve-cancel"]'
    )
    if (!control) throw new Error('expected curve control')
    const initial = {
      x: Number(control.getAttribute('cx')),
      y: Number(control.getAttribute('cy'))
    }

    fireEvent.pointerDown(control, {
      button: 0,
      pointerId: 63,
      clientX: initial.x,
      clientY: initial.y
    })
    fireEvent.pointerMove(svg, {
      pointerId: 63,
      clientX: initial.x + 80,
      clientY: initial.y - 40
    })
    expect(control).toHaveAttribute('cx', String(initial.x + 80))

    fireEvent.pointerCancel(svg, { pointerId: 63 })

    expect(onUpdateLine).not.toHaveBeenCalled()
    expect(control).toHaveAttribute('cx', String(initial.x))
    expect(control).toHaveAttribute('cy', String(initial.y))
  })

  it('keeps selected connector endpoints above nodes and allows moving or right-clicking them', () => {
    const document = makeDocumentWithDrawnShape()
    document.sheets[0]!.elements.push({
      id: 'connector-endpoint-1',
      type: 'connector',
      start: { x: 180, y: 130, anchor: { targetType: 'topic', targetId: 'root' } },
      end: { x: 520, y: 250, anchor: { targetType: 'shape', targetId: 'shape-1' } },
      style: { lineShape: 'straight', endArrow: 'triangle' }
    })
    const onUpdateLine = vi.fn()
    const onLineContextMenu = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateLine={onUpdateLine}
        onLineContextMenu={onLineContextMenu}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const lineHit = container.querySelector<SVGPathElement>('.mindmap-drawn-line-hit')
    if (!svg || !lineHit) throw new Error('expected connector hit target and SVG')

    fireEvent.pointerDown(lineHit, { button: 0, pointerId: 49 })

    const overlay = container.querySelector<SVGGElement>(
      '[data-mindmap-line-endpoint-overlay="connector-endpoint-1"]'
    )
    const root = container.querySelector<SVGGElement>('[data-node-id="root"]')
    const fromEndpoint = container.querySelector<SVGCircleElement>(
      '[data-mindmap-line-endpoint="from"][data-mindmap-line-id="connector-endpoint-1"]'
    )
    const child = container.querySelector<SVGGElement>('[data-node-id="child"]')
    const childRect = child?.querySelector<SVGRectElement>('.mindmap-node-rect')
    if (!overlay || !root || !fromEndpoint || !childRect) {
      throw new Error('expected selected connector endpoint overlay')
    }

    // The overlay is painted after topic/shape/image layers, so a snapped
    // endpoint remains visible and receives the next pointer gesture.
    expect(root.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.pointerDown(fromEndpoint, {
      button: 0,
      pointerId: 50,
      clientX: 180,
      clientY: 130
    })
    const childBounds = targetBounds(childRect)
    const childCenter = {
      x: childBounds.x + childBounds.width / 2,
      y: childBounds.y + childBounds.height / 2
    }
    fireEvent.pointerMove(svg, { pointerId: 50, clientX: childCenter.x, clientY: childCenter.y })
    fireEvent.pointerUp(svg, { pointerId: 50, clientX: childCenter.x, clientY: childCenter.y })

    expect(onUpdateLine).toHaveBeenCalledTimes(1)
    expect(onUpdateLine).toHaveBeenCalledWith('connector-endpoint-1', {
      from: expect.objectContaining({
        target: { id: 'child', kind: 'topic' }
      })
    })

    fireEvent.contextMenu(fromEndpoint, { clientX: 320, clientY: 260 })
    expect(onLineContextMenu).toHaveBeenCalledWith('connector-endpoint-1', 320, 260)
  })

  it('right-clicking a drawn shape opens its context menu and selects the shape', () => {
    const onShapeContextMenu = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onShapeContextMenu={onShapeContextMenu}
      />
    )
    const shape = container.querySelector<SVGGElement>('.mindmap-drawn-shape-group')
    if (!shape) throw new Error('expected drawn shape group')

    fireEvent.contextMenu(shape, { clientX: 620, clientY: 240 })
    expect(onShapeContextMenu).toHaveBeenCalledWith('shape-1', 620, 240)
    // Right-click also selects the shape so the targeted element is visible.
    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'element',
      elementId: 'shape-1',
      elementType: 'shape'
    })
  })

  it('resizes a selected free shape once and uses the editable minimum without moving its opposite edges', () => {
    const onUpdateShape = vi.fn()
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateShape={onUpdateShape}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    if (!svg) throw new Error('expected mind map SVG')
    const shape = screen.getByRole('button', { name: 'Initial label' })

    // A stationary primary click selects the shape and exposes its eight handles
    // without creating a persistence command.
    fireEvent.pointerDown(shape, { button: 0, pointerId: 32, clientX: 620, clientY: 240 })
    fireEvent.pointerUp(svg, { pointerId: 32, clientX: 620, clientY: 240 })
    expect(onUpdateShape).not.toHaveBeenCalled()

    const northWestHandle = container.querySelector<SVGRectElement>(
      '[data-mindmap-shape-resize-handle="nw"]'
    )
    if (!northWestHandle) throw new Error('expected north-west shape resize handle')

    fireEvent.pointerDown(northWestHandle, { button: 0, pointerId: 33, clientX: 600, clientY: 220 })
    fireEvent.pointerMove(svg, { pointerId: 33, clientX: 1_600, clientY: 1_220 })
    fireEvent.pointerUp(svg, { pointerId: 33, clientX: 1_600, clientY: 1_220 })

    expect(onUpdateShape).toHaveBeenCalledTimes(1)
    expect(onUpdateShape).toHaveBeenCalledWith('shape-1', {
      position: { x: 696, y: 276 },
      width: 24,
      height: 24
    })
  })

  it('uses invisible resize zones along every edge and corner instead of visible handles', () => {
    const { container } = renderCanvas(makeDocumentWithEditableDrawnShape())
    const zones = [...container.querySelectorAll<SVGRectElement>('[data-mindmap-shape-resize-edge]')]

    expect(zones.map((zone) => zone.dataset.mindmapShapeResizeEdge)).toEqual([
      'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
    ])
    for (const zone of zones) {
      expect(zone).toHaveAttribute('fill', 'transparent')
      expect(zone).toHaveAttribute('stroke', 'none')
    }

    const north = zones.find((zone) => zone.dataset.mindmapShapeResizeEdge === 'n')
    const east = zones.find((zone) => zone.dataset.mindmapShapeResizeEdge === 'e')
    expect(Number(north?.getAttribute('width'))).toBeGreaterThan(100)
    expect(Number(east?.getAttribute('height'))).toBeGreaterThan(60)
  })

  it('captures free-shape gestures on the shape itself so Chromium can dispatch its double-click back to it', () => {
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const shape = screen.getByRole('button', { name: 'Initial label' })
    if (!svg) throw new Error('expected mind map SVG')

    const shapeCapture = vi.fn()
    const rootCapture = vi.fn()
    Object.defineProperty(shape, 'setPointerCapture', { configurable: true, value: shapeCapture })
    Object.defineProperty(svg, 'setPointerCapture', { configurable: true, value: rootCapture })

    fireEvent.pointerDown(shape, { button: 0, pointerId: 46, clientX: 620, clientY: 240 })

    expect(shapeCapture).toHaveBeenCalledWith(46)
    expect(rootCapture).not.toHaveBeenCalled()
  })

  it('keeps a shape interaction alive when its captured pointer leaves the canvas', () => {
    const { container } = render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const shape = screen.getByRole('button', { name: 'Initial label' })
    if (!svg) throw new Error('expected mind map SVG')

    Object.defineProperty(shape, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(shape, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) })

    fireEvent.pointerDown(shape, { button: 0, pointerId: 47, clientX: 620, clientY: 240 })
    fireEvent.pointerLeave(svg, { pointerId: 47, clientX: 1_200, clientY: 800 })

    expect(shape).toHaveClass('is-moving')
  })

  it('commits edited shape text on blur and discards it on Escape', async () => {
    const user = userEvent.setup()
    const onUpdateShape = vi.fn()
    render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateShape={onUpdateShape}
      />
    )
    const shape = screen.getByRole('button', { name: 'Initial label' })

    await user.dblClick(shape)
    const editor = getRichTextEditor()
    setRichText(editor, 'Blurred label')
    fireEvent.blur(editor)

    expect(onUpdateShape).toHaveBeenCalledTimes(1)
    expect(onUpdateShape).toHaveBeenLastCalledWith('shape-1', { label: 'Blurred label' })
    expect(document.querySelector('.mindmap-richtext')).not.toBeInTheDocument()

    await user.dblClick(screen.getByRole('button', { name: 'Initial label' }))
    const cancelledEditor = getRichTextEditor()
    setRichText(cancelledEditor, 'Do not save')
    fireEvent.keyDown(cancelledEditor, { key: 'Escape' })
    fireEvent.blur(cancelledEditor)

    expect(onUpdateShape).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.mindmap-richtext')).not.toBeInTheDocument()
  })

  it('starts shape text in the visual centre and keeps an unmodified Enter as a newline', async () => {
    const user = userEvent.setup()
    const onUpdateShape = vi.fn()
    render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateShape={onUpdateShape}
      />
    )

    await user.dblClick(screen.getByRole('button', { name: 'Initial label' }))
    const editor = getRichTextEditor()
    expect(editor.parentElement).toHaveClass('mindmap-drawn-shape-label-editor-shell')
    expect(editor).toHaveStyle({ textAlign: 'center' })

    setRichText(editor, 'First line\nSecond line')
    expect(editor.textContent).toBe('First line\nSecond line')
    expect(onUpdateShape).not.toHaveBeenCalled()

    fireEvent.blur(editor)
    expect(onUpdateShape).toHaveBeenCalledWith('shape-1', {
      label: 'First line\nSecond line'
    })
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }]
  ])('commits shape text once with %s+Enter even when blur follows', async (_shortcut, modifier) => {
    const user = userEvent.setup()
    const onUpdateShape = vi.fn()
    render(
      <MindMapCanvas
        document={makeDocumentWithEditableDrawnShape()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onUpdateShape={onUpdateShape}
      />
    )

    await user.dblClick(screen.getByRole('button', { name: 'Initial label' }))
    const editor = getRichTextEditor()
    setRichText(editor, 'Keyboard label')
    fireEvent.keyDown(editor, { key: 'Enter', ...modifier })
    // The edit commit unmounts the editor. A late blur from the browser must
    // be ignored so this remains a single undoable update.
    fireEvent.blur(editor)

    expect(onUpdateShape).toHaveBeenCalledTimes(1)
    expect(onUpdateShape).toHaveBeenCalledWith('shape-1', { label: 'Keyboard label' })
  })
})
