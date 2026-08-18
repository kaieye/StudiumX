import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { MindMapElementStyleInspector } from '../../src/renderer/src/views/mindmap/MindMapElementStyleInspector'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const NOW = '2026-08-12T00:00:00.000Z'
const originalMindMapState = useMindMapViewStore.getState()
const originalAppState = useAppStore.getState()
const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')

function workspace(): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1', name: 'Test', rootPath: '/workspace', missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources', lessonsDir: '/workspace/lessons', recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference', reviewsDir: '/workspace/reviews', createdAt: NOW, updatedAt: NOW,
    agentWorkspaceTrust: 'trusted', missionTitle: 'Test', missionExcerpt: 'Test', courses: [], fileTree: [],
    conversations: [], resources: [], records: [], lessons: [], referenceCount: 0, assetsReady: true, git: null
  }
}

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2, id: 'mind-map-elements', revision: 1, title: 'Elements', createdAt: NOW, updatedAt: NOW,
    theme: { id: 'default' }, assets: [], sheets: [{
      id: 'sheet-1', title: 'Overview', layout: { structureClass: 'studiumx.layout.logic.right' },
      root: { id: 'root', title: 'Root', children: [
        { id: 'a', title: 'Alpha', children: [] }, { id: 'b', title: 'Beta', children: [] }
      ] },
      elements: [
        { id: 'rel', type: 'relationship', from: 'a', to: 'b', label: 'Depends on', style: { stroke: '#112233' } },
        { id: 'boundary', type: 'boundary', topicId: 'a', label: 'Scope' },
        { id: 'summary', type: 'summary', from: 'a', to: 'b', label: 'Together' },
        { id: 'callout', type: 'callout', topicId: 'a', text: 'Remember' }
      ]
    }]
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  await i18n.changeLanguage('en-US')
  useAppStore.setState({ ...originalAppState, appState: { ...originalAppState.appState, activeWorkspace: workspace() } })
  const document = makeDocument()
  Object.defineProperty(window, 'teachingSystem', { configurable: true, value: {
    readMindMap: vi.fn(async () => document), listMindMaps: vi.fn(async () => []),
    updateMindMap: vi.fn(async (payload) => ({ ok: true as const, document: { ...payload.doc, revision: payload.doc.revision + 1 } }))
  } as Partial<TeachingSystemApi> })
  await useMindMapViewStore.getState().openDocument(document.id)
})

afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers()
  useMindMapViewStore.setState(originalMindMapState); useAppStore.setState(originalAppState)
  if (originalTeachingSystemDescriptor) Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
  else delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
  vi.restoreAllMocks()
})

describe('mind map element selection and inspector', () => {
  it.each([
    ['Depends on', 'rel', 'relationship'], ['Scope', 'boundary', 'boundary'],
    ['Together', 'summary', 'summary'], ['Remember', 'callout', 'callout']
  ] as const)('selects %s from the canvas as an element', (name, elementId, elementType) => {
    render(<MindMapCanvas document={makeDocument()} activeSheetIndex={0} onActiveSheetChange={() => undefined} />)
    const element = screen.getByRole('button', { name })
    fireEvent.pointerDown(element)
    expect(useMindMapViewStore.getState().selection).toEqual({ kind: 'element', elementId, elementType })
    expect(useMindMapViewStore.getState().selectedNodeId).toBeNull()
    expect(element).toHaveAttribute('aria-pressed', 'true')
  })

  it('updates an element style through the command stack and restores it on undo', () => {
    useMindMapViewStore.getState().selectElement('rel', 'relationship')
    render(<MindMapElementStyleInspector />)
    const stroke = screen.getByLabelText('Line color')
    fireEvent.change(stroke, { target: { value: '#445566' } })
    fireEvent.click(screen.getByRole('button', { name: 'Line pattern' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Line pattern' })).getByRole('option', { name: 'Dash' }))
    const current = useMindMapViewStore.getState().current
    expect(current?.sheets[0]?.elements[0]?.style).toMatchObject({ stroke: '#445566', linePattern: 'dash' })
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toEqual({ stroke: '#445566' })
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toEqual({ stroke: '#112233' })
  })

  it('applies advanced relationship shape/arrow/pattern fields through element.update and undoes each', () => {
    useMindMapViewStore.getState().selectElement('rel', 'relationship')
    render(<MindMapElementStyleInspector />)

    const selectIcon = (name: string, optionName: string): void => {
      fireEvent.click(screen.getByRole('button', { name }))
      fireEvent.click(within(screen.getByRole('dialog', { name })).getByRole('option', { name: optionName }))
    }

    selectIcon('Line shape', 'Angled')
    selectIcon('Start arrow', 'Dot')
    selectIcon('End arrow', 'Triangle')
    selectIcon('Line pattern', 'Dash-dot')

    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toMatchObject({
      lineShape: 'angled', beginArrow: 'dot', endArrow: 'triangle', linePattern: 'dash-dot'
    })

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toMatchObject({
      lineShape: 'angled', beginArrow: 'dot', endArrow: 'triangle'
    })
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toMatchObject({
      lineShape: 'angled', beginArrow: 'dot'
    })
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toMatchObject({
      lineShape: 'angled'
    })
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toEqual({ stroke: '#112233' })
  })

  it('keeps connector-only arrow controls out of a free shape inspector', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.elements.push({
      id: 'shape-1',
      type: 'shape',
      shape: 'rounded-rect',
      position: { x: 80, y: 120 },
      width: 160,
      height: 96,
      label: 'Canvas shape'
    })
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.getState().selectElement('shape-1', 'shape')
    render(<MindMapElementStyleInspector />)

    expect(screen.queryByRole('button', { name: 'Line shape' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start arrow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End arrow' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line pattern' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Outline shape' })).toBeEnabled()
  })

  it('uses the node-inspector picker UI without redundant element or label headings', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.elements.push({
      id: 'shape-ui-1',
      type: 'shape',
      shape: 'rounded-rect',
      position: { x: 80, y: 120 },
      width: 160,
      height: 96,
      label: 'Canvas shape'
    })
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.getState().selectElement('shape-ui-1', 'shape')
    const { container } = render(<MindMapElementStyleInspector />)

    expect(screen.queryByText('Element style')).not.toBeInTheDocument()
    expect(screen.queryByText('Label / text')).not.toBeInTheDocument()
    expect(screen.getByText('Text')).toBeInTheDocument()
    expect(screen.getByText('Shape')).toBeInTheDocument()
    expect(container.querySelectorAll('.mindmap-topic-color')).toHaveLength(3)
    expect(container.querySelector('.mindmap-topic-style-menu--border-width')).toBeInTheDocument()
  })

  it('shows effective values instead of an inherit placeholder and has no text box', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    // Use a managed SAFE_FONTS stack so the inherited value surfaces by label.
    const georgiaStack = "Georgia, 'Times New Roman', serif"
    current.theme = { id: 'default', fontFamily: georgiaStack }
    current.sheets[0]!.elements.push({
      id: 'shape-eff-1',
      type: 'shape',
      shape: 'rounded-rect',
      position: { x: 80, y: 120 },
      width: 160,
      height: 96,
      label: 'Canvas shape'
    })
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.getState().selectElement('shape-eff-1', 'shape')
    render(<MindMapElementStyleInspector />)

    // The panel no longer hosts a label/text editor.
    expect(screen.queryByLabelText('Label / text')).not.toBeInTheDocument()

    // Inherited picker fields surface the value the canvas actually draws.
    const linePattern = screen.getByRole('button', { name: 'Line pattern' })
    expect(within(linePattern).getByText('Solid')).toBeInTheDocument()
    const outlineShape = screen.getByRole('button', { name: 'Outline shape' })
    expect(within(outlineShape).getByText('Rounded Rectangle')).toBeInTheDocument()

    // The font trigger shows the inherited document theme font by its
    // managed label, with no "Inherit" placeholder for an inherited field.
    const font = screen.getByRole('button', { name: new RegExp(`^Font ${'Georgia'}$`) })
    expect(font).toHaveTextContent('Georgia')
    expect(screen.queryByText(/Inherit/i)).not.toBeInTheDocument()
  })

  it('renders connector line and arrow controls in their own group', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.elements.push({
      id: 'connector-1',
      type: 'connector',
      label: 'Connects the topics',
      start: { x: 80, y: 120, anchor: { targetType: 'topic', targetId: 'a' } },
      end: { x: 280, y: 120, anchor: { targetType: 'topic', targetId: 'b' } }
    })
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.getState().selectElement('connector-1', 'connector')
    render(<MindMapElementStyleInspector />)

    const shapeGroup = screen.getByRole('group', { name: 'Shape' })
    expect(within(shapeGroup).getByLabelText('Line color')).toBeEnabled()
    expect(within(shapeGroup).getByLabelText('Line width')).toBeEnabled()
    expect(within(shapeGroup).getByRole('button', { name: 'Line shape' })).toBeEnabled()
    expect(within(shapeGroup).getByRole('button', { name: 'Start arrow' })).toBeEnabled()
    expect(within(shapeGroup).getByRole('button', { name: 'End arrow' })).toBeEnabled()
    expect(within(shapeGroup).getByRole('button', { name: 'Line pattern' })).toBeEnabled()
    expect(screen.queryByLabelText('Fill color')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Dashed line' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Outline shape' })).not.toBeInTheDocument()

    fireEvent.click(within(shapeGroup).getByRole('button', { name: 'End arrow' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'End arrow' })).getByRole('option', { name: 'Triangle' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements.at(-1)?.style).toMatchObject({
      endArrow: 'triangle'
    })
  })

  it('clears an advanced field back to inherit by selecting the empty option', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.elements[0]!.style = {
      stroke: '#112233', lineShape: 'zigzag', beginArrow: 'dot', linePattern: 'dot', outlineShape: 'waves'
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.getState().selectElement('rel', 'relationship')
    render(<MindMapElementStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Line shape' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Line shape' })).getByRole('button', { name: 'Inherit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Line pattern' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Line pattern' })).getByRole('button', { name: 'Inherit' }))

    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]?.style).toEqual({
      stroke: '#112233', beginArrow: 'dot', outlineShape: 'waves'
    })
  })

  it('applies boundary outline and pattern fields through element.update', () => {
    useMindMapViewStore.getState().selectElement('boundary', 'boundary')
    render(<MindMapElementStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Outline shape' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Outline shape' })).getByRole('option', { name: 'Scallops' }))
    fireEvent.click(screen.getByRole('button', { name: 'Line pattern' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Line pattern' })).getByRole('option', { name: 'Dash' }))

    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[1]?.style).toMatchObject({
      outlineShape: 'scallops', linePattern: 'dash'
    })
    // Each element.update lands as its own undo entry; the last change (linePattern
    // back to inherit) is undone first, preserving the earlier outlineShape change.
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[1]?.style).toEqual({ outlineShape: 'scallops' })
    act(() => useMindMapViewStore.getState().undo())
    // The boundary had no style before the first edit; the final undo removes the
    // whole style snapshot just like the inspector reset button does.
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[1]?.style).toBeUndefined()
  })

  it('sends the revisioned element style through debounced persistence', async () => {
    useMindMapViewStore.getState().selectElement('rel', 'relationship')
    render(<MindMapElementStyleInspector />)
    fireEvent.change(screen.getByLabelText('Line color'), { target: { value: '#778899' } })
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve() })
    const update = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }))
    const saved = update.mock.calls.at(-1)?.[0].doc
    expect(saved?.sheets[0]?.elements[0]?.style?.stroke).toBe('#778899')
  })

  it('disables only a field that the selected element type cannot render and explains why', () => {
    useMindMapViewStore.getState().selectElement('summary', 'summary')
    render(<MindMapElementStyleInspector />)

    expect(screen.getByLabelText('Fill color')).toBeDisabled()
    expect(screen.getByLabelText('Line color')).toBeEnabled()
    expect(screen.getByText('Summary does not support this field yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('Fill color')).toHaveAttribute(
      'aria-describedby',
      'mindmap-element-style-capability-note'
    )
  })

  it('keeps every free-topic control disabled with an accessible canvas-path reason', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.elements.push({
      id: 'free-topic', type: 'free-topic', topicId: 'a', position: { x: 20, y: 20 }
    })
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.getState().selectElement('free-topic', 'free-topic')
    render(<MindMapElementStyleInspector />)

    for (const name of [
      'Line color', 'Fill color', 'Text color', 'Line width',
      'Line pattern', 'Outline shape', 'Font size'
    ]) {
      expect(screen.getByLabelText(name)).toBeDisabled()
    }
    // The font control is a popover trigger button; assert it is disabled too.
    expect(screen.getByRole('button', { name: /^Font / })).toBeDisabled()
    expect(screen.getByText('Free-node styling is unavailable until free-node canvas rendering is enabled.')).toBeInTheDocument()
  })
  it('renders every persisted boundary style field and defaults an unspecified boundary to solid', () => {
    const document = makeDocument()
    const boundary = document.sheets[0]!.elements.find((element) => element.id === 'boundary')
    if (!boundary) throw new Error('missing boundary fixture')
    boundary.style = {
      stroke: '#123456', strokeWidth: 3, fill: '#FEDCBA', textColor: '#334455',
      fontFamily: 'Georgia, serif', fontSize: 17, dashed: false
    }
    const { container, rerender } = render(
      <MindMapCanvas document={document} activeSheetIndex={0} onActiveSheetChange={() => undefined} />
    )
    expect(container.querySelector('.mindmap-boundary')).toHaveStyle({
      stroke: '#123456', strokeWidth: '3', fill: '#FEDCBA', fillOpacity: '1', strokeDasharray: 'none'
    })
    expect(container.querySelector('.mindmap-boundary-label')).toHaveStyle({
      fill: '#334455', fontFamily: 'Georgia, serif', fontSize: '17px'
    })

    const unstyled = makeDocument()
    rerender(<MindMapCanvas document={unstyled} activeSheetIndex={0} onActiveSheetChange={() => undefined} />)
    expect(container.querySelector('.mindmap-boundary')).toHaveStyle({ strokeDasharray: 'none' })
  })

})
