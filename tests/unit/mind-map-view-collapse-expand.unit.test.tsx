import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

vi.mock('../../src/renderer/src/views/mindmap/MindMapAiPanel', () => ({ MindMapAiPanel: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapCanvas', () => ({
  MindMapCanvas: ({ panMode }: { panMode?: boolean }) => (
    <div data-testid="mindmap-canvas" data-pan-mode={String(panMode ?? true)} />
  )
}))
vi.mock('../../src/renderer/src/views/mindmap/MindMapExportFeedback', () => ({ MindMapExportFeedback: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapOutline', () => ({ MindMapOutline: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSearchPanel', () => ({ MindMapSearchPanel: () => null }))
vi.mock('../../src/renderer/src/views/mindmap/MindMapSheetTabs', () => ({ MindMapSheetTabs: () => null }))
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
        layout: { structureClass: 'studiumx.layout.logic.right' }
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

describe('MindMapView recursive collapse/expand toolbar actions', () => {
  it('does not render rename or inspector controls in the canvas action capsule', () => {
    render(<MindMapView />)

    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mind map inspector' })).not.toBeInTheDocument()
  })

  it('renders last-level collapse and next-level expand controls in the canvas toolbar', () => {
    render(<MindMapView />)

    expect(screen.getByRole('button', { name: 'Collapse last visible level' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand next level' })).toBeInTheDocument()
  })

  it('puts the box-selection tool first and passes its toggled mode to the canvas', () => {
    render(<MindMapView />)

    const toolbar = screen.getByRole('toolbar', { name: 'Mind Map' })
    const boxSelectTool = within(toolbar).getAllByRole('button')[0]!

    expect(boxSelectTool).toHaveAccessibleName('Box select mode')
    expect(boxSelectTool).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('mindmap-canvas')).toHaveAttribute('data-pan-mode', 'true')

    fireEvent.click(boxSelectTool)

    expect(boxSelectTool).toHaveAttribute('aria-pressed', 'true')
    expect(boxSelectTool).toHaveClass('is-active')
    expect(screen.getByTestId('mindmap-canvas')).toHaveAttribute('data-pan-mode', 'false')
  })

  it('collapses the deepest visible branch layer recursively through the canonical command path', () => {
    render(<MindMapView />)

    expect(collapsedIds()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Collapse last visible level' }))
    expect(collapsedIds()).toEqual(['branch-a'])

    fireEvent.click(screen.getByRole('button', { name: 'Collapse last visible level' }))
    expect(collapsedIds().sort()).toEqual(['branch-a', 'root'])

    // Each layer is one user-level undo entry.
    useMindMapViewStore.getState().undo()
    expect(collapsedIds()).toEqual(['branch-a'])
    useMindMapViewStore.getState().undo()
    expect(collapsedIds()).toEqual([])
  })

  it('expands one visible child layer at a time across the whole map', () => {
    render(<MindMapView />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse last visible level' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse last visible level' }))
    expect(collapsedIds().sort()).toEqual(['branch-a', 'root'])

    fireEvent.click(screen.getByRole('button', { name: 'Expand next level' }))
    expect(collapsedIds()).toEqual(['branch-a'])

    fireEvent.click(screen.getByRole('button', { name: 'Expand next level' }))
    expect(collapsedIds()).toEqual([])

    // Undo restores the previous frontier as a single entry.
    useMindMapViewStore.getState().undo()
    expect(collapsedIds()).toEqual(['branch-a'])
  })
})
