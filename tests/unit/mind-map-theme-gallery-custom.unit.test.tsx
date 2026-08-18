import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapThemeGallery } from '../../src/renderer/src/views/mindmap/MindMapThemeGallery'
import {
  EMPTY_COLOR_SCHEME_CATALOG,
  type ColorSchemeCatalogState,
  type UserColorScheme
} from '../../src/renderer/src/views/mindmap/mind-map-color-scheme-catalog'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapCommand } from '../../src/shared/mindmap/commands'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-12T00:00:00.000Z'
const originalState = useMindMapViewStore.getState()

const CUSTOM_PALETTE = ['#101010', '#202020', '#303030', '#404040', '#505050', '#606060']

function makeDocument(colorSchemeId = 'dawn'): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-theme-gallery-custom-test',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: {
      id: 'custom-theme',
      background: '#ffffff',
      colorSchemeId,
      branchColors: ['#FF6B6B', '#FF9F69', '#97D3B6', '#88E2D7', '#6FD0F9', '#E18BEE']
    },
    sheets: [{
      id: 'sheet-1',
      title: 'Overview',
      root: { id: 'root', title: 'Root topic', children: [] },
      elements: [],
      layout: { structureClass: 'studiumx.layout.logic.right' }
    }],
    assets: []
  }
}

let dispatch: ReturnType<typeof vi.fn>

beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage('en-US')
  dispatch = vi.fn((command: MindMapCommand) => {
    if (command.type !== 'document.apply-theme') return
    useMindMapViewStore.setState((state) => ({
      current: state.current ? { ...state.current, theme: command.theme } : null
    }))
  })
  useMindMapViewStore.setState({
    ...originalState,
    current: makeDocument(),
    activeSheetId: 'sheet-1',
    colorSchemes: { ...EMPTY_COLOR_SCHEME_CATALOG },
    dispatchCommand: dispatch
  })
})

afterEach(() => {
  localStorage.clear()
  useMindMapViewStore.setState(originalState)
  vi.restoreAllMocks()
})

function customScheme(id = 'user-1'): UserColorScheme {
  return {
    id,
    name: 'My palette',
    colors: [...CUSTOM_PALETTE],
    createdAt: 1,
    updatedAt: 1
  }
}

describe('MindMapThemeGallery custom color schemes', () => {
  it('applies a custom scheme through the document.apply-theme command with resolved colors', () => {
    useMindMapViewStore.setState({
      colorSchemes: { schemes: [customScheme()], favorites: [], recent: [] }
    })
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const option = within(listbox).getByRole('option', { name: /My palette/i })

    act(() => fireEvent.click(option))

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document.apply-theme',
        theme: expect.objectContaining({
          colorSchemeId: 'user-1',
          branchColors: [...CUSTOM_PALETTE],
          rainbowBranches: true
        })
      }),
      expect.anything()
    )
    expect(useMindMapViewStore.getState().current?.theme.colorSchemeId).toBe('user-1')
  })

  it('pins favorites first within their category and highlights the current scheme', () => {
    useMindMapViewStore.setState({
      colorSchemes: {
        schemes: [customScheme(), { ...customScheme('user-2'), name: 'Second palette' }],
        favorites: ['user-2'],
        recent: []
      }
    })
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    // Favorited custom scheme is pinned first within its Custom category.
    const customGroup = within(listbox).getByRole('group', { name: 'Custom' })
    const customOptions = within(customGroup).getAllByRole('option')
    expect(customOptions[0]).toHaveTextContent('Second palette')
    // Current scheme (dawn) is highlighted and selected.
    const dawn = within(listbox).getByRole('option', { name: /Dawn/i })
    expect(dawn).toHaveAttribute('aria-selected', 'true')
    expect(dawn.className).toContain('is-active')
  })

  it('toggles a scheme favorite from the picker', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    fireEvent.click(screen.getByRole('button', { name: /Favorite Dawn/i }))

    expect(useMindMapViewStore.getState().colorSchemes.favorites).toEqual(['dawn'])
    expect(screen.getByRole('button', { name: /Unfavorite Dawn/i })).toBeInTheDocument()
  })

  it('focuses the current option on open and returns focus to the trigger on Escape', async () => {
    render(<MindMapThemeGallery />)

    const trigger = screen.getByRole('button', { name: /Color Scheme Dawn/i })
    fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const dawn = within(listbox).getByRole('option', { name: /Dawn/i })

    await act(async () => {})
    expect(dawn).toHaveFocus()

    fireEvent.keyDown(dawn, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Color Scheme' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('creates, edits and deletes a custom scheme through the editor', () => {
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    fireEvent.click(screen.getByRole('button', { name: /New scheme/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const name = screen.getByLabelText(/Name/i)
    fireEvent.change(name, { target: { value: 'My palette' } })
    // Change the first color well.
    const firstHex = screen.getByLabelText(/Color 1 HEX/i)
    fireEvent.change(firstHex, { target: { value: '#123456' } })
    fireEvent.keyDown(firstHex, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))

    let catalog = useMindMapViewStore.getState().colorSchemes
    expect(catalog.schemes).toHaveLength(1)
    expect(catalog.schemes[0]!.name).toBe('My palette')
    expect(catalog.schemes[0]!.colors[0]).toBe('#123456')

    // Reopen the picker and edit the custom scheme.
    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    fireEvent.click(screen.getByRole('button', { name: /Edit My palette/i }))

    const editName = screen.getByLabelText(/Name/i)
    fireEvent.change(editName, { target: { value: 'Renamed palette' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))

    catalog = useMindMapViewStore.getState().colorSchemes
    expect(catalog.schemes[0]!.name).toBe('Renamed palette')

    // Delete the custom scheme.
    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Renamed palette/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete scheme/i }))

    catalog = useMindMapViewStore.getState().colorSchemes
    expect(catalog.schemes).toHaveLength(0)
  })

  it('duplicates a custom scheme from the picker', () => {
    useMindMapViewStore.setState({
      colorSchemes: { schemes: [customScheme()], favorites: [], recent: [] }
    })
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    fireEvent.click(screen.getByRole('button', { name: /Duplicate My palette/i }))

    const schemes = useMindMapViewStore.getState().colorSchemes.schemes
    expect(schemes).toHaveLength(2)
    expect(schemes[1]!.name).toBe('My palette copy')
    expect(schemes[1]!.colors).toEqual([...CUSTOM_PALETTE])
    expect(schemes[1]!.id).not.toBe(schemes[0]!.id)
  })

  it('deleting a referenced scheme does not blank the open document theme', () => {
    const doc = makeDocument('user-1')
    doc.theme.branchColors = [...CUSTOM_PALETTE]
    useMindMapViewStore.setState({
      current: doc,
      colorSchemes: { schemes: [customScheme()], favorites: ['user-1'], recent: ['user-1'] }
    })

    act(() => {
      useMindMapViewStore.getState().deleteColorScheme('user-1')
    })

    const theme = useMindMapViewStore.getState().current?.theme
    // The document keeps its resolved snapshot regardless of the scheme deletion.
    expect(theme?.colorSchemeId).toBe('user-1')
    expect(theme?.branchColors).toEqual([...CUSTOM_PALETTE])
    expect(useMindMapViewStore.getState().colorSchemes.schemes).toHaveLength(0)
    expect(useMindMapViewStore.getState().colorSchemes.favorites).toEqual([])
    expect(useMindMapViewStore.getState().colorSchemes.recent).toEqual([])
  })

  it('round-trips a user catalogue through the store into localStorage', () => {
    act(() => {
      useMindMapViewStore.getState().createColorScheme('Stored', [...CUSTOM_PALETTE])
      useMindMapViewStore.getState().toggleColorSchemeFavorite('dawn')
      useMindMapViewStore.getState().recordRecentColorScheme('fire')
    })

    const stored = JSON.parse(localStorage.getItem('mindmap.colorSchemes') ?? '{}') as ColorSchemeCatalogState
    expect(stored.schemes[0]?.name).toBe('Stored')
    expect(stored.schemes[0]?.colors).toEqual([...CUSTOM_PALETTE])
    expect(stored.favorites).toEqual(['dawn'])
    expect(stored.recent).toEqual(['fire'])
  })

  it('groups custom schemes under the Custom category', () => {
    useMindMapViewStore.setState({
      colorSchemes: { schemes: [customScheme()], favorites: [], recent: [] }
    })
    render(<MindMapThemeGallery />)

    fireEvent.click(screen.getByRole('button', { name: /Color Scheme Dawn/i }))
    const listbox = screen.getByRole('listbox', { name: 'Color Scheme' })
    const customGroup = within(listbox).getByRole('group', { name: 'Custom' })
    expect(within(customGroup).getByRole('option', { name: /My palette/i })).toBeInTheDocument()
  })
})
