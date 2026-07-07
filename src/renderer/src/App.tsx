import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BookCopy,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coffee,
  Copy,
  DoorOpen,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  History,
  Info,
  LibraryBig,
  LinkIcon,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Pause,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Square,
  Target,
  Timer,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Play,
  SendHorizontal,
  Upload,
  Trash2,
  X,
  Wrench,
  Zap
} from 'lucide-react'
import type { CSSProperties, ErrorInfo, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Component, Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { create } from 'zustand'
import i18n from './i18n'
import { StudySpace, initialWorkspaceViewFromUrl } from './study-space'
import { buildAgentProcessTimeline } from './agent-process-timeline'
import { LessonStyleGallery } from './views/resources/LessonStyleGallery'
import { SettingsView } from './views/settings/SettingsView'
import {
  activeModelProvider,
  applySettingsSideEffects,
  DARK_THEME_MEDIA_QUERY,
  emptySettings,
  normalizeRendererSettings,
  reasoningEffortDescription,
  reasoningEffortLabel,
  reasoningEffortOptionsForSettings,
  runtimeProviderLabel,
  selectedReasoningEffort
} from './workflows/settings'
import {
  courseRelativePathForAgentConversation,
  isCourseAgentConversationPath
} from '../../shared/agent-conversation-catalog'
import {
  activeTeachingConversationSummary,
  agentTurnsToMessages,
  applyAgentChatChunkToPending,
  applyAgentChatStatusToPending,
  applyAgentChatToolEventToPending,
  cancelPendingAgentConversation,
  createAgentConversationTurnDraft,
  failPendingAgentConversation,
  findConversationSummary,
  finishPendingAgentConversationSave,
  isPendingConversationSummary,
  reconcileAgentTurnsWithLocalProcess,
  syncPendingAgentConversation,
  type PendingAgentConversation,
  type SidebarConversationSummary
} from './agent-conversation-state'
import { listSidebarWorkspaceFolders } from '../../shared/course-sidebar'
import {
  type LessonStyleId
} from '../../shared/lesson-styles'
import { classifyProviderError } from '../../shared/provider-error'
import { deriveWorkspaceRemovalUiPatch } from '../../shared/workspace-removal-state'
import {
  type AgentChatMessage,
  type AgentChatProcessEvent,
  type AgentChatStreamChunk,
  type AgentChatStreamStatus,
  type AgentChatStreamToolEvent,
  type AgentChatMode,
  type AgentChatTurn,
  type AgentConversationSummary,
  type CreateTeachingMemoryPayload,
  type GitBranchPayload,
  type LessonStreamChunk,
  type LessonStreamStatus,
  type LessonSummary,
  type ListUpstreamModelsResult,
  type ProgressSummary,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type RemoveTeachingGitWorktreePayload,
  type ReviewCard,
  type SettingsSection,
  type TeachingGitBranchesResult,
  type TeachingGitBranchRow,
  type TeachingGitWorktreesResult,
  type TeachingMemoryDiagnostics,
  type TeachingMemoryRecord,
  type TeachingMemoryScope,
  type TeachingModelProviderProfile,
  type ModelReasoningEffort,
  type TeachingAppState,
  type TeachingRuntimeState,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type UpdateTeachingMemoryPayload,
  type WebSearchBackend,
  type WindowControlAction,
  type WorkspaceFileNode,
  type WorkspaceItemKind,
  type WorkspaceItemRemoveMode,
  type WorkspaceView
} from '../../shared/teaching-types'

// ================================================================
// Types
// ================================================================

type ErrorSeverity = 'error' | 'warning' | 'info'

type UserError = {
  message: string
  severity: ErrorSeverity
  detail?: string
}

type DialogMode = 'chat' | 'teaching'

type CoursePreviewFile = {
  title: string
  relativePath: string
  absolutePath: string
}

type ResourcePreviewFile = {
  id: string
  title: string
  html: string
}

type LessonGenerationOptions = {
  prompt?: string
  messages?: AgentChatMessage[]
}

type StoreState = {
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
  agentChat: (inputOverride?: string, options?: { mode?: AgentChatMode }) => Promise<void>
  setWorkspaceItemMeta: (payload: { workspaceId?: string | null; relativePath: string; pinned?: boolean | null; archived?: boolean | null }) => Promise<void>
  removeWorkspaceItem: (payload: { workspaceId?: string | null; relativePath: string; kind: WorkspaceItemKind; mode?: WorkspaceItemRemoveMode }) => Promise<void>
  removeWorkspace: (payload: { workspaceId: string; mode?: WorkspaceItemRemoveMode }) => Promise<void>
}

// ================================================================
// Constants
// ================================================================

const navItems = [
  { id: 'overview', icon: Bot },
  { id: 'resources', icon: LibraryBig },
  { id: 'studio', icon: DoorOpen }
] satisfies Array<{ id: WorkspaceView; icon: LucideIcon }>

const defaultRuntime: TeachingRuntimeState = {
  status: 'idle',
  currentStep: 'ready',
  queuedTasks: 0,
  providerLabel: 'Local structured generator'
}

const emptyAppState: TeachingAppState = {
  workspaces: [],
  activeWorkspace: null,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: defaultRuntime
}

const defaultPrompt = ''

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

function isInputComposing(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number }
  return Boolean(nativeEvent.isComposing || nativeEvent.keyCode === 229)
}

// ================================================================
// Error Mapping — converts raw errors to user-friendly messages
// ================================================================

function toUserError(error: unknown): UserError {
  const raw = error instanceof Error ? error.message : String(error)

  // IPC validation errors
  if (raw.includes('No handler registered for')) {
    return {
      message: i18n.t('errors.ipcHandlerMissing.message'),
      severity: 'warning',
      detail: i18n.t('errors.ipcHandlerMissing.detail')
    }
  }

  if (raw.includes('未配置 API Key') || raw.includes('No API key') || raw.includes('API Key is required')) {
    return {
      message: i18n.t('errors.noApiKey.message'),
      severity: 'warning',
      detail: i18n.t('errors.noApiKey.detail')
    }
  }

  const providerError = classifyProviderError(raw)
  if (providerError) {
    const suffix = providerError.providerMessage ? ` ${providerError.providerMessage}` : ''
    if (providerError.kind === 'insufficient_balance') {
      return {
        message: i18n.t('errors.providerInsufficientBalance.message'),
        severity: 'warning',
        detail: `${i18n.t('errors.providerInsufficientBalance.detail')}${suffix}`
      }
    }
    if (providerError.kind === 'authentication') {
      return {
        message: i18n.t('errors.providerAuth.message'),
        severity: 'warning',
        detail: `${i18n.t('errors.providerAuth.detail')}${suffix}`
      }
    }
    if (providerError.kind === 'rate_limit') {
      return {
        message: i18n.t('errors.providerRateLimit.message'),
        severity: 'warning',
        detail: `${i18n.t('errors.providerRateLimit.detail')}${suffix}`
      }
    }
    return {
      message: i18n.t('errors.providerHttp.message'),
      severity: 'warning',
      detail: `${i18n.t('errors.providerHttp.detail', { status: providerError.status ?? '-' })}${suffix}`
    }
  }

  if (raw.includes('IPC payload field')) {
    const field = raw.match(/"([^"]+)"/)?.[1] ?? i18n.t('errors.missingField.fallbackField')
    return {
      message: i18n.t('errors.missingField.message'),
      severity: 'warning',
      detail: i18n.t('errors.missingField.detail', { field })
    }
  }

  if (raw.includes('IPC payload must be an object')) {
    return {
      message: i18n.t('errors.badPayload.message'),
      severity: 'warning',
      detail: i18n.t('errors.badPayload.detail')
    }
  }

  if (raw.includes('Unsupported window control action')) {
    return {
      message: i18n.t('errors.windowControl.message'),
      severity: 'info',
      detail: i18n.t('errors.windowControl.detail')
    }
  }

  // Workspace errors
  if (raw.includes('Workspace not found')) {
    return {
      message: i18n.t('errors.workspaceNotFound.message'),
      severity: 'warning',
      detail: i18n.t('errors.workspaceNotFound.detail')
    }
  }

  if (raw.includes('not a directory') || raw.includes('Selected path')) {
    return {
      message: i18n.t('errors.invalidPath.message'),
      severity: 'warning',
      detail: i18n.t('errors.invalidPath.detail')
    }
  }

  if (raw.includes('Mission prompt is required')) {
    return {
      message: i18n.t('errors.emptyMission.message'),
      severity: 'info',
      detail: i18n.t('errors.emptyMission.detail')
    }
  }

  if (raw.includes('Lesson prompt is required')) {
    return {
      message: i18n.t('errors.emptyTask.message'),
      severity: 'info',
      detail: i18n.t('errors.emptyTask.detail')
    }
  }

  if (raw.includes('outside the workspace lessons directory') || raw.includes('Path is outside')) {
    return {
      message: i18n.t('errors.pathRestricted.message'),
      severity: 'warning',
      detail: i18n.t('errors.pathRestricted.detail')
    }
  }

  // File system errors
  if (raw.includes('ENOENT') || raw.includes('no such file')) {
    return {
      message: i18n.t('errors.fileNotFound.message'),
      severity: 'warning',
      detail: i18n.t('errors.fileNotFound.detail')
    }
  }

  if (raw.includes('EACCES') || raw.includes('permission denied')) {
    return {
      message: i18n.t('errors.accessDenied.message'),
      severity: 'error',
      detail: i18n.t('errors.accessDenied.detail')
    }
  }

  // Generic fallback — don't expose raw stack traces
  if (raw.includes('Error:') || raw.includes('TypeError:') || raw.includes('at ')) {
    return {
      message: i18n.t('errors.generic.message'),
      severity: 'error',
      detail: i18n.t('errors.generic.stackDetail')
    }
  }

  return {
    message: raw || i18n.t('errors.generic.message'),
    severity: 'error',
    detail: i18n.t('errors.generic.detail')
  }
}

// ================================================================
// App Error Boundary
// ================================================================

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null }

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[TeachOS] uncaught render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    const userError = toUserError(this.state.error)
    return (
      <div className="app-frame">
        <div className="error-boundary-card">
          <div className="assistant-badge" style={{ margin: '0 auto 16px' }}>
            <AlertTriangle size={16} />
            {i18n.t('errorBoundary.badge')}
          </div>
          <h2>{userError.message}</h2>
          <p>{userError.detail ?? i18n.t('errorBoundary.fallbackDetail')}</p>
          <button type="button" onClick={this.handleReload}>
            <RefreshCw size={15} />
            {i18n.t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    )
  }
}

// ================================================================
// Zustand Store
// ================================================================

const AGENT_INPUT_HISTORY_STORAGE_KEY = 'teachos:agent-input-history'
const MAX_AGENT_INPUT_HISTORY = 20

function appendAgentInputHistory(history: string[], input: string): string[] {
  const value = input.trim()
  if (!value) return history
  const withoutCurrent = history.filter((item) => item !== value)
  return [...withoutCurrent, value].slice(-MAX_AGENT_INPUT_HISTORY)
}

function mergeAgentInputHistory(...sources: Array<string[] | undefined>): string[] {
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
    const stored = window.localStorage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY)
    if (!stored) return []
    return normalizeAgentInputHistory(JSON.parse(stored))
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

const useAppStore = create<StoreState>((set, get) => ({
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
    const courseRelativePath = courseRelativePathForAgentConversation(pending.summary.relativePath)
    set({
      view: pending.mode === 'teaching' ? 'overview' : 'agent',
      overviewDialogMode: pending.mode === 'teaching' ? 'teaching' : get().overviewDialogMode,
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      agentTurns: pending.turns,
      activeConversationId: pending.summary.id,
      agentStatus: pending.status,
      agentToolsSupported: pending.toolsSupported,
      selectedCourseRelativePath: courseRelativePath,
      selectedCourseWorkspaceId: courseRelativePath ? pending.workspaceId : null
    })
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
    set(view === 'resources' ? { view, selectedResourcePreviewFile: null } : { view })
    if (view === 'review') void get().loadReviewCards()
  },
  setOverviewDialogMode: (overviewDialogMode) => set({ overviewDialogMode }),
  openLessonLibrary: () => set({ view: 'lessons', lessonReaderOpen: false, selectedCoursePreviewFile: null, selectedResourcePreviewFile: null }),
  openTeachingConversationView: () => set({
    view: 'overview',
    overviewDialogMode: 'teaching',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null
  }),
  openWorkspaceTeachingMode: () => {
    get().clearAgentChat()
    set({
      view: 'overview',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile: null,
      selectedCourseRelativePath: null,
      selectedCourseWorkspaceId: null
    })
  },
  selectCourseFolder: (selectedCourseRelativePath, workspaceId) => {
    const targetWorkspace = workspaceId
      ? get().appState.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
      : get().appState.activeWorkspace
    const selectedCourse = selectedCourseRelativePath
      ? targetWorkspace?.courses.find((course) => sameRelativePath(course.relativePath, selectedCourseRelativePath)) ?? null
      : null
    const hasCourseContent = selectedCourseRelativePath
      ? Boolean(selectedCourse && selectedCourse.sessionCount > 0)
      : Boolean(targetWorkspace?.lessons.length)
    set({
      view: hasCourseContent ? 'lessons' : 'overview',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile: null,
      selectedCourseRelativePath,
      selectedCourseWorkspaceId: selectedCourse ? targetWorkspace?.id ?? null : null,
      ...(!hasCourseContent
        ? { agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null }
        : {})
    })
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
      console.warn('[TeachOS] preload API is not available; renderer is running without window.teachingSystem.')
      set({ loading: false, error: null })
      return
    }
    try {
      const [state, rawSettings] = await Promise.all([
        api.getState(),
        api.getSettings()
      ])
      const settings = normalizeRendererSettings(rawSettings)
      applySettingsSideEffects(settings)
      set({
        appState: state,
        settings,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
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
      set({
        appState: state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
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
      set({
        appState: state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
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
      set({
        appState: result.state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: result.state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.workspaceImported) {
        const wsName = result.state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName')
        void get().showNotification(i18n.t('notify.imported.title'), i18n.t('notify.imported.body', { name: wsName }))
      }
      return true
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.importFailed.title'), toUserError(error).message)
      }
      return false
    }
  },
  importWorkspacePath: async (rootPath) => {
    const api = window.teachingSystem
    if (!api) return false
    const path = rootPath.trim()
    if (!path) {
      set({ error: { message: i18n.t('errors.invalidPath.message'), severity: 'warning', detail: i18n.t('errors.invalidPath.detail') } })
      return false
    }
    set({ loading: true, error: null })
    try {
      const state = await api.importWorkspacePath(path)
      set({
        appState: state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.workspaceImported) {
        const wsName = state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName')
        void get().showNotification(i18n.t('notify.imported.title'), i18n.t('notify.imported.body', { name: wsName }))
      }
      return true
    } catch (error) {
      const userError = toUserError(error)
      set({ loading: false, error: userError })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.importFailed.title'), userError.message)
      }
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
    set({
      generating: true,
      error: null,
      appState: {
        ...get().appState,
        runtime: {
          status: 'working',
          currentStep: 'calling model',
          queuedTasks: 1,
          providerLabel: runtimeProviderLabel(settings)
        }
      }
    })
    try {
      const result = await api.generateLesson({
        workspaceId: workspace.id,
        prompt,
        courseName: suggestedCourseName(workspace, prompt),
        messages: lessonMessages
      })
      set({
        view: 'lessons',
        lessonReaderOpen: true,
        selectedCourseRelativePath: result.lesson.courseRelativePath,
        selectedCourseWorkspaceId: workspace.id,
        selectedCoursePreviewFile: lessonToCoursePreviewFile(result.lesson),
        appState: result.state,
        taskPrompt: nextPrompt,
        generating: false
      })
      if (settings.workspace.autoOpenGeneratedLesson) {
        void get().openPath(result.lesson.absolutePath)
      }
      if (settings.notifications.enabled && settings.notifications.lessonGenerated) {
        const suffix = result.source === 'fallback'
          ? (result.reason ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: result.reason }) : i18n.t('notify.lessonGenerated.fallbackNoReason'))
          : ''
        void get().showNotification(i18n.t('notify.lessonGenerated.title'), i18n.t('notify.lessonGenerated.body', { title: result.lesson.title, path: result.lesson.relativePath, suffix }))
      }
    } catch (error) {
      const userError = toUserError(error)
      set({
        generating: false,
        error: userError,
        appState: { ...get().appState, runtime: { ...defaultRuntime, status: 'error' } }
      })
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.generateFailed.title'), userError.message)
      }
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
    set({
      generating: true,
      error: null,
      appState: {
        ...get().appState,
        runtime: {
          status: 'working',
          currentStep: 'calling model',
          queuedTasks: 1,
          providerLabel: runtimeProviderLabel(settings)
        }
      }
    })
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
          set({ appState: { ...get().appState, previewHtml: streamingPreviewHtml(liveText, workspace), previewUrl: '' } })
        },
        (status: LessonStreamStatus) => {
          set({
            appState: {
              ...get().appState,
              runtime: { ...get().appState.runtime, currentStep: stepLabel(status.step) }
            }
          })
        }
      )
      if ('error' in done && done.error) {
        const userError = toUserError(new Error(done.message))
        set({ generating: false, error: userError })
        if (settings.notifications.enabled && settings.notifications.errors) {
          void get().showNotification(i18n.t('notify.generateFailed.title'), userError.message)
        }
        return
      }
      if (!('error' in done) && done.kind === 'lesson') {
        set({
          view: 'lessons',
          lessonReaderOpen: true,
          selectedCourseRelativePath: done.lesson.courseRelativePath,
          selectedCourseWorkspaceId: workspace.id,
          selectedCoursePreviewFile: lessonToCoursePreviewFile(done.lesson),
          appState: done.state,
          taskPrompt: nextPrompt,
          generating: false
        })
        if (settings.workspace.autoOpenGeneratedLesson) {
          void get().openPath(done.lesson.absolutePath)
        }
        if (settings.notifications.enabled && settings.notifications.lessonGenerated) {
          const suffix = done.source === 'fallback'
            ? (done.reason ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: done.reason }) : i18n.t('notify.lessonGenerated.fallbackNoReason'))
            : ''
          void get().showNotification(i18n.t('notify.lessonGenerated.title'), i18n.t('notify.lessonGenerated.body', { title: done.lesson.title, path: done.lesson.relativePath, suffix }))
        }
      }
    } catch (error) {
      const userError = toUserError(error)
      set({
        generating: false,
        error: userError,
        appState: { ...get().appState, runtime: { ...defaultRuntime, status: 'error' } }
      })
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
      const latestUserTurn = [...conversation.turns].reverse().find((turn) => turn.role === 'user')
      const conversationCourseRelativePath = courseRelativePathForAgentConversation(conversation.relativePath)
      const isTeachingConversation = Boolean(conversationCourseRelativePath)
      set({
        appState: workspace.id === get().appState.activeWorkspace?.id
          ? get().appState
          : await api.selectWorkspace(workspace.id),
        view: isTeachingConversation ? 'overview' : 'agent',
        overviewDialogMode: isTeachingConversation ? 'teaching' : get().overviewDialogMode,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        agentTurns: conversation.turns,
        activeConversationId: conversation.id,
        agentStatus: '',
        agentToolsSupported: null,
        agentInput: '',
        selectedCourseRelativePath: conversationCourseRelativePath,
        selectedCourseWorkspaceId: conversationCourseRelativePath ? workspace.id : null,
        taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : get().taskPrompt
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
      sourceConversationId,
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
        { streamId: pendingConversationId, workspaceId: workspace.id, mode, messages: priorMessages, userInput: input },
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
            const latest = generatedLessons[generatedLessons.length - 1]
            if (latest && settings.workspace.autoOpenGeneratedLesson) {
              void get().openPath(latest.absolutePath)
            }
            if (latest && settings.notifications.enabled && settings.notifications.lessonGenerated) {
              void get().showNotification(
                i18n.t('notify.lessonGenerated.title'),
                i18n.t('notify.lessonGenerated.body', { title: latest.title, path: latest.relativePath, suffix: '' })
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
          ? {
              lessonReaderOpen: false,
              selectedCoursePreviewFile: null,
              selectedCourseRelativePath: null,
              selectedCourseWorkspaceId: null,
              taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
              agentTurns: [],
              activeConversationId: null,
              agentStatus: '',
              agentInput: '',
              agentToolsSupported: null,
              agentChatBusy: false,
              pendingAgentConversation: null,
            }
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
      selectedCoursePreviewFile: get().selectedCoursePreviewFile,
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
          ? { agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null }
          : {}),
        ...(uiPatch.clearSelectedCoursePreview
          ? { lessonReaderOpen: false, selectedCoursePreviewFile: null }
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
          ? {
              view: state.activeWorkspace ? previous.view : 'overview',
              lessonReaderOpen: false,
              selectedCoursePreviewFile: null,
              selectedCourseRelativePath: null,
              selectedCourseWorkspaceId: null,
              taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
              agentTurns: [],
              activeConversationId: null,
              agentStatus: '',
              agentInput: '',
              agentToolsSupported: null,
              agentChatBusy: false,
              pendingAgentConversation: null,
            }
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
    set({
      view: 'lessons',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: true,
      selectedCoursePreviewFile: lessonToCoursePreviewFile(lesson),
      selectedResourcePreviewFile: null,
      appState: {
        ...get().appState,
        selectedLessonPath: lesson.absolutePath,
        previewHtml: loadingPreviewHtml(workspace),
        previewUrl: ''
      },
      selectedCourseRelativePath: lesson.courseRelativePath,
      selectedCourseWorkspaceId: workspace.id
    })
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
    set({
      view: 'lessons',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: true,
      selectedCoursePreviewFile: file,
      selectedResourcePreviewFile: null,
      appState: {
        ...get().appState,
        selectedLessonPath: file.absolutePath,
        previewHtml: loadingPreviewHtml(workspace),
        previewUrl: ''
      },
      selectedCourseRelativePath: courseRelativePathForFile(file.relativePath),
      selectedCourseWorkspaceId: workspace.id
    })
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
  openResourceHtmlPreview: (selectedResourcePreviewFile) => {
    set({
      view: 'resources',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile
    })
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
    try {
      const result = await api.openExternal(url)
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
    if (!api) return { ok: false, message: 'TeachOS preload API unavailable.' }
    try {
      return await api.probeProvider(payload)
    } catch (error) {
      return { ok: false, message: toUserError(error).message }
    }
  },
  listUpstreamModels: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'TeachOS preload API unavailable.' }
    try {
      return await api.listUpstreamModels(payload)
    } catch (error) {
      return { ok: false, message: toUserError(error).message }
    }
  },
  listGitWorktrees: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, reason: 'error', message: 'TeachOS preload API unavailable.' }
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

// ================================================================
// Main App Component
// ================================================================

const DEFAULT_SIDEBAR_WIDTH = 232
const MIN_SIDEBAR_WIDTH = 176
const MAX_SIDEBAR_WIDTH = 340

function App() {
  const platform = window.teachingSystem?.platform ?? 'win32'
  const isMac = platform === 'darwin'
  const showTitlebar = !isMac
  const { settings, sidebarCollapsed } = useAppStore()
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const appShellStyle = { '--sidebar-width': `${sidebarWidth}px` } as CSSProperties

  useEffect(() => {
    applySettingsSideEffects(settings)
    if (settings.theme !== 'system' || typeof window.matchMedia !== 'function') return

    const themeMedia = window.matchMedia(DARK_THEME_MEDIA_QUERY)
    const handleThemeChange = (): void => applySettingsSideEffects(settings)
    themeMedia.addEventListener('change', handleThemeChange)
    return () => themeMedia.removeEventListener('change', handleThemeChange)
  }, [settings])

  return (
    <AppErrorBoundary>
      <div className="app-frame">
        {showTitlebar && <WindowTitlebar />}
        <div
          className={`app-shell${isMac ? ' platform-darwin' : ''}${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
          data-density={settings.density}
          style={appShellStyle}
        >
          {isMac && <MacTrafficLights />}
          <Sidebar />
          <SidebarResizer disabled={sidebarCollapsed} onResize={setSidebarWidth} width={sidebarWidth} />
          <MainArea />
        </div>
      </div>
    </AppErrorBoundary>
  )
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function SidebarResizer({
  disabled,
  onResize,
  width
}: {
  disabled: boolean
  onResize: (width: number) => void
  width: number
}) {
  const { t } = useTranslation()
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      onResize(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    }

    const finishResize = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      document.body.classList.remove('is-sidebar-resizing')
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    document.body.classList.add('is-sidebar-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onResize(clampSidebarWidth(width - 12))
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onResize(clampSidebarWidth(width + 12))
    }
  }

  return (
    <div
      aria-label={t('sidebarResizer.aria')}
      aria-orientation="vertical"
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuenow={width}
      className={`sidebar-resizer${disabled ? ' is-disabled' : ''}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      role="separator"
      tabIndex={disabled ? -1 : 0}
    />
  )
}

// ================================================================
// Window Titlebar (Windows / Linux)
// ================================================================

function WindowTitlebar() {
  const { t } = useTranslation()
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className="window-titlebar" role="group" aria-label={t('titlebar.group')}>
      <div className="window-controls">
        <button
          className="window-control-btn"
          type="button"
          aria-label={t('titlebar.minimize')}
          title={t('titlebar.minimize')}
          onClick={() => controlWindow('minimize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="window-control-btn"
          type="button"
          aria-label={t('titlebar.maximize')}
          title={t('titlebar.maximize')}
          onClick={() => controlWindow('toggle-maximize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="window-control-btn window-control-btn--close"
          type="button"
          aria-label={t('titlebar.close')}
          title={t('titlebar.close')}
          onClick={() => controlWindow('close')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ================================================================
// Mac Traffic Lights Overlay
// ================================================================

function MacTrafficLights() {
  const { t } = useTranslation()
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className="mac-traffic-lights" role="group" aria-label={t('titlebar.group')}>
      <button
        className="mac-traffic-light mac-traffic-light--close"
        type="button"
        aria-label={t('titlebar.close')}
        title={t('titlebar.close')}
        onClick={() => controlWindow('close')}
      />
      <button
        className="mac-traffic-light mac-traffic-light--minimize"
        type="button"
        aria-label={t('titlebar.minimize')}
        title={t('titlebar.minimize')}
        onClick={() => controlWindow('minimize')}
      />
      <button
        className="mac-traffic-light mac-traffic-light--maximize"
        type="button"
        aria-label={t('titlebar.maximize')}
        title={t('titlebar.maximize')}
        onClick={() => controlWindow('toggle-maximize')}
      />
    </div>
  )
}

// ================================================================
// Sidebar
// ================================================================

function Sidebar() {
  const { t } = useTranslation()
  const {
    view,
    sidebarCollapsed,
    settings,
    appState,
    setView,
    openSettings,
    showNotification
  } = useAppStore()

  const active = appState.activeWorkspace
  const selectedLessonPath = appState.selectedLessonPath
  const lessonReaderOpen = useAppStore((s) => s.lessonReaderOpen)
  const [coursesExpanded, setCoursesExpanded] = useState(true)
  const [conversationsExpanded, setConversationsExpanded] = useState(true)

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-label={t('sidebar.aria')}>
      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'is-active' : ''}`}
              type="button"
              onClick={() => {
                if (item.id === 'overview') {
                  useAppStore.getState().setOverviewDialogMode('teaching')
                  useAppStore.getState().clearAgentChat()
                  useAppStore.setState({
                    selectedCourseRelativePath: null,
                    selectedCourseWorkspaceId: null,
                    lessonReaderOpen: false,
                    selectedCoursePreviewFile: null,
                    selectedResourcePreviewFile: null
                  })
                }
                if (item.id === 'resources') {
                  useAppStore.getState().closeResourceHtmlPreview()
                }
                setView(item.id)
              }}
            >
              <Icon size={17} />
              <span className="collapsible-label">{t(`nav.${item.id}`)}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-content">
        <WorkspaceCourseSection
          workspaces={appState.workspaces}
          activeWorkspaceId={active?.id ?? null}
          expanded={coursesExpanded}
          selectedLessonPath={view === 'lessons' && lessonReaderOpen ? selectedLessonPath : null}
          onToggle={() => setCoursesExpanded((expanded) => !expanded)}
        />
        <SidebarConversationSection
          workspace={active}
          conversations={appState.temporaryConversations}
          expanded={conversationsExpanded}
          onToggle={() => setConversationsExpanded((expanded) => !expanded)}
        />
      </div>

      <div className="sidebar-footer">
        <button className="avatar-button" type="button" onClick={() => openSettings('general')}>
          <span className="avatar">C</span>
        </button>
        <button
          className={`icon-button${settings.notifications.enabled ? '' : ' is-muted'}`}
          type="button"
          aria-label={t('sidebar.notifications')}
          onClick={() => {
            openSettings('notifications')
            void showNotification(t('sidebar.notificationCenterTitle'), settings.notifications.enabled ? t('sidebar.notificationCenterOn') : t('sidebar.notificationCenterOff'))
          }}
          title={t('sidebar.notifications')}
        >
          <Bell size={16} />
        </button>
        <button className="icon-button" type="button" aria-label={t('sidebar.settings')} onClick={() => openSettings('model')} title={t('sidebar.settings')}>
          <Settings size={16} />
        </button>
      </div>
    </aside>
  )
}

function WorkspaceCourseSection({
  workspaces,
  activeWorkspaceId,
  expanded,
  selectedLessonPath,
  onToggle
}: {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspaceId: string | null
  expanded: boolean
  selectedLessonPath: string | null
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const loadLesson = useAppStore((s) => s.loadLesson)
  const loadCourseHtmlFile = useAppStore((s) => s.loadCourseHtmlFile)
  const loadAgentConversation = useAppStore((s) => s.loadAgentConversation)
  const view = useAppStore((s) => s.view)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const openPath = useAppStore((s) => s.openPath)
  const selectCourseFolder = useAppStore((s) => s.selectCourseFolder)
  const showAllCourseFiles = useAppStore((s) => s.settings.workspace.showAllCourseFiles)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const workspacesWithPending = useMemo(
    () => withPendingCourseConversation(workspaces, pendingAgentConversation),
    [pendingAgentConversation, workspaces]
  )
  const workspaceFolders = useMemo(
    () => listSidebarWorkspaceFolders(workspacesWithPending, showAllCourseFiles),
    [showAllCourseFiles, workspacesWithPending]
  )
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  useEffect(() => {
    if (!expanded) setExpandedPaths(new Set())
  }, [expanded])

  const togglePath = (workspaceId: string, relativePath: string): void => {
    const key = workspaceNodeKey(workspaceId, relativePath)
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const ensureWorkspaceSelected = async (workspaceId: string): Promise<void> => {
    if (workspaceId !== activeWorkspaceId) {
      await selectWorkspace(workspaceId)
    }
  }

  return (
    <>
      <div className="sidebar-section sidebar-section--courses">
        <div className="section-heading section-heading--folder">
          <button
            className="section-folder-button"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? t('sidebar.collapseCourses') : t('sidebar.expandCourses')}
            title={expanded ? t('sidebar.collapseCourses') : t('sidebar.expandCourses')}
            onClick={onToggle}
          >
            <span className="collapsible-label">{t('sidebar.courses')}</span>
            <span className="section-folder-chevron" aria-hidden="true">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          <button
            className="section-add-button"
            type="button"
            aria-label={t('sidebar.addCourseProject')}
            title={t('sidebar.addCourseProject')}
            onClick={(event) => {
              event.stopPropagation()
              setImportDialogOpen(true)
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div
          className={`sidebar-disclosure${expanded ? ' is-open' : ''}`}
          aria-hidden={!expanded}
          inert={!expanded ? true : undefined}
        >
          <div className="sidebar-disclosure-inner">
            {workspaceFolders.length > 0 ? (
              <div className="workspace-file-tree workspace-file-tree--courses" role="tree">
                {workspaceFolders.map(({ workspace, node }) => (
                  <WorkspaceFileNodeRow
                    key={workspaceNodeKey(workspace.id, node.relativePath)}
                    node={node}
                    workspace={workspace}
                    level={0}
                    treeRoot="courses"
                    expandedPaths={expandedPaths}
                    selectedLessonPath={selectedLessonPath}
                    activeConversationId={view === 'agent' ? activeConversationId : null}
                    onToggle={togglePath}
                    onEnsureWorkspaceSelected={() => ensureWorkspaceSelected(workspace.id)}
                    onOpenPath={(path) => void openPath(path)}
                    onOpenHtmlFile={(file) => void loadCourseHtmlFile(file)}
                    onOpenCourse={(relativePath) => selectCourseFolder(relativePath, workspace.id)}
                    onOpenLesson={(lesson) => {
                      void loadLesson(lesson)
                    }}
                    onOpenConversation={(conversationId) => void loadAgentConversation(conversationId, workspace.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="workspace-conversation-empty">{t('sidebar.emptyCourses')}</div>
            )}
          </div>
        </div>
      </div>
      {importDialogOpen ? <ImportWorkspaceDialog onClose={() => setImportDialogOpen(false)} /> : null}
    </>
  )
}

function ImportWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  const settings = useAppStore((s) => s.settings)
  const activeWorkspace = useAppStore((s) => s.appState.activeWorkspace)
  const loading = useAppStore((s) => s.loading)
  const importWorkspace = useAppStore((s) => s.importWorkspace)
  const importWorkspacePath = useAppStore((s) => s.importWorkspacePath)
  const openImportLocation = useAppStore((s) => s.openImportLocation)
  const [path, setPath] = useState(settings.workspace.defaultRoot || activeWorkspace?.rootPath || '')

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleChoose = async (): Promise<void> => {
    if (await importWorkspace()) onClose()
  }

  const handleImportPath = async (): Promise<void> => {
    if (await importWorkspacePath(path)) onClose()
  }

  const handleOpenManager = (): void => {
    void openImportLocation(path.trim() || undefined)
  }

  return createPortal(
    <div
      className="import-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="import-dialog-header">
          <div>
            <span>{t('workspaceImport.eyebrow')}</span>
            <h2 id={titleId}>{t('workspaceImport.title')}</h2>
          </div>
          <button type="button" className="settings-close-button" onClick={onClose} aria-label={t('workspaceImport.close')}>
            <X size={16} />
          </button>
        </div>
        <label className="import-dialog-field">
          <span>{t('workspaceImport.pathLabel')}</span>
          <input
            autoFocus
            type="text"
            value={path}
            placeholder={t('workspaceImport.pathPlaceholder')}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleImportPath()
              }
            }}
          />
        </label>
        <div className="import-dialog-tools">
          <button type="button" className="ghost-button" onClick={() => void handleChoose()} disabled={loading}>
            <FolderOpen size={15} />
            {t('workspaceImport.choose')}
          </button>
          <button type="button" className="ghost-button" onClick={handleOpenManager} disabled={loading}>
            <ArrowUpRight size={15} />
            {t('workspaceImport.manage')}
          </button>
        </div>
        <div className="import-dialog-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary-button" onClick={() => void handleImportPath()} disabled={loading || !path.trim()}>
            <Upload size={15} />
            {t('workspaceImport.import')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}

function SidebarConversationSection({
  workspace,
  conversations,
  expanded,
  onToggle
}: {
  workspace: TeachingWorkspaceSummary | null
  conversations: AgentConversationSummary[]
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const loadAgentConversation = useAppStore((s) => s.loadAgentConversation)
  const restorePendingAgentConversation = useAppStore((s) => s.restorePendingAgentConversation)
  const view = useAppStore((s) => s.view)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const storedPendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const pendingAgentConversation = storedPendingAgentConversation &&
    storedPendingAgentConversation.workspaceId === workspace?.id &&
    !isCourseAgentConversationPath(storedPendingAgentConversation.summary.relativePath)
    ? storedPendingAgentConversation
    : null
  const conversationsWithPending: SidebarConversationSummary[] = pendingAgentConversation ? [pendingAgentConversation.summary, ...conversations.filter((conversation) => !sameRelativePath(conversation.relativePath, pendingAgentConversation.summary.relativePath))] : conversations
  const ensureActiveWorkspace = async (): Promise<void> => {}

  return (
    <div className="sidebar-section sidebar-section--conversations" aria-label={t('sidebar.conversations')}>
      <div className="section-heading section-heading--folder sidebar-conversation-heading">
        <button
          className="section-folder-button"
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? t('sidebar.collapseConversations') : t('sidebar.expandConversations')}
          title={expanded ? t('sidebar.collapseConversations') : t('sidebar.expandConversations')}
          onClick={onToggle}
        >
          <span className="collapsible-label">{t('sidebar.conversations')}</span>
          <span className="section-folder-chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </button>
      </div>
      <div
        className={`sidebar-disclosure${expanded ? ' is-open' : ''}`}
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <div className="sidebar-disclosure-inner">
          <div className="workspace-conversation-list is-flat">
            {conversationsWithPending.length === 0 ? (
              <div className="workspace-conversation-empty">{t('sidebar.emptyConversations')}</div>
            ) : (
              conversationsWithPending.map((conversation) => (
                <ConversationListRow
                  key={conversation.id}
                  conversation={conversation}
                  isActiveConversation={view === 'agent' && conversation.id === activeConversationId}
                  onEnsureSelected={ensureActiveWorkspace}
                  onOpen={() => conversation.pending ? restorePendingAgentConversation() : void loadAgentConversation(conversation.id, conversation.workspaceId)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type RowContextMenuPoint = { left: number; top: number }

const ROW_CONTEXT_MENU_EDGE_GAP = 8
const ROW_CONTEXT_MENU_MIN_WIDTH = 164
const ROW_CONTEXT_MENU_ESTIMATED_HEIGHT = 118

function clampRowContextMenuPoint(left: number, top: number, width: number, height: number): RowContextMenuPoint {
  return {
    left: Math.min(Math.max(ROW_CONTEXT_MENU_EDGE_GAP, left), Math.max(ROW_CONTEXT_MENU_EDGE_GAP, window.innerWidth - width - ROW_CONTEXT_MENU_EDGE_GAP)),
    top: Math.min(Math.max(ROW_CONTEXT_MENU_EDGE_GAP, top), Math.max(ROW_CONTEXT_MENU_EDGE_GAP, window.innerHeight - height - ROW_CONTEXT_MENU_EDGE_GAP))
  }
}

function sameRowContextMenuPoint(left: RowContextMenuPoint, right: RowContextMenuPoint): boolean {
  return Math.abs(left.left - right.left) < 0.5 && Math.abs(left.top - right.top) < 0.5
}

function RowContextMenu({
  pinned,
  onTogglePin,
  onArchive,
  onRemove,
  showPin = true,
  showArchive = true
}: {
  pinned: boolean
  onTogglePin: () => void
  onArchive: () => void
  onRemove: () => void
  showPin?: boolean
  showArchive?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState<RowContextMenuPoint | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const close = (): void => setOpen(false)
  const openMenu = (trigger: HTMLButtonElement): void => {
    const rect = trigger.getBoundingClientRect()
    setMenuPoint(
      clampRowContextMenuPoint(
        rect.right - ROW_CONTEXT_MENU_MIN_WIDTH,
        rect.bottom + 6,
        ROW_CONTEXT_MENU_MIN_WIDTH,
        ROW_CONTEXT_MENU_ESTIMATED_HEIGHT
      )
    )
    setOpen(true)
  }
  const run = (action: () => void): void => {
    close()
    action()
  }

  useLayoutEffect(() => {
    if (!open || !menuPoint) return
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextPoint = clampRowContextMenuPoint(menuPoint.left, menuPoint.top, rect.width, rect.height)
    setMenuPoint((current) => {
      if (!current) return nextPoint
      if (sameRowContextMenuPoint(current, nextPoint)) return current
      return nextPoint
    })
  }, [menuPoint, open])

  useEffect(() => {
    if (!open) return

    const closeMenu = (): void => setOpen(false)
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [open])

  return (
    <div ref={wrapRef} className={`row-context-menu${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="row-context-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('sidebar.rowActions')}
        title={t('sidebar.rowActions')}
        onClick={(event) => {
          event.stopPropagation()
          if (open) close()
          else openMenu(event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && menuPoint ? createPortal(
        <div
          ref={menuRef}
          className="row-context-menu-dropdown"
          role="menu"
          style={{ left: menuPoint.left, top: menuPoint.top, minWidth: ROW_CONTEXT_MENU_MIN_WIDTH }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          {showPin ? (
            <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onTogglePin)}>
              {pinned ? <PinOff size={13} /> : <Pin size={13} />}
              <span>{pinned ? t('sidebar.unpin') : t('sidebar.pin')}</span>
            </button>
          ) : null}
          {showArchive ? (
            <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onArchive)}>
              <Archive size={13} />
              <span>{t('sidebar.archive')}</span>
            </button>
          ) : null}
          {showPin || showArchive ? <div className="row-context-menu-separator" role="separator" /> : null}
          <button type="button" role="menuitem" className="row-context-menu-item is-danger" onClick={() => run(onRemove)}>
            <Trash2 size={13} />
            <span>{t('sidebar.remove')}</span>
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  )
}

function RemoveWorkspaceItemDialog({
  itemName,
  itemKind,
  onClose,
  onRemoveFromList,
  onRemoveFromDisk
}: {
  itemName: string
  itemKind: WorkspaceItemKind
  onClose: () => void
  onRemoveFromList: () => void
  onRemoveFromDisk: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const kindLabel = itemKind === 'conversation'
    ? t('sidebar.removeDialog.kindConversation')
    : itemKind === 'directory'
      ? t('sidebar.removeDialog.kindFolder')
    : t('sidebar.removeDialog.kindFile')

  return createPortal(
    <div
      className="remove-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="remove-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="remove-dialog-header">
          <span className="remove-dialog-icon" aria-hidden="true">
            <AlertTriangle size={18} />
          </span>
          <div>
            <span>{kindLabel}</span>
            <h2 id={titleId}>{t('sidebar.removeDialog.title', { name: itemName })}</h2>
          </div>
          <button type="button" className="settings-close-button" onClick={onClose} aria-label={t('sidebar.removeDialog.close')}>
            <X size={16} />
          </button>
        </div>
        <p id={descriptionId} className="remove-dialog-detail">
          {t('sidebar.removeDialog.detail')}
        </p>
        <div className="remove-dialog-options">
          <button type="button" className="remove-dialog-option" onClick={onRemoveFromList}>
            <span className="remove-dialog-option-icon">
              <Archive size={17} />
            </span>
            <span>
              <strong>{t('sidebar.removeDialog.listTitle')}</strong>
              <small>{t('sidebar.removeDialog.listDetail')}</small>
            </span>
          </button>
          <button type="button" className="remove-dialog-option is-danger" onClick={onRemoveFromDisk}>
            <span className="remove-dialog-option-icon">
              <Trash2 size={17} />
            </span>
            <span>
              <strong>{t('sidebar.removeDialog.diskTitle')}</strong>
              <small>{t('sidebar.removeDialog.diskDetail')}</small>
            </span>
          </button>
        </div>
        <div className="remove-dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}

function ConversationListRow({
  conversation,
  isActiveConversation,
  onOpen,
  onEnsureSelected
}: {
  conversation: SidebarConversationSummary
  isActiveConversation: boolean
  onOpen: () => void
  onEnsureSelected: () => Promise<void>
}) {
  const { t } = useTranslation()
  const setWorkspaceItemMeta = useAppStore((s) => s.setWorkspaceItemMeta)
  const removeWorkspaceItem = useAppStore((s) => s.removeWorkspaceItem)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)

  const handlePin = async (): Promise<void> => {
    await onEnsureSelected()
    void setWorkspaceItemMeta({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, pinned: !conversation.pinned })
  }
  const handleArchive = async (): Promise<void> => {
    await onEnsureSelected()
    void setWorkspaceItemMeta({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, archived: true })
  }
  const handleRemoveFromList = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    await onEnsureSelected()
    void removeWorkspaceItem({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, kind: 'conversation', mode: 'list' })
  }
  const handleRemoveFromDisk = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    await onEnsureSelected()
    void removeWorkspaceItem({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, kind: 'conversation', mode: 'disk' })
  }

  return (
    <div
      className={`workspace-conversation-row ${isActiveConversation ? 'is-selected' : ''}${conversation.pending ? ' is-pending' : ''}`}
      title={conversation.absolutePath}
    >
      <button type="button" className="workspace-conversation-main" onClick={onOpen}>
        {conversation.pending ? <Loader2 className="spin" size={13} /> : conversation.pinned ? <Pin size={11} className="row-pin-indicator" /> : <MessageSquare size={13} />}
        <span className="workspace-conversation-body">
          <span className="workspace-conversation-title">{conversation.title}</span>
          {conversation.pending ? <span className="workspace-conversation-meta">{t('sidebar.pendingConversation')}</span> : null}
        </span>
      </button>
      {!conversation.pending && (
        <RowContextMenu
          pinned={!!conversation.pinned}
          onTogglePin={() => void handlePin()}
          onArchive={() => void handleArchive()}
          onRemove={() => setRemoveDialogOpen(true)}
        />
      )}
      {removeDialogOpen ? (
        <RemoveWorkspaceItemDialog
          itemName={conversation.title}
          itemKind="conversation"
          onClose={() => setRemoveDialogOpen(false)}
          onRemoveFromList={() => void handleRemoveFromList()}
          onRemoveFromDisk={() => void handleRemoveFromDisk()}
        />
      ) : null}
    </div>
  )
}

function WorkspaceFileNodeRow({
  node,
  workspace,
  level,
  treeRoot,
  expandedPaths,
  selectedLessonPath,
  activeConversationId,
  onToggle,
  onEnsureWorkspaceSelected,
  onOpenPath,
  onOpenHtmlFile,
  onOpenCourse,
  onOpenLesson,
  onOpenConversation
}: {
  node: WorkspaceFileNode
  workspace: TeachingWorkspaceSummary
  level: number
  treeRoot?: 'courses'
  expandedPaths: Set<string>
  selectedLessonPath: string | null
  activeConversationId: string | null
  onToggle: (workspaceId: string, relativePath: string) => void
  onEnsureWorkspaceSelected: () => Promise<void>
  onOpenPath: (path: string) => void
  onOpenHtmlFile?: (file: CoursePreviewFile) => void
  onOpenCourse?: (relativePath: string, workspaceId: string) => void
  onOpenLesson: (lesson: LessonSummary) => void
  onOpenConversation: (conversationId: string) => void
}) {
  const setWorkspaceItemMeta = useAppStore((s) => s.setWorkspaceItemMeta)
  const removeWorkspaceItem = useAppStore((s) => s.removeWorkspaceItem)
  const removeWorkspace = useAppStore((s) => s.removeWorkspace)
  const restorePendingAgentConversation = useAppStore((s) => s.restorePendingAgentConversation)
  const setOverviewDialogMode = useAppStore((s) => s.setOverviewDialogMode)
  const openWorkspaceTeachingMode = useAppStore((s) => s.openWorkspaceTeachingMode)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const isDirectory = node.kind === 'directory'
  const nodeKey = workspaceNodeKey(workspace.id, node.relativePath)
  const isExpanded = expandedPaths.has(nodeKey)
  const lesson = (workspace.lessons ?? []).find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const conversation = (workspace.conversations ?? []).find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const isPendingConversation = isPendingConversationSummary(conversation)
  const isWorkspaceFolder = treeRoot === 'courses' && level === 0 && isDirectory && normalizeRelativePath(node.relativePath) === ''
  const isCourseFolder = treeRoot === 'courses' && isDirectory && !isWorkspaceFolder && isSidebarCourseFolderPath(node.relativePath)
  const isHtmlFile = !isDirectory && node.name.toLowerCase().endsWith('.html')
  const isSelected = Boolean(
    (((lesson || (treeRoot === 'courses' && isHtmlFile)) && node.absolutePath === selectedLessonPath) ||
      (conversation && conversation.id === activeConversationId))
  )
  const itemKind: WorkspaceItemKind = conversation ? 'conversation' : isDirectory ? 'directory' : 'file'
  const itemLabel = conversation?.title ?? lesson?.title ?? node.name
  const Icon = isDirectory
    ? isExpanded
      ? FolderOpen
      : Folder
    : conversation
      ? MessageSquare
      : FileText

  const handleOpen = async (): Promise<void> => {
    if (treeRoot === 'courses') {
      setOverviewDialogMode('teaching')
    }
    if (isDirectory) {
      if (isWorkspaceFolder) {
        await onEnsureWorkspaceSelected()
        openWorkspaceTeachingMode()
        onToggle(workspace.id, node.relativePath)
        return
      }
      if (isCourseFolder) {
        await onEnsureWorkspaceSelected()
        onOpenCourse?.(node.relativePath, workspace.id)
        onToggle(workspace.id, node.relativePath)
        return
      }
      onToggle(workspace.id, node.relativePath)
      return
    }
    await onEnsureWorkspaceSelected()
    if (lesson) {
      onOpenLesson(lesson)
      return
    }
    if (conversation) {
      if (isPendingConversation) restorePendingAgentConversation()
      else onOpenConversation(conversation.id)
      return
    }
    if (treeRoot === 'courses' && onOpenHtmlFile && node.name.toLowerCase().endsWith('.html')) {
      onOpenHtmlFile({
        title: titleFromFileName(node.name),
        relativePath: node.relativePath,
        absolutePath: node.absolutePath
      })
      return
    }
    onOpenPath(node.absolutePath)
  }

  const handlePin = async (): Promise<void> => {
    if (isWorkspaceFolder) {
      void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', pinned: !node.pinned })
      return
    }
    await onEnsureWorkspaceSelected()
    void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: node.relativePath, pinned: !node.pinned })
  }
  const handleArchive = async (): Promise<void> => {
    if (isWorkspaceFolder) {
      void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', archived: true })
      return
    }
    await onEnsureWorkspaceSelected()
    void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: node.relativePath, archived: true })
  }
  const handleRemoveFromList = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    if (isWorkspaceFolder) {
      void removeWorkspace({ workspaceId: workspace.id, mode: 'list' })
      return
    }
    await onEnsureWorkspaceSelected()
    void removeWorkspaceItem({ workspaceId: workspace.id, relativePath: node.relativePath, kind: itemKind, mode: 'list' })
  }
  const handleRemoveFromDisk = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    if (isWorkspaceFolder) {
      void removeWorkspace({ workspaceId: workspace.id, mode: 'disk' })
      return
    }
    await onEnsureWorkspaceSelected()
    void removeWorkspaceItem({ workspaceId: workspace.id, relativePath: node.relativePath, kind: itemKind, mode: 'disk' })
  }

  return (
    <div className="workspace-node">
      <div
        className={`workspace-node-row ${isSelected ? 'is-selected' : ''} ${isDirectory ? 'is-directory' : ''} ${isHtmlFile ? 'is-html-file' : ''} ${conversation ? 'is-conversation' : ''} ${isPendingConversation ? 'is-pending' : ''} ${isWorkspaceFolder ? 'is-workspace-folder' : ''} ${isCourseFolder ? 'is-course-folder' : ''}`}
        style={{ paddingLeft: 4 + level * 12 }}
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
      >
        <button
          className="workspace-node-button"
          type="button"
          title={node.absolutePath}
          aria-expanded={isDirectory ? isExpanded : undefined}
          onClick={() => void handleOpen()}
        >
          {isPendingConversation ? <Loader2 className="spin" size={13} /> : <Icon size={13} />}
          {node.pinned ? <Pin size={10} className="row-pin-indicator" /> : null}
          <span className="collapsible-label">{conversation?.title ?? lesson?.sessionName ?? node.name}</span>
          {isDirectory ? (
            <span className="workspace-node-chevron" aria-hidden="true">
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : null}
        </button>
        {!isPendingConversation ? (
          <RowContextMenu
            pinned={!!node.pinned}
            onTogglePin={() => void handlePin()}
            onArchive={() => void handleArchive()}
            onRemove={() => setRemoveDialogOpen(true)}
          />
        ) : null}
        {removeDialogOpen ? (
          <RemoveWorkspaceItemDialog
            itemName={itemLabel}
            itemKind={itemKind}
            onClose={() => setRemoveDialogOpen(false)}
            onRemoveFromList={() => void handleRemoveFromList()}
            onRemoveFromDisk={() => void handleRemoveFromDisk()}
          />
        ) : null}
      </div>
      {isDirectory && node.children?.length ? (
        <div
          className={`workspace-node-children${isExpanded ? ' is-open' : ''}${isWorkspaceFolder || isCourseFolder ? ' is-course-children' : ''}`}
          aria-hidden={!isExpanded}
          inert={!isExpanded ? true : undefined}
        >
          <div className="workspace-node-children-inner">
            {node.children.map((child) => (
              <WorkspaceFileNodeRow
                key={workspaceNodeKey(workspace.id, child.relativePath)}
                node={child}
                workspace={workspace}
                level={level + 1}
                treeRoot={treeRoot}
                expandedPaths={expandedPaths}
                selectedLessonPath={selectedLessonPath}
                activeConversationId={activeConversationId}
                onToggle={onToggle}
                onEnsureWorkspaceSelected={onEnsureWorkspaceSelected}
                onOpenPath={onOpenPath}
                onOpenHtmlFile={onOpenHtmlFile}
                onOpenCourse={onOpenCourse}
                onOpenLesson={onOpenLesson}
                onOpenConversation={onOpenConversation}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ================================================================
// Overview pickers: project folder + git branch
// ================================================================

/** Parent folder name, shown muted to disambiguate same-named projects. */
function workspaceContextLabel(rootPath: string, name: string): string {
  const parts = rootPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  return !parent || parent.toLowerCase() === name.toLowerCase() ? '' : parent
}

function sameRelativePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/') === right.replace(/\\/g, '/')
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function withPendingCourseConversation(
  workspaces: TeachingWorkspaceSummary[],
  pendingAgentConversation: PendingAgentConversation | null
): TeachingWorkspaceSummary[] {
  if (!pendingAgentConversation || !isCourseAgentConversationPath(pendingAgentConversation.summary.relativePath)) return workspaces
  const courseRelativePath = courseRelativePathForAgentConversation(pendingAgentConversation.summary.relativePath)
  if (!courseRelativePath) return workspaces

  let changed = false
  const nextWorkspaces = workspaces.map((workspace) => {
    if (workspace.id !== pendingAgentConversation.workspaceId) return workspace
    let workspaceChanged = false
    const conversations = upsertConversationSummary(workspace.conversations, pendingAgentConversation.summary)
    if (conversations !== workspace.conversations) workspaceChanged = true
    const courses = workspace.courses.map((course) => {
      if (!sameRelativePath(course.relativePath, courseRelativePath)) return course
      const courseConversations = upsertConversationSummary(course.conversations, pendingAgentConversation.summary)
      if (courseConversations === course.conversations) return course
      workspaceChanged = true
      return {
        ...course,
        conversations: courseConversations,
        sessionCount: course.sessions.length + courseConversations.length
      }
    })
    if (!workspaceChanged) return workspace
    changed = true
    return {
      ...workspace,
      conversations,
      courses
    }
  })

  return changed ? nextWorkspaces : workspaces
}

function upsertConversationSummary(
  conversations: AgentConversationSummary[],
  conversation: AgentConversationSummary
): AgentConversationSummary[] {
  const withoutCurrent = conversations.filter((item) =>
    item.id !== conversation.id && !sameRelativePath(item.relativePath, conversation.relativePath)
  )
  if (withoutCurrent.length === conversations.length && conversations[0]?.id === conversation.id) return conversations
  return [conversation, ...withoutCurrent]
}

function workspaceNodeKey(workspaceId: string, relativePath: string): string {
  return `${workspaceId}:${normalizeRelativePath(relativePath)}`
}

function isSidebarCourseFolderPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  return normalized === 'lessons' || /^courses\/[^/]+$/i.test(normalized)
}

function userTurnInputHistory(turns: AgentChatTurn[]): string[] {
  return turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
}

function titleFromFileName(fileName: string): string {
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

function courseRelativePathForFile(relativePath: string): string | null {
  const parts = normalizeRelativePath(relativePath).split('/').filter(Boolean)
  if (parts[0] === 'courses' && parts[1]) return `courses/${parts[1]}`
  if (parts[0] === 'lessons') return 'lessons'
  return null
}

function lessonToCoursePreviewFile(lesson: LessonSummary): CoursePreviewFile {
  return {
    title: lesson.sessionName || lesson.title,
    relativePath: lesson.relativePath,
    absolutePath: lesson.absolutePath
  }
}

/** Truncate the middle of a string so long branch names fit the trigger button. */
function middleEllipsize(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return '…'
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}

function usePickerOutsideClose(open: boolean, wrapRef: RefObject<HTMLDivElement | null>, setOpen: (v: boolean) => void): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, wrapRef, setOpen])
}

function ProjectFolderPicker({ mode = 'workspace' }: { mode?: 'workspace' | 'temporary' }) {
  const { t } = useTranslation()
  const workspaces = useAppStore((s) => s.appState.workspaces)
  const active = useAppStore((s) => s.appState.activeWorkspace)
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const importWorkspace = useAppStore((s) => s.importWorkspace)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  usePickerOutsideClose(open, wrapRef, setOpen)

  const showSearch = workspaces.length > 5
  useEffect(() => {
    if (open && showSearch) window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, showSearch])

  const filtered = useMemo(() => {
    const list = workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      rootPath: w.rootPath,
      context: workspaceContextLabel(w.rootPath, w.name)
    }))
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((w) => w.name.toLowerCase().includes(q) || w.rootPath.toLowerCase().includes(q))
  }, [workspaces, query])

  const label = active?.name ?? t('overview.selectWorkspace')

  if (mode === 'temporary') {
    return (
      <div className="overview-picker overview-project-picker">
        <button
          type="button"
          className="overview-picker-trigger"
          title={t('overview.temporarySessionTitle')}
          disabled
        >
          <MessageSquare size={15} strokeWidth={1.8} />
          <span className="overview-picker-label">{t('overview.temporarySession')}</span>
        </button>
      </div>
    )
  }

  const handleSelect = async (id: string): Promise<void> => {
    if (acting) return
    if (id === active?.id) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await selectWorkspace(id)
      setOpen(false)
      setQuery('')
    } finally {
      setActing(false)
    }
  }

  const handleAdd = async (): Promise<void> => {
    if (acting) return
    setActing(true)
    try {
      await importWorkspace()
      setOpen(false)
      setQuery('')
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-project-picker">
      <button
        type="button"
        className="overview-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title={active?.rootPath ?? t('overview.importWorkspace')}
        disabled={acting}
      >
        <Folder size={15} strokeWidth={1.8} />
        <span className="overview-picker-label">{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu" role="listbox">
          {showSearch ? (
            <div className="overview-picker-search">
              <Search size={14} strokeWidth={1.8} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                }}
                placeholder={t('overview.searchWorkspaces')}
              />
            </div>
          ) : null}

          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('overview.workspaces')}</div>
            {filtered.map((w) => {
              const isCurrent = w.id === active?.id
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                  onClick={() => void handleSelect(w.id)}
                  disabled={acting}
                  title={w.rootPath}
                >
                  <Folder size={14} strokeWidth={1.8} className="overview-picker-option-icon" />
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{w.name}</span>
                    {w.context ? <span className="overview-picker-option-context">{w.context}</span> : null}
                  </span>
                  {isCurrent ? <Check size={15} /> : null}
                </button>
              )
            })}
            {filtered.length === 0 ? (
              <div className="overview-picker-empty">
                {workspaces.length === 0 ? t('overview.noWorkspaces') : t('overview.noMatch')}
              </div>
            ) : null}
          </div>

          <div className="overview-picker-footer">
            <button
              type="button"
              className="overview-picker-option"
              onClick={() => void handleAdd()}
              disabled={acting}
            >
              <FolderPlus size={14} strokeWidth={1.9} className="overview-picker-option-icon" />
              <span className="overview-picker-option-title">{t('overview.importWorkspace')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GitBranchPicker({ workspaceRoot }: { workspaceRoot: string }) {
  const { t } = useTranslation()
  const root = workspaceRoot.trim()
  const {
    gitBranchesRoot,
    gitBranchesResult,
    gitBranchesLoading,
    loadGitBranches,
    setGitBranchesResult
  } = useAppStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [acting, setActing] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const result = gitBranchesRoot === root ? gitBranchesResult : null
  const loading = gitBranchesRoot === root ? gitBranchesLoading : false

  // Reload branches whenever the workspace changes (incl. right after an
  // import/select switches the active workspace) and on mount. The cancel
  // guard keeps a stale fetch from overwriting a newer one.
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setActing(null)
    void loadGitBranches(root)
  }, [loadGitBranches, root])

  // Refresh + focus when the dropdown opens.
  useEffect(() => {
    if (!open || !root) return
    void loadGitBranches(root, { force: true })
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [loadGitBranches, open, root])

  usePickerOutsideClose(open, wrapRef, setOpen)

  const branches = useMemo<TeachingGitBranchRow[]>(
    () => (result?.ok ? result.branches : []),
    [result]
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, query])

  const trimmed = query.trim()
  const exactExists = branches.some((b) => b.name === trimmed)
  const canCreate = trimmed.length > 0 && !exactExists
  const currentBranch = result?.ok ? result.currentBranch : null

  const label = !root
    ? t('overview.gitNoWorkspace')
    : !result
      ? t('overview.gitLoading')
      : result?.ok
        ? (currentBranch ?? t('overview.gitDetached'))
        : result?.reason === 'not_git_repo'
          ? t('overview.gitNotRepo')
          : result?.reason === 'git_unavailable'
            ? t('overview.gitUnavailable')
            : t('overview.gitError')
  const triggerLoading = loading && !result

  const switchBranch = async (branch: string): Promise<void> => {
    const api = window.teachingSystem
    if (!api || !root || !branch || acting) return
    setActing(branch)
    try {
      const next = await api.switchGitBranch({ workspaceRoot: root, branch })
      setGitBranchesResult(root, next)
      if (next.ok) {
        setOpen(false)
        setQuery('')
      }
    } finally {
      setActing(null)
    }
  }

  const createBranch = async (): Promise<void> => {
    const api = window.teachingSystem
    const branch = query.trim()
    if (!api || !root || !branch || acting) return
    setActing(branch)
    try {
      const next = await api.createGitBranch({ workspaceRoot: root, branch })
      setGitBranchesResult(root, next)
      if (next.ok) {
        setOpen(false)
        setQuery('')
      }
    } finally {
      setActing(null)
    }
  }

  if (!root) return null

  return (
    <div ref={wrapRef} className="overview-picker overview-git-picker">
      <button
        type="button"
        className="overview-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        disabled={acting != null}
      >
        <GitBranch size={15} strokeWidth={1.8} />
        <span className="overview-picker-label">{middleEllipsize(label, 32)}</span>
        {triggerLoading ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-git-menu">
          <div className="overview-picker-search">
            <Search size={14} strokeWidth={1.8} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
                if (e.key === 'Enter') {
                  if (canCreate) {
                    e.preventDefault()
                    void createBranch()
                  } else {
                    const match = branches.find((b) => b.name === trimmed)
                    if (match) {
                      e.preventDefault()
                      void switchBranch(match.name)
                    }
                  }
                }
              }}
              placeholder={t('overview.gitSearchBranches')}
            />
          </div>

          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('overview.gitBranches')}</div>

            {loading && !result ? (
              <div className="overview-picker-loading">
                <Loader2 size={14} className="spin" />
                <span>{t('overview.gitLoading')}</span>
              </div>
            ) : null}

            {result && !result.ok ? (
              <div className="overview-picker-error">
                <AlertCircle size={14} />
                <span>{result.message}</span>
              </div>
            ) : null}

            {filtered.map((b) => {
              const isActing = acting === b.name
              return (
                <button
                  key={b.name}
                  type="button"
                  className={`overview-picker-option${b.current ? ' is-current' : ''}`}
                  onClick={() => void switchBranch(b.name)}
                  disabled={acting != null || b.current}
                  title={b.worktreePath ? t('overview.gitCheckedOutInWorktree') : b.name}
                >
                  <GitBranch size={14} strokeWidth={1.8} className="overview-picker-option-icon" />
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{middleEllipsize(b.name, 42)}</span>
                    {b.current && result?.ok && result.dirtyCount > 0 ? (
                      <span className="overview-picker-option-context">
                        {t('overview.gitDirty', { count: result.dirtyCount })}
                      </span>
                    ) : b.worktreePath ? (
                      <span className="overview-picker-option-context">{t('overview.gitCheckedOutInWorktree')}</span>
                    ) : null}
                  </span>
                  {isActing ? <Loader2 size={14} className="spin" /> : b.current ? <Check size={15} /> : null}
                </button>
              )
            })}

            {!loading && result?.ok && filtered.length === 0 ? (
              <div className="overview-picker-empty">{t('overview.gitNoBranches')}</div>
            ) : null}
          </div>

          {canCreate ? (
            <div className="overview-picker-footer">
              <button
                type="button"
                className="overview-picker-option"
                onClick={() => void createBranch()}
                disabled={acting != null}
                title={t('overview.gitCreateNamed', { branch: trimmed })}
              >
                <Plus size={14} strokeWidth={1.9} className="overview-picker-option-icon" />
                <span className="overview-picker-option-title">
                  {t('overview.gitCreateNamed', { branch: middleEllipsize(trimmed, 34) })}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function OverviewModelPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openSettings = useAppStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const provider = activeModelProvider(settings)
  const models = provider?.models ?? []
  const current = settings.generator.model
  const label = current || i18n.t('common.auto')

  const handleSelect = async (model: string): Promise<void> => {
    if (acting) return
    if (model === current) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { providerId: provider?.id, model } })
      setOpen(false)
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-model-picker">
      <button
        type="button"
        className="overview-dialog-model"
        onClick={() => setOpen((v) => !v)}
        disabled={acting}
        title={label}
      >
        <span>{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-model-menu" role="listbox">
          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{provider?.name ?? t('common.modelProvider')}</div>
            {models.length === 0 ? (
              <div className="overview-picker-empty">{t('overview.modelEmpty')}</div>
            ) : (
              models.map((model) => {
                const isCurrent = model === current
                return (
                  <button
                    key={model}
                    type="button"
                    className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                    onClick={() => void handleSelect(model)}
                    disabled={acting || isCurrent}
                    title={model}
                  >
                    <span className="overview-picker-option-body">
                      <span className="overview-picker-option-title">{model}</span>
                    </span>
                    {isCurrent ? <Check size={15} /> : null}
                  </button>
                )
              })
            )}
          </div>
          <div className="overview-picker-footer">
            <button
              type="button"
              className="overview-picker-option"
              onClick={() => {
                setOpen(false)
                openSettings('model')
              }}
              title={t('overview.modelManage')}
            >
              <SlidersHorizontal size={14} strokeWidth={1.9} className="overview-picker-option-icon" />
              <span className="overview-picker-option-title">{t('overview.modelManage')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OverviewReasoningPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const options = reasoningEffortOptionsForSettings(settings)
  const current = selectedReasoningEffort(settings)
  const label = reasoningEffortLabel(current)

  const handleSelect = async (reasoningEffort: ModelReasoningEffort): Promise<void> => {
    if (acting) return
    if (reasoningEffort === current && settings.generator.reasoningEffort === current) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { reasoningEffort } })
      setOpen(false)
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-reasoning-picker">
      <button
        type="button"
        className="overview-dialog-model overview-dialog-reasoning"
        onClick={() => setOpen((v) => !v)}
        disabled={acting}
        title={`${t('reasoning.title')}: ${label}`}
      >
        <BrainCircuit size={14} />
        <span>{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-reasoning-menu" role="listbox">
          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('reasoning.title')}</div>
            {options.map((effort) => {
              const isCurrent = effort === current
              return (
                <button
                  key={effort}
                  type="button"
                  className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                  onClick={() => void handleSelect(effort)}
                  disabled={acting || (isCurrent && settings.generator.reasoningEffort === current)}
                  title={reasoningEffortDescription(effort)}
                >
                  <BrainCircuit size={14} strokeWidth={1.8} className="overview-picker-option-icon" />
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{reasoningEffortLabel(effort)}</span>
                    <span className="overview-picker-option-context">{reasoningEffortDescription(effort)}</span>
                  </span>
                  {isCurrent ? <Check size={15} /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ================================================================
// Main Content Area
// ================================================================

function MainArea() {
  const { t } = useTranslation()
  const {
    view,
    settingsSection,
    sidebarCollapsed,
    loading,
    generating,
    error,
    appState,
    settings,
    lessonReaderOpen,
    selectedCoursePreviewFile,
    selectedResourcePreviewFile,
    setView,
    setSidebarCollapsed,
    openSettings,
    closeResourceHtmlPreview,
    pickDefaultRoot,
    initialize,
    updateSettings,
    createWorkspace,
    importWorkspace,
    updateMission,
    applyLessonStyle,
    generateLesson,
    loadLesson,
    openLessonLibrary,
    openResourceHtmlPreview,
    openPath,
    clearError,
    showNotification
  } = useAppStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const active = appState.activeWorkspace
  const selectedCourseWorkspaceId = useAppStore((s) => s.selectedCourseWorkspaceId)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const workspacesWithPending = useMemo(
    () => withPendingCourseConversation(appState.workspaces, pendingAgentConversation),
    [appState.workspaces, pendingAgentConversation]
  )
  const activeWithPending = active
    ? workspacesWithPending.find((workspace) => workspace.id === active.id) ?? active
    : null
  const selectedCourseWorkspace = selectedCourseWorkspaceId
    ? workspacesWithPending.find((workspace) => workspace.id === selectedCourseWorkspaceId) ?? activeWithPending
    : activeWithPending
  const courses = selectedCourseWorkspace?.courses ?? []
  const selectedCourseRelativePath = useAppStore((s) => s.selectedCourseRelativePath)
  const selectedCourse = selectedCourseRelativePath
    ? courses.find((course) => sameRelativePath(course.relativePath, selectedCourseRelativePath)) ?? null
    : null
  const visibleCourses = selectedCourse ? [selectedCourse] : courses.filter((course) => course.sessions.length > 0)
  const visibleLessonCount = visibleCourses.reduce((sum, course) => sum + course.sessions.length, 0)
  const selectedLesson = active?.lessons.find((lesson) => lesson.absolutePath === appState.selectedLessonPath) ?? null
  const selectedPreviewFile = selectedCoursePreviewFile ?? (selectedLesson ? lessonToCoursePreviewFile(selectedLesson) : null)
  const readingCourseHtml = Boolean(lessonReaderOpen && selectedPreviewFile)
  const readingResourceHtml = view === 'resources' && Boolean(selectedResourcePreviewFile)
  const readingHtml = readingCourseHtml || readingResourceHtml
  const lessonFrameKey = selectedPreviewFile
    ? appState.previewUrl || `${appState.selectedLessonPath ?? selectedPreviewFile.relativePath}:${appState.previewHtml.length}`
    : 'empty-preview'
  const resourceFrameKey = selectedResourcePreviewFile
    ? `${selectedResourcePreviewFile.id}:${selectedResourcePreviewFile.html.length}`
    : 'empty-resource-preview'
  const renderSidebarToggle = (className = 'icon-button') => (
    <button
      className={className}
      type="button"
      aria-label={sidebarCollapsed ? t('main.expandSidebar') : t('main.collapseSidebar')}
      onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
    >
      <PanelLeft size={17} />
    </button>
  )

  // Show skeleton during initial load
  if (loading && !active) {
    return (
      <main className="main-area">
        <div className="topbar">
          <div className="crumb">
            <span>TeachOS</span>
          </div>
        </div>
        <div style={{ maxWidth: 760, margin: '36px auto', padding: '0 24px' }}>
          <div className="skeleton" style={{ width: '35%', height: 22, marginBottom: 14, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, borderRadius: 20 }} />
        </div>
      </main>
    )
  }

  return (
    <main className="main-area" data-view={view} data-reading-html={readingHtml ? 'true' : undefined}>
      {readingResourceHtml ? (
        <>
          {renderSidebarToggle('icon-button reader-sidebar-toggle')}
          <button
            className="icon-button reader-preview-back"
            type="button"
            aria-label={t('resources.styles.backToStyles')}
            onClick={closeResourceHtmlPreview}
          >
            <ArrowLeft size={17} />
          </button>
        </>
      ) : readingCourseHtml ? (
        renderSidebarToggle('icon-button reader-sidebar-toggle')
      ) : (
        <header className="topbar">
          <div className="crumb">{renderSidebarToggle()}</div>
        </header>
      )}

      {error && (
        <div className="inline-alert" role="alert" data-severity={error.severity}>
          {error.severity === 'error' && <AlertCircle size={16} />}
          {error.severity === 'warning' && <AlertTriangle size={16} />}
          {error.severity === 'info' && <Info size={16} />}
          <div style={{ minWidth: 0 }}>
            <strong>{error.message}</strong>
            {error.detail && <span style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 400, opacity: 0.8 }}>{error.detail}</span>}
          </div>
          <button className="alert-dismiss" type="button" aria-label={t('main.dismissAlert')} onClick={clearError}>
            <X size={14} />
          </button>
        </div>
      )}

      {view === 'overview' && (
        <OverviewChat active={active} />
      )}

      {view === 'agent' && (
        <OverviewChat active={active} />
      )}

      {view === 'settings' && (
        <SettingsView
          section={settingsSection}
          settings={settings}
          activeWorkspace={active}
          onClose={() => setView('overview')}
          onSectionChange={(section) => openSettings(section)}
          onUpdateSettings={updateSettings}
          onPickDefaultRoot={pickDefaultRoot}
          onCreateWorkspace={createWorkspace}
          onImportWorkspace={importWorkspace}
          onOpenPath={openPath}
          onOpenExternal={useAppStore.getState().openExternal}
          onTestNotification={() => useAppStore.getState().showNotification(t('notify.test.title'), t('notify.test.body'))}
          onProbeProvider={useAppStore.getState().probeProvider}
          onListUpstreamModels={useAppStore.getState().listUpstreamModels}
          onListGitWorktrees={useAppStore.getState().listGitWorktrees}
          onRemoveGitWorktree={useAppStore.getState().removeGitWorktree}
          memoryRecords={useAppStore.getState().memoryRecords}
          memoryDiagnostics={useAppStore.getState().memoryDiagnostics}
          onListMemory={useAppStore.getState().listMemory}
          onCreateMemory={useAppStore.getState().createMemory}
          onUpdateMemory={useAppStore.getState().updateMemory}
          onDeleteMemory={useAppStore.getState().deleteMemory}
          onLoadMemoryDiagnostics={useAppStore.getState().loadMemoryDiagnostics}
          onOpenLogFile={async () => {
            const result = await window.teachingSystem?.openLogFile()
            if (!result?.ok) throw new Error(result?.message ?? i18n.t('errors.openLog'))
          }}
          onOpenAppDataDir={async () => {
            const result = await window.teachingSystem?.openAppDataDir()
            if (!result?.ok) throw new Error(result?.message ?? i18n.t('errors.openAppData'))
          }}
        />
      )}

      {view === 'lessons' && (
        <section className="lesson-course-view" aria-label={t('nav.lessons')} data-reading-html={readingCourseHtml ? 'true' : undefined}>
          <div className="lesson-course-stage" data-reading-html={readingCourseHtml ? 'true' : undefined}>
            {readingCourseHtml && selectedPreviewFile ? (
              <section className="lesson-reader-panel" aria-label={t('lessons.previewAria')}>
                <div className="lesson-reader-frame-wrap">
                  <iframe
                    key={lessonFrameKey}
                    className="lesson-reader-frame"
                    title={selectedPreviewFile.title}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    src={appState.previewUrl || undefined}
                    srcDoc={appState.previewUrl ? undefined : appState.previewHtml || undefined}
                  />
                </div>
              </section>
            ) : (
              <section className="lesson-course-library" aria-label={t('lessons.libraryTitle')}>
                <div className="lesson-library-header">
                  <div>
                    <span>{selectedCourse ? t('lessons.selectedCourseFolder') : active?.missionTitle ?? t('overview.noWorkspace')}</span>
                    <h2>{selectedCourse?.name ?? t('lessons.libraryTitle')}</h2>
                  </div>
                  <button className="ghost-button" type="button" onClick={() => active && void openPath(active.lessonsDir)} disabled={!active}>
                    <FolderOpen size={16} />
                    {t('lessons.openDir')}
                  </button>
                </div>

                {visibleLessonCount === 0 ? (
                  <EmptyState
                    icon={BookOpen}
                    title={t('lessons.emptyTitle')}
                    detail={t('lessons.emptyDetail')}
                    action={active ? { label: t('lessons.emptyAction'), onClick: generateLesson } : undefined}
                  />
                ) : (
                  visibleCourses.map((course) => (
                    <section className="lesson-course-group" key={course.id}>
                      <div className="lesson-course-group-header">
                        <div className="lesson-course-group-title">
                          <BookCopy size={16} />
                          <strong>{course.name}</strong>
                        </div>
                        <span className="lesson-session-count">{t('lessons.sessionCount', { count: course.sessions.length })}</span>
                      </div>
                      <div className="lesson-card-grid">
                        {course.sessions.map((session, sessionIndex) => {
                          const lesson = session.lesson
                          const isSelected = lesson.absolutePath === appState.selectedLessonPath
                          return (
                            <button
                              className={`lesson-course-card${isSelected ? ' is-selected' : ''}`}
                              key={lesson.absolutePath}
                              type="button"
                              onClick={() => void loadLesson(lesson)}
                              style={{ animationDelay: `${Math.min(sessionIndex, 12) * 28}ms` }}
                            >
                              <span className="lesson-card-spine">{formatLessonIndex(lesson.id)}</span>
                              <span className="lesson-card-body">
                                <span className="lesson-card-title">{stripLessonIndexPrefix(session.name, lesson.id)}</span>
                                <span className="lesson-card-summary">{lesson.objective || lesson.prompt || lesson.relativePath}</span>
                                <span className="lesson-card-meta">
                                  <span className="lesson-card-duration">
                                    <Clock3 size={12} />
                                    {t('lessons.duration', { count: lesson.durationMinutes })}
                                  </span>
                                  <ArrowUpRight className="lesson-card-open-hint" size={14} aria-hidden="true" />
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ))
                )}
              </section>
            )}
          </div>
          {!readingCourseHtml && <OverviewLessonComposer active={active} className="lesson-bottom-composer" showModeSwitch={false} />}
        </section>
      )}

      {view === 'resources' && (
        <section className="resource-page" data-reading-html={readingResourceHtml ? 'true' : undefined}>
          {readingResourceHtml && selectedResourcePreviewFile ? (
            <section className="lesson-reader-panel" aria-label={selectedResourcePreviewFile.title}>
              <div className="lesson-reader-frame-wrap">
                <iframe
                  key={resourceFrameKey}
                  className="lesson-reader-frame"
                  title={selectedResourcePreviewFile.title}
                  sandbox="allow-scripts allow-forms"
                  srcDoc={selectedResourcePreviewFile.html}
                />
              </div>
            </section>
          ) : (
            <LessonStyleGallery
              currentStyleId={settings.workspace.lessonStyleId}
              onApplyLessonStyle={applyLessonStyle}
              onOpenPreview={openResourceHtmlPreview}
            />
          )}
        </section>
      )}

      {view === 'studio' && (
        <StudySpace showNotification={showNotification} />
      )}
    </main>
  )
}

// ================================================================
// Settings View
// ================================================================

function DialogModeSwitch() {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const overviewDialogMode = useAppStore((s) => s.overviewDialogMode)
  const setOverviewDialogMode = useAppStore((s) => s.setOverviewDialogMode)
  const setView = useAppStore((s) => s.setView)
  const mode: DialogMode = view === 'agent' ? 'chat' : overviewDialogMode
  const handleChange = (next: DialogMode): void => {
    if (view === 'agent') {
      if (next === 'teaching') {
        setOverviewDialogMode('teaching')
        setView('overview')
      }
      return
    }
    setOverviewDialogMode(next)
  }
  const options: Array<{ id: DialogMode; label: string; icon: LucideIcon }> = [
    { id: 'chat', label: t('overview.mode.chat'), icon: MessageSquare },
    { id: 'teaching', label: t('overview.mode.teaching'), icon: BookOpen }
  ]
  return (
    <div className="dialog-mode-switch" role="tablist" aria-label={t('overview.mode.aria')}>
      {options.map((option) => {
        const Icon = option.icon
        const isActive = mode === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`dialog-mode-switch-btn ${isActive ? 'is-active' : ''}`}
            onClick={() => handleChange(option.id)}
          >
            <Icon size={14} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function OverviewLessonComposer({
  active,
  className = '',
  showModeSwitch = true
}: {
  active: TeachingWorkspaceSummary | null
  className?: string
  showModeSwitch?: boolean
}) {
  const { t } = useTranslation()
  const {
    taskPrompt,
    setTaskPrompt,
    generating,
    agentChatBusy,
    agentChat,
    openTeachingConversationView
  } = useAppStore()
  const busy = generating || agentChatBusy
  const canSend = Boolean(active && taskPrompt.trim().length > 0 && !busy)
  // Every free-form teaching input goes through the conversation agent; it
  // clarifies when needed and calls the generate_lesson tool when ready.
  const submitToTeachingAgent = () => {
    if (!canSend) return
    const prompt = taskPrompt.trim()
    setTaskPrompt('')
    openTeachingConversationView()
    void agentChat(prompt, { mode: 'teaching' })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitToTeachingAgent()
  }
  return (
    <section className={`overview-dialog-shell${className ? ` ${className}` : ''}`} aria-label={t('lessons.composerAria')}>
      {showModeSwitch ? <DialogModeSwitch /> : null}
      <form className="overview-dialog-stack" onSubmit={onSubmit}>
        <div className="overview-dialog-card">
          <textarea
            value={taskPrompt}
            aria-label={t('overview.taskAria')}
            placeholder={active ? t('lessons.composerPlaceholder') : t('overview.placeholderEmpty')}
            onChange={(event) => setTaskPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isInputComposing(event)) return
                event.preventDefault()
                submitToTeachingAgent()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <div className="overview-dialog-actions">
              <OverviewModelPicker />
              <OverviewReasoningPicker />
              <button className="send-button overview-dialog-send" type="submit" aria-label={t('lessons.send')} disabled={!canSend}>
                {busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              </button>
            </div>
          </div>
        </div>
        <div className="overview-dialog-statusbar" aria-label={t('overview.runtimeEnv')}>
          <div className="overview-dialog-status-group overview-dialog-pickers">
            <ProjectFolderPicker />
            <GitBranchPicker workspaceRoot={active?.rootPath ?? ''} />
          </div>
          <div className="overview-dialog-status-group">
            {busy ? <span className="overview-dialog-status-text">{t('lessons.composerTitle')}</span> : null}
          </div>
        </div>
      </form>
    </section>
  )
}

function OverviewChat({ active }: { active: TeachingWorkspaceSummary | null }) {
  const { t } = useTranslation()
  const {
    agentTurns,
    agentChatBusy,
    agentStatus,
    agentInput,
    setAgentInput,
    agentInputHistory,
    rememberAgentInput,
    generating,
    agentChat,
    cancelAgentChat
  } = useAppStore()
  const view = useAppStore((s) => s.view)
  const overviewDialogMode = useAppStore((s) => s.overviewDialogMode)
  const appState = useAppStore((s) => s.appState)
  const isTeachingMode = view !== 'agent' && overviewDialogMode === 'teaching'
  const inputValue = agentInput
  const busy = isTeachingMode ? generating || agentChatBusy : agentChatBusy
  const canSend = Boolean(active && inputValue.trim() && !busy)
  const hasConversation = agentTurns.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null)
  const [inputHistoryDraft, setInputHistoryDraft] = useState('')
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const viewingBusyPendingConversation = agentChatBusy && activeConversationId === pendingAgentConversation?.summary.id
  const canCancelAgentChat = agentChatBusy && Boolean(pendingAgentConversation)
  const sentInputHistory = useMemo(
    () => mergeAgentInputHistory(agentInputHistory, userTurnInputHistory(agentTurns)),
    [agentInputHistory, agentTurns]
  )
  const submitTeachingPrompt = (value: string): void => {
    const prompt = value.trim()
    if (!prompt) return
    rememberAgentInput(prompt)
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
    setAgentInput('')
    // One brain: the teaching conversation owns clarification AND generation
    // (via its generate_lesson tool). No parallel pipeline hand-off here.
    void agentChat(prompt, { mode: 'teaching' })
  }
  const submitChatPrompt = (value: string): void => {
    const prompt = value.trim()
    if (!prompt) return
    rememberAgentInput(prompt)
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
    void agentChat(prompt, { mode: 'temporary' })
  }
  const submitCurrentMode = (): void => {
    if (!canSend) return
    if (isTeachingMode) submitTeachingPrompt(inputValue)
    else submitChatPrompt(inputValue)
  }
  const setInputFromHistory = (value: string): void => {
    setAgentInput(value)
    window.requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      node.setSelectionRange(value.length, value.length)
    })
  }
  const navigateSentInputHistory = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    if (isInputComposing(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (sentInputHistory.length === 0) return false

    const { selectionStart, selectionEnd, value } = event.currentTarget
    if (selectionStart !== selectionEnd) return false
    if (event.key === 'ArrowUp' && selectionStart !== 0) return false
    if (event.key === 'ArrowDown' && selectionStart !== value.length) return false

    event.preventDefault()
    if (event.key === 'ArrowUp') {
      const nextIndex = inputHistoryIndex === null
        ? sentInputHistory.length - 1
        : Math.max(0, inputHistoryIndex - 1)
      if (inputHistoryIndex === null) setInputHistoryDraft(value)
      setInputHistoryIndex(nextIndex)
      setInputFromHistory(sentInputHistory[nextIndex] ?? '')
      return true
    }

    if (inputHistoryIndex === null) return true
    const nextIndex = inputHistoryIndex + 1
    if (nextIndex >= sentInputHistory.length) {
      setInputHistoryIndex(null)
      setInputFromHistory(inputHistoryDraft)
      setInputHistoryDraft('')
      return true
    }
    setInputHistoryIndex(nextIndex)
    setInputFromHistory(sentInputHistory[nextIndex] ?? '')
    return true
  }

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [agentTurns, agentStatus])
  const activeAssistantTurnId = viewingBusyPendingConversation
    ? [...agentTurns].reverse().find((turn) => turn.role === 'assistant')?.id
    : null

  return (
    <section
      className={`overview-dialog-shell${hasConversation ? ' has-conversation' : ''}`}
      aria-label={t('overview.aria')}
    >
      {hasConversation && (
        <div ref={scrollRef} className="overview-dialog-thread">
          <div className="overview-dialog-thread-inner">
          {agentTurns.map((turn) => {
            const isBusyTurn = activeAssistantTurnId === turn.id
            const hasProcess =
              turn.role === 'assistant' &&
              (Boolean(turn.processEvents?.length) || Boolean(turn.toolCalls?.length))
            const content = turn.content || (turn.role === 'assistant' && isBusyTurn && !hasProcess ? '正在回复…' : '')
            return (
              <div
                key={turn.id}
                className={`overview-dialog-message ${turn.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                {turn.role === 'assistant' && <AgentProcessPanel turn={turn} busy={isBusyTurn} compact />}
                {content ? <MarkdownMessage content={content} tone={turn.role} compact /> : null}
              </div>
            )
          })}
          </div>
        </div>
      )}

      <DialogModeSwitch />
      <form
        className="overview-dialog-stack"
        aria-label={t('overview.formAria')}
        onSubmit={(event) => {
          event.preventDefault()
          submitCurrentMode()
        }}
      >
        <div className="overview-dialog-card">
          <textarea
            ref={inputRef}
            value={inputValue}
            aria-label={t('overview.taskAria')}
            placeholder={active
              ? isTeachingMode
                ? '说说你想学什么、当前基础，以及希望先解决什么问题…'
                : '输入对话内容...'
              : t('overview.placeholderEmpty')}
            onChange={(event) => {
              setAgentInput(event.target.value)
              setInputHistoryIndex(null)
              setInputHistoryDraft('')
            }}
            onKeyDown={(event) => {
              if (navigateSentInputHistory(event)) return
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isInputComposing(event)) return
                event.preventDefault()
                submitCurrentMode()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <div className="overview-dialog-actions">
              <OverviewModelPicker />
              <OverviewReasoningPicker />
              <button
                className="send-button overview-dialog-send"
                type={canCancelAgentChat ? 'button' : 'submit'}
                aria-label={canCancelAgentChat ? '中断对话' : '发送消息'}
                title={canCancelAgentChat ? '中断对话' : '发送消息'}
                disabled={canCancelAgentChat ? false : !canSend}
                onClick={canCancelAgentChat ? () => void cancelAgentChat() : undefined}
              >
                {canCancelAgentChat ? <Square size={16} /> : busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              </button>
            </div>
          </div>
        </div>
        <div className="overview-dialog-statusbar" aria-label={t('overview.runtimeEnv')}>
          <div className="overview-dialog-status-group overview-dialog-pickers">
            <ProjectFolderPicker mode={isTeachingMode ? 'workspace' : 'temporary'} />
            {isTeachingMode ? <GitBranchPicker workspaceRoot={active?.rootPath ?? ''} /> : null}
          </div>
          <div className="overview-dialog-status-group">
            {isTeachingMode && generating ? <span className="overview-dialog-status-text">{t('lessons.composerTitle')}</span> : null}
            {!isTeachingMode && agentStatus ? <span className="overview-dialog-status-text">{agentStatus}</span> : null}
          </div>
        </div>
      </form>
    </section>
  )
}

function MarkdownMessage({
  content,
  tone,
  compact = false
}: {
  content: string
  tone: AgentChatTurn['role']
  compact?: boolean
}) {
  return (
    <div className={`markdown-message markdown-message--${tone}${compact ? ' is-compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

const markdownComponents: Components = {
  a: ({ node: _node, href, children, ...props }) => (
    <a
      {...props}
      href={href}
      rel="noreferrer"
      target="_blank"
      onClick={(event) => handleMarkdownLinkClick(event, href)}
    >
      {children}
    </a>
  ),
  code: ({ node: _node, className, children, ...props }) => (
    <code {...props} className={className}>
      {children}
    </code>
  )
}

function handleMarkdownLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, href?: string): void {
  if (!href) return
  event.preventDefault()
  void window.teachingSystem?.openExternal(href)
}

function AgentProcessPanel({
  turn,
  busy,
  compact = false
}: {
  turn: AgentChatTurn
  busy: boolean
  compact?: boolean
}) {
  const events = turn.processEvents ?? []
  const toolCalls = turn.toolCalls ?? []
  const timeline = buildAgentProcessTimeline(turn)
  if (events.length === 0 && toolCalls.length === 0) return null
  return (
    <div className={`agent-process-panel${compact ? ' is-compact' : ''}`}>
      <div className="agent-process-header">
        <BrainCircuit size={compact ? 13 : 14} />
        <strong>思考过程</strong>
        {busy ? <span>进行中</span> : <span>已记录</span>}
      </div>
      <div className="agent-process-list">
        {timeline.map((item, index) => (
          item.kind === 'event' ? (
            <AgentProcessEventRow
              key={item.event.id}
              event={item.event}
              active={busy && index === timeline.length - 1 && item.event.status !== 'done'}
            >
              <AgentProcessToolDetail event={item.event} toolCall={item.toolCall} />
            </AgentProcessEventRow>
          ) : (
            <ToolCallCard key={item.toolCall.id} toolCall={item.toolCall} />
          )
        ))}
      </div>
    </div>
  )
}

function AgentProcessEventRow({
  event,
  active,
  children
}: {
  event: AgentChatProcessEvent
  active: boolean
  children?: ReactNode
}) {
  return (
    <div className={`agent-process-event${event.isError ? ' is-error' : ''}${active ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon">
        <AgentProcessIcon event={event} active={active} />
      </span>
      <div className="agent-process-event-copy">
        <strong>{event.title}</strong>
        {event.detail ? <small>{event.detail}</small> : null}
        {children}
      </div>
    </div>
  )
}

function AgentProcessToolDetail({
  event,
  toolCall
}: {
  event: AgentChatProcessEvent
  toolCall?: NonNullable<AgentChatTurn['toolCalls']>[number]
}) {
  const [open, setOpen] = useState(false)
  if (event.kind !== 'tool_call' && event.kind !== 'tool_result') return null

  const argsPretty = toolCall?.arguments ? prettyJson(toolCall.arguments) : ''
  const hasResult = event.kind === 'tool_result' && (toolCall?.result !== undefined || Boolean(event.detail))
  const resultPretty = toolCall?.result !== undefined ? prettyJson(toolCall.result ?? '') : (event.kind === 'tool_result' ? event.detail ?? '' : '')
  const hasExpandableDetail = Boolean(argsPretty || resultPretty)
  if (!hasExpandableDetail) return null

  return (
    <div className="agent-process-tool-detail">
      <button
        aria-expanded={open}
        className="agent-process-tool-detail-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{hasResult ? '查看工具结果' : '查看工具参数'}</span>
        <ChevronDown className={open ? 'is-open' : ''} size={12} />
      </button>
      {open && (
        <div className="tool-call-body is-inline">
          {argsPretty && (
            <div className="tool-call-section">
              <div>参数</div>
              <pre>{argsPretty}</pre>
            </div>
          )}
          {hasResult && resultPretty && (
            <div className="tool-call-section">
              <div>结果</div>
              <pre>{resultPretty}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentProcessIcon({
  event,
  active
}: {
  event: AgentChatProcessEvent
  active: boolean
}) {
  if (event.isError || event.status === 'error') return <AlertCircle size={13} />
  if (active) return <Loader2 className="spin" size={13} />
  if (event.kind === 'tool_call') return <Search size={13} />
  if (event.kind === 'tool_result') return <CheckCircle2 size={13} />
  if (event.status === 'done') return <CheckCircle2 size={13} />
  if (event.status === 'answering') return <Sparkles size={13} />
  if (event.status === 'tool_running' || event.status === 'tool_done') return <Wrench size={13} />
  return <Clock3 size={13} />
}

function ToolCallCard({ toolCall }: { toolCall: NonNullable<AgentChatTurn['toolCalls']>[number] }) {
  const [open, setOpen] = useState(false)
  const name = toolCall.name || 'tool'
  const argsPretty = prettyJson(toolCall.arguments)
  const hasResult = toolCall.result !== undefined
  return (
    <div className={`tool-call-card${toolCall.isError ? ' is-error' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="tool-call-trigger"
      >
        <Search size={14} />
        <strong>{name}</strong>
        {hasResult && (
          <span className="tool-call-state">
            {toolCall.isError ? '失败' : '完成'}
          </span>
        )}
        <ChevronDown className={open ? 'is-open' : ''} size={13} />
      </button>
      {open && (
        <div className="tool-call-body">
          {argsPretty && (
            <div className="tool-call-section">
              <div>参数</div>
              <pre>{argsPretty}</pre>
            </div>
          )}
          {hasResult && (
            <div className="tool-call-section">
              <div>结果</div>
              <pre>{prettyJson(toolCall.result ?? '')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ================================================================
// Empty State Component
// ================================================================

function EmptyState({
  icon: Icon,
  title,
  detail,
  action
}: {
  icon: LucideIcon
  title: string
  detail: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="empty-state">
      <Icon size={20} />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
        {action && (
          <button className="empty-state-action" type="button" onClick={action.onClick}>
            <Play size={13} />
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

// ================================================================
// Helpers
// ================================================================

function formatLessonIndex(id: string): string {
  const numeric = id.match(/\d+/)?.[0]
  if (!numeric) return id
  return String(Number.parseInt(numeric, 10)).padStart(2, '0')
}

function stripLessonIndexPrefix(name: string, id: string): string {
  if (!id || !name.startsWith(id)) return name
  const rest = name.slice(id.length).replace(/^[\s._-]+/, '')
  return rest || name
}

function runtimeMeterWidth(
  runtime: TeachingRuntimeState,
  active: TeachingWorkspaceSummary | null,
  generating: boolean
): string {
  if (runtime.status === 'error') return '12%'
  if (generating) return '48%'
  if (active?.lessons.length && active.records.length) return '82%'
  if (active?.lessons.length) return '64%'
  if (active) return '28%'
  return '16%'
}

function suggestedCourseName(workspace: TeachingWorkspaceSummary, prompt: string): string {
  const topic = prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^我想(先)?学习/, '')
    .replace(/^学习/, '')
    .replace(/^如何/, '')
    .split(/[。.!?？\n]/)[0]
    ?.trim()

  if (topic) return topic.slice(0, 32)
  return workspace.courses[0]?.name ?? workspace.name
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stepLabel(step: LessonStreamStatus['step']): string {
  const labels: Record<LessonStreamStatus['step'], string> = {
    calling: 'calling model',
    streaming: 'streaming output',
    validating: 'validating JSON',
    rendering: 'rendering artifacts',
    done: 'done',
    error: 'error'
  }
  return labels[step]
}

function prettyJson(value: string): string {
  if (!value) return ''
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function streamingPreviewHtml(liveText: string, workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:760px;margin:0 auto;padding:38px 30px}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}pre{white-space:pre-wrap;line-height:1.7;color:#40506a;background:#f4f7fb;border:1px solid #e8edf5;border-radius:16px;padding:18px;min-height:180px}
</style></head><body><main><div class="badge">TeachOS · Streaming</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(i18n.t('preview.streamingHint'))}</p><pre>${escapeHtml(liveText || i18n.t('preview.streamingPlaceholder'))}</pre></main></body></html>`
}

function emptyPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:680px;margin:0 auto;padding:46px 34px}p{color:#68778f;line-height:1.8}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}
</style></head><body><main><div class="badge">TeachOS</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(workspace.missionExcerpt)}</p><p>${escapeHtml(i18n.t('preview.emptyHint'))}</p></main></body></html>`
}

function loadingPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{display:grid;place-items:center;min-height:360px;padding:34px}p{color:#68778f}
</style></head><body><main><div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(i18n.t('preview.loadingHint'))}</p></div></main></body></html>`
}

export { App, AppErrorBoundary }
