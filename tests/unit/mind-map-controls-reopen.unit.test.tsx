import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapThemePanel } from '../../src/renderer/src/views/mindmap/MindMapThemePanel'
import { MindMapCanvasOptionsPanel } from '../../src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import { parseMindMapUpdatePayload } from '../../src/main/mindmap/mind-map-ipc-commands'

const NOW = '2026-08-14T00:00:00.000Z'
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
    id: 'mind-map-reopen',
    revision: 1,
    title: 'Reopen map',
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
        layout: {
          structureClass: 'studiumx.layout.logic.right',
          defaultTopicShape: 'rounded-rect'
        }
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

/**
 * Simulate a real save -> close -> reopen round-trip for the currently-open
 * canonical document:
 *
 *  1. flush the debounced revisioned save so the canonical store document is
 *     what the main process would persist (updateMindMap is invoked),
 *  2. serialize that canonical document and parse it back through the exact
 *     production IPC parser (parseMindMapUpdatePayload) used by the main
 *     process to accept an update,
 *  3. load the parsed document into a FRESH store via openDocument (new undo
 *     stack, selection reset) — the same path used when a document is closed
 *     and reopened from the gallery,
 *  4. return the reopened canonical document for assertions.
 */
async function saveAndReopen(): Promise<MindMapDocumentV2> {
  // 1) Flush the 400ms debounced save lane so updateMindMap sees the change.
  await act(async () => {
    vi.advanceTimersByTime(500)
    await Promise.resolve()
  })

  const persisted = useMindMapViewStore.getState().current
  if (!persisted) throw new Error('expected a current document after save')

  // 2) Round-trip through the production IPC parser (schema-validated, strips
  //    nothing that the schema declares). Serialize first, exactly like the
  //    document crossing the IPC / file boundary.
  const serialized = JSON.parse(JSON.stringify(persisted))
  const parsed = parseMindMapUpdatePayload({
    workspaceId: 'workspace-1',
    id: persisted.id,
    expectedRevision: persisted.revision,
    doc: serialized
  })
  if (!parsed) throw new Error('reopened document failed to parse through the production IPC parser')

  // 3) Load the parsed document into a fresh store (close + reopen).
  vi.mocked(window.teachingSystem!.readMindMap).mockResolvedValue(parsed.doc)
  await useMindMapViewStore.getState().openDocument(persisted.id)

  // 4) The store now holds the reopened canonical document.
  return parsed.doc
}

function renderPanels(): void {
  render(<MindMapThemePanel />)
  render(<MindMapCanvasOptionsPanel />)
}

describe('mind-map controls survive save -> reopen (L-03)', () => {
  it('creates and persists a connector between two topics through the real toolbar and canvas', async () => {
    useMindMapViewStore.getState().addChild('root')
    const childId = useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.id
    if (!childId) throw new Error('expected an added child topic')

    const { container } = render(<MindMapView />)
    const lineButton = screen.getByRole('button', { name: 'Line' })
    fireEvent.click(lineButton)
    expect(lineButton).toHaveAttribute('aria-pressed', 'true')

    const svg = container.querySelector<SVGSVGElement>('.mindmap-svg')
    const rootTarget = container.querySelector<SVGRectElement>(
      'rect[data-mindmap-line-snap-target="topic:root"]'
    )
    const childTarget = container.querySelector<SVGRectElement>(
      `rect[data-mindmap-line-snap-target="topic:${childId}"]`
    )
    if (!svg || !rootTarget || !childTarget) throw new Error('expected topic snap targets')

    const centerOf = (target: SVGRectElement) => ({
      x: Number(target.getAttribute('x')) + Number(target.getAttribute('width')) / 2,
      y: Number(target.getAttribute('y')) + Number(target.getAttribute('height')) / 2
    })
    const rootCenter = centerOf(rootTarget)
    const childCenter = centerOf(childTarget)

    fireEvent.pointerDown(rootTarget, {
      button: 0,
      pointerId: 71,
      clientX: rootCenter.x,
      clientY: rootCenter.y
    })
    fireEvent.pointerMove(childTarget, {
      pointerId: 71,
      clientX: childCenter.x,
      clientY: childCenter.y
    })
    expect(container.querySelector('.mindmap-line-draft')).toBeInTheDocument()
    fireEvent.pointerUp(childTarget, {
      pointerId: 71,
      clientX: childCenter.x,
      clientY: childCenter.y
    })
    expect(useMindMapViewStore.getState().error).toBeNull()

    const connector = useMindMapViewStore.getState().current?.sheets[0]?.elements.find(
      (element) => element.type === 'connector'
    )
    if (!connector || connector.type !== 'connector') throw new Error('expected a persisted connector')
    expect(connector).toMatchObject({
      start: { anchor: { targetType: 'topic', targetId: 'root' } },
      end: { anchor: { targetType: 'topic', targetId: childId } }
    })

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.elements).toContainEqual(expect.objectContaining({
      id: connector.id,
      type: 'connector',
      start: expect.objectContaining({
        anchor: { targetType: 'topic', targetId: 'root' }
      }),
      end: expect.objectContaining({
        anchor: { targetType: 'topic', targetId: childId }
      })
    }))
  })

  it('retains the background color (theme.background) after reopen', async () => {
    renderPanels()

    fireEvent.click(screen.getByRole('button', { name: 'Background color' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Background color'), {
      target: { value: '#f0fdf4' }
    })
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')

    // Save -> reopen.
    const reopened = await saveAndReopen()
    expect(reopened.theme.background).toBe('#F0FDF4')
    expect(useMindMapViewStore.getState().current?.theme.background).toBe('#F0FDF4')
  })

  it('retains the global font family (theme.fontFamily) after reopen', async () => {
    renderPanels()

    fireEvent.click(screen.getByRole('button', { name: 'Font family System font' }))
    fireEvent.click(screen.getByRole('option', { name: 'CJK Sans-serif' }))
    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toContain('Noto Sans CJK SC')

    const reopened = await saveAndReopen()
    expect(reopened.theme.fontFamily).toContain('Noto Sans CJK SC')
    expect(useMindMapViewStore.getState().current?.theme.fontFamily).toContain('Noto Sans CJK SC')
  })

  it('retains rainbow-off plus the single lineColor (theme.rainbowBranches / lineColor) after reopen', async () => {
    renderPanels()

    const toggle = screen.getByRole('checkbox', { name: 'Rainbow branches' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    fireEvent.click(screen.getByRole('button', { name: 'Single branch color' }))
    const lineHex = within(
      screen.getByRole('dialog', { name: 'Single branch color' })
    ).getByRole('textbox', { name: 'Branch line HEX' })
    fireEvent.change(lineHex, { target: { value: '#123456' } })
    fireEvent.keyDown(lineHex, { key: 'Enter' })

    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      rainbowBranches: false,
      lineColor: '#123456'
    })

    const reopened = await saveAndReopen()
    expect(reopened.theme).toMatchObject({ rainbowBranches: false, lineColor: '#123456' })
    expect(useMindMapViewStore.getState().current?.theme).toMatchObject({
      rainbowBranches: false,
      lineColor: '#123456'
    })
  })

  it('retains the branch line width (sheet.layout.lineWidthScale) after reopen', async () => {
    renderPanels()

    fireEvent.change(screen.getByRole('combobox', { name: 'Branch line width' }), {
      target: { value: '1.5' }
    })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(1.5)

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.layout.lineWidthScale).toBe(1.5)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineWidthScale).toBe(1.5)
  })

  it('retains the branch connector style (sheet.layout.lineStyle) after reopen', async () => {
    renderPanels()

    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Connectors' })).getByRole('option', { name: 'Elbow' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('elbow')

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.layout.lineStyle).toBe('elbow')
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.lineStyle).toBe('elbow')
  })

  it('retains the branch line pattern and tapered flag (sheet.layout.linePattern / tapered) after reopen', async () => {
    renderPanels()

    fireEvent.click(screen.getByRole('button', { name: 'Branch line pattern' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Branch line pattern' })).getByRole('option', { name: 'Dash' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Tapered line/ }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout).toMatchObject({
      linePattern: 'dash',
      tapered: true
    })

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.layout).toMatchObject({ linePattern: 'dash', tapered: true })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout).toMatchObject({
      linePattern: 'dash',
      tapered: true
    })
  })

  it('defaults auto-balance off and persists its enabled state', async () => {
    renderPanels()

    const toggle = screen.getByRole('checkbox', { name: 'Auto-balance map' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.structureClass).toBe('studiumx.layout.logic.balanced')
    fireEvent.click(toggle)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.structureClass).toBe('studiumx.layout.logic.right')

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.layout.structureClass).toBe('studiumx.layout.logic.right')
  })

  it('retains the default node shape used for newly created topics after reopen', async () => {
    renderPanels()

    fireEvent.click(screen.getByRole('button', { name: 'Default node shape Rounded Rect' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Default node shape' })).getByRole('option', { name: 'Ellipse' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout.defaultTopicShape).toBe('ellipse')
    expect(screen.getByRole('button', { name: 'Default node shape Ellipse' })).toBeInTheDocument()

    useMindMapViewStore.getState().addChild('root')
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.style?.shape).toBe('ellipse')

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.layout.defaultTopicShape).toBe('ellipse')
  })

  it('retains branch spacing (sheet.layout.spacing) after reopen', async () => {
    renderPanels()

    const spacingInput = screen.getByRole('spinbutton', { name: 'Branch spacing' })
    fireEvent.change(spacingInput, { target: { value: '24' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout).toMatchObject({
      spacing: 24
    })

    const reopened = await saveAndReopen()
    expect(reopened.sheets[0]?.layout).toMatchObject({ spacing: 24 })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.layout).toMatchObject({
      spacing: 24
    })
  })
})
