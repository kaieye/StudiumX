import {
  applyAgentChatChunkToPending,
  applyAgentChatStatusToPending,
  applyAgentChatToolEventToPending,
  cancelPendingAgentConversation,
  createAgentConversationTurnDraft,
  failPendingAgentConversation,
  finishPendingAgentConversationSave,
  reconcileAgentTurnsWithLocalProcess,
  type PendingAgentConversation
} from '../agent-conversation-state'
import type {
  AgentChatMode,
  AgentConversationTurnStartedRealtimeEvent,
  AgentConversationPromotedRealtimeEvent,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  AgentConversationLookupScope,
  AgentConversationSessionTree,
  AgentRealtimeDeliveryEvent,
  AgentRealtimeEvent,
  ConversationLaneKey,
  LessonSummary,
  TeachingAppState,
  TeachingSystemApi
} from '../../../shared/teaching-types'
import { AGENT_SESSION_BUSY_QUEUED_ACK } from '../../../shared/agent-session-busy-ack'
import {
  projectCompletedAgentConversationIntoAppState,
  projectSettledPendingAgentConversationIntoAppState
} from '../agent-conversation-projection'

/** Renderer-only mirror of follow-ups already accepted by the host lane. */
export type AgentBusyFollowUpItem = {
  /** Opaque host receipt correlation; never a message, transcript, or secret. */
  clientRequestId?: string
  /** Lane identity captured when host accepts the follow-up. */
  target?: ConversationLaneKey
  text: string
  mode?: AgentChatMode
  skillIds?: string[]
}

export type AgentConversationTurnRunnerState = {
  appState: TeachingAppState
  overviewDialogMode: string
  agentInput: string
  agentChatBusy: boolean
  agentBusyAckMessage: string | null
  /** UX mirror only. The host lane is the sole automatic FIFO drainer. */
  agentBusyFollowUpQueue: AgentBusyFollowUpItem[]
  agentStatus: string
  agentTurns: AgentChatTurn[]
  activeConversationId: string | null
  activeConversationScope: AgentConversationLookupScope | null
  activeConversationRevision: number | null
  activeSessionTree: AgentConversationSessionTree | null
  agentToolsSupported: boolean | null
  pendingAgentConversation: PendingAgentConversation | null
  selectedCourseRelativePath: string | null
  taskPrompt: string
}

export type AgentConversationTurnRunnerPatch<TError> = Partial<
  Pick<
    AgentConversationTurnRunnerState,
    | 'appState'
    | 'agentInput'
    | 'agentChatBusy'
    | 'agentBusyAckMessage'
    | 'agentBusyFollowUpQueue'
    | 'agentStatus'
    | 'agentTurns'
    | 'activeConversationId'
    | 'activeConversationScope'
    | 'activeConversationRevision'
    | 'activeSessionTree'
    | 'agentToolsSupported'
    | 'pendingAgentConversation'
    | 'taskPrompt'
  >
> & { error?: TError | null }

export type AgentConversationTurnRunnerApi = Pick<
  TeachingSystemApi,
  | 'submitConversationTurn'
  | 'cancelConversationTurn'
  | 'readAgentConversation'
  | 'readAgentConversationSessionTree'
  | 'getState'
> & Partial<Pick<TeachingSystemApi, 'onAgentChatEvent'>>

export type AgentConversationTurnRunnerDependencies<TError> = {
  getState: () => AgentConversationTurnRunnerState
  setState: (patch: AgentConversationTurnRunnerPatch<TError>) => void
  getApi: () => AgentConversationTurnRunnerApi | undefined
  toUserError: (error: unknown) => TError
  /** Retained for the app-shell seam; host settlement owns generated lesson effects. */
  onGeneratedLessons: (lessons: LessonSummary[]) => void
  onCompletedTurn?: (result: { runId: string; conversationId: string }) => void
  /** Refreshes canonical state after a failed CAS; it must never replay the stale request. */
  onRevisionConflict?: (input: { workspaceId: string; conversationId: string; scope: AgentConversationLookupScope }) => Promise<void>
  now?: () => string
  nextIdSeed?: () => number
  nextClientRequestId?: () => string
}

export type RunAgentConversationTurnOptions = {
  inputOverride?: string
  mode?: AgentChatMode
  skillIds?: string[]
}

type ActiveHostStream = {
  streamId: string
  activeTurnId: string
  pendingConversationId: string
  assistantId: string
  workspaceId: string
  mode: AgentChatMode
  target: ConversationLaneKey
  conversationId?: string
  settling?: boolean
}

function isConversationRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('conversation branch revision conflict')
}

function scopeForMode(mode: AgentChatMode): AgentConversationLookupScope {
  return mode === 'temporary' ? 'temporary' : 'workspace'
}

function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function rejectedMessage(reason: 'invalid_intent' | 'queue_full' | 'branch_unavailable'): string {
  if (reason === 'queue_full') return '当前对话队列已满，请稍后再试。'
  if (reason === 'branch_unavailable') return '当前对话分支不可用，请刷新后再试。'
  return '无法提交这条消息，请检查对话状态后再试。'
}

function cancelRejectedMessage(): string {
  return '无法取消当前对话，请稍后重试。'
}

function cancelRefreshMessage(): string {
  return '当前对话状态已变化，请刷新后再试。'
}

/**
 * Renderer projection for ADR-0170 host-submitted turns.
 *
 * The host owns execution, settlement, and FIFO draining. The renderer owns only
 * optimistic presentation and projection of host realtime events for streams it
 * was explicitly told about.
 */
export class AgentConversationTurnRunner<TError> {
  private unsubscribeRealtime: (() => void) | null = null
  private subscribedApi: AgentConversationTurnRunnerApi | null = null
  private submissionsInFlight = 0
  private readonly bufferedRealtimeEvents = new Map<string, AgentRealtimeEvent[]>()
  private activeHostStream: ActiveHostStream | null = null
  private activeTarget: ConversationLaneKey | null = null
  private activeExpectedBranchRevision: number | undefined
  private queuedProjectionSeed = 0
  /** Last settled host stream, used to reconcile a just-saved pending lane. */
  private settledStream: { streamId: string; pendingConversationId: string } | null = null

  constructor(private readonly dependencies: AgentConversationTurnRunnerDependencies<TError>) {}

  async run(options: RunAgentConversationTurnOptions = {}): Promise<void> {
    const api = this.dependencies.getApi()
    if (!api) return
    const initialState = this.dependencies.getState()
    const workspace = initialState.appState.activeWorkspace
    const input = (options.inputOverride ?? initialState.agentInput).trim()
    if (!workspace || !input) return

    const mode = this.resolveMode(initialState, options.mode)
    if (initialState.agentChatBusy) {
      await this.submitBusyFollowUp({ api, state: initialState, workspaceId: workspace.id, input, mode, skillIds: options.skillIds })
      return
    }

    await this.submitNewTurn({ api, state: initialState, workspaceId: workspace.id, input, mode, skillIds: options.skillIds })
  }

  async cancel(): Promise<void> {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    const active = this.activeHostStream
    if (!pending || !state.agentChatBusy || !active || pending.summary.id !== active.pendingConversationId) return

    const api = this.dependencies.getApi()
    if (!api) {
      this.setError(cancelRejectedMessage())
      return
    }

    try {
      const disposition = await api.cancelConversationTurn({
        target: active.target,
        clientRequestId: this.dependencies.nextClientRequestId?.() ?? createClientRequestId(),
        expectedActiveTurnId: active.activeTurnId
      })
      if (disposition.code !== 'cancelled') {
        this.setError(disposition.code === 'refresh_required' || disposition.code === 'duplicate'
          ? cancelRefreshMessage()
          : cancelRejectedMessage())
        return
      }

      // The host lane has accepted exact cancellation and cleared its exact
      // FIFO. Only now may the renderer reset its optimistic projection.
      this.activeHostStream = null
      this.activeTarget = null
      this.activeExpectedBranchRevision = undefined
      this.dependencies.setState({
        ...cancelPendingAgentConversation({
          pending,
          activeConversationId: state.activeConversationId,
          preserveToolsSupported: true
        })
      })
    } catch {
      // Transport errors are not cancellation confirmations. Keep the active
      // stream and local projection so a later terminal event still settles it.
      this.setError(cancelRejectedMessage())
    }
  }

  private async submitNewTurn(request: {
    api: AgentConversationTurnRunnerApi
    state: AgentConversationTurnRunnerState
    workspaceId: string
    input: string
    mode: AgentChatMode
    skillIds?: string[]
  }): Promise<void> {
    const { api, state, workspaceId, input, mode, skillIds } = request
    const activeConversationMode = state.activeConversationScope
      ? state.activeConversationScope === 'temporary' ? 'temporary' : 'teaching'
      : null
    const canContinueActiveConversation = Boolean(
      state.activeConversationId && (!activeConversationMode || activeConversationMode === mode)
    )
    const activeConversationId = canContinueActiveConversation ? state.activeConversationId : null
    const activeBranch = activeConversationId
      ? state.activeSessionTree?.branches.find((branch) => branch.conversationId === activeConversationId)
      : null
    if (activeBranch && activeBranch.status !== 'active') {
      this.setError('Archived or deleted conversation branches are read-only. Restore the branch before continuing.')
      return
    }

    const activeRevision = activeConversationId
      ? state.activeConversationRevision ?? activeBranch?.revision ?? null
      : null
    const persistedConversation = Boolean(activeConversationId && !activeConversationId.startsWith('pending-'))
    if (persistedConversation && (!Number.isSafeInteger(activeRevision) || (activeRevision ?? -1) < 0)) {
      this.setError('Conversation branch revision is unavailable. Reopen the branch before continuing.')
      return
    }

    const activePending = activeConversationId?.startsWith('pending-') && state.pendingAgentConversation?.summary.id === activeConversationId
      ? state.pendingAgentConversation
      : null
    const sourceConversationId = activePending?.sourceConversationId ?? activeConversationId
    const sourceConversationRevision = activePending?.sourceConversationRevision ?? activeRevision
    const draft = createAgentConversationTurnDraft({
      state: state.appState,
      workspace: state.appState.activeWorkspace!,
      input,
      mode,
      activeConversationId: sourceConversationId,
      activeConversationRevision: sourceConversationRevision,
      currentTurns: canContinueActiveConversation ? state.agentTurns : [],
      selectedCourseRelativePath: state.selectedCourseRelativePath,
      currentSelectedLessonPath: state.appState.selectedLessonPath,
      createdAt: this.dependencies.now?.() ?? new Date().toISOString(),
      idSeed: this.dependencies.nextIdSeed?.() ?? Date.now()
    })
    const target: ConversationLaneKey = draft.sourceConversationId
      ? { kind: 'canonical', workspaceId, scope: scopeForMode(mode), conversationId: draft.sourceConversationId }
      : { kind: 'pending', workspaceId, scope: scopeForMode(mode), pendingConversationId: draft.pendingConversationId }
    const expectedBranchRevision = target.kind === 'canonical' ? draft.pendingConversation.sourceConversationRevision ?? undefined : undefined

    this.dependencies.setState({
      agentChatBusy: true,
      agentInput: '',
      agentStatus: draft.pendingConversation.status,
      agentToolsSupported: null,
      agentTurns: draft.initialTurns,
      activeConversationId: draft.pendingConversationId,
      activeConversationScope: scopeForMode(mode),
      pendingAgentConversation: draft.pendingConversation
    })

    await this.submit({
      api,
      input,
      mode,
      skillIds,
      target,
      expectedBranchRevision,
      draft: { pendingConversationId: draft.pendingConversationId, assistantId: draft.assistantId, workspaceId, mode },
      restoreState: state
    })
  }

  private async submitBusyFollowUp(request: {
    api: AgentConversationTurnRunnerApi
    state: AgentConversationTurnRunnerState
    workspaceId: string
    input: string
    mode: AgentChatMode
    skillIds?: string[]
  }): Promise<void> {
    const { api, state, workspaceId, input: text, mode, skillIds } = request
    const pending = state.pendingAgentConversation
    const target = this.activeTarget ?? this.targetFromBusyState(state, workspaceId, mode)
    if (!target) {
      this.setError('Conversation state is unavailable. Please wait for the current turn to settle and try again.')
      return
    }
    const expectedBranchRevision = target.kind === 'canonical'
      ? this.activeExpectedBranchRevision ?? pending?.sourceConversationRevision ?? state.activeConversationRevision ?? undefined
      : undefined
    if (target.kind === 'canonical' && (!Number.isSafeInteger(expectedBranchRevision) || (expectedBranchRevision ?? -1) < 0)) {
      this.setError('Conversation branch revision is unavailable. Reopen the branch before continuing.')
      return
    }

    await this.submit({ api, input: text, mode, skillIds, target, expectedBranchRevision, restoreState: state, busyFollowUp: true })
  }

  private async submit(input: {
    api: AgentConversationTurnRunnerApi
    input: string
    mode: AgentChatMode
    skillIds?: string[]
    target: ConversationLaneKey
    expectedBranchRevision?: number
    draft?: Omit<ActiveHostStream, 'streamId' | 'activeTurnId' | 'target' | 'conversationId' | 'settling'>
    restoreState: AgentConversationTurnRunnerState
    busyFollowUp?: boolean
  }): Promise<void> {
    const { api, target } = input
    this.ensureRealtimeSubscription(api)
    this.submissionsInFlight += 1
    try {
      const clientRequestId = this.dependencies.nextClientRequestId?.() ?? createClientRequestId()
      const disposition = await api.submitConversationTurn({
        target,
        clientRequestId,
        text: input.input,
        mode: input.mode,
        delivery: 'follow_up',
        ...(input.expectedBranchRevision !== undefined ? { expectedBranchRevision: input.expectedBranchRevision } : {}),
        ...(input.skillIds?.length ? { skillIds: input.skillIds } : {})
      })
      await this.handleDisposition(input, disposition, clientRequestId)
    } catch (error) {
      if (target.kind === 'canonical' && isConversationRevisionConflict(error)) {
        await this.refreshAfterConflict(target, input.input)
      } else {
        this.restoreUnstarted(input.restoreState, input.input, error)
      }
    } finally {
      this.submissionsInFlight -= 1
      if (this.submissionsInFlight === 0) this.bufferedRealtimeEvents.clear()
    }
  }

  private async handleDisposition(
    input: Parameters<AgentConversationTurnRunner<TError>['submit']>[0],
    disposition: Awaited<ReturnType<AgentConversationTurnRunnerApi['submitConversationTurn']>>,
    clientRequestId: string
  ): Promise<void> {
    if (disposition.code === 'started' || disposition.code === 'steered') {
      if (!input.draft) {
        // A busy follow-up can be accepted as a new active turn only if the host
        // races completion. Keep current renderer projection intact rather than
        // fabricating a second local transcript without a returned draft identity.
        this.activeTarget = input.target
        this.activeExpectedBranchRevision = input.expectedBranchRevision
        return
      }
      const active: ActiveHostStream = {
        ...input.draft,
        streamId: disposition.streamId,
        activeTurnId: disposition.activeTurnId,
        target: input.target,
        ...(disposition.code === 'started' && disposition.conversationId ? { conversationId: disposition.conversationId } : {})
      }
      this.activeHostStream = active
      this.activeTarget = input.target
      this.activeExpectedBranchRevision = input.expectedBranchRevision
      this.bindRuntimeStreamId(active.pendingConversationId, active.streamId)
      this.flushBufferedEvents(active)
      return
    }

    if (disposition.code === 'queued') {
      this.acceptQueuedFollowUp({
        clientRequestId,
        target: input.target,
        text: input.input,
        mode: input.mode,
        skillIds: input.skillIds,
        restoreState: input.restoreState,
        wasAlreadyBusy: input.busyFollowUp === true
      })
      return
    }

    if (disposition.code === 'refresh_required') {
      if (input.target.kind === 'canonical') await this.refreshAfterConflict(input.target, input.input)
      else this.restoreUnstarted(input.restoreState, input.input, new Error('Conversation changed. Please refresh before sending again.'))
      return
    }

    if (disposition.code === 'rejected') {
      this.restoreUnstarted(input.restoreState, input.input, new Error(rejectedMessage(disposition.reason)))
      return
    }

    // Idempotency responses do not authorize a second local draft or queue entry.
    // For a recovered queued request, retain a neutral acknowledgement but do not
    // claim ownership of a host queue item we cannot identify.
    if (disposition.originalCode === 'queued') {
      this.dependencies.setState({ agentInput: '', agentBusyAckMessage: AGENT_SESSION_BUSY_QUEUED_ACK, error: null })
    }
  }

  private acceptQueuedFollowUp(input: {
    clientRequestId: string
    target: ConversationLaneKey
    text: string
    mode: AgentChatMode
    skillIds: string[] | undefined
    restoreState: AgentConversationTurnRunnerState
    wasAlreadyBusy: boolean
  }): void {
    const state = this.dependencies.getState()
    const queue = state.agentBusyFollowUpQueue ?? input.restoreState.agentBusyFollowUpQueue
    this.dependencies.setState({
      ...(!input.wasAlreadyBusy ? this.unstartedStatePatch(input.restoreState) : {}),
      agentBusyFollowUpQueue: [
        ...queue,
        {
          clientRequestId: input.clientRequestId,
          target: input.target,
          text: input.text,
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.skillIds?.length ? { skillIds: input.skillIds } : {})
        }
      ],
      agentBusyAckMessage: AGENT_SESSION_BUSY_QUEUED_ACK,
      agentInput: '',
      error: null
    })
  }

  private async refreshAfterConflict(target: Extract<ConversationLaneKey, { kind: 'canonical' }>, input: string): Promise<void> {
    await this.dependencies.onRevisionConflict?.({
      workspaceId: target.workspaceId,
      conversationId: target.conversationId,
      scope: target.scope
    })
    this.activeHostStream = null
    this.activeTarget = null
    this.activeExpectedBranchRevision = undefined
    // Do not automatically replay: a fresh canonical read is required before the
    // learner explicitly sends the preserved text again.
    this.dependencies.setState({ agentInput: input, error: null, agentChatBusy: false })
  }

  private restoreUnstarted(state: AgentConversationTurnRunnerState, input: string, error: unknown): void {
    this.activeHostStream = null
    this.activeTarget = null
    this.activeExpectedBranchRevision = undefined
    this.dependencies.setState({ ...this.unstartedStatePatch(state), agentInput: input, error: this.dependencies.toUserError(error) })
  }

  private unstartedStatePatch(state: AgentConversationTurnRunnerState): AgentConversationTurnRunnerPatch<TError> {
    return {
      agentChatBusy: state.agentChatBusy,
      agentStatus: state.agentStatus,
      agentTurns: state.agentTurns,
      activeConversationId: state.activeConversationId,
      activeConversationScope: state.activeConversationScope,
      activeConversationRevision: state.activeConversationRevision,
      activeSessionTree: state.activeSessionTree,
      agentToolsSupported: state.agentToolsSupported,
      pendingAgentConversation: state.pendingAgentConversation
    }
  }

  private targetFromBusyState(
    state: AgentConversationTurnRunnerState,
    workspaceId: string,
    mode: AgentChatMode
  ): ConversationLaneKey | null {
    const pending = state.pendingAgentConversation
    if (pending?.sourceConversationId) {
      return { kind: 'canonical', workspaceId, scope: scopeForMode(mode), conversationId: pending.sourceConversationId }
    }
    if (pending) {
      return { kind: 'pending', workspaceId, scope: scopeForMode(mode), pendingConversationId: pending.summary.id }
    }
    if (state.activeConversationId && !state.activeConversationId.startsWith('pending-')) {
      return { kind: 'canonical', workspaceId, scope: scopeForMode(mode), conversationId: state.activeConversationId }
    }
    return null
  }

  private resolveMode(state: AgentConversationTurnRunnerState, requested: AgentChatMode | undefined): AgentChatMode {
    if (requested) return requested
    if (state.activeConversationId && !state.activeConversationId.startsWith('pending-')) {
      return state.activeConversationScope === 'temporary' ? 'temporary' : 'teaching'
    }
    return state.overviewDialogMode === 'teaching' ? 'teaching' : 'temporary'
  }

  private ensureRealtimeSubscription(api: AgentConversationTurnRunnerApi): void {
    if (this.subscribedApi === api && this.unsubscribeRealtime) return
    if (this.unsubscribeRealtime) this.unsubscribeRealtime()
    this.unsubscribeRealtime = null
    this.subscribedApi = api
    const subscribe = api.onAgentChatEvent
    if (typeof subscribe !== 'function') return
    this.unsubscribeRealtime = subscribe((event) => this.receiveRealtimeEvent(event))
  }

  private receiveRealtimeEvent(event: AgentRealtimeDeliveryEvent): void {
    if (event.kind === 'conversation_turn_started') {
      this.activateQueuedHostStream(event)
      return
    }
    if (event.kind === 'conversation_promoted') {
      void this.reconcilePromotedConversation(event)
      return
    }
    const active = this.activeHostStream
    if (active?.streamId === event.streamId) {
      this.projectRealtimeEvent(active, event)
      return
    }
    // The invoke disposition can arrive after a started event. Buffer only in
    // that narrow window; never retain or project unrelated global events.
    if (this.submissionsInFlight > 0) {
      const events = this.bufferedRealtimeEvents.get(event.streamId) ?? []
      if (events.length < 128) events.push(event)
      this.bufferedRealtimeEvents.set(event.streamId, events)
    }
  }

  /**
   * Reconciles a pending temporary conversation after the host promotes its
   * pending lane to a canonical conversation id. The terminal outcome normally
   * settles the renderer draft first (into the no-conversationId branch) because
   * the terminal is published before the first save; this lifecycle event arrives
   * after the save and carries the definitive id. It points the active projection
   * at the saved temporary conversation so a completed answer is not dropped or
   * deferred to the next user turn.
   */
  private async reconcilePromotedConversation(event: AgentConversationPromotedRealtimeEvent): Promise<void> {
    const active = this.activeHostStream
    const owned = Boolean(
      (active && active.streamId === event.streamId) ||
      (this.settledStream && this.settledStream.streamId === event.streamId)
    )
    if (!owned) return
    if (active && active.streamId === event.streamId && active.conversationId !== event.conversationId) {
      active.conversationId = event.conversationId
    }
    const state = this.dependencies.getState()
    // Only reconcile a still-pending draft the renderer owns. If the learner has
    // already moved to another conversation, leave the active projection alone.
    if (!state.activeConversationId?.startsWith('pending-') && !(active && active.streamId === event.streamId)) return
    const api = this.dependencies.getApi()
    const appStateResult = await api?.getState()
    if (!appStateResult) return
    const current = this.dependencies.getState()
    const conversation = appStateResult.temporaryConversations.find((item) => item.id === event.conversationId)
    if (!conversation) return
    this.dependencies.setState({
      ...(current.appState !== appStateResult ? { appState: appStateResult } : {}),
      activeConversationId: event.conversationId,
      activeConversationScope: 'temporary',
      activeConversationRevision: conversation.branch?.revision ?? 0,
      pendingAgentConversation: null,
      agentChatBusy: false,
      agentStatus: ''
    })
  }

  private activateQueuedHostStream(event: AgentConversationTurnStartedRealtimeEvent): void {
    const state = this.dependencies.getState()
    const queue = state.agentBusyFollowUpQueue ?? []
    const queuedIndex = queue.findIndex((item) => item.clientRequestId === event.clientRequestId)
    if (queuedIndex < 0) return

    const queued = queue[queuedIndex]!
    const workspace = state.appState.activeWorkspace
    if (!workspace || workspace.id !== queued.target?.workspaceId) return

    // Use an empty prefix unless this renderer is already showing exactly the
    // canonical conversation the host named. A queued renderer can be distinct
    // from the current stream owner; importing an arbitrary local transcript
    // would fabricate a branch projection. Host remains the only saver.
    const matchingCanonicalConversationId = event.conversationId ?? (
      queued.target?.kind === 'canonical' ? queued.target.conversationId : undefined
    )
    const visibleConversationId = state.activeConversationId
    const canUseVisiblePrefix = Boolean(
      matchingCanonicalConversationId &&
      visibleConversationId === matchingCanonicalConversationId &&
      !visibleConversationId.startsWith('pending-')
    )
    const mode = queued.mode ?? (queued.target?.scope === 'temporary' ? 'temporary' : 'teaching')
    const draft = createAgentConversationTurnDraft({
      state: state.appState,
      workspace,
      input: queued.text,
      mode,
      activeConversationId: canUseVisiblePrefix ? matchingCanonicalConversationId! : null,
      activeConversationRevision: canUseVisiblePrefix ? state.activeConversationRevision : null,
      currentTurns: canUseVisiblePrefix ? state.agentTurns : [],
      selectedCourseRelativePath: state.selectedCourseRelativePath,
      currentSelectedLessonPath: state.appState.selectedLessonPath,
      createdAt: this.dependencies.now?.() ?? new Date().toISOString(),
      // Do not collide with a directly-started draft that used the same test or
      // clock seed. This identity is renderer-local projection only.
      idSeed: (this.dependencies.nextIdSeed?.() ?? Date.now()) + ++this.queuedProjectionSeed
    })
    // A pending lane may have been atomically promoted before its queued
    // reservation starts. The host's lifecycle event is the authoritative
    // correlation: when it names a canonical conversation, cancellation must
    // use that exact canonical lane rather than the stale renderer pending key.
    const target = event.conversationId
      ? {
          kind: 'canonical' as const,
          workspaceId: workspace.id,
          scope: scopeForMode(mode),
          conversationId: event.conversationId
        }
      : queued.target ?? (matchingCanonicalConversationId
        ? { kind: 'canonical' as const, workspaceId: workspace.id, scope: scopeForMode(mode), conversationId: matchingCanonicalConversationId }
        : null)
    if (!target) return

    const active: ActiveHostStream = {
      pendingConversationId: draft.pendingConversationId,
      assistantId: draft.assistantId,
      workspaceId: workspace.id,
      mode,
      target,
      streamId: event.streamId,
      activeTurnId: event.activeTurnId,
      ...(event.conversationId ? { conversationId: event.conversationId } : {})
    }
    this.activeHostStream = active
    this.activeTarget = target
    this.activeExpectedBranchRevision = undefined
    this.dependencies.setState({
      agentChatBusy: true,
      agentStatus: draft.pendingConversation.status,
      agentToolsSupported: null,
      agentTurns: draft.initialTurns,
      activeConversationId: draft.pendingConversationId,
      activeConversationScope: scopeForMode(mode),
      pendingAgentConversation: { ...draft.pendingConversation, runtimeStreamId: event.streamId },
      agentBusyFollowUpQueue: queue.filter((_, index) => index !== queuedIndex),
      agentBusyAckMessage: null,
      error: null
    })
    this.flushBufferedEvents(active)
  }

  /**
   * The renderer projects host events into a local pending draft id, but tool
   * replies are resolved by the host's runtime stream id. Keep both identities
   * explicit so an Ask card cannot send its answer to the renderer-only draft.
   */
  private bindRuntimeStreamId(pendingConversationId: string, runtimeStreamId: string): void {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || pending.summary.id !== pendingConversationId || pending.runtimeStreamId === runtimeStreamId) return
    this.dependencies.setState({
      pendingAgentConversation: { ...pending, runtimeStreamId }
    })
  }

  private flushBufferedEvents(active: ActiveHostStream): void {
    const events = this.bufferedRealtimeEvents.get(active.streamId) ?? []
    this.bufferedRealtimeEvents.delete(active.streamId)
    for (const event of events) this.projectRealtimeEvent(active, event)
  }

  private projectRealtimeEvent(active: ActiveHostStream, event: AgentRealtimeEvent): void {
    if (this.activeHostStream?.streamId !== active.streamId) return
    if (event.kind === 'chunk') {
      this.applyChunk(active.assistantId, { ...event.payload, streamId: active.pendingConversationId })
      return
    }
    if (event.kind === 'status') {
      this.applyStatus(active.assistantId, { ...event.payload, streamId: active.pendingConversationId })
      return
    }
    if (event.kind === 'tool') {
      this.applyToolEvent(active.assistantId, { ...event.payload, streamId: active.pendingConversationId })
      return
    }
    if (active.settling) return
    active.settling = true
    void this.finishHostStream(active, event)
  }

  private async finishHostStream(active: ActiveHostStream, event: Extract<AgentRealtimeEvent, { kind: 'terminal' }>): Promise<void> {
    if (this.activeHostStream?.streamId !== active.streamId) return
    this.settledStream = { streamId: active.streamId, pendingConversationId: active.pendingConversationId }
    this.activeHostStream = null
    this.activeTarget = null
    this.activeExpectedBranchRevision = undefined
    if (event.outcome === 'canceled') {
      this.finishCanceled(active.pendingConversationId)
      return
    }
    if (event.outcome === 'error') {
      const state = this.dependencies.getState()
      const pending = state.pendingAgentConversation
      if (!pending || pending.summary.id !== active.pendingConversationId) return
      if (isConversationRevisionConflict(event.message ?? '')) {
        if (active.target.kind === 'canonical') await this.refreshAfterConflict(active.target, pending.turns.at(-2)?.content ?? '')
        return
      }
      this.dependencies.setState({
        error: this.dependencies.toUserError(new Error(event.message ?? 'The conversation could not be completed.')),
        ...failPendingAgentConversation({
          pending,
          activeConversationId: state.activeConversationId,
          assistantId: active.assistantId,
          message: event.message ?? 'The conversation could not be completed.'
        }),
        agentChatBusy: false
      })
      return
    }
    if (event.outcome === 'resource_limit' || event.outcome === 'suspended' || event.outcome === 'no_progress' || event.outcome === 'context_unrecoverable' || event.outcome === 'retry_exhausted') {
      const state = this.dependencies.getState()
      const pending = state.pendingAgentConversation
      if (!pending || pending.summary.id !== active.pendingConversationId) return
      // A resource/retry terminal is not a completed turn. Keep the optimistic
      // transcript visible and require explicit user input for continuation.
      const status = event.outcome === 'resource_limit'
        ? '已达到明确资源边界'
        : event.outcome === 'suspended'
          ? '运行已暂停'
          : event.outcome === 'context_unrecoverable'
            ? '上下文无法安全压缩；请开始新的明确对话，或选择更大的 context window'
            : event.outcome === 'no_progress'
              ? '重复操作未产生安全进展；未自动重试或重放'
              : '自动重试已耗尽，未自动继续请求'
      this.dependencies.setState({
        pendingAgentConversation: { ...pending, status },
        agentStatus: status,
        agentChatBusy: false
      })
      return
    }
    await this.refreshCompletedHostTurn(active)
  }

  private async refreshCompletedHostTurn(active: ActiveHostStream): Promise<void> {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || pending.summary.id !== active.pendingConversationId) return
    const conversationId = active.conversationId ?? (active.target.kind === 'canonical' ? active.target.conversationId : undefined)
    const api = this.dependencies.getApi()
    const [conversationResult, treeResult, appStateResult] = await Promise.allSettled([
      conversationId
        ? api?.readAgentConversation({ workspaceId: active.workspaceId, conversationId, scope: scopeForMode(active.mode) })
        : undefined,
      conversationId
        ? api?.readAgentConversationSessionTree({ workspaceId: active.workspaceId, conversationId, scope: scopeForMode(active.mode) })
        : undefined,
      api?.getState()
    ])
    const conversation = conversationResult.status === 'fulfilled' ? conversationResult.value : undefined
    const tree = treeResult.status === 'fulfilled' ? treeResult.value : undefined
    const appState = appStateResult.status === 'fulfilled' ? appStateResult.value : undefined
    const current = this.dependencies.getState()
    if (current.pendingAgentConversation?.summary.id !== active.pendingConversationId) return

    const refreshedAppState = appState ?? current.appState
    const reconciledAppState = conversation
      ? projectCompletedAgentConversationIntoAppState({
          appState: refreshedAppState,
          workspaceId: active.workspaceId,
          conversation
        })
      : conversationId
        ? projectSettledPendingAgentConversationIntoAppState({
            appState: refreshedAppState,
            pendingAgentConversation: pending,
            savedConversationId: conversationId
          })
        : appState

    if (conversation && tree) {
      const branch = tree.branches.find((item) => item.conversationId === conversation.id)
      this.dependencies.setState({
        ...(reconciledAppState ? { appState: reconciledAppState } : {}),
        activeConversationScope: scopeForMode(active.mode),
        activeConversationRevision: conversation.branch?.revision ?? branch?.revision ?? current.activeConversationRevision,
        activeSessionTree: tree,
        ...finishPendingAgentConversationSave({
          pending,
          activeConversationId: current.activeConversationId,
          savedConversationId: conversation.id,
          turns: reconcileAgentTurnsWithLocalProcess(conversation.turns, pending.turns),
          toolsSupported: pending.toolsSupported
        }),
        agentChatBusy: false
      })
      this.dependencies.onCompletedTurn?.({ runId: active.streamId, conversationId: conversation.id })
      return
    }

    // A terminal event is authoritative even when the just-written transcript or
    // session tree is briefly unavailable. Refresh the workspace catalog when
    // possible (so generated lessons appear), clear the renderer-only pending
    // marker, and retain the completed local projection without re-saving it.
    if (!conversationId) {
      this.dependencies.setState({
        ...(appState ? { appState } : {}),
        pendingAgentConversation: null,
        agentChatBusy: false,
        agentStatus: current.activeConversationId === pending.summary.id ? '' : '完成'
      })
      return
    }
    this.dependencies.setState({
      ...(reconciledAppState ? { appState: reconciledAppState } : {}),
      activeConversationScope: scopeForMode(active.mode),
      ...finishPendingAgentConversationSave({
        pending,
        activeConversationId: current.activeConversationId,
        savedConversationId: conversationId,
        turns: pending.turns,
        toolsSupported: pending.toolsSupported
      }),
      agentChatBusy: false
    })
  }

  private finishCanceled(pendingConversationId: string): void {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || pending.summary.id !== pendingConversationId) return
    this.dependencies.setState(cancelPendingAgentConversation({ pending, activeConversationId: state.activeConversationId }))
  }

  private applyChunk(assistantId: string, chunk: AgentChatStreamChunk): void {
    const state = this.dependencies.getState()
    const patch = applyAgentChatChunkToPending({ pending: state.pendingAgentConversation, activeConversationId: state.activeConversationId, assistantId, chunk })
    if (patch) this.dependencies.setState(patch)
  }

  private applyStatus(assistantId: string, status: AgentChatStreamStatus): void {
    const state = this.dependencies.getState()
    const patch = applyAgentChatStatusToPending({ pending: state.pendingAgentConversation, activeConversationId: state.activeConversationId, assistantId, status })
    if (patch) this.dependencies.setState(patch)
  }

  private applyToolEvent(assistantId: string, event: AgentChatStreamToolEvent): void {
    const state = this.dependencies.getState()
    const patch = applyAgentChatToolEventToPending({ pending: state.pendingAgentConversation, activeConversationId: state.activeConversationId, assistantId, event })
    if (patch) this.dependencies.setState(patch)
  }

  private setError(message: string): void {
    this.dependencies.setState({ error: this.dependencies.toUserError(new Error(message)) })
  }
}
