import { fireEvent, render, screen } from '@testing-library/react'
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

const NOW = '2026-08-12T00:00:00.000Z'
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

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-collapse-expand',
    revision: 1,
    title: 'Collapse expand',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root topic',
          children: [
            {
              id: 'branch-a',
              title: 'Branch A',
              children: [{ id: 'leaf-a1', title: 'Leaf A1', children: [] }]
            },
            { id: 'branch-b', title: 'Branch B', children: [] }
          ]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

const collapsedIds = (): string[] => {
  const root = useMindMapViewStore.getState().current?.sheets[0]?.root
  if (!root) return []
  const ids: string[] = []
  const walk = (node: { id: string; collapsed?: boolean; children: unknown[] }): void => {
    if (node.collapsed === true) ids.push(node.id)
    for (const child of node.children as Array<{ id: string; collapsed?: boolean; children: unknown[] }>) walk(child)
  }
  walk(root)
  return ids
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  useAppStore.setState({
    ...originalAppState,
    appState: { ...originalAppState.appState, activeWorkspace: workspace() }
  })

  const document = makeDocument()
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: {
      listMindMaps: vi.fn(async () => []),
      readMindMap: vi.fn(async () => document),
      updateMindMap: vi.fn(async (payload) => ({
        ok: true as const,
        document: { ...payload.doc, revision: payload.doc.revision + 1 }
      }))
    } as Partial<TeachingSystemApi>
  })

  await useMindMapViewStore.getState().openDocument(document.id)
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

describe('MindMapView collapse/expand-all toolbar actions', () => {
  it('renders collapse-all/expand-all controls in the canvas toolbar', () => {
    render(<MindMapView />)

    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
  })

  it('collapses every topic through the canonical command path when collapse-all is clicked', () => {
    render(<MindMapView />)

    expect(collapsedIds()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))

    expect(collapsedIds().sort()).toEqual(['branch-a', 'branch-b', 'leaf-a1', 'root'])

    // A single user-level undo entry restores the whole map to expanded.
    useMindMapViewStore.getState().undo()
    expect(collapsedIds()).toEqual([])
  })

  it('expands every topic through the canonical command path when expand-all is clicked', () => {
    render(<MindMapView />)

    // Collapse everything first so expand-all has something to revert.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(collapsedIds().length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))

    expect(collapsedIds()).toEqual([])

    // Undo returns to the fully-collapsed state as a single entry.
    useMindMapViewStore.getState().undo()
    expect(collapsedIds().length).toBeGreaterThan(0)
  })
})
