import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { MindMapSummary } from '../../src/shared/mindmap/mind-map-types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

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
  MindMapCanvas: () => null
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

function installTeachingSystem(overrides: Partial<TeachingSystemApi>): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: {
      listMindMaps: vi.fn(async (): Promise<MindMapSummary[]> => []),
      listMindMapLibrary: vi.fn(async () => null),
      readMindMap: vi.fn(async () => makeDocument('Imported')),
      createMindMap: vi.fn(async () => makeDocument('New map')),
      ...overrides
    } as Partial<TeachingSystemApi>
  })
}

/** Enter the editor by creating a fresh mind map, then click the Import menu item. */
async function clickImport(container: HTMLElement): Promise<void> {
  fireEvent.click(screen.getAllByRole('button', { name: 'New mind map' })[0])
  await waitFor(() => expect(container.querySelector('.mindmap-stage')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  const menu = container.querySelector('.mindmap-export-dropdown__menu')
  if (!menu) throw new Error('expected the export menu to open')
  fireEvent.click(within(menu as HTMLElement).getByRole('menuitem', { name: 'Import' }))
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

describe('MindMapView import', () => {
  it('opens the host import dialog and opens the imported document', async () => {
    const importMindMapFile = vi.fn(async () => ({ canceled: false as const, document: makeDocument('Imported') }))
    const readMindMap = vi.fn(async () => makeDocument('Imported'))
    installTeachingSystem({ importMindMapFile, readMindMap })

    const { container } = render(<MindMapView />)
    await clickImport(container)

    await waitFor(() =>
      expect(importMindMapFile).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    )
    await waitFor(() => expect(useMindMapViewStore.getState().current?.title).toBe('Imported'))
    expect(readMindMap).toHaveBeenCalledWith({ workspaceId: 'workspace-1', id: 'mind-map-1' })
  })

  it('does nothing when the host dialog is canceled', async () => {
    const importMindMapFile = vi.fn(async () => ({ canceled: true as const }))
    const readMindMap = vi.fn(async () => makeDocument('Imported'))
    installTeachingSystem({ importMindMapFile, readMindMap })

    const { container } = render(<MindMapView />)
    await clickImport(container)

    await waitFor(() =>
      expect(importMindMapFile).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    )
    await waitFor(() => expect(useMindMapViewStore.getState().current?.title).toBe('New map'))
    expect(readMindMap).not.toHaveBeenCalled()
  })

  it('surfaces a host import failure as a notice', async () => {
    const importMindMapFile = vi.fn(async () => {
      throw new Error('Markdown import failed (parse): bad tree')
    })
    installTeachingSystem({ importMindMapFile })

    const { container } = render(<MindMapView />)
    await clickImport(container)

    await waitFor(() =>
      expect(screen.getByText('Markdown import failed (parse): bad tree')).toBeInTheDocument()
    )
    expect(useMindMapViewStore.getState().current?.title).toBe('New map')
  })
})
