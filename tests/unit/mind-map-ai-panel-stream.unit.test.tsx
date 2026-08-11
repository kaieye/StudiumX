import { act, render, screen, waitFor } from '@testing-library/react'
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

function selectedFileProposalResult(): MindMapProposalGenerateResult {
  const result = proposalResult()
  return {
    ...result,
    request: {
      ...result.request,
      scope: 'selected-file',
      selectedFile: {
        id: 'selected-file:canonical',
        workspacePath: 'reference/context.md',
        contentHash: 'canonical-hash'
      }
    },
    proposal: {
      ...result.proposal,
      scope: 'selected-file'
    }
  }
}

function notesProposalResult(): MindMapProposalGenerateResult {
  const result = proposalResult()
  return {
    ...result,
    request: {
      ...result.request,
      scope: 'notes',
      notes: {
        id: 'notes:canonical',
        workspacePath: 'NOTES.md',
        contentHash: 'canonical-hash'
      }
    },
    proposal: {
      ...result.proposal,
      scope: 'notes'
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

  it('renders correlated provider deltas and ignores stale generation events', async () => {
    const user = userEvent.setup()
    render(<MindMapAiPanel open onToggle={() => {}} />)
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

    expect(screen.getByText('{"sheets":[]}')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-stream-step', 'streaming')

    act(() => resolveGeneration?.(generatedDocument()))
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
    expect(screen.getByText('partial JSON')).toBeInTheDocument()
  })

  it('generates a read-only proposal, submits only explicit decisions, and adopts the host result', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Preview request' }))
    await user.click(screen.getByRole('button', { name: 'Generate proposal' }))

    expect(generateMindMapProposal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'generated',
      scope: 'sheet',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      prompt: 'Build a study map'
    })
    expect(screen.getByText('Proposal item 1')).toBeInTheDocument()
    expect(screen.getByText('Proposal item 2')).toBeInTheDocument()

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept item' })
    await user.click(acceptButtons[0]!)
    await user.click(screen.getByRole('button', { name: 'Apply reviewed changes' }))

    expect(applyMindMapProposal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'generated',
      expectedRevision: 1,
      proposal: proposal.proposal,
      decisions: { 'rename-document': 'accept' }
    })
    await waitFor(() => expect(useMindMapViewStore.getState().current).toEqual(applied.document))
    expect(screen.getByText(/Applied 1 item/)).toBeInTheDocument()
  })

  it('reports a stale proposal without adopting a newer host document', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Preview request' }))
    await user.click(screen.getByRole('button', { name: 'Generate proposal' }))
    await user.click(screen.getAllByRole('button', { name: 'Accept item' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Apply reviewed changes' }))

    expect(applyMindMapProposal).toHaveBeenCalledTimes(1)
    expect(useMindMapViewStore.getState().current).toBe(current)
    expect(screen.getByText(/expected revision 1/)).toBeInTheDocument()
  })

  it('previews and submits the explicitly selected workspace file scope', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = selectedFileProposalResult()
    const generateMindMapProposal = vi.fn(async () => proposal)
    api.generateMindMapProposal = generateMindMapProposal
    useAppStore.setState({
      selectedMarkdownDocument: {
        title: 'Reference context',
        relativePath: 'reference/context.md',
        absolutePath: '/workspace/reference/context.md',
        content: '# Context',
        updatedAt: null
      }
    })
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.selectOptions(screen.getByLabelText('Request scope'), 'selected-file')
    expect(screen.getByText('Using selected file: reference/context.md')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview request' }))
    await user.click(screen.getByRole('button', { name: 'Generate proposal' }))

    expect(generateMindMapProposal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'generated',
      scope: 'selected-file',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      selectedFile: { workspacePath: 'reference/context.md' },
      prompt: 'Build a study map'
    })
  })

  it('previews and submits the canonical workspace Notes scope', async () => {
    const user = userEvent.setup()
    const current = generatedDocument()
    const proposal = notesProposalResult()
    const generateMindMapProposal = vi.fn(async () => proposal)
    api.generateMindMapProposal = generateMindMapProposal
    useMindMapViewStore.setState({
      current,
      selectedNodeId: null,
      activeSheetId: 'sheet-1'
    })

    render(<MindMapAiPanel open onToggle={() => {}} />)
    await user.click(screen.getByRole('tab', { name: /AI$/ }))

    await user.selectOptions(screen.getByLabelText('Request scope'), 'notes')
    expect(
      screen.getByText('Using the canonical workspace NOTES.md as read-only context')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview request' }))
    await user.click(screen.getByRole('button', { name: 'Generate proposal' }))

    expect(generateMindMapProposal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'generated',
      scope: 'notes',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      prompt: 'Build a study map'
    })
  })

})
