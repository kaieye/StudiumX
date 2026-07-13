import { create } from 'zustand'
import { classifyExternalDestination } from '../../../shared/external-destination'
import i18n from '../i18n'
import { initialWorkspaceViewFromUrl } from '../study-space'
import {
  applySettingsSideEffects,
  emptySettings,
  normalizeRendererSettings,
  runtimeProviderLabel
} from '../workflows/settings'
import {
  activeTeachingConversationSummary,
  agentTurnsToMessages,
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
import {
  activateWorkspaceContext,
  clearAgentConversationContext,
  clearMarkdownDocumentContext,
  clearRemovedWorkspaceContext,
  courseRelativePathForFile,
  lessonToCoursePreviewFile,
  openAgentConversationContext,
  openLessonLibrary as openLessonLibraryContext,
  openLessonReaderContext,
  openPrimaryView,
  openResourceReaderContext,
  openTeachingConversation,
  openWorkspaceTeaching,
  restorePendingConversationContext,
  selectCourseFolderContext,
  type CoursePreviewFile,
  type DialogMode,
  type ResourcePreviewFile
} from './contextTransitions'
import { type LessonStyleId } from '../../../shared/lesson-styles'
import { deriveWorkspaceRemovalUiPatch } from '../../../shared/workspace-removal-state'
import {
  operationFeedback,
  type OperationFeedback,
  type OperationFeedbackError,
  type OperationFeedbackNotificationSettings,
  type OperationNotificationIntent
} from './operationFeedback'
import {
  type AgentChatMessage,
  type AgentChatStreamChunk,
  type AgentChatStreamStatus,
  type AgentChatStreamToolEvent,
  type AgentProjectionInvalidation,
  type AgentChatMode,
  type AgentChatTurn,
  type CreateTeachingMemoryPayload,
  type LessonStreamChunk,
  type LessonSummary,
  type InterruptedAgentRun,
  type ListUpstreamModelsResult,
  type ProgressSummary,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type RemoveTeachingGitWorktreePayload,
  type ReviewCard,
  type SettingsSection,
  type TeachingGitBranchesResult,
  type TeachingGitWorktreesResult,
  type TeachingMemoryDiagnostics,
  type TeachingMemoryRecord,
  type TeachingAppState,
  type TeachingRuntimeState,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type UpdateTeachingMemoryPayload,
  type WorkspaceMarkdownDocument,
  type WorkspaceItemKind,
  type WorkspaceItemRemoveMode,
  type WorkspaceView
} from '../../../shared/teaching-types'
import {
  appendStreamingPreview,
  beginLessonGeneration,
  directLessonDonePatch,
  effectsForAgentGeneratedLessons,
  effectsForGeneratedLesson,
  failLessonGeneration,
  failStreamingLessonGeneration,
  lessonGenerationDefaultRuntime,
  streamedLessonDonePatch,
  suggestedCourseName,
  updateStreamingStatus,
  type LessonGenerationNotificationIntent
} from './lessonGenerationFlow'

export type UserError = OperationFeedbackError

export type { CoursePreviewFile, DialogMode, ResourcePreviewFile } from './contextTransitions'
export { lessonToCoursePreviewFile } from './contextTransitions'

type LessonGenerationOptions = {
  prompt?: string
  messages?: AgentChatMessage[]
}

export type StoreState = {
  view: WorkspaceView
  settingsSection: SettingsSection
  sidebarCollapsed: boolean
  loading: boolean
  generating: boolean
  error: UserError | null
  searchQuery: string
  taskPrompt: string
  overviewDialogMode: DialogMode
  lessonReaderOpen: boolean
  selectedCoursePreviewFile: CoursePreviewFile | null
  selectedResourcePreviewFile: ResourcePreviewFile | null
  selectedMarkdownDocument: WorkspaceMarkdownDocument | null
  markdownDraft: string
  markdownSaving: boolean
  selectedCourseRelativePath: string | null
  selectedCourseWorkspaceId: string | null
  appState: TeachingAppState
  settings: TeachingSettingsV1
  setView: (view: WorkspaceView) => void
  setOverviewDialogMode: (mode: DialogMode) => void
  openLessonLibrary: () => void
  openTeachingConversationView: () => void
  openWorkspaceTeachingMode: () => void
  selectCourseFolder: (relativePath: string | null, workspaceId?: string | null) => void
  setSettingsSection: (section: SettingsSection) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  openSettings: (section?: SettingsSection) => void
  setSearchQuery: (query: string) => void
  setTaskPrompt: (prompt: string) => void
  clearError: () => void
  initialize: () => Promise<void>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  pickDefaultRoot: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: () => Promise<void>
  importWorkspace: () => Promise<boolean>
  importWorkspacePath: (rootPath: string) => Promise<boolean>
  updateMission: () => Promise<void>
  applyLessonStyle: (styleId: LessonStyleId) => Promise<void>
  generateLesson: (options?: LessonGenerationOptions) => Promise<void>
  generateLessonStream: (options?: LessonGenerationOptions) => Promise<void>
  loadLesson: (lesson: LessonSummary) => Promise<void>
  loadCourseHtmlFile: (file: CoursePreviewFile) => Promise<void>
  loadWorkspaceMarkdownFile: (file: CoursePreviewFile, workspaceId?: string | null) => Promise<void>
  setMarkdownDraft: (content: string) => void
  saveMarkdownDocument: () => Promise<void>
  openResourceHtmlPreview: (file: ResourcePreviewFile) => void
  closeResourceHtmlPreview: () => void
  openPath: (path: string) => Promise<void>
  openImportLocation: (path?: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  showNotification: (title: string, body: string) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  listGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  removeGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  listMemory: (workspaceRoot?: string) => Promise<void>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  loadMemoryDiagnostics: () => Promise<void>
  loadReviewCards: () => Promise<void>
  recordProgress: (lessonId: string, results: Array<{ lessonId: string; question: string; correct: boolean }>) => Promise<void>
  reviewCards: ReviewCard[]
  progress: ProgressSummary | null
  memoryRecords: TeachingMemoryRecord[]
  memoryDiagnostics: TeachingMemoryDiagnostics | null
  agentTurns: AgentChatTurn[]
  activeConversationId: string | null
  agentChatBusy: boolean
  agentStatus: string
  agentInput: string
  agentInputHistory: string[]
  agentToolsSupported: boolean | null
  pendingAgentConversation: PendingAgentConversation | null
  gitBranchesRoot: string
  gitBranchesResult: TeachingGitBranchesResult | null
  gitBranchesLoading: boolean
  setAgentInput: (input: string) => void
  rememberAgentInput: (input: string) => void
  clearAgentChat: () => void
  cancelAgentChat: () => Promise<void>
  restorePendingAgentConversation: () => void
  loadGitBranches: (workspaceRoot: string, options?: { force?: boolean }) => Promise<void>
  setGitBranchesResult: (workspaceRoot: string, result: TeachingGitBranchesResult) => void
  loadAgentConversation: (conversationId: string, workspaceId?: string | null) => Promise<void>
  agentChat: (inputOverride?: string, options?: { mode?: AgentChatMode; skillIds?: string[] }) => Promise<void>
  setWorkspaceItemMeta: (payload: { workspaceId?: string | null; relativePath: string; pinned?: boolean | null; archived?: boolean | null }) => Promise<void>
  removeWorkspaceItem: (payload: { workspaceId?: string | null; relativePath: string; kind: WorkspaceItemKind; mode?: WorkspaceItemRemoveMode }) => Promise<void>
  removeWorkspace: (payload: { workspaceId: string; mode?: WorkspaceItemRemoveMode }) => Promise<void>
}


// ================================================================
// Defaults
// ================================================================

const defaultRuntime: TeachingRuntimeState = lessonGenerationDefaultRuntime

const emptyAppState: TeachingAppState = {
  workspaces: [],
  activeWorkspace: null,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: defaultRuntime,
  recentChangeSummary: null,
  changeHistory: []
}

const defaultPrompt = ''

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

// ================================================================
// Operation feedback seam
// ================================================================

function operationFeedbackTranslate(key: string, interpolation?: Record<string, unknown>): string {
  return i18n.t(key, interpolation)
}

function notificationSettings(settings: TeachingSettingsV1): OperationFeedbackNotificationSettings {
  return {
    enabled: settings.notifications.enabled,
    errors: settings.notifications.errors,
    lessonGenerated: settings.notifications.lessonGenerated,
    workspaceImported: settings.notifications.workspaceImported
  }
}

function deliverOperationNotification(
  notification: OperationNotificationIntent,
  deliver: (title: string, body: string) => Promise<void>
): void {
  if (notification.kind === 'workspace-imported') {
    void deliver(
      i18n.t('notify.imported.title'),
      i18n.t('notify.imported.body', { name: notification.workspaceName })
    )
    return
  }
  if (notification.kind === 'workspace-import-failed') {
    void deliver(i18n.t('notify.importFailed.title'), notification.message)
    return
  }
  if (notification.kind === 'lesson-generation-failed') {
    void deliver(i18n.t('notify.generateFailed.title'), notification.message)
    return
  }
  const suffix = notification.source === 'fallback'
    ? (notification.reason
        ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: notification.reason })
        : i18n.t('notify.lessonGenerated.fallbackNoReason'))
    : ''
  void deliver(
    i18n.t('notify.lessonGenerated.title'),
    i18n.t('notify.lessonGenerated.body', {
      title: notification.title,
      path: notification.path,
      suffix
    })
  )
}

function deliverOperationFeedback(
  feedback: OperationFeedback,
  deliver: (title: string, body: string) => Promise<void>
): void {
  if (feedback.notification) deliverOperationNotification(feedback.notification, deliver)
}

export function toUserError(error: unknown): UserError {
  const feedback = operationFeedback({
    outcome: 'failure',
    error,
    translate: operationFeedbackTranslate
  })
  if (!feedback.visibleError) throw new Error('Operation feedback must classify failures.')
  return feedback.visibleError
}

// ================================================================
// Zustand Store
// ================================================================

const AGENT_INPUT_HISTORY_STORAGE_KEY = 'studiumx:agent-input-history'
const LEGACY_AGENT_INPUT_HISTORY_STORAGE_KEY = 'teachos:agent-input-history'
const MAX_AGENT_INPUT_HISTORY = 20

function appendAgentInputHistory(history: string[], input: string): string[] {
  const value = input.trim()
  if (!value) return history
  const withoutCurrent = history.filter((item) => item !== value)
  return [...withoutCurrent, value].slice(-MAX_AGENT_INPUT_HISTORY)
}

export function mergeAgentInputHistory(...sources: Array<string[] | undefined>): string[] {
  return sources.flat().reduce<string[]>((history, input) => appendAgentInputHistory(history, input ?? ''), [])
}

function normalizeAgentInputHistory(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.reduce<string[]>((history, item) => {
    if (typeof item !== 'string') return history
    return appendAgentInputHistory(history, item)
  }, [])
}

function readPersistedAgentInputHistory(): string[] {
  try {
    const stored =
      window.localStorage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_AGENT_INPUT_HISTORY_STORAGE_KEY)
    if (!stored) return []
    const history = normalizeAgentInputHistory(JSON.parse(stored))
    window.localStorage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(history))
    return history
  } catch {
    return []
  }
}

function persistAgentInputHistory(history: string[]): void {
  try {
    window.localStorage.setItem(
      AGENT_INPUT_HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_AGENT_INPUT_HISTORY))
    )
  } catch {
    // Input history is a convenience feature; storage failures should not block sending.
  }
}

function lessonEffectSettings(settings: TeachingSettingsV1) {
  return {
    autoOpenGeneratedLesson: settings.workspace.autoOpenGeneratedLesson,
    notificationsEnabled: settings.notifications.enabled,
    lessonGeneratedNotifications: settings.notifications.lessonGenerated
  }
}

function lessonGeneratedNotificationBody(intent: LessonGenerationNotificationIntent): string {
  const suffix = intent.source === 'fallback'
    ? (intent.reason
        ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: intent.reason })
        : i18n.t('notify.lessonGenerated.fallbackNoReason'))
    : ''
  return i18n.t('notify.lessonGenerated.body', { title: intent.title, path: intent.path, suffix })
}

export const useAppStore = create<StoreState>((set, get) => ({
  view: initialWorkspaceViewFromUrl(),
  settingsSection: 'general',
  sidebarCollapsed: false,
  loading: true,
  generating: false,
  error: null,
  searchQuery: '',
  taskPrompt: defaultPrompt,
  overviewDialogMode: 'chat',
  lessonReaderOpen: false,
  selectedCoursePreviewFile: null,
  selectedResourcePreviewFile: null,
  selectedMarkdownDocument: null,
  markdownDraft: '',
  markdownSaving: false,
  selectedCourseRelativePath: null,
  selectedCourseWorkspaceId: null,
  appState: emptyAppState,
  settings: emptySettings,
  reviewCards: [],
  progress: null,
  memoryRecords: [],
  memoryDiagnostics: null,
  agentTurns: [],
  activeConversationId: null,
  agentChatBusy: false,
  agentStatus: '',
  agentInput: '',
  agentInputHistory: readPersistedAgentInputHistory(),
  agentToolsSupported: null,
  pendingAgentConversation: null,
  gitBranchesRoot: '',
  gitBranchesResult: null,
  gitBranchesLoading: false,
  setAgentInput: (agentInput) => set({ agentInput }),
  rememberAgentInput: (input) => {
    const nextHistory = appendAgentInputHistory(get().agentInputHistory, input)
    set({ agentInputHistory: nextHistory })
    persistAgentInputHistory(nextHistory)
  },
  clearAgentChat: () => {
    if (get().agentChatBusy && get().pendingAgentConversation) {
      set({ agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null })
      return
    }
    set({ agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null })
  },
  cancelAgentChat: async () => {
    const api = window.teachingSystem
    const pending = get().pendingAgentConversation
    if (!pending || !get().agentChatBusy) return
    set(cancelPendingAgentConversation({
      pending,
      activeConversationId: get().activeConversationId,
      preserveToolsSupported: true
    }))
    await api?.cancelAgentChatStream(pending.summary.id).catch(() => undefined)
  },
  restorePendingAgentConversation: () => {
    const pending = get().pendingAgentConversation
    if (!pending) return
    set(restorePendingConversationContext(pending, get().overviewDialogMode))
  },
  loadGitBranches: async (workspaceRoot, options) => {
    const root = workspaceRoot.trim()
    const api = window.teachingSystem
    if (!root || !api) {
      set({ gitBranchesRoot: '', gitBranchesResult: null, gitBranchesLoading: false })
      return
    }
    const current = get()
    if (!options?.force && current.gitBranchesRoot === root && (current.gitBranchesResult || current.gitBranchesLoading)) return

    set({
      gitBranchesRoot: root,
      gitBranchesLoading: true,
      ...(current.gitBranchesRoot === root ? {} : { gitBranchesResult: null })
    })
    try {
      const result = await api.listGitBranches(root)
      if (get().gitBranchesRoot === root) {
        set({ gitBranchesResult: result, gitBranchesLoading: false })
      }
    } catch (error) {
      if (get().gitBranchesRoot === root) {
        set({ gitBranchesLoading: false, error: toUserError(error) })
      }
    }
  },
  setGitBranchesResult: (workspaceRoot, gitBranchesResult) => {
    const root = workspaceRoot.trim()
    set({ gitBranchesRoot: root, gitBranchesResult, gitBranchesLoading: false })
  },
  setView: (view) => {
    set(openPrimaryView(view))
    if (view === 'review') void get().loadReviewCards()
  },
  setOverviewDialogMode: (overviewDialogMode) => set({ overviewDialogMode }),
  openLessonLibrary: () => set(openLessonLibraryContext()),
  openTeachingConversationView: () => set(openTeachingConversation()),
  openWorkspaceTeachingMode: () => {
    set(openWorkspaceTeaching())
  },
  selectCourseFolder: (selectedCourseRelativePath, workspaceId) => {
    const targetWorkspace = workspaceId
      ? get().appState.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
      : get().appState.activeWorkspace
    set(selectCourseFolderContext({ selectedCourseRelativePath, workspaceId, targetWorkspace }))
  },
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  openSettings: (section = 'general') => set({ view: 'settings', settingsSection: section }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTaskPrompt: (taskPrompt) => set({ taskPrompt }),
  clearError: () => set({ error: null }),
  initialize: async () => {
    set({ loading: true, error: null })
    const api = window.teachingSystem
    if (!api) {
      console.warn('[StudiumX] preload API is not available; renderer is running without window.teachingSystem.')
      set({ loading: false, error: null })
      return
    }
    try {
      const [state, rawSettings, interruptedRuns] = await Promise.all([
        api.getState(),
        api.getSettings(),
        api.listInterruptedAgentRuns()
      ])
      const settings = normalizeRendererSettings(rawSettings)
      applySettingsSideEffects(settings)
      const interrupted = state.activeWorkspace
        ? interruptedRuns.find((run) => run.workspaceId === state.activeWorkspace?.id)
        : interruptedRuns.find((run) => !run.workspaceId)
      let recoveryTurns: AgentChatTurn[] = []
      if (interrupted) {
        if (interrupted.workspaceId && interrupted.conversationId) {
          recoveryTurns = await api.readAgentConversation({
            workspaceId: interrupted.workspaceId,
            conversationId: interrupted.conversationId
          }).then((record) => record.turns).catch(() => [])
        }
        recoveryTurns = [...recoveryTurns, interruptedAgentRunNotice(interrupted)]
      }
      set({
        appState: state,
        settings,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false,
        agentTurns: recoveryTurns,
        activeConversationId: interrupted?.conversationId ?? null,
        agentStatus: interrupted ? '上次运行已中断，等待你明确继续或重新发送。' : '',
        agentChatBusy: false,
        pendingAgentConversation: null
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  updateSettings: async (patch) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const settings = normalizeRendererSettings(await api.updateSettings(patch))
      applySettingsSideEffects(settings)
      set({ settings, error: null })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  pickDefaultRoot: async () => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const currentPath = get().settings.workspace.defaultRoot
      const result = await api.pickDirectory(currentPath)
      if (result.canceled || !result.path) return
      await get().updateSettings({ workspace: { defaultRoot: result.path } })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  selectWorkspace: async (workspaceId) => {
    const api = window.teachingSystem
    if (!api) return
    set({ loading: true, error: null })
    try {
      const state = await api.selectWorkspace(workspaceId)
      set(activateWorkspaceContext({
        appState: state,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
      }))
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  createWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return
    const name = window.prompt(i18n.t('dialogs.createNameTitle'), i18n.t('dialogs.createNameDefault'))
    if (!name) return
    const prompt = window.prompt(i18n.t('dialogs.createMissionTitle'), i18n.t('dialogs.createMissionDefault', { name }))
    if (!prompt) return
    set({ loading: true, error: null })
    try {
      const state = await api.createWorkspace({ name, prompt })
      set(activateWorkspaceContext({
        appState: state,
        taskPrompt: defaultPrompt,
        loading: false
      }))
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  importWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return false
    set({ loading: true, error: null })
    try {
      const result = await api.importWorkspace()
      if (result.canceled || !result.state) {
        set({ loading: false })
        return false
      }
      set(activateWorkspaceContext({
        appState: result.state,
        taskPrompt: result.state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
      }))
      const settings = get().settings
      const feedback = operationFeedback({
        outcome: 'workspace-imported',
        workspaceName: result.state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName'),
        notifications: notificationSettings(settings)
      })
      deliverOperationFeedback(feedback, get().showNotification)
      return true
    } catch (error) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error,
        operation: 'workspace-import',
        notifications: notificationSettings(get().settings),
        translate: operationFeedbackTranslate
      })
      set({ loading: false, error: feedback.visibleError ?? toUserError(error) })
      deliverOperationFeedback(feedback, get().showNotification)
      return false
    }
  },
  importWorkspacePath: async (rootPath) => {
    const api = window.teachingSystem
    if (!api) return false
    const path = rootPath.trim()
    if (!path) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error: new Error('Selected path'),
        translate: operationFeedbackTranslate
      })
      set({ error: feedback.visibleError ?? toUserError(new Error('Selected path')) })
      return false
    }
    set({ loading: true, error: null })
    try {
      const state = await api.importWorkspacePath(path)
      set(activateWorkspaceContext({
        appState: state,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
      }))
      const settings = get().settings
      const feedback = operationFeedback({
        outcome: 'workspace-imported',
        workspaceName: state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName'),
        notifications: notificationSettings(settings)
      })
      deliverOperationFeedback(feedback, get().showNotification)
      return true
    } catch (error) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error,
        operation: 'workspace-import',
        notifications: notificationSettings(get().settings),
        translate: operationFeedbackTranslate
      })
      set({ loading: false, error: feedback.visibleError ?? toUserError(error) })
      deliverOperationFeedback(feedback, get().showNotification)
      return false
    }
  },
  openImportLocation: async (path) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openImportLocation(path)
      if (!result.ok) {
        set({ error: { message: i18n.t('errors.openPath'), severity: 'warning', detail: result.message } })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  updateMission: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    const newPrompt = window.prompt(i18n.t('dialogs.updateMissionTitle'), workspace.missionExcerpt)
    if (!newPrompt) return
    set({ loading: true, error: null })
    try {
      const state = await api.updateMission({ workspaceId: workspace.id, prompt: newPrompt })
      set({ appState: state, loading: false })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  applyLessonStyle: async (styleId) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const workspace = get().appState.activeWorkspace
      if (workspace) {
        const state = await api.applyLessonStyle({ workspaceId: workspace.id, styleId })
        set({ appState: state })
      }
      await get().updateSettings({ workspace: { lessonStyleId: styleId } })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  generateLesson: async (options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = (options?.prompt ?? get().taskPrompt).trim()
    const settings = get().settings
    if (!workspace || !prompt) return
    const lessonMessages = options?.messages ?? (
      activeTeachingConversationSummary({
        state: get().appState,
        workspaceId: workspace.id,
        activeConversationId: get().activeConversationId,
        pendingAgentConversation: get().pendingAgentConversation
      })
        ? agentTurnsToMessages(get().agentTurns)
        : []
    )
    if (
      settings.workspace.confirmBeforeGenerating &&
      !window.confirm(i18n.t('dialogs.confirmGenerate'))
    ) {
      return
    }
    set(beginLessonGeneration({ appState: get().appState, providerLabel: runtimeProviderLabel(settings) }))
    try {
      const result = await api.generateLesson({
        workspaceId: workspace.id,
        prompt,
        courseName: suggestedCourseName(workspace, prompt),
        messages: lessonMessages
      })
      set(directLessonDonePatch({ result, workspaceId: workspace.id, nextPrompt }))
      const effects = effectsForGeneratedLesson({
        lesson: result.lesson,
        source: result.source,
        reason: result.reason,
        settings: lessonEffectSettings(settings)
      })
      if (effects.openPath) void get().openPath(effects.openPath)
      if (effects.lessonGeneratedNotification) {
        void get().showNotification(i18n.t('notify.lessonGenerated.title'), lessonGeneratedNotificationBody(effects.lessonGeneratedNotification))
      }
    } catch (error) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error,
        operation: 'lesson-generation',
        notifications: notificationSettings(settings),
        translate: operationFeedbackTranslate
      })
      set(failLessonGeneration({ appState: get().appState, error: feedback.visibleError ?? toUserError(error) }))
      deliverOperationFeedback(feedback, get().showNotification)
    }
  },
  generateLessonStream: async (options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = (options?.prompt ?? get().taskPrompt).trim()
    const settings = get().settings
    if (!workspace || !prompt) return
    const lessonMessages = options?.messages ?? (
      activeTeachingConversationSummary({
        state: get().appState,
        workspaceId: workspace.id,
        activeConversationId: get().activeConversationId,
        pendingAgentConversation: get().pendingAgentConversation
      })
        ? agentTurnsToMessages(get().agentTurns)
        : []
    )
    if (
      settings.workspace.confirmBeforeGenerating &&
      !window.confirm(i18n.t('dialogs.confirmGenerate'))
    ) {
      return
    }
    set(beginLessonGeneration({ appState: get().appState, providerLabel: runtimeProviderLabel(settings) }))
    let liveText = ''
    try {
      const done = await api.generateLessonStream(
        {
          workspaceId: workspace.id,
          prompt,
          courseName: suggestedCourseName(workspace, prompt),
          messages: lessonMessages
        },
        (chunk: LessonStreamChunk) => {
          liveText += chunk.delta
          set(appendStreamingPreview({
            appState: get().appState,
            liveText,
            workspace,
            labels: {
              language: i18n.language,
              hint: i18n.t('preview.streamingHint'),
              placeholder: i18n.t('preview.streamingPlaceholder')
            }
          }))
        },
        (status) => {
          set(updateStreamingStatus({ appState: get().appState, status }))
        }
      )
      if ('error' in done && done.error) {
        const feedback = operationFeedback({
          outcome: 'failure',
          error: new Error(done.message),
          operation: 'lesson-generation',
          notifications: notificationSettings(settings),
          translate: operationFeedbackTranslate
        })
        set(failStreamingLessonGeneration(feedback.visibleError ?? toUserError(new Error(done.message))))
        deliverOperationFeedback(feedback, get().showNotification)
        return
      }
      if (!('error' in done) && done.kind === 'lesson') {
        const patch = streamedLessonDonePatch({ done, workspaceId: workspace.id, nextPrompt })
        if (patch) set(patch)
        const effects = effectsForGeneratedLesson({
          lesson: done.lesson,
          source: done.source,
          reason: done.reason,
          settings: lessonEffectSettings(settings)
        })
        if (effects.openPath) void get().openPath(effects.openPath)
        if (effects.lessonGeneratedNotification) {
          void get().showNotification(i18n.t('notify.lessonGenerated.title'), lessonGeneratedNotificationBody(effects.lessonGeneratedNotification))
        }
      }
    } catch (error) {
      const userError = toUserError(error)
      set(failLessonGeneration({ appState: get().appState, error: userError }))
    }
  },
  loadAgentConversation: async (conversationId, workspaceId) => {
    const api = window.teachingSystem
    if (!api) return
    const requestedWorkspaceId = workspaceId ?? get().appState.activeWorkspace?.id ?? null
    const workspace = requestedWorkspaceId
      ? get().appState.workspaces.find((item) => item.id === requestedWorkspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    set({ error: null })
    try {
      const conversation = await api.readAgentConversation({ workspaceId: workspace.id, conversationId })
      set({
        appState: workspace.id === get().appState.activeWorkspace?.id
          ? get().appState
          : await api.selectWorkspace(workspace.id),
        ...openAgentConversationContext({
          conversation,
          workspaceId: workspace.id,
          currentOverviewDialogMode: get().overviewDialogMode,
          currentTaskPrompt: get().taskPrompt
        })
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  agentChat: async (inputOverride, options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const input = (inputOverride ?? get().agentInput).trim()
    if (!workspace || !input || get().agentChatBusy) return
    const mode: AgentChatMode = options?.mode ?? (get().overviewDialogMode === 'teaching' ? 'teaching' : 'temporary')
    const draft = createAgentConversationTurnDraft({
      state: get().appState,
      workspace,
      input,
      mode,
      activeConversationId: get().activeConversationId,
      currentTurns: get().agentTurns,
      selectedCourseRelativePath: get().selectedCourseRelativePath,
      currentSelectedLessonPath: get().appState.selectedLessonPath,
      createdAt: new Date().toISOString(),
      idSeed: Date.now()
    })
    const {
      pendingConversationId,
      selectedCourseRelativePath,
      selectedLessonPath,
      assistantId,
      priorMessages,
      initialTurns,
      pendingConversation
    } = draft
    set({
      agentChatBusy: true,
      agentInput: '',
      agentStatus: pendingConversation.status,
      agentToolsSupported: null,
      agentTurns: initialTurns,
      activeConversationId: pendingConversationId,
      pendingAgentConversation: pendingConversation
    })
    try {
      const done = await api.agentChatStream(
        {
          streamId: pendingConversationId,
          conversationId: pendingConversation.sourceConversationId ?? undefined,
          workspaceId: workspace.id,
          mode,
          messages: priorMessages,
          userInput: input,
          ...(options?.skillIds?.length ? { skillIds: options.skillIds } : {})
        },
        (chunk: AgentChatStreamChunk) => {
          const patch = applyAgentChatChunkToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            chunk
          })
          if (patch) set(patch)
        },
        (status: AgentChatStreamStatus) => {
          const patch = applyAgentChatStatusToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            status
          })
          if (patch) set(patch)
        },
        (event: AgentChatStreamToolEvent) => {
          const patch = applyAgentChatToolEventToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            event
          })
          if (patch) set(patch)
        },
        (invalidation: AgentProjectionInvalidation) => {
          const message = invalidation.reason === 'replay_gap'
            ? '实时事件回放不完整；当前过程视图已标记失效，完成后将以保存的对话结果为准。'
            : '实时事件回放已不可用；当前过程视图已标记失效，应用不会据此自动重跑。'
          const patch = applyAgentChatStatusToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            status: { streamId: invalidation.streamId, status: 'error', message }
          })
          if (patch) set(patch)
        }
      )
      if ('canceled' in done) {
        const pending = get().pendingAgentConversation
        if (!pending || pending.summary.id !== pendingConversationId) return
        set(cancelPendingAgentConversation({ pending, activeConversationId: get().activeConversationId }))
        return
      }
      if ('error' in done && done.error) {
        const pending = get().pendingAgentConversation
        if (!pending || pending.summary.id !== pendingConversationId) return
        const userError = toUserError(new Error(done.message))
        set({
          error: userError,
          ...failPendingAgentConversation({
            pending,
            activeConversationId: get().activeConversationId,
            assistantId
          })
        })
        return
      }
      if (!('error' in done)) {
        const pending = get().pendingAgentConversation
        if (!pending || pending.summary.id !== pendingConversationId) return
        const latestUserTurn = [...done.turns].reverse().find((turn) => turn.role === 'user')
        const reconciledTurns = reconcileAgentTurnsWithLocalProcess(done.turns, pending.turns)
        const savePatch = syncPendingAgentConversation({
          pending,
          pendingConversationId,
          activeConversationId: get().activeConversationId,
          patch: {
            turns: reconciledTurns,
            status: '保存对话…',
            toolsSupported: done.toolsSupported
          }
        })
        if (savePatch) set(savePatch)
        set({
          taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : get().taskPrompt
        })
        try {
          const saved = await api.saveAgentConversation({
            workspaceId: workspace.id,
            mode,
            conversationId: pending?.sourceConversationId ?? null,
            selectedLessonPath,
            selectedCourseRelativePath,
            turns: reconciledTurns
          })
          set({
            appState: saved.state,
            ...finishPendingAgentConversationSave({
              pending,
              activeConversationId: get().activeConversationId,
              savedConversationId: saved.conversation.id,
              turns: reconciledTurns,
              toolsSupported: done.toolsSupported
            })
          })
          // Lessons generated inside the conversation (generate_lesson tool):
          // saved.state already contains them; mirror the direct-generation
          // notifications and auto-open behavior without yanking the user
          // away from the conversation.
          const generatedLessons = done.generatedLessons ?? []
          if (generatedLessons.length > 0) {
            const settings = get().settings
            const effects = effectsForAgentGeneratedLessons({
              lessons: generatedLessons,
              settings: lessonEffectSettings(settings)
            })
            if (effects.openPath) {
              void get().openPath(effects.openPath)
            }
            if (effects.lessonGeneratedNotification) {
              void get().showNotification(
                i18n.t('notify.lessonGenerated.title'),
                lessonGeneratedNotificationBody(effects.lessonGeneratedNotification)
              )
            }
          }
        } catch (saveError) {
          set({ error: toUserError(saveError) })
        } finally {
          if (get().pendingAgentConversation?.summary.id && get().pendingAgentConversation?.summary.id !== pendingConversationId) return
          const visiblePatch = get().activeConversationId === pendingConversationId
            ? { agentStatus: '' }
            : {}
          set({ agentChatBusy: false, ...visiblePatch })
        }
      }
    } catch (error) {
      const pending = get().pendingAgentConversation
      if (!pending || pending.summary.id !== pendingConversationId) return
      const userError = toUserError(error)
      set({
        error: userError,
        ...failPendingAgentConversation({
          pending,
          activeConversationId: get().activeConversationId,
          assistantId
        })
      })
    }
  },
  setWorkspaceItemMeta: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = payload.workspaceId
      ? get().appState.workspaces.find((item) => item.id === payload.workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    try {
      const state = await api.setWorkspaceItemMeta({
        workspaceId: workspace.id,
        relativePath: payload.relativePath,
        pinned: payload.pinned,
        archived: payload.archived
      })
      const archivesWorkspaceRoot = normalizeRelativePath(payload.relativePath) === '' && payload.archived === true
      const clearsCurrentContext =
        archivesWorkspaceRoot &&
        (get().appState.activeWorkspace?.id === workspace.id ||
          get().selectedCourseWorkspaceId === workspace.id ||
          get().pendingAgentConversation?.workspaceId === workspace.id)
      set({
        appState: state,
        error: null,
        ...(clearsCurrentContext
          ? activateWorkspaceContext({
              appState: state,
              taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt
            })
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  removeWorkspaceItem: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = payload.workspaceId
      ? get().appState.workspaces.find((item) => item.id === payload.workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    const removalSnapshot = {
      activeConversationId: get().activeConversationId,
      selectedCoursePreviewFile: get().selectedCoursePreviewFile ?? get().selectedMarkdownDocument,
      selectedCourseRelativePath: get().selectedCourseRelativePath
    }
    try {
      const state = await api.removeWorkspaceItem({
        workspaceId: workspace.id,
        relativePath: payload.relativePath,
        kind: payload.kind,
        mode: payload.mode ?? 'disk'
      })
      const uiPatch = deriveWorkspaceRemovalUiPatch(payload, removalSnapshot, state)
      set({
        appState: state,
        error: null,
        ...(uiPatch.clearActiveConversation
          ? clearAgentConversationContext()
          : {}),
        ...(uiPatch.clearSelectedCoursePreview
          ? { lessonReaderOpen: false, selectedCoursePreviewFile: null, ...clearMarkdownDocumentContext() }
          : {}),
        ...(uiPatch.clearSelectedCourseFolder
          ? { selectedCourseRelativePath: null, selectedCourseWorkspaceId: null }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  removeWorkspace: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.workspaces.find((item) => item.id === payload.workspaceId)
    if (!workspace) return
    const previous = get()
    const clearsCurrentContext =
      previous.appState.activeWorkspace?.id === workspace.id ||
      previous.selectedCourseWorkspaceId === workspace.id ||
      previous.pendingAgentConversation?.workspaceId === workspace.id
    try {
      const state = await api.removeWorkspace({
        workspaceId: workspace.id,
        mode: payload.mode ?? 'disk'
      })
      set({
        appState: state,
        error: null,
        ...(clearsCurrentContext
          ? clearRemovedWorkspaceContext({
              nextState: state,
              previousView: previous.view,
              nextPrompt,
              defaultPrompt
            })
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadLesson: async (lesson) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    set(openLessonReaderContext({
      appState: get().appState,
      workspace,
      previewFile: lessonToCoursePreviewFile(lesson),
      previewHtml: loadingPreviewHtml(workspace),
      courseRelativePath: lesson.courseRelativePath
    }))
    try {
      const result = await api.readLesson({
        workspaceId: workspace.id,
        lessonPath: lesson.absolutePath
      })
      set({ appState: { ...get().appState, selectedLessonPath: lesson.absolutePath, previewHtml: result.html, previewUrl: result.url } })
    } catch (error) {
      set({ error: toUserError(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace), previewUrl: '' } })
    }
  },
  loadCourseHtmlFile: async (file) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    set(openLessonReaderContext({
      appState: get().appState,
      workspace,
      previewFile: file,
      previewHtml: loadingPreviewHtml(workspace),
      courseRelativePath: courseRelativePathForFile(file.relativePath)
    }))
    try {
      const result = await api.readLesson({
        workspaceId: workspace.id,
        lessonPath: file.absolutePath
      })
      set({
        appState: { ...get().appState, selectedLessonPath: file.absolutePath, previewHtml: result.html, previewUrl: result.url },
        selectedCoursePreviewFile: file
      })
    } catch (error) {
      set({ error: toUserError(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace), previewUrl: '' } })
    }
  },
  loadWorkspaceMarkdownFile: async (file, workspaceId) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = workspaceId
      ? get().appState.workspaces.find((item) => item.id === workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    set({
      view: 'lessons',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile: null,
      selectedMarkdownDocument: {
        title: file.title,
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        content: '',
        updatedAt: null
      },
      markdownDraft: '',
      markdownSaving: false,
      selectedCourseRelativePath: courseRelativePathForFile(file.relativePath),
      selectedCourseWorkspaceId: workspace.id,
      error: null,
      appState: { ...get().appState, selectedLessonPath: file.absolutePath }
    })
    try {
      const document = await api.readWorkspaceMarkdown({
        workspaceId: workspace.id,
        documentPath: file.absolutePath
      })
      set({
        selectedMarkdownDocument: document,
        markdownDraft: document.content,
        appState: { ...get().appState, selectedLessonPath: document.absolutePath }
      })
    } catch (error) {
      set({ error: toUserError(error), ...clearMarkdownDocumentContext() })
    }
  },
  setMarkdownDraft: (markdownDraft) => set({ markdownDraft }),
  saveMarkdownDocument: async () => {
    const api = window.teachingSystem
    if (!api) return
    const document = get().selectedMarkdownDocument
    const workspace = get().selectedCourseWorkspaceId
      ? get().appState.workspaces.find((item) => item.id === get().selectedCourseWorkspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!document || !workspace) return
    set({ markdownSaving: true, error: null })
    try {
      const result = await api.saveWorkspaceMarkdown({
        workspaceId: workspace.id,
        documentPath: document.absolutePath,
        content: get().markdownDraft
      })
      set({
        appState: result.state,
        selectedMarkdownDocument: result.document,
        markdownDraft: result.document.content,
        markdownSaving: false
      })
    } catch (error) {
      set({ error: toUserError(error), markdownSaving: false })
    }
  },
  openResourceHtmlPreview: (selectedResourcePreviewFile) => {
    set(openResourceReaderContext(selectedResourcePreviewFile))
  },
  closeResourceHtmlPreview: () => set({ selectedResourcePreviewFile: null }),
  openPath: async (path) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openPath(path)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? i18n.t('errors.openPath'))) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  openExternal: async (url) => {
    const api = window.teachingSystem
    if (!api) return
    const target = classifyExternalDestination(url)
    if (target.kind === 'blocked') {
      set({ error: toUserError(new Error(target.message)) })
      return
    }
    try {
      // The main-process IPC handler repeats this classification and applies privacy policy.
      const result = await api.openExternal(target.url)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? i18n.t('errors.openExternal'))) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  showNotification: async (title, body) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      await api.showNotification({ title, body })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  probeProvider: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'StudiumX preload API unavailable.' }
    try {
      return await api.probeProvider(payload)
    } catch (error) {
      const feedback = operationFeedback({ outcome: 'failure', error, translate: operationFeedbackTranslate })
      return { ok: false, message: feedback.visibleError?.message ?? toUserError(error).message }
    }
  },
  listUpstreamModels: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'StudiumX preload API unavailable.' }
    try {
      return await api.listUpstreamModels(payload)
    } catch (error) {
      const feedback = operationFeedback({ outcome: 'failure', error, translate: operationFeedbackTranslate })
      return { ok: false, message: feedback.visibleError?.message ?? toUserError(error).message }
    }
  },
  listGitWorktrees: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, reason: 'error', message: 'StudiumX preload API unavailable.' }
    try {
      return await api.listGitWorktrees(workspaceRoot)
    } catch (error) {
      return { ok: false, reason: 'error', message: toUserError(error).message }
    }
  },
  removeGitWorktree: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.removeGitWorktree(payload)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? 'Failed to remove worktree.')) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  listMemory: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const memoryRecords = await api.listMemory(workspaceRoot)
      set({ memoryRecords })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  createMemory: async (payload) => {
    const api = window.teachingSystem
    if (!api) return false
    try {
      const memory = await api.createMemory(payload)
      set((state) => ({ memoryRecords: [memory, ...state.memoryRecords.filter((item) => item.id !== memory.id)] }))
      void get().loadMemoryDiagnostics()
      return true
    } catch (error) {
      set({ error: toUserError(error) })
      return false
    }
  },
  updateMemory: async (memoryId, patch) => {
    const api = window.teachingSystem
    if (!api) return false
    try {
      const memory = await api.updateMemory(memoryId, patch)
      set((state) => ({
        memoryRecords: state.memoryRecords.map((item) => (item.id === memoryId ? memory : item))
      }))
      void get().loadMemoryDiagnostics()
      return true
    } catch (error) {
      set({ error: toUserError(error) })
      return false
    }
  },
  deleteMemory: async (memoryId, workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      await api.deleteMemory(memoryId, workspaceRoot)
      set((state) => ({ memoryRecords: state.memoryRecords.filter((item) => item.id !== memoryId) }))
      void get().loadMemoryDiagnostics()
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadMemoryDiagnostics: async () => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const memoryDiagnostics = await api.getMemoryDiagnostics()
      set({ memoryDiagnostics })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadReviewCards: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) {
      set({ reviewCards: [] })
      return
    }
    try {
      const result = await api.listReviewCards(workspace.id)
      set({ reviewCards: result.cards })
      void api.getProgress(workspace.id).then((res) => set({ progress: res.progress })).catch(() => {})
    } catch (error) {
      set({ error: toUserError(error), reviewCards: [] })
    }
  },
  recordProgress: async (lessonId, results) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    try {
      const res = await api.recordProgress({ workspaceId: workspace.id, lessonId, results })
      set({ progress: res.progress })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  }
}))

function interruptedAgentRunNotice(run: InterruptedAgentRun): AgentChatTurn {
  const waiting = run.previousStatus === 'waiting_for_permission'
    ? '退出时正在等待写入审批；旧审批已失效。'
    : run.previousStatus === 'waiting_for_elicitation'
      ? '退出时正在等待你的选择；旧问题不会自动恢复。'
      : '退出时该运行仍在进行。'
  const review = run.operationReviewCount > 0
    ? ` 有 ${run.operationReviewCount} 个已开始但完成状态不明的写入需要人工检查，应用不会自动重做。`
    : ''
  const content = `上次 Agent 运行被中断。${waiting}${review}\n\n请检查已有结果后，明确输入“继续”或重新发送请求。`
  return {
    id: `interrupted-${run.runId}`,
    role: 'assistant',
    content,
    createdAt: run.interruptedAt,
    processEvents: [{
      id: `interrupted-event-${run.runId}`,
      kind: 'status',
      title: '运行中断',
      detail: run.reason,
      status: 'error',
      isError: true,
      createdAt: run.interruptedAt
    }],
    metadata: { version: 1, runUsage: run.usage }
  }
}


// ================================================================
// Store Helpers
// ================================================================

export function sameRelativePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/') === right.replace(/\\/g, '/')
}


export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}


export function userTurnInputHistory(turns: AgentChatTurn[]): string[] {
  return turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
}


export function titleFromFileName(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{4}-/, '')
    .replace(/-reference$/i, '')
  const title = stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
  return title || fileName
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}


function emptyPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:680px;margin:0 auto;padding:46px 34px}p{color:#68778f;line-height:1.8}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}
</style></head><body><main><div class="badge">StudiumX</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(workspace.missionExcerpt)}</p><p>${escapeHtml(i18n.t('preview.emptyHint'))}</p></main></body></html>`
}


function loadingPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{display:grid;place-items:center;min-height:360px;padding:34px}p{color:#68778f}
</style></head><body><main><div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(i18n.t('preview.loadingHint'))}</p></div></main></body></html>`
}
