import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapSourcePanel } from '../../src/renderer/src/views/mindmap/MindMapSourcePanel'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'
import type {
  MindMapSourceRefreshPreviewResult
} from '../../src/shared/teaching-types/mindmap'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi } from '../../src/shared/teaching-types'

function makeRoot(): MindMapTopicV2 {
  return {
    id: 'root',
    title: 'Course',
    sourceRefs: [
      {
        id: 'source-lesson',
        workspacePath: 'lessons\\unit-1.md',
        breadcrumb: ['Unit 1', 'Introduction']
      }
    ],
    children: [
      {
        id: 'chapter',
        title: 'Chapter',
        sourceRefs: [{ id: 'source-lesson', workspacePath: 'lessons/unit-1.md', stale: true }],
        children: []
      },
      {
        id: 'review',
        title: 'Review',
        sourceRefs: [{ id: 'source-notes', workspacePath: 'notes/review.md' }],
        children: []
      }
    ]
  }
}

const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')

function installTeachingSystem(api: Partial<TeachingSystemApi>): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: api
  })
}

function makePreviewResult(): MindMapSourceRefreshPreviewResult {
  return {
    documentId: 'map-1',
    revision: 7,
    entries: [
      {
        sourceRef: {
          id: 'source-lesson',
          workspacePath: 'lessons/unit-1.md'
        },
        topicIds: ['root'],
        sheetIds: ['sheet-1'],
        previousContentHash: 'old-hash',
        currentContentHash: 'new-hash',
        status: 'stale',
        changed: true,
        change: 'content_changed'
      },
      {
        sourceRef: {
          id: 'source-notes',
          workspacePath: 'notes/review.md'
        },
        topicIds: ['review'],
        sheetIds: ['sheet-1'],
        previousContentHash: 'same-hash',
        currentContentHash: 'same-hash',
        status: 'fresh',
        changed: false,
        change: 'unchanged'
      }
    ],
    changedCount: 1,
    attentionCount: 1
  }
}

function renderRefreshablePanel(
  overrides: Partial<React.ComponentProps<typeof MindMapSourcePanel>> = {}
) {
  return renderPanel({
    workspaceId: 'workspace-1',
    documentId: 'map-1',
    ...overrides
  })
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof MindMapSourcePanel>> = {}
) {
  const props: React.ComponentProps<typeof MindMapSourcePanel> = {
    root: makeRoot(),
    selectedNodeId: null,
    onSelect: vi.fn(),
    onOpenSource: vi.fn(),
    ...overrides
  }
  render(<MindMapSourcePanel {...props} />)
  return props
}

describe('MindMapSourcePanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    if (originalTeachingSystemDescriptor) {
      Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
    } else {
      delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
    }
    vi.restoreAllMocks()
  })

  it('renders the deduplicated source list, count, locations, and stale status', () => {
    renderPanel()

    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByText('2 sources')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unit 1 \/ Introduction.*Open source/ })).toBeInTheDocument()
    expect(screen.getByText('lessons/unit-1.md')).toBeInTheDocument()
    expect(screen.getByText(/Source changed/)).toBeInTheDocument()
    expect(screen.getByText(/2 topics/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review\.md.*Open source/ })).toBeInTheDocument()
  })

  it('selects the first associated topic and opens the source', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onOpenSource = vi.fn()
    renderPanel({ onSelect, onOpenSource })

    await user.click(screen.getByRole('button', { name: /Unit 1 \/ Introduction.*Open source/ }))

    expect(onSelect).toHaveBeenCalledWith('root')
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-lesson',
        workspacePath: 'lessons\\unit-1.md',
        breadcrumb: ['Unit 1', 'Introduction'],
        stale: true
      })
    )
  })

  it('marks a source selected when the current topic is associated with it', () => {
    renderPanel({ selectedNodeId: 'chapter' })

    expect(
      screen.getByRole('button', { name: /Unit 1 \/ Introduction.*Open source/ })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /review\.md.*Open source/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('renders an explicit empty state when the sheet has no source anchors', () => {
    const root: MindMapTopicV2 = { id: 'root', title: 'Course', children: [] }
    renderPanel({ root })

    expect(screen.getByText('0 sources')).toBeInTheDocument()
    expect(screen.getByText('No sources attached')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open source/ })).not.toBeInTheDocument()
  })

  it('previews source updates with loading and an accessible before/after diff without writing', async () => {
    const user = userEvent.setup()
    let resolvePreview: (result: MindMapSourceRefreshPreviewResult) => void = () => undefined
    const previewMindMapSourceRefresh = vi.fn(
      () => new Promise<MindMapSourceRefreshPreviewResult>((resolve) => {
        resolvePreview = resolve
      })
    )
    const updateMindMap = vi.fn()
    installTeachingSystem({ previewMindMapSourceRefresh, updateMindMap })

    renderRefreshablePanel()
    const refreshButton = screen.getByRole('button', { name: 'Refresh preview' })
    await user.click(refreshButton)

    expect(previewMindMapSourceRefresh).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'map-1'
    })
    expect(refreshButton).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Checking source updates…')

    resolvePreview(makePreviewResult())

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Checked 2 sources: 1 changed, 1 need attention.'
      )
    })
    expect(screen.getByRole('list', { name: 'Source update preview' })).toBeInTheDocument()
    expect(screen.getByText('Previous content hash')).toBeInTheDocument()
    expect(screen.getByText('old-hash')).toBeInTheDocument()
    expect(screen.getByText('new-hash')).toBeInTheDocument()
    expect(screen.getByText('Content hash changed')).toBeInTheDocument()
    expect(screen.getByText('No changes detected.')).toBeInTheDocument()
    expect(updateMindMap).not.toHaveBeenCalled()
  })

  it('shows a localized error and does not mutate the document when preview fails', async () => {
    const user = userEvent.setup()
    const previewMindMapSourceRefresh = vi.fn(async () => {
      throw new Error('backend failure')
    })
    const updateMindMap = vi.fn()
    installTeachingSystem({ previewMindMapSourceRefresh, updateMindMap })

    renderRefreshablePanel()
    await user.click(screen.getByRole('button', { name: 'Refresh preview' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not check for source updates.'
      )
    })
    expect(updateMindMap).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation and applies only selected reviewable updates', async () => {
    const user = userEvent.setup()
    const previewMindMapSourceRefresh = vi.fn(async () => makePreviewResult())
    const applyMindMapSourceRefresh = vi.fn(async () => ({
      ok: true as const,
      document: {} as MindMapDocumentV2,
      command: null,
      inverse: null,
      appliedSourceIds: ['source-lesson']
    }))
    const onSourceRefreshApplied = vi.fn()
    installTeachingSystem({ previewMindMapSourceRefresh, applyMindMapSourceRefresh })

    renderRefreshablePanel({ onSourceRefreshApplied })
    await user.click(screen.getByRole('button', { name: 'Refresh preview' }))
    await waitFor(() => expect(screen.getByText('Content hash changed')).toBeInTheDocument())

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(1)
    expect(checkboxes[0]).toBeChecked()
    const applyButton = screen.getByRole('button', { name: 'Apply 1 selected update(s)' })
    await user.click(applyButton)

    await waitFor(() => expect(applyMindMapSourceRefresh).toHaveBeenCalledTimes(1))
    expect(applyMindMapSourceRefresh).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'map-1',
      expectedRevision: 7,
      updates: [{
        sourceRef: {
          id: 'source-lesson',
          workspacePath: 'lessons/unit-1.md',
          contentHash: 'new-hash',
          stale: false
        }
      }]
    })
    expect(onSourceRefreshApplied).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      appliedSourceIds: ['source-lesson']
    }))
    expect(screen.getByRole('status')).toHaveTextContent('Applied metadata refresh for 1 source(s).')
  })

  it('surfaces a compare-and-swap conflict without adopting a failed update', async () => {
    const user = userEvent.setup()
    const previewMindMapSourceRefresh = vi.fn(async () => makePreviewResult())
    const applyMindMapSourceRefresh = vi.fn(async () => ({
      ok: false as const,
      code: 'revision_stale' as const,
      expectedRevision: 7,
      currentRevision: 8
    }))
    const onSourceRefreshApplied = vi.fn()
    installTeachingSystem({ previewMindMapSourceRefresh, applyMindMapSourceRefresh })

    renderRefreshablePanel({ onSourceRefreshApplied })
    await user.click(screen.getByRole('button', { name: 'Refresh preview' }))
    await waitFor(() => expect(screen.getByText('Content hash changed')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Apply 1 selected update(s)' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The mind map changed while you reviewed. Refresh the preview and review again.'
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Expected revision: 7; current revision: 8.'
    )
    expect(onSourceRefreshApplied).not.toHaveBeenCalled()
  })

})
