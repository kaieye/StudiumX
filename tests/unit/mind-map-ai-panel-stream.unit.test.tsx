import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapAiPanel } from '../../src/renderer/src/views/mindmap/MindMapAiPanel'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type {
  MindMapProposalApplyResult,
  MindMapProposalGenerateResult,
  MindMapStreamChunk,
  MindMapStreamStatus,
  TeachingSystemApi,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

const NOW = '2026-08-09T00:00:00.000Z'
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

function generatedDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'generated',
    revision: 1,
    title: 'Generated',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root', title: 'Generated root', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function proposalResult(): MindMapProposalGenerateResult {
  return {
    documentId: 'generated',
    revision: 1,
    request: {
      schemaVersion: 1,
      documentId: 'generated',
      scope: 'sheet',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: []
    },
    proposal: {
      schemaVersion: 1,
      proposalId: 'proposal-1',
      scope: 'sheet',
      items: [
        {
          id: 'rename-document',
          command: { type: 'document.rename', title: 'Reviewed map' }
        },
        {
          id: 'rename-sheet',
          command: { type: 'sheet.rename', sheetId: 'sheet-1', title: 'Reviewed sheet' }
        }
      ]
    }
  }
}

function appliedProposalResult(): MindMapProposalApplyResult {
  const document = generatedDocument()
  return {
    ok: true,
    proposalId: 'proposal-1',
    document: {
      ...document,
      revision: 2,
      title: 'Reviewed map',
      sheets: [{ ...document.sheets[0]!, title: 'Reviewed sheet' }]
    },
    command: {
      type: 'transaction',
      commands: [
        { type: 'document.rename', title: 'Reviewed map' },
        { type: 'sheet.rename', sheetId: 'sheet-1', title: 'Reviewed sheet' }
      ]
    },
    inverse: {
      type: 'transaction',
      commands: [
        { type: 'sheet.rename', sheetId: 'sheet-1', title: 'Overview' },
        { type: 'document.rename', title: 'Generated' }
      ]
    },
    acceptedIds: ['rename-document'],
    rejectedIds: ['rename-sheet']
  }
}

describe('MindMapAiPanel streaming preview', () => {
  let chunkHandler: ((chunk: MindMapStreamChunk) => void) | undefined
  let statusHandler: ((status: MindMapStreamStatus) => void) | undefined
  let resolveGeneration: ((document: MindMapDocumentV2) => void) | undefined
  let api: Partial<TeachingSystemApi>

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    useAppStore.setState({
      ...originalAppState,
      appState: {
        ...originalAppState.appState,
        activeWorkspace: workspace()
      }
    })
    useMindMapViewStore.setState({
      ...originalMindMapState,
      aiPrompt: 'Build a study map',
      current: null,
      selectedNodeId: null,
      activeSheetId: null,
      generating: false,
      streamText: '',
      error: null
    })

    const generation = new Promise<MindMapDocumentV2>((resolve) => {
      resolveGeneration = resolve
    })
    api = {
      generateMindMap: vi.fn(() => generation),
      cancelMindMapGeneration: vi.fn(async () => ({ canceled: true })),
      onMindMapStreamChunk: vi.fn((handler) => {
        chunkHandler = handler
        return vi.fn()
      }),
      onMindMapStreamStatus: vi.fn((handler) => {
        statusHandler = handler
        return vi.fn()
      })
    }
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: api
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState(originalMindMapState)
    useAppStore.setState(originalAppState)
    if (originalTeachingSystemDescriptor) {
      Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
    } else {
      delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
    }
    vi.restoreAllMocks()
  })

  it('keeps import/export and panel toggle controls mounted when collapsed', () => {
    const { container } = render(
      <MindMapAiPanel
        open={false}
        onToggle={() => {}}
        documentTitle="Collapsed map"
        onRenameDocument={() => {}}
        importExportControl={<button type="button">Import and export</button>}
      />
    )

    expect(container.querySelector('.mindmap-ai-panel')).toHaveClass('is-collapsed')
    const importExportButton = screen.getByRole('button', { name: 'Import and export' })
    const panelToggleButton = screen.getByRole('button', { name: 'Mind map inspector' })
    expect(importExportButton).toBeInTheDocument()
    expect(panelToggleButton).toBeInTheDocument()
    expect(
      importExportButton.compareDocumentPosition(panelToggleButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('keeps canvas-wide options in Canvas and merges module style into Node', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    current.sheets[0]!.elements = [
      { id: 'relationship-1', type: 'relationship', from: 'root', to: 'root', label: 'Depends on' }
    ]
    useMindMapViewStore.setState({
      current,
      activeSheetId: 'sheet-1',
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      inspectorTab: 'format'
    })

    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Node' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Style' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Format' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Content' })).not.toBeInTheDocument()
    expect(screen.getByText('Canvas options')).toBeInTheDocument()

    // Selecting a topic reveals the Node tab, where its style now lives
    // alongside notes and markers.
    act(() => useMindMapViewStore.getState().selectTopic('root'))
    expect(screen.getByRole('tab', { name: 'Node' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Node style')).toBeInTheDocument()
    expect(screen.queryByText('Canvas options')).not.toBeInTheDocument()
    expect(container.querySelector('#mindmap-inspector-notes')).toBeInTheDocument()
    expect(container.querySelector('#mindmap-inspector-markers')).toBeInTheDocument()

    // The Canvas tab keeps only the canvas-wide controls for any selection.
    await user.click(screen.getByRole('tab', { name: 'Canvas' }))
    expect(screen.getByText('Canvas options')).toBeInTheDocument()
    expect(screen.queryByText('Node style')).not.toBeInTheDocument()

    // Selecting an element also lands on Node with its style inspector.
    act(() => useMindMapViewStore.getState().selectElement('relationship-1', 'relationship'))
    expect(screen.getByRole('tab', { name: 'Node' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Relationship')).toBeInTheDocument()
    expect(screen.getByText('Element style')).toBeInTheDocument()
  })

  it('renders correlated provider deltas and ignores stale generation events', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    const generationId = (api.generateMindMap as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].generationId
    expect(generationId).toEqual(expect.any(String))

    act(() => {
      statusHandler?.({ generationId, step: 'streaming' })
      chunkHandler?.({ generationId, delta: '{"sheets":' })
      chunkHandler?.({ generationId: 'stale-generation', delta: 'ignored' })
      chunkHandler?.({ generationId, delta: '[]}' })
    })

    expect(within(screen.getByRole('log')).getByText('Build a study map')).toBeInTheDocument()
    expect(screen.getByText('{"sheets":[]}')).toBeInTheDocument()
    expect(container.querySelector('[data-stream-step="streaming"]')).toBeInTheDocument()
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')

    act(() => resolveGeneration?.(generatedDocument()))
  })

  it('uses a conversation thread with a bottom composer and supports Enter to send', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    const conversation = container.querySelector('.mindmap-ai-panel__conversation')
    const thread = container.querySelector('.mindmap-ai-panel__thread')
    const composer = container.querySelector('.mindmap-ai-panel__composer')
    expect(conversation).toContainElement(thread)
    expect(conversation).toContainElement(composer)
    expect(thread?.compareDocumentPosition(composer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    const prompt = screen.getByLabelText('Topic or prompt')
    await user.clear(prompt)
    await user.type(prompt, 'Map the Krebs cycle{enter}')

    expect(api.generateMindMap).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      prompt: 'Map the Krebs cycle'
    }))
    expect(within(screen.getByRole('log')).getByText('Map the Krebs cycle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('retries the prompt from the failed conversation turn', async () => {
    const user = userEvent.setup()
    api.generateMindMap = vi.fn()
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockImplementationOnce(() => new Promise<MindMapDocumentV2>(() => undefined))

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(api.generateMindMap).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: 'Build a study map'
    }))
    expect(screen.getByLabelText('Topic or prompt')).toHaveValue('')
  })

  it('keeps a shared generation error visible after the panel remounts', async () => {
    useMindMapViewStore.setState({ error: 'Provider unavailable' })
    const { unmount } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await userEvent.click(screen.getByRole('tab', { name: /AI$/ }))
    unmount()

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await userEvent.click(screen.getByRole('tab', { name: /AI$/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable')
  })

  it('keeps the draft prompt when there is no active workspace', async () => {
    const user = userEvent.setup()
    useAppStore.setState({
      appState: {
        ...originalAppState.appState,
        activeWorkspace: null
      }
    })
    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    const prompt = screen.getByLabelText('Topic or prompt')
    await user.clear(prompt)
    await user.type(prompt, 'Keep this prompt')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(prompt).toHaveValue('Keep this prompt')
    expect(api.generateMindMap).not.toHaveBeenCalled()
  })

  it('cancels the generation lease while retaining the received preview text', async () => {
    const user = userEvent.setup()
    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    const generationId = (api.generateMindMap as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].generationId
    act(() => chunkHandler?.({ generationId, delta: 'partial JSON' }))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.cancelMindMapGeneration).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      generationId
    })
    expect(useMindMapViewStore.getState().generating).toBe(false)
    expect(useMindMapViewStore.getState().aiPrompt).toBe('Build a study map')
    expect(screen.getByText('partial JSON')).toBeInTheDocument()
  })

  it('edits the current canvas directly and adopts the host result without review', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = proposalResult()
    const applied = appliedProposalResult()
    const generateMindMapProposal = vi.fn(async () => proposal)
    const applyMindMapProposal = vi.fn(async () => applied)
    api.generateMindMapProposal = generateMindMapProposal
    api.applyMindMapProposal = applyMindMapProposal
    api.listMindMaps = vi.fn(async () => [])
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(generateMindMapProposal).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      id: 'generated',
      scope: 'sheet',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      prompt: 'Build a study map'
    }))
    expect(applyMindMapProposal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'generated',
      expectedRevision: 1,
      proposal: proposal.proposal,
      decisions: { 'rename-document': 'accept', 'rename-sheet': 'accept' }
    })
    await waitFor(() => expect(useMindMapViewStore.getState().current).toEqual(applied.document))
    expect(screen.queryByText('Proposal item 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Request scope')).not.toBeInTheDocument()
  })

  it('reports a stale auto-applied proposal without adopting a newer host document', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = proposalResult()
    const applyMindMapProposal = vi.fn(async () => ({
      ok: false as const,
      code: 'revision_stale' as const,
      expectedRevision: 1,
      currentRevision: 2
    }))
    api.generateMindMapProposal = vi.fn(async () => proposal)
    api.applyMindMapProposal = applyMindMapProposal
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(applyMindMapProposal).toHaveBeenCalledTimes(1)
    expect(useMindMapViewStore.getState().current).toBe(current)
    expect(screen.getByText(/expected revision 1/)).toBeInTheDocument()
  })

})
