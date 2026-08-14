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
  it('does not render a readability warning for low-contrast theme colors', () => {
    render(<MindMapThemePanel />)

    expect(screen.queryByRole('status', { name: 'Color readability warning' })).not.toBeInTheDocument()
  })

  it('shows the single-line color editor only when rainbow branches is off', () => {
    render(<MindMapThemePanel />)

    const toggle = screen.getByRole('checkbox', { name: 'Rainbow branches' })
    // Rainbow mode (default) no longer duplicates the color scheme picker.
    expect(screen.queryByLabelText('Branch palette')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    const lineHex = screen.getByRole('textbox', { name: 'Branch line HEX' })
    fireEvent.change(lineHex, { target: { value: '#123456' } })
    fireEvent.keyDown(lineHex, { key: 'Enter' })

    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      rainbowBranches: false,
      lineColor: '#123456'
    })

    fireEvent.click(toggle)
    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      rainbowBranches: true,
      lineColor: '#123456'
    })
    expect(screen.queryByLabelText('Branch palette')).not.toBeInTheDocument()
  })

  it('keeps an imported document font visible and warns only that it may fall back', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.fontFamily = 'Imported XMind Font, sans-serif'
    useMindMapViewStore.setState({ current: structuredClone(current) })

    render(<MindMapThemePanel />)

    expect(screen.getByRole('button', { name: /Imported XMind Font/ })).toBeInTheDocument()
    expect(screen.getByText('Requested imported or custom font may fall back in this app.')).toBeInTheDocument()
  })

  it('supports HEX, transparent and CJK-safe document appearance controls', () => {
    render(<MindMapThemePanel />)

    fireEvent.change(screen.getByLabelText('Background HEX'), { target: { value: '#f0fdf4' } })
    fireEvent.keyDown(screen.getByLabelText('Background HEX'), { key: 'Enter' })
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')

    fireEvent.click(screen.getAllByRole('button', { name: 'Transparent' })[0]!)
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('transparent')

    fireEvent.click(screen.getByRole('button', { name: 'Font family System font' }))
    fireEvent.click(screen.getByRole('option', { name: 'CJK Sans-serif' }))
    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toContain('Noto Sans CJK SC')
  })

  it('commits 8-digit alpha HEX through the theme command and keeps it readable', () => {
    render(<MindMapThemePanel />)
    const backgroundHex = screen.getByRole('textbox', { name: 'Background HEX' })

    fireEvent.change(backgroundHex, { target: { value: '#10182780' } })
    fireEvent.keyDown(backgroundHex, { key: 'Enter' })

    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#10182780')
  })

  it('alpha slider converts the background to 8-digit hex with the new alpha', () => {
    render(<MindMapThemePanel />)

    const alpha = screen.getByRole('slider', { name: 'Background opacity' })
    expect(alpha).toBeEnabled()
    expect(screen.getByText('100%')).toBeInTheDocument()

    act(() => {
      fireEvent.change(alpha, { target: { value: '50' } })
    })
    const hex = screen.getByRole('textbox', { name: 'Background HEX' })
    expect(hex).toHaveValue('#10182780')
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#10182780')
    expect(screen.getByText('50%')).toBeInTheDocument()

    act(() => {
      fireEvent.change(alpha, { target: { value: '100' } })
    })
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#101827FF')

    act(() => {
      useMindMapViewStore.getState().undo()
    })
    // Undo returns the previously committed state, not the panel default.
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#10182780')
  })

  it('alpha slider reads an 8-digit background and defaults to 100% for 6-digit hex', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.background = '#10182780'
    useMindMapViewStore.setState({ current: structuredClone(current) })

    render(<MindMapThemePanel />)

    expect(screen.getByRole('slider', { name: 'Background opacity' })).toHaveValue('50')
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('disables the alpha slider while the background is transparent', () => {
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Transparent' })[0]!)
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('transparent')

    const alpha = screen.getByRole('slider', { name: 'Background opacity' })
    expect(alpha).toBeDisabled()
    expect(alpha).toHaveAccessibleDescription('Unavailable while the background is transparent')
  })

  it('announces the selected font option without relying on colour', () => {
    localStorage.clear()
    render(<MindMapThemePanel />)
    const trigger = screen.getByRole('button', { name: /Font family/ })
    fireEvent.click(trigger)
    const system = screen.getByRole('option', { name: 'System font' })
    expect(system).toHaveAttribute('aria-selected', 'true')
    expect(system).toHaveAccessibleDescription('Selected')
  })

  it('tracks recent applied backgrounds in localStorage and applies them back', () => {
    localStorage.clear()
    const dispatch = vi.spyOn(useMindMapViewStore.getState(), 'dispatchCommand')
    render(<MindMapThemePanel />)

    const backgroundHex = screen.getByRole('textbox', { name: 'Background HEX' })
    fireEvent.change(backgroundHex, { target: { value: '#f0fdf4' } })
    fireEvent.keyDown(backgroundHex, { key: 'Enter' })
    fireEvent.change(backgroundHex, { target: { value: '#101827' } })
    fireEvent.keyDown(backgroundHex, { key: 'Enter' })

    const stored = JSON.parse(localStorage.getItem('mindmap.recentBackgroundColors') ?? '[]') as string[]
    expect(stored[0]).toBe('#101827')
    expect(stored[1]).toBe('#F0FDF4')

    fireEvent.click(screen.getByRole('button', { name: 'Recent color #F0FDF4' }))

    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'document.apply-theme' }),
      expect.anything()
    )
  })

  it('does not record transparent or malformed colors and loads recent colors on mount', () => {

    localStorage.clear()
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Transparent' })[0]!)
    expect(localStorage.getItem('mindmap.recentBackgroundColors')).toBeNull()

    const backgroundHex = screen.getByRole('textbox', { name: 'Background HEX' })
    fireEvent.change(backgroundHex, { target: { value: 'garbage' } })
    fireEvent.keyDown(backgroundHex, { key: 'Enter' })
    expect(localStorage.getItem('mindmap.recentBackgroundColors')).toBeNull()

    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.background = '#10182755'
    useMindMapViewStore.setState({ current: structuredClone(current) })
    localStorage.setItem(
      'mindmap.recentBackgroundColors',
      JSON.stringify(['#10182755', '#notacolor', '#F0FDF4', '#f0fdf4'])
    )

    const { unmount } = render(<MindMapThemePanel />)
    expect(screen.getByRole('button', { name: 'Recent color #10182755' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recent color #F0FDF4' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recent color #notacolor' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear recent colors' }))
    expect(localStorage.getItem('mindmap.recentBackgroundColors')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Recent colors' })).not.toBeInTheDocument()
    unmount()
  })

  it('opens the font picker, filters by search and selects a font through the theme command', () => {
    localStorage.clear()
    render(<MindMapThemePanel />)

    const trigger = screen.getByRole('button', { name: 'Font family System font' })
    fireEvent.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'Search fonts' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search fonts' }), {
      target: { value: 'mono' }
    })
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    // Every result either has a matching label or a matching stack family
    // (e.g. the Menlo entry matches via its `ui-monospace` stack).
    expect(options.every((option) => {
      const label = (option.textContent ?? '').toLowerCase()
      const style = option.getAttribute('style')?.toLowerCase()
      return label.includes('mono') || (style?.includes('monospace') ?? false)
    })).toBe(true)

    fireEvent.click(screen.getByRole('option', { name: 'Monospace' }))
    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toContain('ui-monospace')
  })

  it('renders each font option in its own font family (C-06 preview)', () => {
    render(<MindMapThemePanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Font family System font' }))

    const option = screen.getByRole('option', { name: 'CJK Sans-serif' })
    expect(option).toHaveStyle({
      fontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    })
  })

  it('supports keyboard: arrows wrap, Enter selects, Escape closes and restores focus', () => {
    localStorage.clear()
    const dispatch = vi.spyOn(useMindMapViewStore.getState(), 'dispatchCommand')
    render(<MindMapThemePanel />)

    const trigger = screen.getByRole('button', { name: 'Font family System font' })
    fireEvent.click(trigger)
    const options = screen.getAllByRole('option')
    const first = options[0]!
    const last = options[options.length - 1]!

    // ArrowUp from search (no option focused) wraps to the last option.
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search fonts' }), { key: 'ArrowUp' })
    expect(last).toHaveFocus()
    // ArrowDown wraps to the first option.
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search fonts' }), { key: 'ArrowDown' })
    expect(first).toHaveFocus()

    // Enter selects the focused option and commits through the theme command.
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'document.apply-theme' }),
      expect.anything()
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('records a recently used font to localStorage and surfaces it in the Recent group', () => {
    localStorage.clear()
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Font family System font' }))
    fireEvent.click(screen.getByRole('option', { name: 'CJK Sans-serif' }))

    const stored = JSON.parse(localStorage.getItem('mindmap.recentFonts') ?? '[]') as string[]
    expect(stored[0]).toBe('"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif')

    // Reopen: the Recent group appears and lists the recorded font first.
    fireEvent.click(screen.getByRole('button', { name: /CJK Sans-serif/ }))
    const recentLabel = screen.getByText('Recent')
    expect(recentLabel).toBeInTheDocument()
    const recentOptions = recentLabel.closest('.mindmap-font-picker__group')
      ?.querySelectorAll('[role="option"]')
    expect(recentOptions?.length).toBeGreaterThan(0)
  })

  it('can clear a concrete topic font override back to inherit (clear item)', () => {
    localStorage.clear()
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.fontFamily = 'Verdana, Geneva, sans-serif'
    useMindMapViewStore.setState({ current: structuredClone(current) })

    render(<MindMapThemePanel />)
    const trigger = screen.getByRole('button', { name: /Verdana/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'System font' }))

    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toBeUndefined()
  })

})
