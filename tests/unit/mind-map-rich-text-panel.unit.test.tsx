import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { MindMapTopicStyleInspector } from '../../src/renderer/src/views/mindmap/MindMapTopicStyleInspector'
import { MindMapElementStyleInspector } from '../../src/renderer/src/views/mindmap/MindMapElementStyleInspector'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-1',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root',
          children: [{ id: 'child', title: 'Child', children: [] }]
        },
        elements: [
          {
            id: 'shape-1',
            type: 'shape',
            shape: 'rect',
            position: { x: 600, y: 220 },
            width: 120,
            height: 80,
            label: 'Shape label'
          }
        ],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

const originalMindMapState = useMindMapViewStore.getState()
const originalAppState = useAppStore.getState()

function workspace(): {
  id: string
  name: string
  rootPath: string
  missionPath: string
  resourcesPath: string
  lessonsDir: string
  recordsDir: string
  referenceDir: string
  reviewsDir: string
  createdAt: string
  updatedAt: string
  agentWorkspaceTrust: 'trusted'
  missionTitle: string
  missionExcerpt: string
  courses: unknown[]
  fileTree: unknown[]
  conversations: unknown[]
  resources: unknown[]
  records: unknown[]
  lessons: unknown[]
  referenceCount: number
  assetsReady: boolean
  git: null
} {
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

beforeEach(async () => {
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
      readMindMap: async () => document,
      listMindMaps: async () => [],
      updateMindMap: async (payload: { doc: MindMapDocumentV2 }) => ({ ok: true as const, document: payload.doc })
    }
  })
  await useMindMapViewStore.getState().openDocument(document.id)
})

afterEach(() => {
  // Unmount rendered components before resetting the shared stores. Resetting
  // the mind-map store while an inspector is still mounted re-renders it with
  // `current: null`, which triggers a React "fewer hooks" warning.
  cleanup()
  useMindMapViewStore.setState(originalMindMapState)
  useAppStore.setState(originalAppState)
})

function selectEditorText(editor: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(editor)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  fireEvent.mouseUp(editor)
  fireEvent.selectionChange?.(document) // some environments
}

describe('right-panel text edits target the selected span', () => {
  it('topic inspector routes a text property to the selection when active', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child',
      editingNodeId: 'child',
      richTextSelectionActive: true,
      richTextTarget: { kind: 'node', nodeId: 'child' },
      richTextSelection: {
        active: true,
        rect: null,
        start: 0,
        end: 2,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        color: undefined,
        fontFamily: undefined,
        fontSize: undefined,
        mixed: false
      }
    })

    render(<MindMapTopicStyleInspector />)
    const boldButton = screen.getByRole('button', { name: 'Bold' })
    fireEvent.click(boldButton)

    // The change should be routed to the selected span, not the topic style.
    expect(useMindMapViewStore.getState().richTextStyleRequest).toEqual({
      id: expect.any(Number),
      style: { bold: true },
      toggle: false
    })
  })

  it('topic inspector falls back to whole-topic style without a selection', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child',
      richTextSelectionActive: false,
      richTextTarget: null
    })

    render(<MindMapTopicStyleInspector />)
    const boldButton = screen.getByRole('button', { name: 'Bold' })
    fireEvent.click(boldButton)

    expect(useMindMapViewStore.getState().richTextStyleRequest).toBeNull()
  })

  it('element inspector routes a text property to a shape selection when active', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'element', elementId: 'shape-1', elementType: 'shape' },
      selectedNodeId: null,
      richTextSelectionActive: true,
      richTextTarget: { kind: 'shape', shapeId: 'shape-1' },
      richTextSelection: {
        active: true,
        rect: null,
        start: 0,
        end: 5,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        color: undefined,
        fontFamily: undefined,
        fontSize: undefined,
        mixed: false
      }
    })

    render(<MindMapElementStyleInspector />)
    const sizeInput = screen.getByRole('spinbutton', { name: /font size/i })
    fireEvent.change(sizeInput, { target: { value: '18' } })

    expect(useMindMapViewStore.getState().richTextStyleRequest).toEqual({
      id: expect.any(Number),
      style: { fontSize: 18 },
      toggle: false
    })
  })
})

describe('canvas forwards selection-targeted style requests to the editor', () => {
  it('applies a requested span style to the selected text in a node', () => {
    const { unmount } = render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Child' }))
    const editor = document.querySelector<HTMLElement>('.mindmap-node-input')
    expect(editor).not.toBeNull()
    selectEditorText(editor!)

    act(() => {
      useMindMapViewStore.getState().requestRichTextStyle({ bold: true })
    })

    const boldRun = Array.from(editor?.querySelectorAll<HTMLElement>('span[style]') ?? [])
      .find((run) => run.style.fontWeight === 'bold')
    expect(boldRun?.textContent).toBe('Child')
    unmount()
  })

  it('keeps the edit session alive when the editor blurs into the inspector panel', () => {
    const { container, unmount } = render(
      <MindMapCanvas
        document={makeDocument()}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Child' }))
    const editor = document.querySelector<HTMLElement>('.mindmap-node-input')
    expect(editor).not.toBeNull()

    // Simulate the right inspector panel next to the canvas.
    const panel = document.createElement('aside')
    panel.className = 'mindmap-ai-panel'
    document.body.appendChild(panel)
    const panelInput = document.createElement('input')
    panel.appendChild(panelInput)

    fireEvent.blur(editor, { relatedTarget: panelInput })

    // The edit stays open so the panel can target the selected span.
    expect(useMindMapViewStore.getState().editingNodeId).toBe('child')

    // Clicking back on the canvas commits the deferred edit.
    fireEvent.pointerDown(container.querySelector('.mindmap-svg')!, { button: 0, pointerId: 1 })
    expect(useMindMapViewStore.getState().editingNodeId).toBeNull()

    panel.remove()
    unmount()
  })
})
