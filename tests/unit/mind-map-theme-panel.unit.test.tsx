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
  it('shows a non-blocking readability warning for unsafe resolved topic colors without dispatching a change', () => {
    const dispatch = vi.spyOn(useMindMapViewStore.getState(), 'dispatchCommand')
    render(<MindMapThemePanel />)

    expect(screen.getByRole('status', { name: 'Color readability warning' })).toHaveTextContent(
      'Some topic text may be hard to read'
    )
    expect(screen.getByRole('checkbox', { name: 'Rainbow branches' })).toBeEnabled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not show a readability warning when all resolved topic text pairs are high contrast', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme = {
      ...current.theme,
      textColor: '#FFFFFF',
      rainbowBranches: false,
      lineColor: '#24324A',
      topicStyles: {
        central: { fill: '#24324A', textColor: '#FFFFFF' },
        main: { fill: '#24324A', textColor: '#FFFFFF' },
        sub: { fill: '#24324A', textColor: '#FFFFFF' }
      }
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })

    render(<MindMapThemePanel />)

    expect(screen.queryByRole('status', { name: 'Color readability warning' })).not.toBeInTheDocument()
  })

  it('preserves palette and single-line color while switching branch modes', () => {
    render(<MindMapThemePanel />)

    const toggle = screen.getByRole('checkbox', { name: 'Rainbow branches' })
    fireEvent.click(toggle)

    const lineHex = screen.getByRole('textbox', { name: 'Branch line HEX' })
    fireEvent.change(lineHex, { target: { value: '#123456' } })
    fireEvent.keyDown(lineHex, { key: 'Enter' })

    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      rainbowBranches: false,
      lineColor: '#123456'
    })

    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Branch palette'), { target: { value: 'fire' } })
    fireEvent.click(toggle)

    const theme = useMindMapViewStore.getState().current?.theme
    expect(theme?.rainbowBranches).toBe(false)
    expect(theme?.lineColor).toBe('#123456')
    expect(theme?.colorSchemeId).toBe('fire')
    expect(theme?.branchColors).toHaveLength(6)
  })

  it('keeps an imported document font visible and warns only that it may fall back', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.fontFamily = 'Imported XMind Font, sans-serif'
    useMindMapViewStore.setState({ current: structuredClone(current) })

    render(<MindMapThemePanel />)

    expect(screen.getByRole('combobox', { name: 'Font family' })).toHaveValue(
      'Imported XMind Font, sans-serif'
    )
    expect(screen.getByText('Requested imported or custom font may fall back in this app.')).toBeInTheDocument()
  })

  it('supports HEX, transparent and CJK-safe document appearance controls', () => {
    render(<MindMapThemePanel />)

    const backgroundHex = screen.getByRole('textbox', { name: 'Background HEX' })
    fireEvent.change(backgroundHex, { target: { value: '#f0fdf4' } })
    fireEvent.keyDown(backgroundHex, { key: 'Enter' })
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')

    fireEvent.click(screen.getAllByRole('button', { name: 'Transparent' })[0]!)
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('transparent')

    fireEvent.change(screen.getByLabelText('Font family'), {
      target: { value: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif' }
    })
    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toContain('Noto Sans CJK SC')
  })

})
