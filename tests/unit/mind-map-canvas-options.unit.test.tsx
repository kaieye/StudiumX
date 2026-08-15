import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapCanvasOptionsPanel } from '../../src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

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
    id: 'mind-map-canvas-options',
    revision: 1,
    title: 'Canvas options',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
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
    appState: { ...originalAppState.appState, activeWorkspace: workspace() }
  })

  const document = makeDocument()
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: {
      readMindMap: vi.fn(async () => document),
      listMindMaps: vi.fn(async () => []),
      updateMindMap: vi.fn(async (payload) => ({
        ok: true as const,
        document: { ...payload.doc, revision: payload.doc.revision + 1 }
      }))
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

describe('MindMapCanvasOptionsPanel', () => {
  it('offers five line-width levels and keeps each change undoable', () => {
    render(<MindMapCanvasOptionsPanel />)

    const select = screen.getByRole('combobox', { name: 'Branch line width' })
    expect(within(select).getAllByRole('option')).toHaveLength(5)
    expect(select).toHaveValue('1')

    fireEvent.change(select, { target: { value: '0.5' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(0.5)
    expect(select).toHaveValue('0.5')

    fireEvent.change(select, { target: { value: '2' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(2)
    expect(select).toHaveValue('2')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(0.5)
    expect(select).toHaveValue('0.5')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBeUndefined()
    expect(select).toHaveValue('1')
  })

  it('does not expose structure switching controls', () => {
    render(<MindMapCanvasOptionsPanel />)

    expect(screen.queryByText('Structure')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Structure' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Balanced map' })).not.toBeInTheDocument()
  })

  it('resets canvas presentation without changing the document structure', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.layout = {
      structureClass: 'org.xmind.ui.spreadsheet.column',
      spacing: 32,
      compact: true
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapCanvasOptionsPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset canvas layout' }))

    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout).toEqual({
      structureClass: 'org.xmind.ui.spreadsheet.column'
    })
  })

  it('separates the structure default from explicit connector overrides', () => {
    render(<MindMapCanvasOptionsPanel />)

    // For a logic chart the structure default is Curve, so it is shown as the
    // selected option instead of a redundant "Structure default" entry.
    const trigger = screen.getByRole('button', { name: 'Connectors' })
    expect(trigger).toHaveTextContent('Curve')

    fireEvent.click(trigger)
    let dialog = screen.getByRole('dialog', { name: 'Connectors' })
    expect(within(dialog).getAllByRole('option').map((option) => option.getAttribute('aria-label'))).toEqual([
      'Rounded Elbow', 'Elbow', 'Straight', 'Curve'
    ])
    expect(within(dialog).getByRole('option', { name: 'Curve' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).queryByRole('button', { name: 'Structure default' })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('option', { name: 'Elbow' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('elbow')

    // Selecting Curve again makes it an explicit concrete override.
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    dialog = screen.getByRole('dialog', { name: 'Connectors' })
    fireEvent.click(within(dialog).getByRole('option', { name: 'Curve' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('curve')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('elbow')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBeUndefined()
  })

  it('offers the branch line pattern selector and keeps each change undoable', () => {
    render(<MindMapCanvasOptionsPanel />)

    const trigger = screen.getByRole('button', { name: 'Branch line pattern' })
    fireEvent.click(trigger)
    let dialog = screen.getByRole('dialog', { name: 'Branch line pattern' })
    expect(within(dialog).getAllByRole('option')).toHaveLength(4)

    fireEvent.click(within(dialog).getByRole('option', { name: 'Dash' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBe('dash')

    fireEvent.click(screen.getByRole('button', { name: 'Branch line pattern' }))
    dialog = screen.getByRole('dialog', { name: 'Branch line pattern' })
    fireEvent.click(within(dialog).getByRole('option', { name: 'Hand-drawn dash' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBe('hand-drawn-dash')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBe('dash')
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBeUndefined()
  })

  it('toggles the tapered line switch through the command path', () => {
    render(<MindMapCanvasOptionsPanel />)

    const toggle = screen.getByRole('checkbox', { name: /Tapered line/ })
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.tapered).toBe(true)

    fireEvent.click(toggle)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.tapered).toBe(false)

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.tapered).toBe(true)
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.tapered).toBeUndefined()
  })

  it('persists the selected line width through revisioned CAS', async () => {
    render(<MindMapCanvasOptionsPanel />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Branch line width' }), { target: { value: '1.5' } })

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    const update = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }))
    expect(update.mock.calls.at(-1)?.[0].doc.sheets[0]?.layout.lineWidthScale).toBe(1.5)
  })

  it('no longer hosts collapse/expand-all map operations in the format area', () => {
    render(<MindMapCanvasOptionsPanel />)

    expect(screen.queryByText('Map operations')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
  })

  it('announces inherited state for sheet-layout selects', () => {
    render(<MindMapCanvasOptionsPanel />)
    expect(screen.getByRole('button', { name: 'Connectors' }))
      .toHaveAccessibleDescription('Inherited from theme')
    expect(screen.getByRole('combobox', { name: 'Branch line width' }))
      .toHaveAccessibleDescription('Inherited from theme')
    expect(screen.getByRole('button', { name: 'Branch line pattern' }))
      .toHaveAccessibleDescription('Inherited from theme')
  })

})
