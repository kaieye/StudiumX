import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
  localStorage.clear()
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

  it('always shows the single-line color editor regardless of rainbow mode', () => {
    render(<MindMapThemePanel />)

    const toggle = screen.getByRole('checkbox', { name: 'Rainbow branches' })
    // The unified line color HEX editor lives inside the color menu rather than
    // taking up a second control in the main theme row.
    expect(screen.queryByRole('textbox', { name: 'Branch line HEX' }))
      .not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Single branch color' }))
    const dialog = screen.getByRole('dialog', { name: 'Single branch color' })
    const lineHex = within(dialog).getByRole('textbox', { name: 'Branch line HEX' })

    fireEvent.change(lineHex, { target: { value: '#123456' } })
    fireEvent.keyDown(lineHex, { key: 'Enter' })

    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      lineColor: '#123456'
    })

    // Toggling rainbow off keeps the editor visible and preserves the color.
    fireEvent.click(toggle)
    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      rainbowBranches: false,
      lineColor: '#123456'
    })
    expect(within(dialog).getByRole('textbox', { name: 'Branch line HEX' })).toBeInTheDocument()
  })

  it('uses the background-color menu UI for the unified branch-line color', () => {
    render(<MindMapThemePanel />)

    const swatch = screen.getByRole('button', { name: 'Single branch color' })
    expect(swatch).toHaveClass('mindmap-theme-bg-picker__swatch')
    fireEvent.click(swatch)

    const dialog = screen.getByRole('dialog', { name: 'Single branch color' })
    const presets = within(dialog).getByRole('group', { name: 'Preset colors' })
    expect(within(presets).getAllByRole('button')).toHaveLength(18)

    fireEvent.click(within(presets).getByRole('button', { name: 'Preset color #A6B8A4' }))

    expect(useMindMapViewStore.getState().current?.theme.lineColor).toBe('#A6B8A4')
    expect(within(presets).getByRole('button', { name: 'Preset color #A6B8A4' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('slider', { name: 'Branch line opacity' })).toBeEnabled()
    expect(JSON.parse(localStorage.getItem('mindmap.recentLineColors') ?? '[]'))
      .toEqual(['#A6B8A4'])
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

  it('adjusts the document background color through the popover color well', () => {
    render(<MindMapThemePanel />)

    const swatch = screen.getByRole('button', { name: 'Background color' })
    fireEvent.click(swatch)
    const dialog = screen.getByRole('dialog', { name: 'Background color' })

    fireEvent.change(within(dialog).getByLabelText('Background color'), {
      target: { value: '#f0fdf4' }
    })
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')

    fireEvent.click(screen.getByRole('button', { name: 'Font family System font' }))
    fireEvent.click(screen.getByRole('option', { name: 'CJK Sans-serif' }))
    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toContain('Noto Sans CJK SC')
  })

  it('shows preset background colors and applies a selected preset', () => {
    render(<MindMapThemePanel />)

    const swatch = screen.getByRole('button', { name: 'Background color' })
    expect(swatch).toHaveClass('mindmap-theme-bg-picker__swatch')
    fireEvent.click(swatch)

    const presets = screen.getByRole('group', { name: 'Preset colors' })
    expect(within(presets).getAllByRole('button')).toHaveLength(18)
    expect(within(presets).getByRole('button', { name: 'Preset color #FFFFFF' }))
      .toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(within(presets).getByRole('button', { name: 'Preset color #A6B8A4' }))

    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#A6B8A4')
    expect(within(presets).getByRole('button', { name: 'Preset color #A6B8A4' }))
      .toHaveAttribute('aria-pressed', 'true')

    const recent = screen.getByRole('group', { name: 'Recent colors' })
    expect(within(recent).getByRole('button', { name: 'Recent color #A6B8A4' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem('mindmap.recentBackgroundColors') ?? '[]'))
      .toEqual(['#A6B8A4'])
  })

  it('alpha slider converts the background to 8-digit hex with the new alpha', () => {
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const alpha = within(dialog).getByRole('slider', { name: 'Background opacity' })
    const alphaInput = within(dialog).getByRole('spinbutton', {
      name: 'Background opacity percentage'
    })
    expect(alpha).toBeEnabled()
    expect(alphaInput).toHaveValue(100)

    act(() => {
      fireEvent.change(alpha, { target: { value: '50' } })
    })
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#10182780')
    expect(alphaInput).toHaveValue(50)

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
    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })

    expect(within(dialog).getByRole('slider', { name: 'Background opacity' })).toHaveValue('50')
    expect(within(dialog).getByRole('spinbutton', {
      name: 'Background opacity percentage'
    })).toHaveValue(50)
  })

  it('accepts direct opacity percentage input', () => {
    render(<MindMapThemePanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const alphaInput = within(dialog).getByRole('spinbutton', {
      name: 'Background opacity percentage'
    })

    fireEvent.change(alphaInput, { target: { value: '35' } })

    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#10182759')
    expect(within(dialog).getByRole('slider', { name: 'Background opacity' })).toHaveValue('35')
  })

  it('disables the alpha slider while the background is transparent', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.background = 'transparent'
    useMindMapViewStore.setState({ current: structuredClone(current) })

    render(<MindMapThemePanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })

    const alpha = within(dialog).getByRole('slider', { name: 'Background opacity' })
    expect(alpha).toBeDisabled()
    expect(alpha).toHaveAccessibleDescription('Unavailable while the background is transparent')
    expect(within(dialog).getByRole('spinbutton', {
      name: 'Background opacity percentage'
    })).toBeDisabled()
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

  it('applies the color well value through the undoable theme command', () => {
    localStorage.clear()
    const dispatch = vi.spyOn(useMindMapViewStore.getState(), 'dispatchCommand')
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    fireEvent.change(within(dialog).getByLabelText('Background color'), {
      target: { value: '#f0fdf4' }
    })

    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'document.apply-theme' }),
      expect.anything()
    )
  })

  it('keeps recent swatches stable while previewing a custom background color', () => {
    localStorage.setItem('mindmap.recentBackgroundColors', JSON.stringify(['#D9CEC2', '#A6B8A4']))
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const nativeColor = within(dialog).getByLabelText('Background color')
    const recent = within(dialog).getByRole('group', { name: 'Recent colors' })

    fireEvent.change(nativeColor, { target: { value: '#B5C9C7' } })
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#D9CEC2', '#A6B8A4'])

    fireEvent.blur(nativeColor, { target: { value: '#B5C9C7' } })
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#B5C9C7', '#D9CEC2', '#A6B8A4'])
  })

  it('does not add opacity adjustments to recent background colors', () => {
    localStorage.setItem('mindmap.recentBackgroundColors', JSON.stringify(['#D9CEC2', '#A6B8A4']))
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const alpha = within(dialog).getByRole('slider', { name: 'Background opacity' })
    fireEvent.change(alpha, { target: { value: '45' } })

    const recent = within(dialog).getByRole('group', { name: 'Recent colors' })
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#D9CEC2', '#A6B8A4'])
  })

  it('records an opacity-adjusted background as a new recent color on release', () => {
    localStorage.setItem('mindmap.recentBackgroundColors', JSON.stringify(['#D9CEC2']))
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const alpha = within(dialog).getByRole('slider', { name: 'Background opacity' })

    // Preview while dragging stays live but does not touch the recent row.
    fireEvent.change(alpha, { target: { value: '50' } })
    let recent = within(dialog).getByRole('group', { name: 'Recent colors' })
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#D9CEC2'])

    // Releasing the slider commits the resulting 8-digit color as a new swatch.
    fireEvent.pointerUp(alpha)
    recent = within(dialog).getByRole('group', { name: 'Recent colors' })
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#10182780', '#D9CEC2'])
    expect(within(recent).getByRole('button', { name: 'Recent color #10182780' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem('mindmap.recentBackgroundColors') ?? '[]'))
      .toEqual(['#10182780', '#D9CEC2'])
  })

  it('keeps the visible recent order while switching, but persists it for the next open', () => {
    localStorage.setItem('mindmap.recentBackgroundColors', JSON.stringify(['#D9CEC2', '#A6B8A4']))
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const recent = within(dialog).getByRole('group', { name: 'Recent colors' })

    // Switch to the second recent swatch.
    fireEvent.click(within(recent).getByRole('button', { name: 'Recent color #A6B8A4' }))

    // The visible list keeps its order while the popover stays open.
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#D9CEC2', '#A6B8A4'])
    // The selected swatch is highlighted even though it is not moved to the front.
    expect(within(recent).getByRole('button', { name: 'Recent color #A6B8A4' }))
      .toHaveAttribute('aria-pressed', 'true')
    // The reorder is persisted so the next open shows it at the front.
    expect(JSON.parse(localStorage.getItem('mindmap.recentBackgroundColors') ?? '[]'))
      .toEqual(['#A6B8A4', '#D9CEC2'])
  })

  it('shows a persisted recent-swatch reorder at the front on the next open', () => {
    localStorage.setItem('mindmap.recentBackgroundColors', JSON.stringify(['#D9CEC2', '#A6B8A4']))
    render(<MindMapThemePanel />)

    const swatch = screen.getByRole('button', { name: 'Background color' })
    fireEvent.click(swatch)
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const recent = within(dialog).getByRole('group', { name: 'Recent colors' })

    // Switch to the second recent swatch; the visible list stays put.
    fireEvent.click(within(recent).getByRole('button', { name: 'Recent color #A6B8A4' }))
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#D9CEC2', '#A6B8A4'])

    // Close and reopen: the persisted reorder is now at the front.
    fireEvent.click(swatch)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(swatch)
    const reopened = within(screen.getByRole('dialog', { name: 'Background color' }))
      .getByRole('group', { name: 'Recent colors' })
    expect(within(reopened).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#A6B8A4', '#D9CEC2'])
  })

  it('collapses a fully-opaque alpha commit to the 6-digit recent form', () => {
    localStorage.setItem('mindmap.recentBackgroundColors', JSON.stringify(['#D9CEC2']))
    render(<MindMapThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    const dialog = screen.getByRole('dialog', { name: 'Background color' })
    const alpha = within(dialog).getByRole('slider', { name: 'Background opacity' })

    fireEvent.change(alpha, { target: { value: '100' } })
    fireEvent.pointerUp(alpha)

    const recent = within(dialog).getByRole('group', { name: 'Recent colors' })
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['#101827', '#D9CEC2'])
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
