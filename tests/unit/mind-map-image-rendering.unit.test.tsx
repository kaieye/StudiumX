import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import type { TeachingSystemApi } from '../../src/preload/index'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'

const appStoreState = vi.hoisted(() => ({
  appState: {
    activeWorkspace: {
      id: 'workspace-1',
      name: 'Workspace',
      rootPath: '/tmp/workspace',
      lessons: []
    }
  },
  openExternal: vi.fn(async () => undefined)
}))

vi.mock('../../src/renderer/src/app-shell/appStore', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof appStoreState) => unknown) => selector(appStoreState),
    { getState: () => appStoreState }
  )
  return { useAppStore }
})

const NOW = '2026-08-15T00:00:00.000Z'
const documentFixture: MindMapDocumentV2 = {
  schemaVersion: 2,
  id: 'mind-map-images',
  revision: 1,
  title: 'Image map',
  createdAt: NOW,
  updatedAt: NOW,
  theme: { id: 'default' },
  sheets: [{
    id: 'sheet-1',
    title: 'Images',
    root: { id: 'root', title: 'Diagram', children: [] },
    elements: [],
    images: [{ id: 'img-1', type: 'image', assetId: 'asset-1', width: 160, height: 88, topicId: 'root' }],
    layout: { structureClass: 'org.xmind.ui.logic.right' }
  }],
  assets: [{ id: 'asset-1', fileName: 'diagram.png', mimeType: 'image/png' }]
}

const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')
const originalMindMapState = useMindMapViewStore.getState()

describe('mind-map topic images', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root'] },
      selectedNodeId: 'root',
      editingNodeId: null
    })
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        readMindMapAsset: vi.fn(async () => ({
          asset: documentFixture.assets[0]!,
          dataUrl: 'data:image/png;base64,AAAA'
        }))
      } as Partial<TeachingSystemApi>
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState(originalMindMapState)
    if (originalTeachingSystemDescriptor) {
      Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
    } else {
      delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
    }
    vi.restoreAllMocks()
  })

  it('loads and displays an attached image inside the topic frame', async () => {
    render(
      <MindMapCanvas
        document={documentFixture}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const image = await screen.findByRole('img', { name: 'diagram.png' })
    const topic = document.querySelector('[data-node-id="root"]')

    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(topic?.querySelector('.mindmap-image')).toBeNull() // attached images render in the overlay layer
    expect(document.querySelector('.mindmap-image-group')).toContainElement(image)
    expect(window.teachingSystem?.readMindMapAsset).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'mind-map-images',
      assetId: 'asset-1'
    })
  })

  it('renders the attached image in the overlay layer for right placement', async () => {
    const rightDocument: MindMapDocumentV2 = {
      ...documentFixture,
      sheets: [{
        ...documentFixture.sheets[0]!,
        root: {
          ...documentFixture.sheets[0]!.root,
          imagePlacement: 'right'
        }
      }]
    }
    render(
      <MindMapCanvas
        document={rightDocument}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    await screen.findByRole('img', { name: 'diagram.png' })
    expect(document.querySelector('.mindmap-image-group')).not.toBeNull()
  })

  it('renders a free image at its explicit position in the overlay layer', async () => {
    const freeDocument: MindMapDocumentV2 = {
      ...documentFixture,
      sheets: [{
        ...documentFixture.sheets[0]!,
        images: [{ id: 'img-free', type: 'image', assetId: 'asset-1', width: 120, height: 90, position: { x: 300, y: 200 } }]
      }]
    }
    render(
      <MindMapCanvas
        document={freeDocument}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )

    const image = await screen.findByRole('img', { name: 'diagram.png' })
    const group = image.closest('.mindmap-image-group')
    expect(group).not.toBeNull()
    // The overlay foreignObject sits at the free position.
    const foreign = group?.querySelector('foreignObject')
    expect(foreign).toHaveAttribute('x', '300')
    expect(foreign).toHaveAttribute('y', '200')
  })

  it('offers a delete button on a selected image and removes it (with its asset)', async () => {
    useMindMapViewStore.setState({
      selection: { kind: 'image', imageId: 'img-1' }
    })
    const dispatchCommand = vi.fn()
    const originalDispatch = useMindMapViewStore.getState().dispatchCommand
    useMindMapViewStore.setState({ dispatchCommand })

    try {
      render(
        <MindMapCanvas
          document={documentFixture}
          activeSheetIndex={0}
          onActiveSheetChange={() => undefined}
        />
      )
      await screen.findByRole('img', { name: 'diagram.png' })

      const remove = screen.getByRole('button', { name: 'Remove image' })
      fireEvent.click(remove)

      expect(dispatchCommand).toHaveBeenCalledWith(
        {
          type: 'transaction',
          commands: [
            { type: 'image.remove', sheetId: 'sheet-1', imageId: 'img-1' },
            { type: 'asset.remove', assetId: 'asset-1' }
          ]
        },
        expect.objectContaining({ label: 'Remove image' })
      )
    } finally {
      useMindMapViewStore.setState({ dispatchCommand: originalDispatch })
    }
  })

  it('keeps the grabbed point under the cursor while dragging a free image', async () => {
    const freeDocument: MindMapDocumentV2 = {
      ...documentFixture,
      sheets: [{
        ...documentFixture.sheets[0]!,
        images: [{ id: 'img-free', type: 'image', assetId: 'asset-1', width: 120, height: 90, position: { x: 300, y: 200 } }]
      }]
    }
    const { container } = render(
      <MindMapCanvas
        document={freeDocument}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    await screen.findByRole('img', { name: 'diagram.png' })

    const group = document.querySelector<SVGGElement>('.mindmap-image-group')
    const svg = container.querySelector('svg')
    if (!group || !svg) throw new Error('expected image group and svg')

    // Grab the image at its centre: image is at (300, 200) size 120x90, so the
    // centre is (360, 245). The ghost must keep that point under the cursor.
    fireEvent.pointerDown(group, { clientX: 360, clientY: 245 })
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 300 })

    const ghost = container.querySelector('.mindmap-image-ghost')
    expect(ghost).not.toBeNull()
    // translate(pointer - grabOffset): grabOffset = (360-300, 245-200) = (60, 45)
    expect(ghost).toHaveAttribute('transform', 'translate(340 255)')
  })

  it('maps the pointer through the canvas on-screen offset for drop placement', async () => {
    const freeDocument: MindMapDocumentV2 = {
      ...documentFixture,
      sheets: [{
        ...documentFixture.sheets[0]!,
        images: [{ id: 'img-free', type: 'image', assetId: 'asset-1', width: 120, height: 90, position: { x: 300, y: 200 } }]
      }]
    }
    const { container } = render(
      <MindMapCanvas
        document={freeDocument}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
      />
    )
    await screen.findByRole('img', { name: 'diagram.png' })

    // The canvas is not at the viewport origin (sidebar/toolbar offset).
    const canvasEl = container.querySelector<HTMLElement>('.mindmap-canvas')
    const group = document.querySelector<SVGGElement>('.mindmap-image-group')
    const svg = container.querySelector('svg')
    if (!canvasEl || !group || !svg) throw new Error('expected canvas, image group and svg')
    canvasEl.getBoundingClientRect = () => ({ left: 100, top: 60, width: 1200, height: 800, right: 1300, bottom: 860, x: 100, y: 60, toJSON: () => ({}) }) as DOMRect

    // Grab the image centre, then move to a client point. The content point
    // must subtract the canvas offset, otherwise the ghost drifts by (100, 60).
    fireEvent.pointerDown(group, { clientX: 360 + 100, clientY: 245 + 60 })
    fireEvent.pointerMove(svg, { clientX: 400 + 100, clientY: 300 + 60 })

    const ghost = container.querySelector('.mindmap-image-ghost')
    expect(ghost).not.toBeNull()
    // content = client - offset: pointer content = (400, 300) - grabOffset (60,45)
    expect(ghost).toHaveAttribute('transform', 'translate(340 255)')
  })

  it('keeps an attached image on its topic after a plain click (no drag)', async () => {
    const dispatchCommand = vi.fn()
    const originalDispatch = useMindMapViewStore.getState().dispatchCommand
    useMindMapViewStore.setState({ dispatchCommand })

    try {
      const { container } = render(
        <MindMapCanvas
          document={documentFixture}
          activeSheetIndex={0}
          onActiveSheetChange={() => undefined}
        />
      )
      await screen.findByRole('img', { name: 'diagram.png' })

      const group = document.querySelector<SVGGElement>('.mindmap-image-group')
      const svg = container.querySelector('svg')
      if (!group || !svg) throw new Error('expected image group and svg')

      // Press and release at the same spot: a plain click. It must only select
      // the image and must NOT detach it from the topic via a move command.
      fireEvent.pointerDown(group, { clientX: 360, clientY: 245 })
      fireEvent.pointerUp(svg, { clientX: 360, clientY: 245 })

      expect(dispatchCommand).not.toHaveBeenCalled()
    } finally {
      useMindMapViewStore.setState({ dispatchCommand: originalDispatch })
    }
  })
})
