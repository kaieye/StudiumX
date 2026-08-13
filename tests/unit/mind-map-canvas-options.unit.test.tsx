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

    const group = screen.getByRole('group', { name: 'Branch line width' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(5)
    expect(within(group).getByRole('button', { name: 'Default' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(within(group).getByRole('button', { name: 'Extra thin' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(0.5)
    expect(within(group).getByRole('button', { name: 'Extra thin' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(within(group).getByRole('button', { name: 'Extra bold' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(2)
    expect(within(group).getByRole('button', { name: 'Extra bold' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(0.5)
    expect(within(group).getByRole('button', { name: 'Extra thin' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBeUndefined()
    expect(within(group).getByRole('button', { name: 'Default' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('enables balanced mode only for compatible logic structures', () => {
    render(<MindMapCanvasOptionsPanel />)

    const balanced = screen.getByRole('checkbox', { name: 'Balanced map' })
    expect(balanced).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Structure: Right' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Structure' })).getByRole('option', { name: 'Matrix (Rows)' }))
    expect(balanced).toBeDisabled()
    expect(screen.getByText('Balanced mode is available only for Logic Chart structures.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Structure: Matrix (Rows)' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Structure' })).getByRole('option', { name: 'Right' }))
    expect(balanced).toBeEnabled()
  })

  it('keeps structures in a compact keyboard-accessible picker', async () => {
    render(<MindMapCanvasOptionsPanel />)

    const trigger = screen.getByRole('button', { name: 'Structure: Right' })
    expect(screen.queryByRole('listbox', { name: 'Structure' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Structure' })
    const right = within(listbox).getByRole('option', { name: 'Right' })
    const balanced = within(listbox).getByRole('option', { name: 'Balanced' })
    await act(async () => Promise.resolve())
    expect(right).toHaveFocus()

    fireEvent.keyDown(right, { key: 'ArrowRight' })
    expect(balanced).toHaveFocus()
    fireEvent.keyDown(balanced, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Structure' })).not.toBeInTheDocument()
    await act(async () => Promise.resolve())
    expect(trigger).toHaveFocus()
  })

  it('resets to the current structure family default instead of forcing logic right', () => {
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
      structureClass: 'org.xmind.ui.spreadsheet'
    })
  })

  it('separates the structure default from explicit connector overrides', () => {
    render(<MindMapCanvasOptionsPanel />)

    const group = screen.getByRole('group', { name: 'Connectors' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Structure default', 'Curve', 'Straight', 'Elbow', 'Rounded Elbow', 'Bight', 'Fold', 'Rounded Fold'
    ])
    expect(within(group).getByRole('button', { name: 'Structure default' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Structure default')).toHaveLength(2)
    expect(screen.getByText('Curve', { selector: 'small' })).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: 'Rounded Fold' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('rounded-fold')
    expect(within(group).getByRole('button', { name: 'Rounded Fold' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Sheet override', { selector: 'span' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use structure default' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBeUndefined()
    expect(within(group).getByRole('button', { name: 'Structure default' })).toHaveAttribute('aria-pressed', 'true')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('rounded-fold')
    expect(within(group).getByRole('button', { name: 'Rounded Fold' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Sheet override', { selector: 'span' })).toBeInTheDocument()

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBeUndefined()
    expect(within(group).getByRole('button', { name: 'Structure default' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('preserves an explicit connector override when the structure changes', () => {
    render(<MindMapCanvasOptionsPanel />)

    fireEvent.click(within(screen.getByRole('group', { name: 'Connectors' })).getByRole('button', { name: 'Curve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Structure: Right' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Structure' })).getByRole('option', { name: 'Timeline (H)' }))

    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout).toMatchObject({
      structureClass: 'org.xmind.ui.timeline.horizontal',
      lineStyle: 'curve'
    })
    expect(within(screen.getByRole('group', { name: 'Connectors' })).getByRole('button', { name: 'Curve' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Sheet override')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use structure default' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBeUndefined()
    expect(screen.getByText('Timeline', { selector: 'small' })).toBeInTheDocument()
  })

  it('offers the branch line pattern selector and keeps each change undoable', () => {
    render(<MindMapCanvasOptionsPanel />)

    const group = screen.getByRole('group', { name: 'Branch line pattern' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(4)
    expect(within(group).getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(group).getByRole('button', { name: 'Dash' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBe('dash')
    expect(within(group).getByRole('button', { name: 'Dash' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(group).getByRole('button', { name: 'Hand-drawn dash' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBe('hand-drawn-dash')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBe('dash')
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.linePattern).toBeUndefined()
    expect(within(group).getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'true')
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

    const group = screen.getByRole('group', { name: 'Branch line width' })
    fireEvent.click(within(group).getByRole('button', { name: 'Thick' }))

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    const update = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }))
    expect(update.mock.calls.at(-1)?.[0].doc.sheets[0]?.layout.lineWidthScale).toBe(1.5)
  })
})
