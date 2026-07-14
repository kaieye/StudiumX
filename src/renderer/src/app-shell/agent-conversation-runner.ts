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

export type AgentConversationTurnRunnerState = {
  appState: TeachingAppState
  overviewDialogMode: string
  agentInput: string
  agentChatBusy: boolean
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
  'agentChatStream' | 'cancelAgentChatStream' | 'saveAgentConversation' | 'readAgentConversationSessionTree'
>

export type AgentConversationTurnRunnerDependencies<TError> = {
  getState: () => AgentConversationTurnRunnerState
  setState: (patch: AgentConversationTurnRunnerPatch<TError>) => void
  getApi: () => AgentConversationTurnRunnerApi | undefined
  toUserError: (error: unknown) => TError
  onGeneratedLessons: (lessons: LessonSummary[]) => void
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
    if (!workspace || !input || initialState.agentChatBusy) return

    const activeBranch = initialState.activeConversationId
      ? initialState.activeSessionTree?.branches.find(
          (branch) => branch.conversationId === initialState.activeConversationId
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
    const activeBranchRevision = initialState.activeConversationRevision ?? activeBranch?.revision ?? null
    const continuingPersistedBranch = Boolean(
      initialState.activeConversationId && !initialState.activeConversationId.startsWith('pending-')
    )
    if (continuingPersistedBranch && (!Number.isSafeInteger(activeBranchRevision) || (activeBranchRevision ?? -1) < 0)) {
      this.dependencies.setState({
        error: this.dependencies.toUserError(
          new Error('Conversation branch revision is unavailable. Reopen the branch before continuing.')
        )
      })
      return
    }

    const mode = options.mode
      ?? (continuingPersistedBranch && initialState.activeConversationScope
        ? initialState.activeConversationScope === 'temporary' ? 'temporary' : 'teaching'
        : initialState.overviewDialogMode === 'teaching' ? 'teaching' : 'temporary')
    const draft = createAgentConversationTurnDraft({
      state: initialState.appState,
      workspace,
      input,
      mode,
      activeConversationId: initialState.activeConversationId,
      activeConversationRevision: activeBranchRevision,
      currentTurns: initialState.agentTurns,
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
        this.fail(pendingConversationId, assistantId, new Error(done.message))
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
      this.fail(pendingConversationId, assistantId, error)
    }
  }

  async cancel(): Promise<void> {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || !state.agentChatBusy) return

    this.dependencies.setState(cancelPendingAgentConversation({
      pending,
      activeConversationId: state.activeConversationId,
      preserveToolsSupported: true
    }))
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
    this.dependencies.setState(cancelPendingAgentConversation({
      pending,
      activeConversationId: state.activeConversationId
    }))
  }

  private fail(pendingConversationId: string, assistantId: string, error: unknown): void {
    const state = this.dependencies.getState()
    const pending = state.pendingAgentConversation
    if (!pending || pending.summary.id !== pendingConversationId) return
    this.dependencies.setState({
      error: this.dependencies.toUserError(error),
      ...failPendingAgentConversation({
        pending,
        activeConversationId: state.activeConversationId,
        assistantId
      })
    })
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
      if (pendingIsVisible) {
        this.dependencies.setState({
          appState: saved.state,
          activeConversationScope: mode === 'temporary' ? 'temporary' : 'workspace',
          activeConversationRevision: saved.conversation.branch?.revision
            ?? (pending.sourceConversationRevision === null ? 1 : pending.sourceConversationRevision + 1),
          activeSessionTree: sessionTree,
          ...finishPendingAgentConversationSave({
            pending,
            activeConversationId: latestState.activeConversationId,
            savedConversationId: saved.conversation.id,
            turns: reconciledTurns,
            toolsSupported: done.toolsSupported
          })
        })
      } else {
        // Navigation that happened while the save/tree refresh was in flight owns
        // the visible branch context, revision, and tree. Only merge the catalog.
        this.dependencies.setState({ appState: saved.state })
      }
      if (treeError) this.dependencies.setState({ error: this.dependencies.toUserError(treeError) })
      if (done.generatedLessons?.length) this.dependencies.onGeneratedLessons(done.generatedLessons)
    } catch (error) {
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
