import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { MindMapSummary } from '../../src/shared/mindmap/mind-map-types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

vi.mock('../../src/renderer/src/views/mindmap/MindMapAiPanel', () => ({ MindMapAiPanel: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapCanvas', () => ({ MindMapCanvas: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapExportFeedback', () => ({ MindMapExportFeedback: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapImportCompatibilityReport', () => ({ MindMapImportCompatibilityReport: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapOutline', () => ({ MindMapOutline: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSearchPanel', () => ({ MindMapSearchPanel: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSheetTabs', () => ({ MindMapSheetTabs: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSourcePanel', () => ({ MindMapSourcePanel: () => null }))
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
        layout: { structureClass: 'org.xmind.ui.logic.right' }
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

  it('opens a floating create dialog and creates with the selected structure', async () => {
    render(<MindMapView />)

    const createButton = screen.getAllByRole('button', { name: 'New mind map' })[0]
    fireEvent.click(createButton)

    expect(screen.getByRole('dialog', { name: 'Create a mind map' })).toBeInTheDocument()
    expect(createButton).toHaveClass('mindmap-home-card--new')
    expect(createButton).not.toHaveClass('mindmap-home-card--creating')
    expect(screen.getByRole('radio', { name: /Mind map/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(window.teachingSystem?.createMindMap).not.toHaveBeenCalled()

    const matrixPreset = screen.getByRole('radio', { name: /Matrix chart/i })
    matrixPreset.focus()
    fireEvent.click(matrixPreset)
    expect(matrixPreset).toHaveFocus()
    expect(matrixPreset).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Mind map name' }), {
      target: { value: 'Chemistry' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create mind map' }))

    await waitFor(() => expect(window.teachingSystem?.createMindMap).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      title: 'Chemistry',
      structureClass: 'org.xmind.ui.spreadsheet'
    }))
    expect(useMindMapViewStore.getState().current?.title).toBe('Chemistry')
  })

  it('keeps the create dialog open and reports an error when creation fails', async () => {
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Mind map name' }), {
      target: { value: 'Chemistry' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create mind map' }))

    await waitFor(() => expect(createMindMap).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Create a mind map' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('create failed')
    expect(useMindMapViewStore.getState().current).toBeNull()
  })

  it('closes the create dialog with Escape without creating a document', () => {
    render(<MindMapView />)

    const createButton = screen.getAllByRole('button', { name: 'New mind map' })[0]
    fireEvent.click(createButton)
    expect(screen.getByRole('dialog', { name: 'Create a mind map' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Create a mind map' })).not.toBeInTheDocument()
    expect(createButton).toBeInTheDocument()
    expect(window.teachingSystem?.createMindMap).not.toHaveBeenCalled()
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
        readMindMap,
        createMindMap,
        updateMindMap,
        deleteMindMap
      } as Partial<TeachingSystemApi>
    })

    render(<MindMapView />)

    await screen.findByRole('button', { name: 'Chemistry' })

    fireEvent.click(screen.getByRole('button', { name: 'Rename: Chemistry' }))
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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Chemistry' }), {
      clientX: 100,
      clientY: 120
    })

    expect(screen.getByRole('menu', { name: 'Mind map actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy mind map' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove mind map' })).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Chemistry' }), {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Chemistry' }), {
      clientX: 100,
      clientY: 120
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove mind map' }))
    await waitFor(() =>
      expect(deleteMindMap).toHaveBeenCalledWith({ workspaceId: 'workspace-1', id: source.id })
    )
    expect(screen.queryByRole('button', { name: 'Chemistry' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Outline' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search this sheet' }))
    expect(container.querySelector('.mindmap-utility-panel--search')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Outline' }))
    expect(container.querySelector('.mindmap-utility-panel--outline')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to mind maps' }))
    await waitFor(() => expect(useMindMapViewStore.getState().current).toBeNull())
    expect(screen.getByPlaceholderText('Search mind maps')).toBeInTheDocument()
  })
})
