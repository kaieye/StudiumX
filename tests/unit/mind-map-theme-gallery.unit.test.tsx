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
    const painter = within(listbox).getByRole('option', { name: /Painter/i })
    const greenTea = within(listbox).getByRole('option', { name: /Green Tea/i })

    await waitFor(() => expect(dawn).toHaveFocus())
    fireEvent.keyDown(dawn, { key: 'ArrowDown' })
    expect(painter).toHaveFocus()
    fireEvent.keyDown(painter, { key: 'ArrowUp' })
    expect(dawn).toHaveFocus()
    fireEvent.keyDown(dawn, { key: 'ArrowUp' })
    expect(greenTea).toHaveFocus()

    fireEvent.keyDown(greenTea, { key: 'Escape' })
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
})
