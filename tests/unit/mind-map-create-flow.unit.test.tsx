import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'
import type { MindMapCanvasLineUpdate } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import type {
  MindMapCanvasLineDraft,
  MindMapCanvasLineTool
} from '../../src/renderer/src/views/mindmap/mind-map-line-tool'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { MindMapSummary } from '../../src/shared/mindmap/mind-map-types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

type MindMapCanvasHarnessProps = {
  document?: MindMapDocumentV2
  lineTool?: MindMapCanvasLineTool | null
  onCreateLine?: (draft: MindMapCanvasLineDraft) => void
  onUpdateLine?: (lineId: string, patch: MindMapCanvasLineUpdate) => void
}

const mindMapCanvasHarness = vi.hoisted(() => ({
  props: null as MindMapCanvasHarnessProps | null
}))

vi.mock('../../src/renderer/src/views/mindmap/MindMapAiPanel', () => ({
  MindMapAiPanel: ({
    utilityControl,
    utilityContent,
    importExportControl
  }: {
    utilityControl?: ReactNode
    utilityContent?: ReactNode
    importExportControl?: ReactNode
  }) => (
    <aside>
      {utilityControl}
      {utilityContent}
      {importExportControl}
    </aside>
  )
}))
vi.mock('../../src/renderer/src/views/mindmap/MindMapCanvas', () => ({
  MindMapCanvas: (props: MindMapCanvasHarnessProps) => {
    mindMapCanvasHarness.props = props
    return null
  }
}))
vi.mock('../../src/renderer/src/views/mindmap/MindMapExportFeedback', () => ({ MindMapExportFeedback: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapOutline', () => ({ MindMapOutline: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSearchPanel', () => ({ MindMapSearchPanel: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSheetTabs', () => ({ MindMapSheetTabs: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapThemePanel', () => ({ MindMapThemePanel: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapTopicStyleInspector', () => ({ MindMapTopicStyleInspector: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/mind-map-keyboard', () => ({ useMindMapKeyboard: () => undefined }))

const NOW = '2026-08-10T00:00:00.000Z'
const originalMindMapState = useMindMapViewStore.getState()
const originalAppState = useAppStore.getState()
const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')

function workspace(): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Test workspace',
    rootPath: '/workspace',
    missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources',
    lessonsDir: '/workspace/lessons',
    recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference',
    reviewsDir: '/workspace/reviews',
    createdAt: NOW,
    updatedAt: NOW,
    agentWorkspaceTrust: 'trusted',
    missionTitle: 'Test workspace',
    missionExcerpt: 'Test workspace',
    courses: [],
    fileTree: [],
    conversations: [],
    resources: [],
    records: [],
    lessons: [],
    referenceCount: 0,
    assetsReady: true,
    git: null
  }
}

function makeDocument(title: string): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-1',
    revision: 1,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'studiumx-default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: { id: 'root', title, children: [] },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  useAppStore.setState({
    ...originalAppState,
    appState: {
      ...originalAppState.appState,
      activeWorkspace: workspace()
    }
  })

  const document = makeDocument('Chemistry')
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: {
      listMindMaps: vi.fn(async () => []),
      createMindMap: vi.fn(async () => document)
    } as Partial<TeachingSystemApi>
  })
  useMindMapViewStore.setState({
    ...originalMindMapState,
    documents: [],
    current: null,
    selectedNodeId: null,
    activeSheetId: null,
    editingNodeId: null,
    error: null
  })
  mindMapCanvasHarness.props = null
})

afterEach(() => {
  useMindMapViewStore.setState(originalMindMapState)
  useAppStore.setState(originalAppState)
  if (originalTeachingSystemDescriptor) {
    Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
  } else {
    delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
  }
  vi.restoreAllMocks()
})

describe('MindMapView create flow', () => {
  it('shows the card gallery and its search field without editor rails initially', () => {
    const { container } = render(<MindMapView />)

    expect(screen.getByPlaceholderText('Search mind maps')).toBeInTheDocument()
    expect(container.querySelector('.mindmap-home')).toBeInTheDocument()
    expect(container.querySelector('.mindmap-list')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-stage')).not.toBeInTheDocument()
  })

  it('creates a default-titled mind map and enters the editor without showing a naming dialog', async () => {
    const { container } = render(<MindMapView />)

    const createButton = screen.getAllByRole('button', { name: 'New mind map' })[0]
    fireEvent.click(createButton)

    await waitFor(() => expect(window.teachingSystem?.createMindMap).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      title: 'New mind map',
      structureClass: 'studiumx.layout.logic.right'
    }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-home')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-stage')).toBeInTheDocument()
    expect(useMindMapViewStore.getState().current?.title).toBe('Chemistry')
  })

  it('leaves line drawing mode after creating a connector so its endpoints can be edited', async () => {
    render(<MindMapView />)
    fireEvent.click(screen.getAllByRole('button', { name: 'New mind map' })[0])

    await waitFor(() => expect(mindMapCanvasHarness.props).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Line' }))
    await waitFor(() => expect(mindMapCanvasHarness.props?.lineTool).toMatchObject({
      active: true,
      lineShape: 'straight',
      endArrow: 'triangle'
    }))

    const onCreateLine = mindMapCanvasHarness.props?.onCreateLine
    if (!onCreateLine) throw new Error('expected the canvas to receive an onCreateLine callback')

    act(() => {
      onCreateLine({
        from: { x: 20, y: 20 },
        to: { x: 140, y: 100 },
        style: { lineShape: 'straight', endArrow: 'triangle' }
      })
    })

    await waitFor(() => expect(mindMapCanvasHarness.props?.lineTool).toBeNull())
  })

  it('persists and undoes a curved connector control offset from the canvas', async () => {
    render(<MindMapView />)
    fireEvent.click(screen.getAllByRole('button', { name: 'New mind map' })[0])
    await waitFor(() => expect(mindMapCanvasHarness.props?.onCreateLine).toBeDefined())

    act(() => {
      mindMapCanvasHarness.props?.onCreateLine?.({
        from: { x: 20, y: 20 },
        to: { x: 180, y: 100 },
        style: { lineShape: 'curved', endArrow: 'triangle' }
      })
    })
    const connector = useMindMapViewStore.getState().current?.sheets[0]?.elements.find(
      (element) => element.type === 'connector'
    )
    if (!connector) throw new Error('expected the canvas callback to create a connector')

    act(() => {
      mindMapCanvasHarness.props?.onUpdateLine?.(connector.id, {
        curveControlOffset: { x: 24, y: -48 }
      })
    })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]).toMatchObject({
      curveControlOffset: { x: 24, y: -48 }
    })
    await waitFor(() => {
      expect(mindMapCanvasHarness.props?.document?.sheets[0]?.elements[0]).toMatchObject({
        curveControlOffset: { x: 24, y: -48 }
      })
    })

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.elements[0]).not.toHaveProperty(
      'curveControlOffset'
    )
  })

  it('uses compact Chinese hover labels for floating-toolbar actions', async () => {
    await i18n.changeLanguage('zh-CN')
    const { container } = render(<MindMapView />)

    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('mindmap.newDocument') })[0])

    await waitFor(() =>
      expect(container.querySelector('.mindmap-floating-toolbar')).toBeInTheDocument()
    )
    const toolbar = container.querySelector('.mindmap-floating-toolbar')
    expect(toolbar).not.toBeNull()
    const expectedTooltips = [
      ['撤销', '撤销'],
      ['重做', '重做'],
      ['收起最后一层子节点', '收起最后一层子节点'],
      ['展开下一层子节点', '展开下一层子节点'],
      ['添加子节点', '加子节点'],
      ['添加同级节点', '加同级'],
      ['节点总结', '节点总结'],
      ['添加内容', '加内容']
    ]

    for (const [name, tooltip] of expectedTooltips) {
      const button = toolbar?.querySelector(`button[aria-label="${name}"]`)
      expect(button).toHaveAttribute('data-tooltip', tooltip)
      expect(button).not.toHaveAttribute('title')
    }

    expect(toolbar?.querySelector('button[aria-label="添加子节点"] svg > path'))
      .toHaveAttribute('d', 'M8.75 10H11.25')
    expect(toolbar?.querySelector('button[aria-label="收起最后一层子节点"] svg > path'))
      .toHaveAttribute('d', 'M5.5 5.5L9 10L5.5 14.5')
    expect(toolbar?.querySelector('button[aria-label="展开下一层子节点"] svg > path'))
      .toHaveAttribute('d', 'M8.5 5.5L5 10L8.5 14.5')
    const summaryIcon = toolbar?.querySelector('button[aria-label="节点总结"] svg')
    expect(summaryIcon?.querySelectorAll('rect')).toHaveLength(2)
    expect(summaryIcon?.querySelector('.mindmap-toolbar-summary-icon__brace')).toBeInTheDocument()
  })

  it('keeps the user in the gallery when direct creation fails', async () => {
    const createMindMap = vi.fn(async () => {
      throw new Error('create failed')
    })
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        listMindMaps: vi.fn(async () => []),
        createMindMap
      } as Partial<TeachingSystemApi>
    })

    render(<MindMapView />)
    fireEvent.click(screen.getAllByRole('button', { name: 'New mind map' })[0])

    await waitFor(() => expect(createMindMap).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search mind maps')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('create failed')
    expect(useMindMapViewStore.getState().current).toBeNull()
  })

  it('shows rename, copy, and remove actions when a preview card is right-clicked', async () => {
    const source = makeDocument('Chemistry')
    const summary: MindMapSummary = {
      id: source.id,
      title: source.title,
      updatedAt: source.updatedAt,
      sheetCount: source.sheets.length
    }
    const copied = {
      ...source,
      id: 'mind-map-copy',
      revision: 1,
      title: 'Chemistry copy',
      createdAt: '2026-08-10T01:00:00.000Z',
      updatedAt: '2026-08-10T01:00:00.000Z'
    }
    const listMindMaps = vi.fn(async () => [summary])
    const listMindMapLibrary = vi.fn(async () => ({
      home: [],
      workspaces: [{ workspaceId: 'workspace-1', name: 'Test workspace', path: '/Users/chos1nz/Documents/Test workspace', documents: [summary] }]
    }))
    const readMindMap = vi.fn(async ({ id }: { id: string }) =>
      id === copied.id ? copied : source
    )
    const createMindMap = vi.fn(async () => copied)
    const updateMindMap = vi.fn(async (payload: { doc: MindMapDocumentV2 }) => ({
      ok: true as const,
      document: payload.doc
    }))
    const deleteMindMap = vi.fn(async () => undefined)
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        listMindMaps,
        listMindMapLibrary,
        readMindMap,
        createMindMap,
        updateMindMap,
        deleteMindMap
      } as Partial<TeachingSystemApi>
    })

    render(<MindMapView />)

    // The map appears in both the "Recently edited" and "All mind maps"
    // sections (recent is a highlight subset of all), so match all instances.
    await screen.findAllByRole('button', { name: 'Chemistry' })

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename: Chemistry' })[0])
    expect(useMindMapViewStore.getState().current).toBeNull()
    const renameInput = screen.getByRole('textbox', { name: 'Rename' })
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    fireEvent.change(renameInput, { target: { value: 'Organic chemistry' } })
    fireEvent.blur(renameInput)
    await waitFor(() =>
      expect(updateMindMap).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'workspace-1',
          id: source.id,
          expectedRevision: source.revision,
          doc: expect.objectContaining({ title: 'Organic chemistry' })
        })
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Rename' })).not.toBeInTheDocument()
    )

    fireEvent.contextMenu(screen.getAllByRole('button', { name: 'Chemistry' })[0], {
      clientX: 100,
      clientY: 120
    })

    expect(screen.getByRole('menu', { name: 'Mind map actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy mind map' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove mind map' })).toBeInTheDocument()

    fireEvent.contextMenu(screen.getAllByRole('button', { name: 'Chemistry' })[0], {
      clientX: 100,
      clientY: 120
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy mind map' }))
    await waitFor(() =>
      expect(createMindMap).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        title: 'Chemistry copy'
      })
    )
    expect(updateMindMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        id: copied.id,
        expectedRevision: copied.revision,
        doc: expect.objectContaining({
          id: copied.id,
          title: 'Chemistry copy',
          sheets: source.sheets
        })
      })
    )

    fireEvent.contextMenu(screen.getAllByRole('button', { name: 'Chemistry' })[0], {
      clientX: 100,
      clientY: 120
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove mind map' }))
    await waitFor(() =>
      expect(deleteMindMap).toHaveBeenCalledWith({ workspaceId: 'workspace-1', id: source.id })
    )
    expect(screen.queryAllByRole('button', { name: 'Chemistry' })).toHaveLength(0)
  })

  it('renders list-provided card previews without waiting for document reads', async () => {
    const source = makeDocument('Chemistry')
    source.sheets[0]!.root = {
      id: 'preview-root',
      title: 'Preview root',
      children: [{ id: 'preview-child', title: 'Preview child', children: [] }]
    }
    const summary: MindMapSummary = {
      id: source.id,
      title: 'Chemistry',
      updatedAt: source.updatedAt,
      sheetCount: 1,
      preview: {
        theme: source.theme,
        root: source.sheets[0]!.root,
        layout: source.sheets[0]!.layout
      }
    }
    const readMindMap = vi.fn(() => new Promise<MindMapDocumentV2>(() => undefined))
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        listMindMaps: vi.fn(async () => []),
        listMindMapLibrary: vi.fn(async () => ({
          home: [],
          workspaces: [{ workspaceId: 'workspace-1', name: 'Test workspace', path: '/Users/chos1nz/Documents/Test workspace', documents: [summary] }]
        })),
        readMindMap
      } as Partial<TeachingSystemApi>
    })

    render(<MindMapView />)

    await screen.findAllByRole('button', { name: 'Chemistry' })
    // Workspace cards stay inside their folder on the home page; the recent
    // row is the only home-page projection for this workspace document.
    expect(screen.getAllByText('Preview child')).toHaveLength(1)
    expect(readMindMap).not.toHaveBeenCalled()
  })

  it('opens editor utilities from the right and returns to the gallery from the home icon', async () => {
    const document = makeDocument('Chemistry')
    useMindMapViewStore.setState({
      current: document,
      selectedNodeId: document.sheets[0]?.root.id ?? null,
      activeSheetId: document.sheets[0]?.id ?? null,
      editingNodeId: null
    })

    const { container } = render(<MindMapView />)

    expect(container.querySelector('.mindmap-list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search this sheet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Outline' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search this sheet' }))
    expect(container.querySelector('.mindmap-utility-panel--search')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Outline' }))
    expect(container.querySelector('.mindmap-utility-panel--outline')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to mind maps' }))
    await waitFor(() => expect(useMindMapViewStore.getState().current).toBeNull())
    expect(screen.getByPlaceholderText('Search mind maps')).toBeInTheDocument()
  })

  it('offers the implemented export formats', () => {
    const document = makeDocument('Chemistry')
    useMindMapViewStore.setState({
      current: document,
      selectedNodeId: document.sheets[0]?.root.id ?? null,
      activeSheetId: document.sheets[0]?.id ?? null,
      editingNodeId: null
    })

    render(<MindMapView />)

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(screen.getByRole('menuitem', { name: 'Export Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Export OPML' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Export SVG' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Export PNG' })).toBeInTheDocument()
  })

  it('shows a newly created map card immediately after returning to the gallery', async () => {
    const created = makeDocument('Physics')
    created.id = 'mind-map-physics'
    const createdSummary: MindMapSummary = {
      id: created.id,
      title: created.title,
      updatedAt: created.updatedAt,
      sheetCount: created.sheets.length
    }
    // The library mock only reports the new card after the create flow has had
    // a chance to refresh it — mimicking a fresh main-process listing.
    let libraryCalls = 0
    const listMindMapLibrary = vi.fn(async () => {
      libraryCalls += 1
      return { home: libraryCalls > 1 ? [createdSummary] : [], workspaces: [] }
    })
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        listMindMaps: vi.fn(async () => []),
        listMindMapLibrary,
        createMindMap: vi.fn(async () => created)
      } as Partial<TeachingSystemApi>
    })

    render(<MindMapView />)
    // A freshly opened page has the initial null scope, which is also the
    // home page — this is the state that previously kept the new card hidden.
    expect(useMindMapViewStore.getState().scope).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'New mind map' })[0])
    await waitFor(() => expect(useMindMapViewStore.getState().current?.title).toBe('Physics'))

    fireEvent.click(screen.getByRole('button', { name: 'Back to mind maps' }))
    await screen.findAllByRole('button', { name: 'Physics' })
  })

  it('refreshes an edited map card (title and preview) when returning to the gallery', async () => {
    const source = makeDocument('Chemistry')
    const edited = { ...source, title: 'Organic chemistry' }
    const oldSummary: MindMapSummary = {
      id: source.id,
      title: source.title,
      updatedAt: source.updatedAt,
      sheetCount: source.sheets.length
    }
    const newSummary: MindMapSummary = {
      ...oldSummary,
      title: 'Organic chemistry',
      updatedAt: '2026-08-10T02:00:00.000Z'
    }
    // The library mock reports the stale card until the editor is closed, then
    // the refreshed one — the exact staleness the bug report describes.
    let libraryCalls = 0
    const listMindMapLibrary = vi.fn(async () => {
      libraryCalls += 1
      return { home: libraryCalls > 1 ? [newSummary] : [oldSummary], workspaces: [] }
    })
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        listMindMaps: vi.fn(async () => []),
        listMindMapLibrary,
        updateMindMap: vi.fn(async (payload: { doc: MindMapDocumentV2 }) => ({
          ok: true as const,
          document: payload.doc
        }))
      } as Partial<TeachingSystemApi>
    })

    useMindMapViewStore.setState({
      current: edited,
      scope: 'home',
      selectedNodeId: edited.sheets[0]?.root.id ?? null,
      activeSheetId: edited.sheets[0]?.id ?? null,
      editingNodeId: null
    })

    render(<MindMapView />)
    expect(screen.getByRole('button', { name: 'Back to mind maps' })).toBeInTheDocument()

    const libraryCallsBeforeClose = listMindMapLibrary.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Back to mind maps' }))

    // Closing the editor must re-fetch the aggregate library so the card is
    // current immediately instead of only after a later reload or restart.
    await waitFor(() =>
      expect(listMindMapLibrary.mock.calls.length).toBeGreaterThan(libraryCallsBeforeClose)
    )
    await screen.findAllByRole('button', { name: 'Organic chemistry' })
    expect(screen.queryByRole('button', { name: 'Chemistry' })).not.toBeInTheDocument()
  })
})
