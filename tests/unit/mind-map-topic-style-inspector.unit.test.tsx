import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapTopicStyleInspector } from '../../src/renderer/src/views/mindmap/MindMapTopicStyleInspector'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const NOW = '2026-08-09T00:00:00.000Z'
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
    id: 'mind-map-1',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'studiumx-default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root topic',
          style: { fill: '#123456' },
          children: [{ id: 'child', title: 'Child topic', children: [] }]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  await i18n.changeLanguage('en-US')
  useAppStore.setState({
    ...originalAppState,
    appState: {
      ...originalAppState.appState,
      activeWorkspace: workspace()
    }
  })

  const document = makeDocument()
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: {
      readMindMap: vi.fn(async () => document),
      listMindMaps: vi.fn(async () => []),
      updateMindMap: vi.fn(async (payload) => ({ ok: true as const, document: payload.doc }))
    } as Partial<TeachingSystemApi>
  })

  await useMindMapViewStore.getState().openDocument(document.id)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  useMindMapViewStore.setState(originalMindMapState)
  useAppStore.setState(originalAppState)
  if (originalTeachingSystemDescriptor) {
    Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
  } else {
    delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
  }
  vi.restoreAllMocks()
})

describe('MindMapTopicStyleInspector', () => {
  it('shows inherited sheet layout for the selected topic', () => {
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByText('Topic style')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Topic layout' })).toHaveValue('')
    expect(screen.getByText('Effective layout: Right')).toBeInTheDocument()
  })

  it('updates only the layout override and keeps unrelated style fields', () => {
    render(<MindMapTopicStyleInspector />)
    const select = screen.getByRole('combobox', { name: 'Topic layout' })

    fireEvent.change(select, { target: { value: 'org.xmind.ui.logic.balanced' } })

    const topic = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(topic?.style).toEqual({ fill: '#123456', structureClass: 'org.xmind.ui.logic.balanced' })
    expect(screen.getByText('Effective layout: Balanced')).toBeInTheDocument()
  })

  it('clears the override to inherit again and remains undoable', () => {
    render(<MindMapTopicStyleInspector />)
    const select = screen.getByRole('combobox', { name: 'Topic layout' })

    fireEvent.change(select, { target: { value: 'org.xmind.ui.logic.left' } })
    fireEvent.change(select, { target: { value: '' } })

    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toEqual({
      fill: '#123456'
    })
    expect(select).toHaveValue('')

    act(() => {
      useMindMapViewStore.getState().undo()
    })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toEqual({
      fill: '#123456',
      structureClass: 'org.xmind.ui.logic.left'
    })
    expect(select).toHaveValue('org.xmind.ui.logic.left')
  })
})
