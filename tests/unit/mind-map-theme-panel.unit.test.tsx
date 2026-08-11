import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapThemePanel } from '../../src/renderer/src/views/mindmap/MindMapThemePanel'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import {
  DEFAULT_MIND_MAP_THEME,
  type MindMapDocumentV2
} from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const NOW = '2026-08-09T00:00:00.000Z'
const originalMindMapState = useMindMapViewStore.getState()
const originalAppState = useAppStore.getState()
const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

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
    theme: {
      id: 'custom-theme',
      name: 'Exam prep',
      background: '#101827',
      textColor: '#f8fafc',
      lineColor: '#64748b'
    },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root', title: 'Root topic', children: [] },
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
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) }
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
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  } else {
    delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard
  }
  vi.restoreAllMocks()
})

describe('MindMapThemePanel', () => {
  it('toggles rainbow branches through the undoable theme command', async () => {
    render(<MindMapThemePanel />)

    const toggle = screen.getByRole('checkbox', { name: 'Rainbow branches' })
    expect(toggle).toBeChecked()

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(useMindMapViewStore.getState().current?.theme.rainbowBranches).toBe(false)

    act(() => {
      useMindMapViewStore.getState().undo()
    })

    expect(useMindMapViewStore.getState().current?.theme).toEqual(makeDocument().theme)
  })

  it('resets a custom theme through the undoable document theme command', () => {
    render(<MindMapThemePanel />)
    const reset = screen.getByRole('button', { name: 'Reset theme' })
    expect(reset).not.toBeDisabled()

    act(() => {
      fireEvent.click(reset)
    })

    expect(useMindMapViewStore.getState().current?.theme).toEqual(DEFAULT_MIND_MAP_THEME)
    expect(screen.getByRole('button', { name: 'Reset theme' })).toBeDisabled()

    act(() => {
      useMindMapViewStore.getState().undo()
    })

    expect(useMindMapViewStore.getState().current?.theme).toEqual(makeDocument().theme)
  })
})
