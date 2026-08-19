import { PanelRightClose, SendHorizontal, Square } from 'lucide-react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import type { MindMapProposalDecision } from '../../../../shared/mindmap/commands/mind-map-proposal'
import { MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MARKER } from '../../../../shared/mindmap/mind-map-repository-errors'
import type {
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  AgentRealtimeEvent,
  MindMapProposalApplyResult,
  MindMapStreamStatus
} from '../../../../shared/teaching-types'
import type { AgentChatImageAttachment } from '../../../../shared/agent-chat-images'
import {
  applyAgentChatChunkToPending,
  applyAgentChatStatusToPending,
  applyAgentChatToolEventToPending,
  type PendingAgentConversation
} from '../../agent-conversation-state'
import { buildAgentConversationPresentation } from '../../agent-conversation-presentation'
import { useAppStore } from '../../app-shell/appStore'
import {
  OverviewModelAndReasoningPicker
} from '../../ui/overview-composer-pickers'
import { AgentChatImageGallery } from '../../ui/AgentChatImageGallery'
import {
  AgentChatImageAttachmentRail,
  AgentChatImageComposerError,
  AgentChatImageFileInput,
  AgentChatImagePickerButton,
  useAgentChatImageDrafts
} from '../../ui/agent-chat-image-composer'
import { MarkdownMessage } from '../../ui/MarkdownMessage'
import {
  AgentConversationAssistantBody,
  AgentConversationMessageFrame
} from '../agent-conversation/AgentConversationAssistantBody'
import { useMindMapViewStore } from './mind-map-view-store'
import { MindMapThemeGallery } from './MindMapThemeGallery'
import { MindMapThemePanel } from './MindMapThemePanel'
import { MindMapTopicStyleInspector } from './MindMapTopicStyleInspector'
import { MindMapCanvasOptionsPanel } from './MindMapCanvasOptionsPanel'
import { MindMapElementStyleInspector } from './MindMapElementStyleInspector'
import {
  expandMindMapGenerationPreviewCommand,
  newCompletedMindMapProposalItems,
  type MindMapStreamedProposalItem
} from './mind-map-generation-preview'

type MindMapAiGenerationMessage = {
  generationId: string
  prompt: string
  step: MindMapStreamStatus['step'] | 'applying'
  status: 'generating' | 'completed' | 'no_changes' | 'cancelled' | 'error'
  agentTurn: AgentChatTurn
  lastAgentSequence: number
  /** User images attached to this generation turn, shown in the transcript. */
  imageAttachments?: AgentChatImageAttachment[]
  error?: string
  notice?: string
}

type MindMapGenerationTerminal = {
  generationId: string
  step: 'error' | 'cancelled'
}

type MindMapGenerationPreviewSession = {
  generationId: string
  streamText: string
  admittedItemIds: Set<string>
  commands: MindMapCommand[]
  timer: ReturnType<typeof setTimeout> | null
  drainWaiters: Array<(drained: boolean) => void>
}

// Short enough to keep a medium map moving, long enough for a person to see
// the parent-to-child reveal rather than a single layout pop.
const MIND_MAP_PREVIEW_REVEAL_INTERVAL_MS = 56

function terminalStepForGeneration(
  terminal: MindMapGenerationTerminal | null,
  generationId: string
): MindMapGenerationTerminal['step'] {
  return terminal?.generationId === generationId ? terminal.step : 'error'
}

function pendingConversationForMindMapMessage(
  message: MindMapAiGenerationMessage
): PendingAgentConversation {
  return {
    workspaceId: 'mind-map',
    sourceConversationId: null,
    sourceConversationRevision: null,
    mode: 'temporary',
    summary: {
      id: message.generationId,
      title: message.prompt,
      createdAt: message.agentTurn.createdAt,
      updatedAt: message.agentTurn.createdAt,
      relativePath: '',
      absolutePath: '',
      messageCount: 1,
      pending: true
    },
    turns: [message.agentTurn],
    status: '',
    toolsSupported: null,
    runtimeStreamId: message.generationId
  }
}

function terminalAgentStatus(event: Extract<AgentRealtimeEvent, { kind: 'terminal' }>): AgentChatStreamStatus {
  return {
    streamId: event.streamId,
    status: event.outcome,
    ...(event.message ? { message: event.message } : {})
  }
}

/** Project one dedicated mind-map event through the homepage conversation reducer. */
function applyMindMapAgentEvent(
  message: MindMapAiGenerationMessage,
  event: AgentRealtimeEvent
): MindMapAiGenerationMessage {
  if (event.streamId !== message.generationId || event.sequence <= message.lastAgentSequence) {
    return message
  }
  // Mind-map provider output is machine-readable JSON for the canvas preview,
  // never assistant prose. Ignore answer-channel chunks defensively so an
  // older main process cannot reintroduce the raw document into the transcript.
  if (event.kind === 'chunk' && event.payload.channel !== 'reasoning') {
    return { ...message, lastAgentSequence: event.sequence }
  }
  const pending = pendingConversationForMindMapMessage(message)
  const common = {
    pending,
    activeConversationId: message.generationId,
    assistantId: message.agentTurn.id,
    realtimeEvent: event,
    updatedAt: event.createdAt
  }
  const patch = event.kind === 'chunk'
    ? applyAgentChatChunkToPending({ ...common, chunk: event.payload })
    : event.kind === 'status'
      ? applyAgentChatStatusToPending({ ...common, status: event.payload })
      : event.kind === 'tool'
        ? applyAgentChatToolEventToPending({ ...common, event: event.payload })
        : applyAgentChatStatusToPending({ ...common, status: terminalAgentStatus(event) })
  const agentTurn = patch?.pendingAgentConversation?.turns.find((turn) => turn.id === message.agentTurn.id)
  return {
    ...message,
    agentTurn: agentTurn ?? message.agentTurn,
    lastAgentSequence: event.sequence
  }
}

/** Project a real repository IPC boundary without competing with host sequence numbers. */
function applyMindMapToolProjection(
  message: MindMapAiGenerationMessage,
  event: AgentChatStreamToolEvent,
  updatedAt = new Date().toISOString()
): MindMapAiGenerationMessage {
  if (event.streamId !== message.generationId) return message
  const pending = pendingConversationForMindMapMessage(message)
  const patch = applyAgentChatToolEventToPending({
    pending,
    activeConversationId: message.generationId,
    assistantId: message.agentTurn.id,
    event,
    updatedAt
  })
  const agentTurn = patch?.pendingAgentConversation?.turns.find((turn) => turn.id === message.agentTurn.id)
  return {
    ...message,
    agentTurn: agentTurn ?? message.agentTurn
  }
}

/**
 * Electron prepends an implementation-level IPC envelope to rejected invokes.
 * Keep that detail out of the learner-facing transcript, and turn the known
 * strict proposal-boundary failure into an actionable retry message. The raw
 * provider text remains only in the canvas preview; it is never copied into
 * assistant prose or applied to the canonical map unless the host validates it.
 */
function mindMapGenerationErrorMessage(
  caught: unknown,
  t: (key: string) => string
): string {
  const raw = caught instanceof Error ? caught.message : String(caught)
  if (raw.includes(MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MARKER)) {
    return t('mindmap.aiDocumentMissing')
  }
  if (raw.includes('mind-map proposal failed schema validation')) {
    return t('mindmap.aiProposalInvalidOutput')
  }

  const withoutIpcEnvelope = raw.replace(
    /^Error invoking remote method '[^']+': Error:\s*/u,
    ''
  ).trim()
  return withoutIpcEnvelope || t('mindmap.aiError')
}

/**
 * Recognize both the path-safe repository marker and a raw ENOENT emitted by
 * an already-running older main process. The legacy fallback is constrained to
 * the exact open-map file, so a missing selected source file is not mistaken
 * for a deleted canonical document.
 */
function isMissingCurrentMindMapDocumentError(caught: unknown, documentId: string): boolean {
  const raw = caught instanceof Error ? caught.message : String(caught)
  if (raw.includes(MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MARKER)) return true
  if (!raw.includes('ENOENT: no such file or directory')) return false
  return [
    `/mindmaps/${documentId}.json`,
    `\\mindmaps\\${documentId}.json`
  ].some((suffix) => raw.includes(suffix))
}

/**
 * AI chat panel for the mind map (docs/mindmap/design.md §6.5).
 *
 * The conversation edits the current canvas directly: sending a message asks
 * the provider for a proposal against the active sheet and applies every item
 * immediately — no review or approval step. When no document is open yet, it
 * falls back to generating a brand-new document from the prompt.
 *
 * Cancellation is propagated to the main process/provider through the
 * `cancelMindMapGeneration` IPC (generation-correlated by `generationId`), so
 * clicking cancel aborts the provider request instead of only hiding loading
 * (docs/mindmap/m0-baseline.md §2.1 P0 fix).
 */
type MindMapAiPanelProps = {
  /** P2 §5.2: whether the inspector is visible (controlled by the view store). */
  open: boolean
  /** Temporary AI projection mode; the title control must not write canonical state. */
  readOnly?: boolean
  /** Toggle the inspector visibility (header button + ⌘.). */
  onToggle: () => void
  /** Title of the currently open mind-map document. */
  documentTitle: string
  /** Rename the currently open mind-map document. */
  onRenameDocument: (title: string) => void
  /** Import/export control rendered beside the panel collapse button. */
  importExportControl?: ReactNode
  /** Search/outline tool buttons rendered to the left of the import/export control. */
  utilityControl?: ReactNode
  /** Optional search/outline surface rendered below the persistent header row. */
  utilityContent?: ReactNode
}

export function MindMapAiPanel({
  open,
  readOnly = false,
  onToggle,
  documentTitle,
  onRenameDocument,
  importExportControl,
  utilityControl,
  utilityContent
}: MindMapAiPanelProps) {
  const { t } = useTranslation()
  const aiPrompt = useMindMapViewStore((s) => s.aiPrompt)
  const setAiPrompt = useMindMapViewStore((s) => s.setAiPrompt)
  const generating = useMindMapViewStore((s) => s.generating)
  const error = useMindMapViewStore((s) => s.error)
  const selection = useMindMapViewStore((s) => s.selection)

  const [generationMessages, setGenerationMessages] = useState<MindMapAiGenerationMessage[]>([])
  const [editingDocumentTitle, setEditingDocumentTitle] = useState(false)
  const [documentTitleDraft, setDocumentTitleDraft] = useState(documentTitle)
  const documentTitleInputRef = useRef<HTMLInputElement>(null)

  // Shared composer image attachments (same hook as the overview conversation).
  const imageDrafts = useAgentChatImageDrafts({
    // Attachments belong to the current document; never carry them across maps.
    resetKey: useMindMapViewStore((s) => s.current?.id)
  })
  const hasDraftImages = imageDrafts.hasDrafts

  const generationRef = useRef<{
    workspaceId: string
    generationId: string
    prompt: string
  } | null>(null)
  // Once the host apply invoke has started, cancelling the renderer lease
  // cannot reliably undo a commit that may already be in flight. Keep that
  // narrow boundary non-cancellable from the UI and let the invoke settle.
  const generationPhaseRef = useRef<'provider' | 'applying' | null>(null)
  const generationTerminalRef = useRef<MindMapGenerationTerminal | null>(null)
  const previewSessionRef = useRef<MindMapGenerationPreviewSession | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const threadShouldStickRef = useRef(true)

  const settlePreviewDrain = (
    session: MindMapGenerationPreviewSession,
    drained: boolean
  ): void => {
    const waiters = session.drainWaiters.splice(0)
    for (const resolve of waiters) resolve(drained)
  }

  const discardGenerationPreview = (generationId?: string): void => {
    const session = previewSessionRef.current
    if (!session) {
      if (generationId) useMindMapViewStore.getState().clearGenerationPreview(generationId)
      return
    }
    if (generationId && session.generationId !== generationId) return
    previewSessionRef.current = null
    if (session.timer !== null) clearTimeout(session.timer)
    session.timer = null
    session.commands.length = 0
    settlePreviewDrain(session, false)
    useMindMapViewStore.getState().clearGenerationPreview(session.generationId)
  }

  /**
   * Unmounting the panel is a cancellation boundary.  Invalidate the local
   * lease before a late provider promise can cross into apply/adopt, then ask
   * the host to abort the matching request on a best-effort basis.
   */
  const abandonGenerationLease = (): void => {
    const active = generationRef.current
    if (!active) {
      discardGenerationPreview()
      useMindMapViewStore.setState({ generating: false })
      generationPhaseRef.current = null
      return
    }
    generationTerminalRef.current = { generationId: active.generationId, step: 'cancelled' }
    generationRef.current = null
    generationPhaseRef.current = null
    discardGenerationPreview(active.generationId)
    // A panel can disappear while its provider promise is still pending (for
    // example when the learner leaves the editor). Do not leave the global
    // store stuck in a permanent generating state after the component's
    // cancellation boundary has run.
    useMindMapViewStore.setState({ generating: false, aiPrompt: active.prompt })
    try {
      void window.teachingSystem?.cancelMindMapGeneration({
        workspaceId: active.workspaceId,
        generationId: active.generationId
      })
    } catch {
      // Unmount cleanup is best-effort; the local lease is already invalidated.
    }
  }

  const scheduleGenerationPreviewReveal = (generationId: string): void => {
    const session = previewSessionRef.current
    if (!session || session.generationId !== generationId || session.timer !== null) return
    session.timer = setTimeout(() => {
      const active = previewSessionRef.current
      if (!active || active.generationId !== generationId) return
      active.timer = null
      if (generationRef.current?.generationId !== generationId) {
        discardGenerationPreview(generationId)
        return
      }
      const command = active.commands.shift()
      if (!command) {
        settlePreviewDrain(active, true)
        return
      }
      useMindMapViewStore.getState().revealGenerationPreviewCommand(generationId, command)
      if (active.commands.length > 0) {
        scheduleGenerationPreviewReveal(generationId)
      } else {
        settlePreviewDrain(active, true)
      }
    }, MIND_MAP_PREVIEW_REVEAL_INTERVAL_MS)
  }

  const enqueuePreviewItems = (
    generationId: string,
    items: readonly MindMapStreamedProposalItem[]
  ): void => {
    const session = previewSessionRef.current
    if (!session || session.generationId !== generationId) return
    for (const item of items) {
      if (session.admittedItemIds.has(item.id)) continue
      session.admittedItemIds.add(item.id)
      session.commands.push(...expandMindMapGenerationPreviewCommand(item.command))
    }
    if (session.commands.length > 0) scheduleGenerationPreviewReveal(generationId)
  }

  const appendPreviewStream = (generationId: string, delta: string): void => {
    const session = previewSessionRef.current
    if (!session || session.generationId !== generationId) return
    session.streamText += delta
    enqueuePreviewItems(
      generationId,
      newCompletedMindMapProposalItems(session.streamText, session.admittedItemIds)
    )
  }

  const beginGenerationPreview = (generationId: string): void => {
    if (!useMindMapViewStore.getState().startGenerationPreview(generationId)) return
    previewSessionRef.current = {
      generationId,
      streamText: '',
      admittedItemIds: new Set<string>(),
      commands: [],
      timer: null,
      drainWaiters: []
    }
  }

  const waitForPreviewQueue = (generationId: string): Promise<boolean> => {
    const session = previewSessionRef.current
    // No preview means the legacy full-document path is intentionally using its
    // existing final-document fallback, so it must not block canonical apply.
    if (!session || session.generationId !== generationId) return Promise.resolve(true)
    if (session.timer === null && session.commands.length === 0) return Promise.resolve(true)
    return new Promise((resolve) => {
      session.drainWaiters.push(resolve)
      scheduleGenerationPreviewReveal(generationId)
    })
  }

  useEffect(() => {
    if (!editingDocumentTitle) setDocumentTitleDraft(documentTitle)
  }, [documentTitle, editingDocumentTitle])

  useEffect(() => {
    if (!readOnly || !editingDocumentTitle) return
    setEditingDocumentTitle(false)
    setDocumentTitleDraft(documentTitle)
  }, [documentTitle, editingDocumentTitle, readOnly])

  useEffect(() => {
    if (editingDocumentTitle) documentTitleInputRef.current?.focus()
  }, [editingDocumentTitle])

  useEffect(() => {
    const api = window.teachingSystem
    const offChunk = api?.onMindMapStreamChunk
      ? api.onMindMapStreamChunk((chunk) => {
          if (generationRef.current?.generationId !== chunk.generationId) return
          useMindMapViewStore.setState((state) => ({
            streamText: state.streamText + chunk.delta
          }))
          appendPreviewStream(chunk.generationId, chunk.delta)
        })
      : () => undefined
    const offStatus = api?.onMindMapStreamStatus?.((status) => {
      if (generationRef.current?.generationId !== status.generationId) return
      if (status.step === 'error' || status.step === 'cancelled') {
        generationTerminalRef.current = { generationId: status.generationId, step: status.step }
        discardGenerationPreview(status.generationId)
      } else if (status.step === 'calling') {
        generationTerminalRef.current = null
      }
      setGenerationMessages((messages) => messages.map((message) => {
        if (message.generationId !== status.generationId) return message
        if (status.step === 'error' || status.step === 'cancelled') {
          return {
            ...message,
            status: status.step === 'cancelled' ? 'cancelled' : 'error'
          }
        }
        return {
          ...message,
          step: status.step
        }
      }))
    })
    const offAgentEvent = api?.onMindMapAgentEvent?.((event) => {
      if (generationRef.current?.generationId !== event.streamId) return
      setGenerationMessages((messages) => messages.map((message) => (
        message.generationId === event.streamId
          ? applyMindMapAgentEvent(message, event)
          : message
      )))
    })

    return () => {
      offChunk()
      offStatus?.()
      offAgentEvent?.()
      abandonGenerationLease()
    }
  }, [])

  const canSubmit = !generating && (aiPrompt.trim().length > 0 || hasDraftImages)

  /** Apply a provider diff to the open canvas immediately, without review. */
  const editCurrentCanvas = async (
    workspace: string,
    documentId: string,
    sheetId: string,
    prompt: string,
    generationId: string,
    imageAttachments?: AgentChatImageAttachment[]
  ): Promise<void> => {
    const generated = await window.teachingSystem?.generateMindMapProposal({
      workspaceId: workspace,
      id: documentId,
      scope: 'sheet',
      sheetId,
      selectedTopicIds: [],
      sourceRefs: [],
      prompt,
      ...(imageAttachments?.length ? { imageAttachments } : {}),
      generationId
    })
    if (!generated) throw new Error(t('mindmap.aiProposalUnavailable'))
    if (generated.documentId !== documentId) {
      throw new Error(t('mindmap.aiProposalDocumentMismatch'))
    }

    // A host-validated proposal is authoritative for completion. It also
    // fills any items whose final `}` arrived after the last renderer stream
    // event, while stable item ids keep already-queued streamed items unique.
    enqueuePreviewItems(generationId, generated.proposal.items)
    const previewDrained = await waitForPreviewQueue(generationId)
    if (!previewDrained || generationRef.current?.generationId !== generationId) return

    // Providers can legitimately signal that they found no useful edits with
    // an empty proposal. This is a no-op, not a failed schema/IPC boundary:
    // preserve the canonical document, do not enter the durable apply lane,
    // and make the result clear so the learner can refine or retry the prompt.
    if (generated.proposal.items.length === 0) {
      if (generationRef.current?.generationId !== generationId) return
      discardGenerationPreview(generationId)
      setGenerationMessages((messages) => messages.map((message) => (
        message.generationId === generationId
          ? {
              ...message,
              step: 'done',
              status: 'no_changes',
              notice: t('mindmap.aiNoChangesDetail')
            }
          : message
      )))
      return
    }

    // The provider proposal is read-only. Confirm the local generation lease
    // before crossing into the mutating apply lane, then expose that real
    // renderer-side boundary in the process transcript.
    if (generationRef.current?.generationId !== generationId) return
    generationPhaseRef.current = 'applying'
    setGenerationMessages((messages) => messages.map((message) => (
      message.generationId === generationId
        ? { ...message, step: 'applying' }
        : message
    )))

    // No approval step: every proposed item is accepted and applied directly.
    const decisions: Record<string, MindMapProposalDecision> = {}
    for (const item of generated.proposal.items) {
      decisions[item.id] = 'accept'
    }
    const targetPath = `mindmaps/${documentId}.json`
    const toolCall = {
      id: `${generationId}:edit:${documentId}`,
      name: 'edit_workspace_file',
      arguments: JSON.stringify({ path: targetPath })
    }
    const projectTool = (result?: string, isError?: boolean): void => {
      setGenerationMessages((messages) => messages.map((message) => (
        message.generationId === generationId
          ? applyMindMapToolProjection(message, {
              streamId: generationId,
              toolCall,
              ...(result !== undefined ? { result, isError } : {})
            })
          : message
      )))
    }
    projectTool()

    let applied: Extract<MindMapProposalApplyResult, { ok: true }>
    try {
      const result = await window.teachingSystem?.applyMindMapProposal({
        workspaceId: workspace,
        id: documentId,
        expectedRevision: generated.revision,
        proposal: generated.proposal,
        decisions
      })
      if (!result) throw new Error(t('mindmap.aiProposalUnavailable'))
      if (!result.ok) {
        if (result.code === 'revision_stale') {
          throw new Error(
            t('mindmap.aiProposalRevisionStale', {
              expected: result.expectedRevision,
              current: result.currentRevision
            })
          )
        }
        throw new Error(`${t('mindmap.aiProposalApplyError')}: ${result.error.message}`)
      }
      applied = result
      projectTool(JSON.stringify({ ok: true, path: targetPath, revision: applied.document.revision }), false)
    } catch (error) {
      projectTool(JSON.stringify({ ok: false, path: targetPath }), true)
      throw error
    }

    // A cancelled run must not adopt a late result.
    if (generationRef.current?.generationId !== generationId) return
    useMindMapViewStore.getState().adoptCommittedDocument(applied.document, {
      inverse: applied.inverse,
      label: t('mindmap.aiProposalUndoLabel')
    })
    discardGenerationPreview(generationId)
    setGenerationMessages((messages) => messages.map((message) => (
      message.generationId === generationId
        ? { ...message, step: 'done', status: 'completed' }
        : message
    )))
  }

  /** Fallback when no document is open yet: generate a brand-new document. */
  const generateNewDocument = async (
    workspace: string,
    prompt: string,
    generationId: string,
    imageAttachments?: AgentChatImageAttachment[]
  ): Promise<void> => {
    const generated = await window.teachingSystem?.generateMindMap({
      workspaceId: workspace,
      title: prompt.slice(0, 40) || 'AI 导图',
      prompt,
      ...(imageAttachments?.length ? { imageAttachments } : {}),
      generationId
    })
    // A provider may settle just after the user clicked cancel. Never adopt
    // a late result from a generation whose local cancellation lease ended.
    if (!generated && generationRef.current?.generationId === generationId) {
      throw new Error(t('mindmap.aiError'))
    }
    if (generated && generationRef.current?.generationId === generationId) {
      const rootId = generated.sheets[0]?.root.id ?? null
      useMindMapViewStore.setState({
        current: generated,
        selection: rootId ? { kind: 'topic', topicIds: [rootId] } : { kind: 'canvas' },
        selectedNodeId: rootId,
        activeSheetId: generated.sheets[0]?.id ?? null,
        streamText: '',
        aiPrompt: ''
      })
      setGenerationMessages((messages) => messages.map((message) => (
        message.generationId === generationId
          ? { ...message, step: 'done', status: 'completed' }
          : message
      )))
      void useMindMapViewStore.getState().loadDocuments()
    }
  }

  const runGeneration = async (
    prompt: string,
    imageAttachments?: AgentChatImageAttachment[]
  ): Promise<void> => {
    if (useMindMapViewStore.getState().generating) return
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (!workspace) return
    const generationId = crypto.randomUUID()
    const submittedPrompt = prompt.trim()
    const current = useMindMapViewStore.getState().current
    const sheetId = useMindMapViewStore.getState().activeSheetId ?? current?.sheets[0]?.id
    const createdAt = new Date().toISOString()
    generationRef.current = { workspaceId: workspace, generationId, prompt: submittedPrompt }
    generationPhaseRef.current = 'provider'
    generationTerminalRef.current = null
    if (current && sheetId) beginGenerationPreview(generationId)
    setGenerationMessages((messages) => [
      ...messages,
      {
        generationId,
        prompt: submittedPrompt,
        step: 'calling',
        status: 'generating',
        lastAgentSequence: 0,
        ...(imageAttachments?.length ? { imageAttachments } : {}),
        agentTurn: {
          id: `${generationId}:assistant`,
          role: 'assistant',
          content: '',
          processEvents: [],
          createdAt
        }
      }
    ])
    useMindMapViewStore.setState({ generating: true, streamText: '', error: null })
    try {
      if (current && sheetId) {
        await editCurrentCanvas(
          workspace,
          current.id,
          sheetId,
          submittedPrompt,
          generationId,
          imageAttachments
        )
      } else {
        await generateNewDocument(workspace, submittedPrompt, generationId, imageAttachments)
      }
    } catch (caught) {
      discardGenerationPreview(generationId)
      // A cancelled run is intentionally not an error panel; the user already
      // asked to stop it.
      if (generationRef.current?.generationId === generationId) {
        const currentDocumentWasRemoved = current
          ? isMissingCurrentMindMapDocumentError(caught, current.id)
          : false
        const message = currentDocumentWasRemoved
          ? t('mindmap.aiDocumentMissing')
          : mindMapGenerationErrorMessage(caught, t)
        const terminalStatus = terminalStepForGeneration(
          generationTerminalRef.current,
          generationId
        )
        setGenerationMessages((messages) => messages.map((entry) => (
          entry.generationId === generationId
            ? terminalStatus === 'cancelled'
              ? { ...entry, status: 'cancelled' }
              : { ...entry, status: 'error', error: message }
            : entry
        )))
        if (terminalStatus !== 'cancelled') {
          if (currentDocumentWasRemoved && current) {
            useMindMapViewStore.getState().discardMissingDocument(current.id, message)
            useMindMapViewStore.setState({ aiPrompt: submittedPrompt })
          } else {
            useMindMapViewStore.setState({ error: message, aiPrompt: submittedPrompt })
          }
        }
      }
    } finally {
      discardGenerationPreview(generationId)
      if (generationRef.current?.generationId === generationId) {
        generationRef.current = null
        generationPhaseRef.current = null
        useMindMapViewStore.setState({ generating: false })
      }
    }
  }

  const cancelGeneration = (): void => {
    const active = generationRef.current
    if (!active || generationPhaseRef.current === 'applying') return
    const { workspaceId, generationId, prompt } = active
    generationTerminalRef.current = { generationId, step: 'cancelled' }
    discardGenerationPreview(generationId)
    generationRef.current = null
    generationPhaseRef.current = null
    setGenerationMessages((messages) => messages.map((message) => (
      message.generationId === generationId
        ? { ...message, status: 'cancelled' }
        : message
    )))
    useMindMapViewStore.setState({ generating: false, aiPrompt: prompt })
    try {
      void window.teachingSystem?.cancelMindMapGeneration({ workspaceId, generationId })
    } catch {
      // Best-effort: the local generation promise settles independently and the
      // main process/provider abort is fire-and-forget from the renderer.
    }
  }

  const canCancelGeneration = generating && generationPhaseRef.current !== 'applying'

  const submitPrompt = (): void => {
    if (!canSubmit) return
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (!workspace) return
    // An image-only submission still needs a generation intent; mirror the
    // overview composer's default prompt so the provider sees the images.
    const prompt = aiPrompt.trim() || (hasDraftImages ? '请根据这些图片生成思维导图。' : '')
    if (!prompt) return
    const attachments = imageDrafts.transportAttachments()
    setAiPrompt('')
    imageDrafts.clear()
    void runGeneration(prompt, attachments)
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    submitPrompt()
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submitPrompt()
  }

  const retryGeneration = (prompt: string, imageAttachments?: AgentChatImageAttachment[]): void => {
    if (generating || !prompt.trim()) return
    setAiPrompt('')
    void runGeneration(prompt, imageAttachments)
  }

  const updateThreadStickiness = (): void => {
    const thread = threadRef.current
    if (!thread) return
    threadShouldStickRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24
  }

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    // During an in-flight generation the transcript is pinned to the bottom so
    // the latest process row and status stay visible without manual
    // scrolling (mirrors the overview conversation). Once idle, only follow new
    // content when the learner is already at the bottom, so reading older turns
    // is never fought.
    const shouldStick = threadShouldStickRef.current || generating
    if (!shouldStick) return
    thread.scrollTop = thread.scrollHeight
  }, [generationMessages, generating])

  const inspectorTab = useMindMapViewStore((s) => s.inspectorTab)
  const setInspectorTab = useMindMapViewStore((s) => s.setInspectorTab)

  const beginDocumentTitleEdit = (): void => {
    if (readOnly) return
    setDocumentTitleDraft(documentTitle)
    setEditingDocumentTitle(true)
  }

  const cancelDocumentTitleEdit = (): void => {
    setDocumentTitleDraft(documentTitle)
    setEditingDocumentTitle(false)
  }

  const commitDocumentTitleEdit = (): void => {
    const nextTitle = documentTitleDraft.trim()
    if (nextTitle && nextTitle !== documentTitle) onRenameDocument(nextTitle)
    cancelDocumentTitleEdit()
  }

  return (
    <aside className={`mindmap-ai-panel${open ? '' : ' is-collapsed'}`} aria-label={t('mindmap.inspector.title')}>
      <div className="mindmap-inspector-header">
        <input
          ref={documentTitleInputRef}
          className={`mindmap-inspector-title-input${editingDocumentTitle ? ' is-editing' : ''}`}
          value={editingDocumentTitle ? documentTitleDraft : documentTitle}
          readOnly={!editingDocumentTitle}
          onClick={() => {
            if (!editingDocumentTitle) beginDocumentTitleEdit()
          }}
          onChange={(event) => setDocumentTitleDraft(event.currentTarget.value)}
          onBlur={() => {
            if (editingDocumentTitle && !readOnly) commitDocumentTitleEdit()
          }}
          onKeyDown={(event) => {
            if (!editingDocumentTitle) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                beginDocumentTitleEdit()
              }
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelDocumentTitleEdit()
            } else if (event.key === 'Enter') {
              event.preventDefault()
              commitDocumentTitleEdit()
            }
          }}
          title={readOnly ? t('mindmap.aiStreaming') : t('mindmap.renameDocument')}
          aria-label={t('mindmap.renameDocument')}
          disabled={readOnly}
        />
        {utilityControl}
        {importExportControl}
        <button
          type="button"
          className="mindmap-ai-panel__collapse icon-button"
          onClick={onToggle}
          title={t('mindmap.inspector.title')}
          aria-label={t('mindmap.inspector.title')}
        >
          <PanelRightClose size={14} aria-hidden="true" />
        </button>
      </div>
      {utilityContent ? (
        <div className="mindmap-inspector-utility-content">
          {utilityContent}
        </div>
      ) : (
        <>
          <div className="mindmap-inspector-tabs" role="tablist" aria-label={t('mindmap.inspector.title')}>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'format'}
                className={`mindmap-inspector-tab${inspectorTab === 'format' ? ' is-active' : ''}`}
                onClick={() => setInspectorTab('format')}
              >
                {t('mindmap.inspector.format')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'content'}
                className={`mindmap-inspector-tab${inspectorTab === 'content' ? ' is-active' : ''}`}
                disabled={selection.kind !== 'topic' && selection.kind !== 'element' && selection.kind !== 'elements'}
                onClick={() => setInspectorTab('content')}
              >
                {t('mindmap.inspector.content')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'ai'}
                className={`mindmap-inspector-tab${inspectorTab === 'ai' ? ' is-active' : ''}`}
                onClick={() => setInspectorTab('ai')}
              >
                {t('mindmap.inspector.ai')}
              </button>
          </div>
          {inspectorTab === 'format' ? (
            <div className="mindmap-inspector-tab-content">
              <MindMapThemeGallery />
              <MindMapThemePanel />
              <MindMapCanvasOptionsPanel />
            </div>
          ) : inspectorTab === 'content' ? (
            <div className="mindmap-inspector-tab-content mindmap-inspector-tab-content--content">
              {selection.kind === 'topic' ? (
                <MindMapTopicStyleInspector />
              ) : selection.kind === 'element' || selection.kind === 'elements' || selection.kind === 'hybrid' ? (
                <MindMapElementStyleInspector />
              ) : (
                <div className="mindmap-inspector-empty" role="status">
                  {t('mindmap.inspector.contentTopicOnly')}
                </div>
              )}
            </div>
          ) : (
            <div className="mindmap-inspector-tab-content mindmap-inspector-tab-content--ai">
              <div className="mindmap-ai-panel__conversation overview-dialog-shell has-conversation">
                <div
                  ref={threadRef}
                  className="mindmap-ai-panel__thread overview-dialog-thread"
                  role="log"
                  aria-label={t('mindmap.inspector.ai')}
                  aria-live="off"
                  onScroll={updateThreadStickiness}
                >
                  <div className="mindmap-ai-panel__thread-inner overview-dialog-thread-inner">
                    {generationMessages.map((message) => {
                      const active = message.status === 'generating'
                      const presentation = buildAgentConversationPresentation({
                        turns: [message.agentTurn],
                        activeTurnId: active ? message.agentTurn.id : null
                      }).turns[0]
                      return (
                        <Fragment key={message.generationId}>
                          <AgentConversationMessageFrame
                            messageRole="user"
                            className="mindmap-ai-panel__message mindmap-ai-panel__message--user"
                          >
                            <MarkdownMessage content={message.prompt} tone="user" compact />
                            {message.imageAttachments?.length ? (
                              <AgentChatImageGallery attachments={message.imageAttachments} />
                            ) : null}
                          </AgentConversationMessageFrame>
                          <AgentConversationMessageFrame
                            messageRole="assistant"
                            className="mindmap-ai-panel__message mindmap-ai-panel__message--assistant"
                            // Keep the real last renderer lifecycle boundary for diagnostics;
                            // visible reasoning/text/tool rows come from the shared Agent turn.
                            data-stream-step={message.step}
                            data-generation-status={message.status}
                          >
                            <AgentConversationAssistantBody
                              content={message.agentTurn.content}
                              presentation={presentation}
                              compact
                            />
                            {message.error ? <p className="mindmap-ai-panel__message-error">{message.error}</p> : null}
                            {message.notice ? <p className="mindmap-ai-panel__message-notice">{message.notice}</p> : null}
                            {message.status === 'error' || message.status === 'no_changes' ? (
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => retryGeneration(message.prompt, message.imageAttachments)}
                                disabled={generating}
                              >
                                {t('mindmap.retry')}
                              </button>
                            ) : null}
                            {message.status === 'generating' || message.status === 'cancelled' ? (
                              <span className="mindmap-ai-panel__message-announcement" role="status" aria-live="polite">
                                {message.status === 'generating'
                                  ? t('mindmap.aiStreaming')
                                  : t('mindmap.aiStreamCancelled')}
                              </span>
                            ) : null}
                          </AgentConversationMessageFrame>
                        </Fragment>
                      )
                    })}

                    {error && generationMessages.length === 0 ? (
                      <div className="mindmap-ai-panel__error" role="alert">
                        <span>{t('mindmap.aiError')}</span>
                        <p>{error}</p>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => retryGeneration(aiPrompt.trim())}
                          disabled={generating || !aiPrompt.trim()}
                        >
                          {t('mindmap.retry')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <form className="mindmap-ai-panel__composer overview-dialog-stack" onSubmit={onSubmit}>
                  <div className="mindmap-ai-panel__composer-card overview-dialog-card">
                    <label className="mindmap-ai-panel__composer-label" htmlFor="mindmap-ai-prompt">
                      {t('mindmap.aiPromptLabel')}
                    </label>
                    <AgentChatImageFileInput
                      inputRef={imageDrafts.inputRef}
                      disabled={generating || readOnly}
                      onFiles={imageDrafts.handleFiles}
                    />
                    <textarea
                      id="mindmap-ai-prompt"
                      className="mindmap-ai-panel__input"
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.currentTarget.value)}
                      onPaste={imageDrafts.handlePaste}
                      onKeyDown={onComposerKeyDown}
                      placeholder={t('mindmap.aiPromptPlaceholder')}
                      rows={2}
                      disabled={generating}
                    />
                    <AgentChatImageAttachmentRail attachments={imageDrafts.attachments} onRemove={imageDrafts.remove} />
                    <AgentChatImageComposerError error={imageDrafts.error} />
                    <div className="mindmap-ai-panel__composer-footer">
                      <div className="mindmap-ai-panel__composer-actions">
                        <AgentChatImagePickerButton
                          disabled={generating || readOnly}
                          onClick={() => imageDrafts.inputRef.current?.click()}
                        />
                        <OverviewModelAndReasoningPicker />
                      </div>
                      {generating ? (
                        <button
                          type="button"
                          className="mindmap-ai-panel__send overview-dialog-send"
                          onClick={cancelGeneration}
                          disabled={!canCancelGeneration}
                          aria-label={t('mindmap.aiCancel')}
                          title={t('mindmap.aiCancel')}
                        >
                          <Square size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          className="mindmap-ai-panel__send overview-dialog-send"
                          disabled={!canSubmit}
                          aria-label={t('mindmap.aiGenerate')}
                          title={t('mindmap.aiGenerate')}
                        >
                          <SendHorizontal size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
