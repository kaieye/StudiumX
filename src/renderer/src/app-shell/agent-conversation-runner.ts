import {
  applyAgentChatChunkToPending,
  applyAgentChatStatusToPending,
  applyAgentChatToolEventToPending,
  cancelPendingAgentConversation,
  createAgentConversationTurnDraft,
  failPendingAgentConversation,
  finishPendingAgentConversationSave,
  reconcileAgentTurnsWithLocalProcess,
  syncPendingAgentConversation,
  type PendingAgentConversation
} from '../agent-conversation-state'
import type {
  AgentChatMode,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentChatTurn,
  AgentConversationLookupScope,
  AgentConversationSessionTree,
  AgentProjectionInvalidation,
  LessonSummary,
  TeachingAppState,
  TeachingSystemApi
} from '../../../shared/teaching-types'
import {
  AGENT_BUSY_FOLLOW_UP_QUEUE_HARD_CAP,
  AGENT_SESSION_BUSY_QUEUED_ACK
} from '../../../shared/agent-session-busy-ack'

/** Local busy follow-up item (renderer queue; default policy = queue, never silent drop). */
export type AgentBusyFollowUpItem = {
  text: string
  mode?: AgentChatMode
  skillIds?: string[]
}

export type AgentConversationTurnRunnerState = {
  appState: TeachingAppState
  overviewDialogMode: string
  agentInput: string
  agentChatBusy: boolean
  /** Closed-copy busy-ack banner while a follow-up is queued (B-12). */
  agentBusyAckMessage: string | null
  /** FIFO follow-ups accepted while a turn is busy (hard-capped). */
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
> & {
  error?: TError | null
}

export type AgentConversationTurnRunnerApi = Pick<
  TeachingSystemApi,
  | 'agentChatStream'
  | 'cancelAgentChatStream'
  | 'saveAgentConversation'
  | 'readAgentConversationSessionTree'
  /** Rebuilds workspace catalog projections (courses/sessions/sidebar) from durable index. */
  | 'getState'
>

export type AgentConversationTurnRunnerDependencies<TError> = {
  getState: () => AgentConversationTurnRunnerState
  setState: (patch: AgentConversationTurnRunnerPatch<TError>) => void
  getApi: () => AgentConversationTurnRunnerApi | undefined
  toUserError: (error: unknown) => TError
  onGeneratedLessons: (lessons: LessonSummary[]) => void
  onCompletedTurn?: (result: { runId: string; conversationId: string }) => void
  now?: () => string
  nextIdSeed?: () => number
}

export type RunAgentConversationTurnOptions = {
  inputOverride?: string
  mode?: AgentChatMode
  skillIds?: string[]
}

/**
 * Runs one Agent conversation turn behind a single seam.
 *
 * The caller only supplies live store access plus adapters for IPC, error
 * presentation, and generated-lesson effects. Draft construction, streaming
 * projection, durable reconciliation, cancellation, and failure cleanup stay
 * local to this module.
 */
export class AgentConversationTurnRunner<TError> {
  constructor(private readonly dependencies: AgentConversationTurnRunnerDependencies<TError>) {}

  async run(options: RunAgentConversationTurnOptions = {}): Promise<void> {
    const api = this.dependencies.getApi()
    if (!api) return

    const initialState = this.dependencies.getState()
    const workspace = initialState.appState.activeWorkspace
    const input = (options.inputOverride ?? initialState.agentInput).trim()
    if (!workspace || !input) return

    // B-12: busy default is queue (never silent drop). Local FIFO + closed-copy ack banner.
    if (initialState.agentChatBusy) {
      this.enqueueBusyFollowUp({
        text: input,
        mode: options.mode,
        skillIds: options.skillIds,
        // Always clear composer on accept — caller may have passed inputOverride while
        // leaving store.agentInput populated (OverviewChat temporary path).
        clearComposerInput: true
      })
      return
    }

    await this.executeTurn(options)
    await this.drainBusyFollowUpQueue()
  }

  /**
   * Accept a follow-up while a turn is in flight. Does not start a second stream.
   */
  private enqueueBusyFollowUp(item: {
    text: string
    mode?: AgentChatMode
    skillIds?: string[]
    clearComposerInput: boolean
  }): void {
    const state = this.dependencies.getState()
    const queue = state.agentBusyFollowUpQueue ?? []
    if (queue.length >= AGENT_BUSY_FOLLOW_UP_QUEUE_HARD_CAP) {
      this.dependencies.setState({
        agentBusyAckMessage: `队列已满（最多 ${AGENT_BUSY_FOLLOW_UP_QUEUE_HARD_CAP} 条），请等待当前回合结束后再试。`,
        ...(item.clearComposerInput ? { agentInput: '' } : {})
      })
      return
    }
    this.dependencies.setState({
      agentBusyFollowUpQueue: [
        ...queue,
        {
          text: item.text,
          ...(item.mode ? { mode: item.mode } : {}),
          ...(item.skillIds?.length ? { skillIds: item.skillIds } : {})
        }
      ],
      agentBusyAckMessage: AGENT_SESSION_BUSY_QUEUED_ACK,
      ...(item.clearComposerInput ? { agentInput: '' } : {})
    })
  }

  /**
   * After the live turn settles, drain queued follow-ups FIFO (one stream at a time).
   * Cancel clears the queue, so this is a no-op after cancel.
   */
  private async drainBusyFollowUpQueue(): Promise<void> {
    for (;;) {
      const state = this.dependencies.getState()
      if (state.agentChatBusy) return
      const queue = state.agentBusyFollowUpQueue ?? []
      if (queue.length === 0) {
        if (state.agentBusyAckMessage) {
          this.dependencies.setState({ agentBusyAckMessage: null })
        }
        return
      }
      const [next, ...rest] = queue
      this.dependencies.setState({
        agentBusyFollowUpQueue: rest,
        agentBusyAckMessage: rest.length > 0 ? AGENT_SESSION_BUSY_QUEUED_ACK : null
      })
      await this.executeTurn({
        inputOverride: next.text,
        mode: next.mode,
        skillIds: next.skillIds
      })
    }
  }

  private async executeTurn(options: RunAgentConversationTurnOptions = {}): Promise<void> {
    const api = this.dependencies.getApi()
    if (!api) return

    const initialState = this.dependencies.getState()
    const workspace = initialState.appState.activeWorkspace
    const input = (options.inputOverride ?? initialState.agentInput).trim()
    // Re-check: concurrent enqueue should not start a second stream.
    if (!workspace || !input || initialState.agentChatBusy) return

    const activeConversationMode = initialState.activeConversationScope
      ? initialState.activeConversationScope === 'temporary' ? 'temporary' : 'teaching'
      : null
    const hasPersistedConversation = Boolean(
      initialState.activeConversationId && !initialState.activeConversationId.startsWith('pending-')
    )
    const mode = options.mode
      ?? (hasPersistedConversation && activeConversationMode
        ? activeConversationMode
        : initialState.overviewDialogMode === 'teaching' ? 'teaching' : 'temporary')
    // A conversation belongs to exactly one storage scope. Switching between
    // temporary chat and teaching mode must start a fresh conversation rather
    // than trying to continue the old id in the other scope.
    const canContinueActiveConversation = Boolean(
      initialState.activeConversationId &&
      (!activeConversationMode || activeConversationMode === mode)
    )
    const activeConversationId = canContinueActiveConversation ? initialState.activeConversationId : null
    const activeBranch = activeConversationId
      ? initialState.activeSessionTree?.branches.find(
          (branch) => branch.conversationId === activeConversationId
        )
      : null
    if (activeBranch && activeBranch.status !== 'active') {
      this.dependencies.setState({
        error: this.dependencies.toUserError(
          new Error('Archived or deleted conversation branches are read-only. Restore the branch before continuing.')
        )
      })
      return
    }
    const activeBranchRevision = activeConversationId
      ? initialState.activeConversationRevision ?? activeBranch?.revision ?? null
      : null
    const continuingPersistedBranch = Boolean(
      activeConversationId && !activeConversationId.startsWith('pending-')
    )
    if (continuingPersistedBranch && (!Number.isSafeInteger(activeBranchRevision) || (activeBranchRevision ?? -1) < 0)) {
      this.dependencies.setState({
        error: this.dependencies.toUserError(
          new Error('Conversation branch revision is unavailable. Reopen the branch before continuing.')
        )
      })
      return
    }

    const activePending = activeConversationId?.startsWith('pending-')
      && initialState.pendingAgentConversation?.summary.id === activeConversationId
      ? initialState.pendingAgentConversation
      : null
    const sourceConversationId = activePending?.sourceConversationId ?? activeConversationId
    const sourceConversationRevision = activePending?.sourceConversationRevision ?? activeBranchRevision
    const draft = createAgentConversationTurnDraft({
      state: initialState.appState,
      workspace,
      input,
      mode,
      activeConversationId: sourceConversationId,
      activeConversationRevision: sourceConversationRevision,
      currentTurns: canContinueActiveConversation ? initialState.agentTurns : [],
      selectedCourseRelativePath: initialState.selectedCourseRelativePath,
      currentSelectedLessonPath: initialState.appState.selectedLessonPath,
      createdAt: this.dependencies.now?.() ?? new Date().toISOString(),
      idSeed: this.dependencies.nextIdSeed?.() ?? Date.now()
    })
    const {
      pendingConversationId,
      selectedCourseRelativePath,
      selectedLessonPath,
      assistantId,
      priorMessages,
      priorMessageTurnIds,
      initialTurns,
      pendingConversation
    } = draft

    this.dependencies.setState({
      agentChatBusy: true,
      agentInput: '',
      agentStatus: pendingConversation.status,
      agentToolsSupported: null,
      agentTurns: initialTurns,
      activeConversationId: pendingConversationId,
      activeConversationScope: mode === 'temporary' ? 'temporary' : 'workspace',
      pendingAgentConversation: pendingConversation
    })

    try {
      const done = await api.agentChatStream(
        {
          streamId: pendingConversationId,
          conversationId: pendingConversation.sourceConversationId ?? undefined,
          workspaceId: workspace.id,
          expectedBranchRevision: pendingConversation.sourceConversationRevision ?? undefined,
          mode,
          messages: priorMessages,
          ...(priorMessageTurnIds.length ? { messageTurnIds: priorMessageTurnIds } : {}),
          userInput: input,
          ...(options.skillIds?.length ? { skillIds: options.skillIds } : {})
        },
        (chunk) => this.applyChunk(assistantId, chunk),
        (status) => this.applyStatus(assistantId, status),
        (event) => this.applyToolEvent(assistantId, event),
        (invalidation) => this.applyInvalidation(assistantId, invalidation)
      )

      if ('canceled' in done) {
        this.finishCanceled(pendingConversationId)
        return
      }

      if ('error' in done && done.error) {
        await this.failAndSave({
          api,
          workspaceId: workspace.id,
          mode,
          pendingConversationId,
          assistantId,
          selectedCourseRelativePath,
          selectedLessonPath,
          error: new Error(done.message)
        })
        return
      }

      if (!('error' in done)) {
        await this.saveCompletedTurn({
          api,
          workspaceId: workspace.id,
          mode,
          pendingConversationId,
          selectedCourseRelativePath,
          selectedLessonPath,
          done
        })
      }
    } catch (error) {
      await this.failAndSave({
        api,
        workspaceId: workspace.id,
        mode,
        pendingConversationId,
        assistantId,
        selectedCourseRelativePath,
        selectedLessonPath,
        error
      })
    }
  }

  async cancel(): Promise<void> {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || !state.agentChatBusy) return

    this.dependencies.setState({
      ...cancelPendingAgentConversation({
        pending,
        activeConversationId: state.activeConversationId,
        preserveToolsSupported: true
      }),
      // Cancel drops queued follow-ups (same as main-process clearOnCancel).
      agentBusyFollowUpQueue: [],
      agentBusyAckMessage: null
    })
    await this.dependencies.getApi()?.cancelAgentChatStream(pending.summary.id).catch(() => undefined)
  }

  private applyChunk(assistantId: string, chunk: AgentChatStreamChunk): void {
    const state = this.dependencies.getState()
    const patch = applyAgentChatChunkToPending({
      pending: state.pendingAgentConversation,
      activeConversationId: state.activeConversationId,
      assistantId,
      chunk
    })
    if (patch) this.dependencies.setState(patch)
  }

  private applyStatus(assistantId: string, status: AgentChatStreamStatus): void {
    const state = this.dependencies.getState()
    const patch = applyAgentChatStatusToPending({
      pending: state.pendingAgentConversation,
      activeConversationId: state.activeConversationId,
      assistantId,
      status
    })
    if (patch) this.dependencies.setState(patch)
  }

  private applyToolEvent(assistantId: string, event: AgentChatStreamToolEvent): void {
    const state = this.dependencies.getState()
    const patch = applyAgentChatToolEventToPending({
      pending: state.pendingAgentConversation,
      activeConversationId: state.activeConversationId,
      assistantId,
      event
    })
    if (patch) this.dependencies.setState(patch)
  }

  private applyInvalidation(assistantId: string, invalidation: AgentProjectionInvalidation): void {
    const message = invalidation.reason === 'replay_gap'
      ? '实时事件回放不完整；当前过程视图已标记失效，完成后将以保存的对话结果为准。'
      : '实时事件回放已不可用；当前过程视图已标记失效，应用不会据此自动重跑。'
    this.applyStatus(assistantId, { streamId: invalidation.streamId, status: 'error', message })
  }

  private finishCanceled(pendingConversationId: string): void {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || pending.summary.id !== pendingConversationId) return
    this.dependencies.setState({
      ...cancelPendingAgentConversation({
        pending,
        activeConversationId: state.activeConversationId
      }),
      agentBusyFollowUpQueue: [],
      agentBusyAckMessage: null
    })
  }

  private async failAndSave({
    api,
    workspaceId,
    mode,
    pendingConversationId,
    assistantId,
    selectedCourseRelativePath,
    selectedLessonPath,
    error
  }: {
    api: AgentConversationTurnRunnerApi
    workspaceId: string
    mode: AgentChatMode
    pendingConversationId: string
    assistantId: string
    selectedCourseRelativePath: string | null
    selectedLessonPath: string | null
    error: unknown
  }): Promise<void> {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || pending.summary.id !== pendingConversationId) return
    const message = error instanceof Error ? error.message : String(error)
    this.dependencies.setState({
      error: this.dependencies.toUserError(error),
      ...failPendingAgentConversation({
        pending,
        activeConversationId: state.activeConversationId,
        assistantId,
        message
      })
    })

    const failedState = this.dependencies.getState()
    const failedPending = failedState.pendingAgentConversation
    if (!failedPending || failedPending.summary.id !== pendingConversationId) return

    try {
      // Failed runs do not have a confirmed parent-turn stage, so they must be
      // saved as an ordinary transcript rather than promoted with the run id.
      const saved = await api.saveAgentConversation({
        workspaceId,
        mode,
        conversationId: failedPending.sourceConversationId ?? null,
        expectedBranchRevision: failedPending.sourceConversationRevision ?? undefined,
        selectedLessonPath,
        selectedCourseRelativePath,
        turns: failedPending.turns
      })
      let sessionTree: AgentConversationSessionTree | null = null
      try {
        sessionTree = await api.readAgentConversationSessionTree({
          workspaceId,
          conversationId: saved.conversation.id,
          scope: mode === 'temporary' ? 'temporary' : 'workspace'
        })
      } catch {
        // The catalog and transcript are already durable. A tree refresh can be
        // recovered the next time the conversation is opened.
      }
      const latestState = this.dependencies.getState()
      const pendingIsVisible = latestState.activeConversationId === pendingConversationId
        && latestState.pendingAgentConversation?.summary.id === pendingConversationId
      this.dependencies.setState({
        appState: saved.state,
        ...(pendingIsVisible
          ? {
              activeConversationScope: mode === 'temporary' ? 'temporary' : 'workspace',
              activeConversationRevision: saved.conversation.branch?.revision
                ?? (failedPending.sourceConversationRevision === null
                  ? 1
                  : failedPending.sourceConversationRevision + 1),
              activeSessionTree: sessionTree
            }
          : {}),
        ...finishPendingAgentConversationSave({
          pending: failedPending,
          activeConversationId: latestState.activeConversationId,
          savedConversationId: saved.conversation.id,
          turns: failedPending.turns,
          toolsSupported: failedPending.toolsSupported
        })
      })
    } catch {
      // Keep the failed transcript in memory when durable storage is itself
      // unavailable. The original generation error remains the user-facing one.
    } finally {
      const latestState = this.dependencies.getState()
      if (latestState.pendingAgentConversation?.summary.id === pendingConversationId) {
        const visiblePatch = latestState.activeConversationId === pendingConversationId
          ? { agentStatus: '' }
          : {}
        this.dependencies.setState({ agentChatBusy: false, ...visiblePatch })
      }
    }
  }

  /**
   * Lesson files and `.studiumx/index.json` become durable as soon as
   * `generate_lesson` succeeds. Conversation save can still fail (e.g. parent-turn
   * digest mismatch). Rebuild appState from the main-process catalog so the
   * course sidebar reflects new sessions without waiting on transcript save.
   */
  private async refreshAppStateAfterGeneratedLessons(
    api: AgentConversationTurnRunnerApi
  ): Promise<void> {
    try {
      const state = await api.getState()
      this.dependencies.setState({ appState: state })
    } catch {
      // Best-effort only: lesson artifacts remain on disk and can appear after reload.
    }
  }

  private async saveCompletedTurn({
    api,
    workspaceId,
    mode,
    pendingConversationId,
    selectedCourseRelativePath,
    selectedLessonPath,
    done
  }: {
    api: AgentConversationTurnRunnerApi
    workspaceId: string
    mode: AgentChatMode
    pendingConversationId: string
    selectedCourseRelativePath: string | null
    selectedLessonPath: string | null
    done: Exclude<Awaited<ReturnType<AgentConversationTurnRunnerApi['agentChatStream']>>, { canceled: true } | { error: true }>
  }): Promise<void> {
    const beforeSave = this.dependencies.getState()
    const pending = beforeSave.pendingAgentConversation
    if (!pending || pending.summary.id !== pendingConversationId) return

    const latestUserTurn = [...done.turns].reverse().find((turn) => turn.role === 'user')
    const reconciledTurns = reconcileAgentTurnsWithLocalProcess(done.turns, pending.turns)
    const savePatch = syncPendingAgentConversation({
      pending,
      pendingConversationId,
      activeConversationId: beforeSave.activeConversationId,
      patch: {
        turns: reconciledTurns,
        status: '保存对话…',
        toolsSupported: done.toolsSupported
      }
    })
    if (savePatch) this.dependencies.setState(savePatch)
    this.dependencies.setState({
      taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : beforeSave.taskPrompt
    })

    // Refresh catalog before durable conversation save so sidebar lessons appear
    // even when save later rejects or the app exits mid-save.
    if (done.generatedLessons?.length) {
      await this.refreshAppStateAfterGeneratedLessons(api)
    }

    try {
      const saved = await api.saveAgentConversation({
        workspaceId,
        runId: pendingConversationId,
        mode,
        conversationId: pending.sourceConversationId ?? null,
        expectedBranchRevision: pending.sourceConversationRevision ?? undefined,
        selectedLessonPath,
        selectedCourseRelativePath,
        turns: reconciledTurns
      })
      let sessionTree: AgentConversationSessionTree | null = null
      let treeError: unknown = null
      try {
        sessionTree = await api.readAgentConversationSessionTree({
          workspaceId,
          conversationId: saved.conversation.id,
          scope: mode === 'temporary' ? 'temporary' : 'workspace'
        })
      } catch (error) {
        treeError = error
      }
      const latestState = this.dependencies.getState()
      const pendingIsVisible = latestState.activeConversationId === pendingConversationId
        && latestState.pendingAgentConversation?.summary.id === pendingConversationId
      this.dependencies.setState({
        appState: saved.state,
        ...(pendingIsVisible
          ? {
              activeConversationScope: mode === 'temporary' ? 'temporary' : 'workspace',
              activeConversationRevision: saved.conversation.branch?.revision
                ?? (pending.sourceConversationRevision === null ? 1 : pending.sourceConversationRevision + 1),
              activeSessionTree: sessionTree
            }
          : {}),
        // Navigation that happened while saving owns the visible branch context,
        // but the now-durable pending draft must still be retired globally.
        ...finishPendingAgentConversationSave({
          pending,
          activeConversationId: latestState.activeConversationId,
          savedConversationId: saved.conversation.id,
          turns: reconciledTurns,
          toolsSupported: done.toolsSupported
        })
      })
      this.dependencies.onCompletedTurn?.({
        runId: pendingConversationId,
        conversationId: saved.conversation.id
      })
      if (treeError) this.dependencies.setState({ error: this.dependencies.toUserError(treeError) })
      if (done.generatedLessons?.length) this.dependencies.onGeneratedLessons(done.generatedLessons)
    } catch (error) {
      // Lesson files may already be durable even when conversation save rejects.
      // Keep surfacing the save error, re-attempt catalog refresh (in case the
      // pre-save refresh raced a late index write), and still hand generated
      // lessons to the UI for open/notification effects.
      if (done.generatedLessons?.length) {
        await this.refreshAppStateAfterGeneratedLessons(api)
        this.dependencies.onGeneratedLessons(done.generatedLessons)
      }
      this.dependencies.setState({ error: this.dependencies.toUserError(error) })
    } finally {
      const stateAfterSave = this.dependencies.getState()
      if (
        stateAfterSave.pendingAgentConversation?.summary.id &&
        stateAfterSave.pendingAgentConversation.summary.id !== pendingConversationId
      ) return
      const visiblePatch = stateAfterSave.activeConversationId === pendingConversationId
        ? { agentStatus: '' }
        : {}
      this.dependencies.setState({ agentChatBusy: false, ...visiblePatch })
    }
  }
}
