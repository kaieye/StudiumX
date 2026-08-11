import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
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
  it('opens the title form first and creates only after a title is submitted', async () => {
    render(<MindMapView />)

    const createButton = screen.getAllByRole('button', { name: 'New mind map' })[0]
    fireEvent.click(createButton)

    expect(screen.getByPlaceholderText('Enter a title…')).toBeInTheDocument()
    expect(window.teachingSystem?.createMindMap).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Enter a title…'), {
      target: { value: 'Chemistry' }
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    await waitFor(() => expect(window.teachingSystem?.createMindMap).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      title: 'Chemistry'
    }))
    expect(useMindMapViewStore.getState().current?.title).toBe('Chemistry')
  })
})
