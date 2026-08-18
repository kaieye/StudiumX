import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
        layout: { structureClass: 'studiumx.layout.logic.right' }
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

function topicInsertProposalResult(): MindMapProposalGenerateResult {
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
      proposalId: 'proposal-topic-insert',
      scope: 'sheet',
      items: [
        {
          id: 'insert-branch',
          command: {
            type: 'topic.insert',
            sheetId: 'sheet-1',
            parentId: 'root',
            node: {
              id: 'branch',
              title: 'Branch',
              children: [{ id: 'leaf', title: 'Leaf', children: [] }]
            }
          }
        }
      ]
    }
  }
}

function appliedTopicInsertProposalResult(): MindMapProposalApplyResult {
  const document = generatedDocument()
  document.sheets[0]!.root.children = [{
    id: 'branch',
    title: 'Branch',
    children: [{ id: 'leaf', title: 'Leaf', children: [] }]
  }]
  return {
    ok: true,
    proposalId: 'proposal-topic-insert',
    document: { ...document, revision: 2 },
    command: {
      type: 'topic.insert',
      sheetId: 'sheet-1',
      parentId: 'root',
      node: {
        id: 'branch',
        title: 'Branch',
        children: [{ id: 'leaf', title: 'Leaf', children: [] }]
      }
    },
    inverse: {
      type: 'topic.remove',
      sheetId: 'sheet-1',
      topicId: 'branch'
    },
    acceptedIds: ['insert-branch'],
    rejectedIds: []
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

  it('keeps the document title input mounted while entering rename mode', async () => {
    const user = userEvent.setup()

    render(
      <MindMapAiPanel
        open
        onToggle={() => {}}
        documentTitle="Study map"
        onRenameDocument={() => {}}
      />
    )

    const titleInput = screen.getByLabelText('Rename')
    expect(titleInput).toHaveValue('Study map')
    expect(titleInput).toHaveAttribute('readonly')

    await user.click(titleInput)

    expect(screen.getByLabelText('Rename')).toBe(titleInput)
    expect(titleInput).not.toHaveAttribute('readonly')
    expect(titleInput).toHaveFocus()
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

    // Selecting a topic reveals the Node tab, where its style now lives.
    // Notes and markers were removed from the node settings panel (they are
    // edited in the canvas-adjacent topic popover).
    act(() => useMindMapViewStore.getState().selectTopic('root'))
    expect(screen.getByRole('tab', { name: 'Node' })).toHaveAttribute('aria-selected', 'true')
    expect(container.querySelector('.mindmap-topic-style .mm-subhead')).toHaveTextContent('Style')
    expect(screen.queryByText('Canvas options')).not.toBeInTheDocument()
    expect(container.querySelector('#mindmap-inspector-notes')).not.toBeInTheDocument()
    expect(container.querySelector('#mindmap-inspector-markers')).not.toBeInTheDocument()

    // The Canvas tab keeps only the canvas-wide controls for any selection.
    await user.click(screen.getByRole('tab', { name: 'Canvas' }))
    expect(screen.getByText('Canvas options')).toBeInTheDocument()
    expect(container.querySelector('.mindmap-topic-style')).not.toBeInTheDocument()

    // Selecting an element also lands on Node with its style inspector.
    act(() => useMindMapViewStore.getState().selectElement('relationship-1', 'relationship'))
    expect(screen.getByRole('tab', { name: 'Node' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Relationship')).toBeInTheDocument()
    expect(screen.getByText('Element style')).toBeInTheDocument()
  })

  it('lets streamed previews grow with the transcript instead of clipping them inside a code slab', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/mindmap/mindmap.css'),
      'utf8'
    )
    const threadRule = styles.match(/\.mindmap-ai-panel__thread\s*\{([\s\S]*?)\n\}/)?.[1]
    const previewRule = styles.match(
      /\.mindmap-ai-panel__message--assistant > \.markdown-message pre\s*\{([\s\S]*?)\n\}/
    )?.[1]

    // The conversation thread is the single vertical scroll owner. A generated
    // map preview can be much longer than a composer input, so a nested 180px
    // code slab hides most of the AI turn behind a second scrollbar.
    expect(threadRule).toMatch(/flex:\s*1 1 auto;/)
    expect(threadRule).toMatch(/min-height:\s*0;/)
    expect(threadRule).toMatch(/overflow-y:\s*auto;/)
    expect(previewRule).toMatch(/max-height:\s*none;/)
    expect(previewRule).toMatch(/overflow:\s*visible;/)
  })

  it('renders correlated provider deltas and ignores stale generation events', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    const generationId = (api.generateMindMap as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].generationId
    expect(generationId).toEqual(expect.any(String))

    // The mind-map conversation reuses the compact process-card surface from
    // the main conversation, while exposing its real provider lifecycle.
    const processPanel = container.querySelector<HTMLElement>(
      '.mindmap-ai-panel__message--assistant .agent-process-panel'
    )
    expect(processPanel).toHaveClass('is-compact')
    expect(within(processPanel!).getByText('Analyze the prompt and plan the map')).toBeInTheDocument()
    expect(within(processPanel!).getByText('Generate the mind map')).toBeInTheDocument()

    act(() => {
      statusHandler?.({ generationId, step: 'streaming' })
      chunkHandler?.({ generationId, delta: '{"sheets":' })
      chunkHandler?.({ generationId: 'stale-generation', delta: 'ignored' })
      chunkHandler?.({ generationId, delta: '[]}' })
    })

    expect(within(screen.getByRole('log')).getByText('Build a study map')).toBeInTheDocument()
    expect(screen.getByText('{"sheets":[]}')).toBeInTheDocument()
    expect(container.querySelector('[data-stream-step="streaming"]')).toBeInTheDocument()
    expect(screen.getByText('Generate the mind map').closest('.agent-process-event')).toHaveClass('is-active')
    expect(screen.getByText('Analyze the prompt and plan the map').closest('.agent-process-event')).not.toHaveClass('is-active')
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')
    expect(container.querySelector('.mindmap-ai-panel__thread-inner')).toHaveClass('overview-dialog-thread-inner')
    expect(within(screen.getByRole('log')).getByText('Build a study map').closest('.markdown-message')).toHaveClass(
      'markdown-message--user'
    )
    expect(screen.getByText('{"sheets":[]}').closest('.markdown-message')).toHaveClass('markdown-message--assistant')
    expect(container.querySelector('.mindmap-ai-panel__message-preview')).not.toBeInTheDocument()

    act(() => resolveGeneration?.(generatedDocument()))
  })

  it('renders no bottom status strip (the process card carries generation status)', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    expect(container.querySelector('.mindmap-ai-panel__composer')).toBeInTheDocument()
    expect(container.querySelector('.mindmap-ai-panel__statusbar')).not.toBeInTheDocument()
    expect(container.querySelector('.mindmap-ai-panel__message-status')).not.toBeInTheDocument()
  })

  it('uses a conversation thread with a bottom composer and supports Enter to send', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    const conversation = container.querySelector('.mindmap-ai-panel__conversation')
    const thread = container.querySelector('.mindmap-ai-panel__thread')
    const composer = container.querySelector('.mindmap-ai-panel__composer')
    const composerCard = container.querySelector('.mindmap-ai-panel__composer-card')
    expect(conversation).toContainElement(thread)
    expect(conversation).toContainElement(composer)
    expect(thread?.compareDocumentPosition(composer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(conversation).toHaveClass('overview-dialog-shell', 'has-conversation')
    expect(thread).toHaveClass('overview-dialog-thread')
    expect(composer).toHaveClass('overview-dialog-stack')
    expect(composerCard).toHaveClass('overview-dialog-card')

    const prompt = screen.getByLabelText('Topic or prompt')
    await user.clear(prompt)
    await user.type(prompt, 'Map the Krebs cycle{enter}')

    expect(api.generateMindMap).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      prompt: 'Map the Krebs cycle'
    }))
    expect(within(screen.getByRole('log')).getByText('Map the Krebs cycle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('overview-dialog-send')
    expect(container.querySelector('.mindmap-ai-panel__statusbar')).not.toBeInTheDocument()
  })

  it('sends source intent to the host when creating a new mind map without a file picker', async () => {
    const user = userEvent.setup()
    useMindMapViewStore.setState({
      aiPrompt: '请根据资料分析文件夹中的 Markdown 生成完整导图。'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(api.generateMindMap).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      prompt: '请根据资料分析文件夹中的 Markdown 生成完整导图。'
    }))
    expect(vi.mocked(api.generateMindMap!).mock.calls[0]?.[0]).not.toHaveProperty('selectedFile')

    act(() => resolveGeneration?.(generatedDocument()))
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
    const { container } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    const generationId = (api.generateMindMap as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].generationId
    act(() => {
      statusHandler?.({ generationId, step: 'streaming' })
      chunkHandler?.({ generationId, delta: 'partial JSON' })
    })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.cancelMindMapGeneration).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      generationId
    })
    expect(useMindMapViewStore.getState().generating).toBe(false)
    expect(useMindMapViewStore.getState().aiPrompt).toBe('Build a study map')
    expect(screen.getByText('partial JSON')).toBeInTheDocument()
    expect(screen.getByText('This step was cancelled')).toBeInTheDocument()
    expect(container.querySelector('[data-generation-status="cancelled"][data-stream-step="streaming"]')).toBeInTheDocument()
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
    await waitFor(() => expect(applyMindMapProposal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'generated',
      expectedRevision: 1,
      proposal: proposal.proposal,
      decisions: { 'rename-document': 'accept', 'rename-sheet': 'accept' }
    }))
    await waitFor(() => expect(useMindMapViewStore.getState().current).toEqual(applied.document))
    expect(screen.getByText('Generate a change proposal')).toBeInTheDocument()
    expect(screen.getByText('Apply changes to the current canvas')).toBeInTheDocument()
    await waitFor(() => expect(
      screen.getByText('Apply changes to the current canvas').closest('.mindmap-ai-panel__message--assistant')
    ).toHaveAttribute('data-stream-step', 'done'))
    expect(screen.queryByText('Proposal item 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Request scope')).not.toBeInTheDocument()
  })

  it('reveals inserted topics one step at a time before adopting the host document', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    current.sheets[0]!.root.children = []
    const proposal = topicInsertProposalResult()
    const applied = appliedTopicInsertProposalResult()
    let resolveProposal: ((result: MindMapProposalGenerateResult) => void) | undefined
    let resolveApply: ((result: MindMapProposalApplyResult) => void) | undefined
    const generateMindMapProposal = vi.fn(() => new Promise<MindMapProposalGenerateResult>((resolve) => {
      resolveProposal = resolve
    }))
    const applyMindMapProposal = vi.fn(() => new Promise<MindMapProposalApplyResult>((resolve) => {
      resolveApply = resolve
    }))
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

    const generationId = (generateMindMapProposal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].generationId
    expect(generationId).toEqual(expect.any(String))

    // Feed a complete item before the host promise settles. The renderer must
    // project it locally without touching the canonical document.
    act(() => chunkHandler?.({
      generationId,
      delta: JSON.stringify({ items: proposal.proposal.items })
    }))
    expect(useMindMapViewStore.getState().current).toBe(current)
    act(() => resolveProposal?.(proposal))

    await waitFor(() => {
      const preview = useMindMapViewStore.getState().generationPreview
      expect(preview?.document.sheets[0]?.root.children[0]).toMatchObject({
        id: 'branch',
        title: 'Branch',
        children: []
      })
      expect(preview?.latestNodeIds).toEqual(['branch'])
    })
    expect(applyMindMapProposal).not.toHaveBeenCalled()

    await waitFor(() => {
      const preview = useMindMapViewStore.getState().generationPreview
      expect(preview?.document.sheets[0]?.root.children[0]?.children[0]).toMatchObject({
        id: 'leaf',
        title: 'Leaf'
      })
    })
    await waitFor(() => expect(applyMindMapProposal).toHaveBeenCalledTimes(1))
    expect(useMindMapViewStore.getState().current).toBe(current)
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeDisabled()
    await user.click(cancelButton)
    expect(api.cancelMindMapGeneration).not.toHaveBeenCalled()
    expect(useMindMapViewStore.getState().generating).toBe(true)

    await act(async () => resolveApply?.(applied))
    await waitFor(() => expect(useMindMapViewStore.getState().current).toEqual(applied.document))
    expect(useMindMapViewStore.getState().generationPreview).toBeNull()
  })

  it('clears the preview on cancel and ignores a late proposal result', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = topicInsertProposalResult()
    let resolveProposal: ((result: MindMapProposalGenerateResult) => void) | undefined
    const generateMindMapProposal = vi.fn(() => new Promise<MindMapProposalGenerateResult>((resolve) => {
      resolveProposal = resolve
    }))
    const applyMindMapProposal = vi.fn()
    api.generateMindMapProposal = generateMindMapProposal
    api.applyMindMapProposal = applyMindMapProposal
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(useMindMapViewStore.getState().generationPreview).not.toBeNull())

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useMindMapViewStore.getState().generationPreview).toBeNull()
    expect(useMindMapViewStore.getState().current).toBe(current)
    expect(useMindMapViewStore.getState().generating).toBe(false)

    await act(async () => resolveProposal?.(proposal))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(applyMindMapProposal).not.toHaveBeenCalled()
    expect(useMindMapViewStore.getState().current).toBe(current)
  })

  it('invalidates the generation lease when the panel unmounts', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = topicInsertProposalResult()
    let resolveProposal: ((result: MindMapProposalGenerateResult) => void) | undefined
    const generateMindMapProposal = vi.fn(() => new Promise<MindMapProposalGenerateResult>((resolve) => {
      resolveProposal = resolve
    }))
    const applyMindMapProposal = vi.fn()
    api.generateMindMapProposal = generateMindMapProposal
    api.applyMindMapProposal = applyMindMapProposal
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    const { unmount } = render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    const generationId = (generateMindMapProposal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].generationId
    await waitFor(() => expect(useMindMapViewStore.getState().generationPreview).not.toBeNull())

    unmount()
    expect(useMindMapViewStore.getState().generationPreview).toBeNull()
    expect(useMindMapViewStore.getState().generating).toBe(false)
    expect(useMindMapViewStore.getState().aiPrompt).toBe('Build a study map')
    expect(api.cancelMindMapGeneration).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      generationId
    })

    await act(async () => resolveProposal?.(proposal))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(applyMindMapProposal).not.toHaveBeenCalled()
    expect(useMindMapViewStore.getState().current).toBe(current)
  })

  it('keeps source resolution in the host and sends the user language without a file picker', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = proposalResult()
    const applied = appliedProposalResult()
    const generateMindMapProposal = vi.fn(async () => proposal)
    api.generateMindMapProposal = generateMindMapProposal
    api.applyMindMapProposal = vi.fn(async () => applied)
    api.listMindMaps = vi.fn(async () => [])
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1',
      aiPrompt: '请根据资料分析文件夹中的 Markdown 生成完整导图。'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(generateMindMapProposal).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      id: 'generated',
      scope: 'sheet',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      prompt: '请根据资料分析文件夹中的 Markdown 生成完整导图。'
    }))
    expect(generateMindMapProposal.mock.calls[0]?.[0]).not.toHaveProperty('selectedFile')
  })

  it('surfaces an empty provider proposal as a no-change outcome without applying it', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const noChanges = {
      ...proposalResult(),
      proposal: {
        ...proposalResult().proposal,
        items: []
      }
    }
    const generateMindMapProposal = vi.fn(async () => noChanges)
    const applyMindMapProposal = vi.fn()
    api.generateMindMapProposal = generateMindMapProposal
    api.applyMindMapProposal = applyMindMapProposal
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(
      document.querySelector('[data-generation-status="no_changes"]')
    ).toBeInTheDocument())
    const noChangesMessage = document.querySelector('[data-generation-status="no_changes"]')
    expect(noChangesMessage).not.toBeNull()
    // The process card carries the terminal no-change outcome (the standalone
    // status line was removed); the final stage reads as "no changes to apply".
    expect(within(noChangesMessage!).getByText('No changes to apply')).toBeInTheDocument()
    expect(within(noChangesMessage!).getByText(
      'The AI did not suggest any changes to apply. Specify what to add, revise, or remove, then try again.'
    )).toBeInTheDocument()
    expect(applyMindMapProposal).not.toHaveBeenCalled()
    expect(useMindMapViewStore.getState().current).toBe(current)
    expect(noChangesMessage).not.toHaveClass('is-error')
  })

  it('shows a retryable, localized message when the provider returns an invalid proposal shape', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    api.generateMindMapProposal = vi.fn().mockRejectedValueOnce(new Error(
      "Error invoking remote method 'teach:generate-mind-map-proposal': Error: Mind map generation failed (invalid_output): mind-map proposal failed schema validation"
    ))
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(screen.getByText(
      'The AI returned an incomplete change proposal. Your mind map was not changed. Please try again.'
    )).toBeInTheDocument())
    expect(screen.queryByText(/Error invoking remote method/)).not.toBeInTheDocument()
  })

  it('returns to the library instead of exposing a local path when the open map was removed', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const rawPath = '/Users/chos1nz/Documents/考公/mindmaps/generated.json'
    api.generateMindMapProposal = vi.fn().mockRejectedValueOnce(new Error(
      "Error invoking remote method 'teach:generate-mind-map-proposal': Error: " +
      `ENOENT: no such file or directory, open '${rawPath}'`
    ))
    api.applyMindMapProposal = vi.fn()
    api.listMindMaps = vi.fn(async () => [])
    useMindMapViewStore.setState({
      current,
      documents: [{ id: current.id, title: current.title, updatedAt: current.updatedAt, sheetCount: 1 }],
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    const message =
      'This mind map file is no longer available. You have been returned to the mind-map library. ' +
      'Open another mind map or create a new one, then try again.'
    await waitFor(() => expect(useMindMapViewStore.getState().current).toBeNull())
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(useMindMapViewStore.getState().error).toBe(message)
    expect(useMindMapViewStore.getState().documents).not.toContainEqual(
      expect.objectContaining({ id: current.id })
    )
    expect(api.applyMindMapProposal).not.toHaveBeenCalled()
    expect(screen.queryByText(rawPath)).not.toBeInTheDocument()
    expect(screen.queryByText(/ENOENT: no such file or directory/)).not.toBeInTheDocument()
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

    await waitFor(() => expect(applyMindMapProposal).toHaveBeenCalledTimes(1))
    expect(useMindMapViewStore.getState().current).toBe(current)
    expect(screen.getByText(/expected revision 1/)).toBeInTheDocument()
  })

})
