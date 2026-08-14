import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapThemeGallery } from '../../src/renderer/src/views/mindmap/MindMapThemeGallery'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-12T00:00:00.000Z'
const originalState = useMindMapViewStore.getState()

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-theme-gallery-test',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: {
      id: 'custom-theme',
      background: '#ffffff',
      colorSchemeId: 'dawn',
      branchColors: ['#FF6B6B', '#FF9F69', '#97D3B6', '#88E2D7', '#6FD0F9', '#E18BEE']
    },
    sheets: [{
      id: 'sheet-1',
      title: 'Overview',
      root: { id: 'root', title: 'Root topic', children: [] },
      elements: [],
      layout: { structureClass: 'org.xmind.ui.logic.right' }
    }],
    assets: []
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  useMindMapViewStore.setState({
    ...originalState,
    current: makeDocument(),
    activeSheetId: 'sheet-1',
    dispatchCommand: (command) => {
      if (command.type !== 'document.apply-theme') return
      useMindMapViewStore.setState((state) => ({
        current: state.current ? { ...state.current, theme: command.theme } : null
      }))
    }
  })
})

afterEach(() => {
  useMindMapViewStore.setState(originalState)
  vi.restoreAllMocks()
})

describe('MindMapThemeGallery', () => {
  it('keeps the preset catalogue collapsed until requested', () => {
    render(<MindMapThemeGallery />)

    expect(screen.queryByRole('listbox', { name: 'Style preset' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Snowbrush/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Style preset Custom/i }))

    expect(screen.getByRole('listbox', { name: 'Style preset' })).toBeInTheDocument()
    expect(screen.getByText(/Each preset lists its XMind fidelity results/i)).toBeInTheDocument()
    expect(screen.getByRole('option', {
      name: /Snowbrush\. XMind style fidelity: \d+ preserved, \d+ approximated, \d+ dropped\./i
    })).toBeInTheDocument()
  })

  it('supports focus entry, wrapped arrow navigation, and Escape focus return', async () => {
    render(<MindMapThemeGallery />)

    const trigger = screen.getByRole('button', { name: /Color Scheme Dawn.*Rainbow palette/i })
    fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const dawn = within(listbox).getByRole('option', { name: /Dawn/i })
    const deepSea = within(listbox).getByRole('option', { name: /Ocean/i })
    const fire = within(listbox).getByRole('option', { name: /Fireplace/i })

    await waitFor(() => expect(dawn).toHaveFocus())
    fireEvent.keyDown(dawn, { key: 'ArrowDown' })
    expect(deepSea).toHaveFocus()
    fireEvent.keyDown(deepSea, { key: 'ArrowUp' })
    expect(dawn).toHaveFocus()
    // ArrowUp from the first option wraps to the last option in the list.
    fireEvent.keyDown(dawn, { key: 'ArrowUp' })
    expect(fire).toHaveFocus()

    fireEvent.keyDown(fire, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Color Scheme' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses an open picker on outside pointer interaction', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    expect(screen.getByRole('listbox', { name: 'Color Scheme' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox', { name: 'Color Scheme' })).not.toBeInTheDocument()
  })

  it('returns focus to the trigger after choosing an option', async () => {
    render(<MindMapThemeGallery />)

    const trigger = screen.getByRole('button', { name: /Color Scheme Dawn/i })
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Color Scheme' })).getByRole('option', { name: /Painter/i }))

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('listbox', { name: 'Color Scheme' })).not.toBeInTheDocument()
  })

  it('shows a single-color preview when rainbow branches are disabled', () => {
    const current = makeDocument()
    current.theme.rainbowBranches = false
    current.theme.lineColor = '#123456'
    useMindMapViewStore.setState({ current })

    const { container } = render(<MindMapThemeGallery />)

    const trigger = screen.getByRole('button', { name: /Color Scheme Dawn.*Single color/i })
    const preview = container.querySelector('[data-branch-mode="single"]')
    expect(trigger).toContainElement(preview)
    expect(preview?.children).toHaveLength(1)
    expect(preview?.firstElementChild).toHaveStyle({ background: '#123456' })
  })

  it('applies a color scheme without replacing the current style preset', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const painter = within(listbox).getByRole('option', { name: /Painter/i })

    act(() => fireEvent.click(painter))

    expect(useMindMapViewStore.getState().current?.theme.id).toBe('custom-theme')
    expect(useMindMapViewStore.getState().current?.theme.colorSchemeId).toBe('painter')
    expect(screen.queryByRole('listbox', { name: 'Color Scheme' })).not.toBeInTheDocument()
  })

  it('groups built-in color schemes into Recommended/Classic sections', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })

    const recommended = within(listbox).getByText('Recommended')
    const classic = within(listbox).getByText('Classic')
    expect(recommended).toBeInTheDocument()
    expect(classic).toBeInTheDocument()

    const recommendedGroup = within(listbox).getByRole('group', { name: 'Recommended' })
    const classicGroup = within(listbox).getByRole('group', { name: 'Classic' })
    expect(within(recommendedGroup).getByRole('option', { name: /Dawn/i })).toBeInTheDocument()
    expect(within(recommendedGroup).getByRole('option', { name: /Green Tea/i })).toBeInTheDocument()
    expect(within(classicGroup).getByRole('option', { name: /Painter/i })).toBeInTheDocument()
    expect(within(classicGroup).getByRole('option', { name: /Vintage/i })).toBeInTheDocument()
    expect(within(classicGroup).getByRole('option', { name: /Fireplace/i })).toBeInTheDocument()
  })

  it('keeps favorites pinned first within their category group', () => {
    useMindMapViewStore.setState({ colorSchemes: { schemes: [], favorites: ['vintage'], recent: [] } })
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const classicGroup = within(listbox).getByRole('group', { name: 'Classic' })
    const classicOptions = within(classicGroup).getAllByRole('option')
    // Vintage is favorited and therefore pinned first inside its category.
    expect(classicOptions[0]).toHaveTextContent('Vintage')
  })

  it('filters schemes by name with a non-empty search query', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const search = within(listbox).getByRole('searchbox')

    fireEvent.change(search, { target: { value: 'fire' } })
    // Group labels disappear while searching; only matching options remain.
    expect(within(listbox).queryByText('Recommended')).not.toBeInTheDocument()
    expect(within(listbox).queryByText('Classic')).not.toBeInTheDocument()
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Fireplace'])
  })

  it('shows a no-results empty state for an unmatched query', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const search = within(listbox).getByRole('searchbox')

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(within(listbox).queryAllByRole('option')).toHaveLength(0)
    expect(within(listbox).getByText('No matching color schemes')).toBeInTheDocument()
  })

  it('searches case-insensitively and matches custom scheme names too', () => {
    useMindMapViewStore.setState({
      colorSchemes: {
        schemes: [{ id: 'user-1', name: 'My Palette', colors: ['#101010', '#202020', '#303030', '#404040', '#505050', '#606060'], createdAt: 1, updatedAt: 1 }],
        favorites: [],
        recent: []
      }
    })
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const search = within(listbox).getByRole('searchbox')

    fireEvent.change(search, { target: { value: 'PALETTE' } })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['My PaletteCustom'])
  })

  it('keeps keyboard navigation working across grouped sections', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const dawn = within(listbox).getByRole('option', { name: /Dawn/i })
    const deepSea = within(listbox).getByRole('option', { name: /Ocean/i })

    // Navigation is flat across grouped options: dawn is first, ArrowDown moves to the next option.
    fireEvent.focus(dawn)
    fireEvent.keyDown(dawn, { key: 'ArrowDown' })
    expect(deepSea).toHaveFocus()
    fireEvent.keyDown(deepSea, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Color Scheme' })).not.toBeInTheDocument()
  })

  it('announces the active scheme and active preset without relying on colour', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.id = 'snowbrush'
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapThemeGallery />)

    // Scheme: Dawn is the active scheme -> aria-selected + text description + visible check.
    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const dawn = within(listbox).getByRole('option', { name: /Dawn/i })
    expect(dawn).toHaveAttribute('aria-selected', 'true')
    expect(dawn).toHaveAccessibleDescription('Selected')
    expect(dawn.querySelector('.mindmap-theme-picker__check')).not.toBeNull()

    fireEvent.keyDown(dawn, { key: 'Escape' })

    // Preset: Snowbrush is the active preset -> aria-selected + description.
    fireEvent.click(screen.getByRole('button', { name: /Style preset Snowbrush/i }))
    const presetListbox = screen.getByRole('listbox', { name: 'Style preset' })
    const snowbrush = within(presetListbox).getByRole('option', { name: /^Snowbrush\./i })
    expect(snowbrush).toHaveAttribute('aria-selected', 'true')
    expect(snowbrush).toHaveAccessibleDescription('Selected')
  })
})
