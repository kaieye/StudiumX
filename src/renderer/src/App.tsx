import {
  AlertCircle,
  AlertTriangle,
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
  Command,
  Database,
  ExternalLink,
  FileCheck2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  History,
  Home,
  Info,
  KeyRound,
  LibraryBig,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  Minus,
  Monitor,
  Moon,
  PanelLeft,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Play,
  SendHorizontal,
  Upload,
  X,
  Wrench,
  Zap
} from 'lucide-react'
import type { CSSProperties, ErrorInfo, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Component, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { create } from 'zustand'
import i18n from './i18n'
import {
  TEACHING_MODEL_PROVIDER_PRESETS,
  type AgentChatProcessEvent,
  type AgentChatStreamChunk,
  type AgentChatStreamStatus,
  type AgentChatStreamToolEvent,
  type AgentChatTurn,
  type AgentChatMessage,
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
  type TeachingAppState,
  type TeachingRuntimeState,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type UpdateTeachingMemoryPayload,
  type WindowControlAction,
  type WorkspaceFileNode,
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

type StoreState = {
  view: WorkspaceView
  settingsSection: SettingsSection
  sidebarCollapsed: boolean
  loading: boolean
  generating: boolean
  error: UserError | null
  searchQuery: string
  taskPrompt: string
  appState: TeachingAppState
  settings: TeachingSettingsV1
  setView: (view: WorkspaceView) => void
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
  importWorkspace: () => Promise<void>
  updateMission: () => Promise<void>
  generateLesson: () => Promise<void>
  generateLessonStream: () => Promise<void>
  loadLesson: (lesson: LessonSummary) => Promise<void>
  openPath: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  showNotification: (title: string, body: string) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (providerId: string) => Promise<ListUpstreamModelsResult>
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
  agentToolsSupported: boolean | null
  setAgentInput: (input: string) => void
  clearAgentChat: () => void
  loadAgentConversation: (conversationId: string) => Promise<void>
  agentChat: () => Promise<void>
}

// ================================================================
// Constants
// ================================================================

const navItems = [
  { id: 'overview', icon: Home },
  { id: 'agent', icon: Bot },
  { id: 'resources', icon: LibraryBig }
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
  previewHtml: '',
  selectedLessonPath: null,
  runtime: defaultRuntime
}

const emptySettings: TeachingSettingsV1 = {
  version: 1,
  locale: 'zh-CN',
  theme: 'system',
  uiFontScale: 1,
  density: 'comfortable',
  provider: {
    activeProviderId: 'deepseek',
    providers: TEACHING_MODEL_PROVIDER_PRESETS.map((preset) => ({ ...preset, apiKey: '' })),
    proxy: {
      enabled: false,
      url: ''
    }
  },
  generator: {
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    endpointFormat: 'chat_completions',
    temperature: 0.4,
    maxOutputTokens: 4096,
    lessonDurationMinutes: 15,
    includeRetrievalPractice: true,
    generateReference: true,
    generateLearningRecord: true,
    structuredOutput: true,
    streaming: false,
    requestTimeoutMs: 60_000
  },
  workspace: {
    defaultRoot: '',
    confirmBeforeGenerating: false,
    autoOpenGeneratedLesson: false
  },
  worktree: {
    rootPath: ''
  },
  memory: {
    enabled: true,
    maxInjected: 4
  },
  tools: {
    enabled: false,
    webSearch: true,
    webFetch: false,
    maxIterations: 4
  },
  notifications: {
    enabled: true,
    lessonGenerated: true,
    workspaceImported: true,
    errors: true
  },
  privacy: {
    maskApiKeys: true,
    allowExternalLinks: true
  },
  appBehavior: {
    openAtLogin: false,
    startMinimized: false,
    closeAction: 'quit',
    closeToTray: false
  },
  log: {
    enabled: true,
    retentionDays: 14
  }
}

function normalizeRendererSettings(input: TeachingSettingsPatch | TeachingSettingsV1 | null | undefined): TeachingSettingsV1 {
  const settings = input ?? {}

  return {
    ...emptySettings,
    ...settings,
    provider: {
      ...emptySettings.provider,
      ...(settings.provider ?? {}),
      proxy: {
        ...emptySettings.provider.proxy,
        ...(settings.provider?.proxy ?? {})
      },
      providers:
        Array.isArray(settings.provider?.providers) && settings.provider.providers.length > 0
          ? settings.provider.providers
          : emptySettings.provider.providers
    },
    generator: {
      ...emptySettings.generator,
      ...(settings.generator ?? {})
    },
    workspace: {
      ...emptySettings.workspace,
      ...(settings.workspace ?? {})
    },
    worktree: {
      ...emptySettings.worktree,
      ...(settings.worktree ?? {})
    },
    memory: {
      ...emptySettings.memory,
      ...(settings.memory ?? {})
    },
    tools: {
      ...emptySettings.tools,
      ...(settings.tools ?? {})
    },
    notifications: {
      ...emptySettings.notifications,
      ...(settings.notifications ?? {})
    },
    privacy: {
      ...emptySettings.privacy,
      ...(settings.privacy ?? {})
    },
    appBehavior: {
      ...emptySettings.appBehavior,
      ...(settings.appBehavior ?? {})
    },
    log: {
      ...emptySettings.log,
      ...(settings.log ?? {})
    }
  }
}

const defaultPrompt =
  '我想先学习如何把 teach 技能包的 MISSION、RESOURCES 和 lessons 组织成一个 Electron 桌面应用的 MVP。'

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

const settingsNavItems = [
  { id: 'general', icon: Settings },
  { id: 'appearance', icon: Palette },
  { id: 'model', icon: Bot },
  { id: 'generation', icon: SlidersHorizontal },
  { id: 'tools', icon: Wrench },
  { id: 'workspace', icon: FolderOpen },
  { id: 'worktree', icon: GitBranch },
  { id: 'memory', icon: BrainCircuit },
  { id: 'notifications', icon: Bell },
  { id: 'privacy', icon: Lock },
  { id: 'about', icon: Info }
] satisfies Array<{ id: SettingsSection; icon: LucideIcon }>

const modelSettingsProviderIds = ['deepseek', 'glm', 'custom'] as const

// ================================================================
// Preset tutorial cards — built-in placeholders for future tutorials
// ================================================================

const PRESET_TUTORIALS: { icon: LucideIcon; titleKey: string; detailKey: string; tagKey: string }[] = [
  { icon: BookOpen, titleKey: 'resources.tutorials.start.title', detailKey: 'resources.tutorials.start.detail', tagKey: 'resources.tutorials.start.tag' },
  { icon: BrainCircuit, titleKey: 'resources.tutorials.concepts.title', detailKey: 'resources.tutorials.concepts.detail', tagKey: 'resources.tutorials.concepts.tag' },
  { icon: Play, titleKey: 'resources.tutorials.practice.title', detailKey: 'resources.tutorials.practice.detail', tagKey: 'resources.tutorials.practice.tag' },
  { icon: Sparkles, titleKey: 'resources.tutorials.advanced.title', detailKey: 'resources.tutorials.advanced.detail', tagKey: 'resources.tutorials.advanced.tag' },
  { icon: Database, titleKey: 'resources.tutorials.cases.title', detailKey: 'resources.tutorials.cases.detail', tagKey: 'resources.tutorials.cases.tag' },
  { icon: Info, titleKey: 'resources.tutorials.faq.title', detailKey: 'resources.tutorials.faq.detail', tagKey: 'resources.tutorials.faq.tag' }
]

// ================================================================
// Settings helpers — resolve active provider, runtime label, theme side effects
// ================================================================

function activeModelProvider(settings: TeachingSettingsV1): TeachingModelProviderProfile {
  const provider =
    settings.provider.providers.find((item) => item.id === settings.generator.providerId) ??
    settings.provider.providers.find((item) => item.id === settings.provider.activeProviderId) ??
    settings.provider.providers[0]
  return provider
}

function runtimeProviderLabel(settings: TeachingSettingsV1): string {
  const provider = activeModelProvider(settings)
  const model = settings.generator.model || i18n.t('common.auto')
  return `${provider?.name ?? i18n.t('common.modelProvider')} · ${model}`
}

function applySettingsSideEffects(settings: TeachingSettingsV1): void {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.density = settings.density
  root.style.fontSize = `${settings.uiFontScale * 100}%`
  void i18n.changeLanguage(settings.locale)
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

const useAppStore = create<StoreState>((set, get) => ({
  view: 'overview',
  settingsSection: 'general',
  sidebarCollapsed: false,
  loading: true,
  generating: false,
  error: null,
  searchQuery: '',
  taskPrompt: defaultPrompt,
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
  agentToolsSupported: null,
  setAgentInput: (agentInput) => set({ agentInput }),
  clearAgentChat: () => set({ agentTurns: [], activeConversationId: null, agentStatus: '', agentToolsSupported: null, agentChatBusy: false }),
  setView: (view) => {
    set({ view })
    if (view === 'review') void get().loadReviewCards()
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
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
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
      set({ appState: state, taskPrompt: defaultPrompt, agentTurns: [], activeConversationId: null, agentStatus: '', agentToolsSupported: null, loading: false })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  importWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return
    set({ loading: true, error: null })
    try {
      const result = await api.importWorkspace()
      if (result.canceled || !result.state) {
        set({ loading: false })
        return
      }
      set({
        appState: result.state,
        taskPrompt: result.state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        loading: false
      })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.workspaceImported) {
        const wsName = result.state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName')
        void get().showNotification(i18n.t('notify.imported.title'), i18n.t('notify.imported.body', { name: wsName }))
      }
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.importFailed.title'), toUserError(error).message)
      }
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
  generateLesson: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = get().taskPrompt.trim()
    const settings = get().settings
    if (!workspace || !prompt) return
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
        courseName: suggestedCourseName(workspace, prompt)
      })
      set({
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
  generateLessonStream: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = get().taskPrompt.trim()
    const settings = get().settings
    if (!workspace || !prompt) return
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
          courseName: suggestedCourseName(workspace, prompt)
        },
        (chunk: LessonStreamChunk) => {
          liveText += chunk.delta
          set({ appState: { ...get().appState, previewHtml: streamingPreviewHtml(liveText, workspace) } })
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
      if (!('error' in done)) {
        set({ appState: done.state, taskPrompt: nextPrompt, generating: false })
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
  loadAgentConversation: async (conversationId) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    set({ error: null })
    try {
      const conversation = await api.readAgentConversation({ workspaceId: workspace.id, conversationId })
      const latestUserTurn = [...conversation.turns].reverse().find((turn) => turn.role === 'user')
      set({
        view: 'agent',
        agentTurns: conversation.turns,
        activeConversationId: conversation.id,
        agentChatBusy: false,
        agentStatus: '',
        agentToolsSupported: null,
        agentInput: '',
        taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : get().taskPrompt
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  agentChat: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const input = get().agentInput.trim()
    if (!workspace || !input || get().agentChatBusy) return
    const settings = get().settings
    const createdAt = new Date().toISOString()
    const userTurn: AgentChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: input,
      createdAt
    }
    // Build the prior transcript (text-only) to send back for multi-turn context.
    const priorMessages: AgentChatMessage[] = get().agentTurns
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .map((turn) => ({ role: turn.role, content: turn.content }))
    const assistantId = `a-${Date.now()}`
    const assistantTurn: AgentChatTurn = {
      id: assistantId,
      role: 'assistant',
      content: '',
      processEvents: [createAgentStatusProcessEvent('thinking')],
      createdAt
    }
    set({
      agentChatBusy: true,
      agentInput: '',
      agentStatus: '思考中…',
      agentToolsSupported: null,
      agentTurns: [...get().agentTurns, userTurn, assistantTurn]
    })
    try {
      const done = await api.agentChatStream(
        { workspaceId: workspace.id, messages: priorMessages, userInput: input },
        (chunk: AgentChatStreamChunk) => {
          const turns = [...get().agentTurns]
          const idx = turns.findIndex((t) => t.id === assistantId)
          if (idx >= 0) {
            turns[idx] = { ...turns[idx], content: turns[idx].content + chunk.delta }
            set({ agentTurns: turns })
          }
        },
        (status: AgentChatStreamStatus) => {
          const label = agentStatusLabel(status.status)
          set({
            agentStatus: status.message ? `${label} ${status.message}` : label,
            agentTurns: updateAgentAssistantTurn(get().agentTurns, assistantId, (turn) => ({
              ...turn,
              processEvents: appendAgentProcessEvent(
                turn.processEvents,
                createAgentStatusProcessEvent(status.status, status.message)
              )
            }))
          })
        },
        (event: AgentChatStreamToolEvent) => {
          const turns = [...get().agentTurns]
          const idx = turns.findIndex((t) => t.id === assistantId)
          if (idx < 0) return
          const existing = turns[idx].toolCalls ?? []
          const toolCallId = event.toolCall.id
          const existingIdx = existing.findIndex((tc) => tc.id === toolCallId)
          if (existingIdx >= 0 && event.result !== undefined) {
            const updated = [...existing]
            updated[existingIdx] = {
              ...updated[existingIdx],
              result: event.result,
              isError: event.isError
            }
            turns[idx] = { ...turns[idx], toolCalls: updated }
          } else if (existingIdx < 0) {
            turns[idx] = {
              ...turns[idx],
              toolCalls: [
                ...existing,
                {
                  id: toolCallId,
                  name: event.toolCall.name,
                  arguments: event.toolCall.arguments,
                  result: event.result,
                  isError: event.isError
                }
              ]
            }
          }
          turns[idx] = {
            ...turns[idx],
            processEvents: appendAgentProcessEvent(
              turns[idx].processEvents,
              event.result !== undefined
                ? createAgentToolResultProcessEvent(event)
                : createAgentToolCallProcessEvent(event)
            )
          }
          set({ agentTurns: turns })
        }
      )
      if ('error' in done && done.error) {
        const userError = toUserError(new Error(done.message))
        set({ agentChatBusy: false, agentStatus: '', error: userError })
        return
      }
      if (!('error' in done)) {
        const latestUserTurn = [...done.turns].reverse().find((turn) => turn.role === 'user')
        const currentTurns = get().agentTurns
        const reconciledTurns = reconcileAgentTurnsWithLocalProcess(done.turns, currentTurns)
        // Reconcile with the server-authoritative transcript.
        set({
          agentTurns: reconciledTurns,
          agentStatus: '保存对话…',
          agentToolsSupported: done.toolsSupported,
          taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : get().taskPrompt
        })
        try {
          const saved = await api.saveAgentConversation({
            workspaceId: workspace.id,
            conversationId: get().activeConversationId,
            selectedLessonPath: get().appState.selectedLessonPath,
            turns: reconciledTurns
          })
          set({
            appState: saved.state,
            activeConversationId: saved.conversation.id
          })
        } catch (saveError) {
          set({ error: toUserError(saveError) })
        } finally {
          set({ agentChatBusy: false, agentStatus: '' })
        }
      }
    } catch (error) {
      const userError = toUserError(error)
      set({
        agentChatBusy: false,
        agentStatus: '',
        error: userError,
        agentTurns: get().agentTurns.filter((t) => t.id !== assistantId)
      })
    }
  },
  loadLesson: async (lesson) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    set({
      appState: {
        ...get().appState,
        selectedLessonPath: lesson.absolutePath,
        previewHtml: loadingPreviewHtml(workspace)
      }
    })
    try {
      const result = await api.readLesson({
        workspaceId: workspace.id,
        lessonPath: lesson.absolutePath
      })
      set({ appState: { ...get().appState, selectedLessonPath: lesson.absolutePath, previewHtml: result.html } })
    } catch (error) {
      set({ error: toUserError(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace) } })
    }
  },
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
  listUpstreamModels: async (providerId) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'TeachOS preload API unavailable.' }
    try {
      return await api.listUpstreamModels(providerId)
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
    selectWorkspace,
    createWorkspace,
    showNotification
  } = useAppStore()

  const active = appState.activeWorkspace
  const selectedLessonPath = appState.selectedLessonPath

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
              onClick={() => setView(item.id)}
            >
              <Icon size={17} />
              <span className="collapsible-label">{t(`nav.${item.id}`)}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-section">
        <div className="section-heading">
          <span className="collapsible-label">{t('sidebar.workspace')}</span>
          <button className="icon-button" type="button" aria-label={t('sidebar.newWorkspace')} onClick={createWorkspace}>
            <Plus size={15} />
          </button>
        </div>
        {appState.workspaces.map((workspace) => (
          <WorkspaceTree
            key={workspace.id}
            workspace={workspace}
            activeWorkspaceId={active?.id ?? null}
            selectedLessonPath={selectedLessonPath}
            onSelectWorkspace={(workspaceId) => selectWorkspace(workspaceId)}
          />
        ))}
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

function WorkspaceTree({
  workspace,
  activeWorkspaceId,
  selectedLessonPath,
  onSelectWorkspace
}: {
  workspace: TeachingWorkspaceSummary
  activeWorkspaceId: string | null
  selectedLessonPath: string | null
  onSelectWorkspace: (workspaceId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const loadLesson = useAppStore((s) => s.loadLesson)
  const loadAgentConversation = useAppStore((s) => s.loadAgentConversation)
  const openPath = useAppStore((s) => s.openPath)
  const setView = useAppStore((s) => s.setView)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const isActive = workspace.id === activeWorkspaceId
  const fileTree = workspace.fileTree ?? []
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!isActive) return
    setExpandedPaths((current) => {
      if (current.has('')) return current
      const next = new Set(current)
      next.add('')
      return next
    })
  }, [isActive])

  const rootExpanded = expandedPaths.has('')
  const togglePath = (relativePath: string): void => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }

  const ensureWorkspaceSelected = async (): Promise<void> => {
    if (!isActive) await onSelectWorkspace(workspace.id)
  }

  return (
    <div className={`workspace-tree ${isActive ? 'is-active' : ''}`}>
      <div className={`workspace-item ${isActive ? 'is-selected' : ''}`}>
        <button
          className="workspace-main-button"
          type="button"
          onClick={() => void onSelectWorkspace(workspace.id)}
          title={workspace.rootPath}
        >
          {rootExpanded ? <FolderOpen size={17} /> : <Folder size={17} />}
          <span className="collapsible-label">{workspace.name}</span>
        </button>
        <button
          className="workspace-toggle-button"
          type="button"
          aria-label={rootExpanded ? t('sidebar.collapseFolder') : t('sidebar.expandFolder')}
          title={rootExpanded ? t('sidebar.collapseFolder') : t('sidebar.expandFolder')}
          onClick={() => togglePath('')}
        >
          {rootExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      </div>

      {rootExpanded && fileTree.length > 0 ? (
        <div className="workspace-file-tree">
          {fileTree.map((node) => (
            <WorkspaceFileNodeRow
              key={node.relativePath}
              node={node}
              workspace={workspace}
              level={0}
              expandedPaths={expandedPaths}
              selectedLessonPath={selectedLessonPath}
              activeConversationId={activeConversationId}
              onToggle={togglePath}
              onEnsureWorkspaceSelected={ensureWorkspaceSelected}
              onOpenPath={(path) => void openPath(path)}
              onOpenLesson={(lesson) => {
                setView('lessons')
                void loadLesson(lesson)
              }}
              onOpenConversation={(conversationId) => void loadAgentConversation(conversationId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceFileNodeRow({
  node,
  workspace,
  level,
  expandedPaths,
  selectedLessonPath,
  activeConversationId,
  onToggle,
  onEnsureWorkspaceSelected,
  onOpenPath,
  onOpenLesson,
  onOpenConversation
}: {
  node: WorkspaceFileNode
  workspace: TeachingWorkspaceSummary
  level: number
  expandedPaths: Set<string>
  selectedLessonPath: string | null
  activeConversationId: string | null
  onToggle: (relativePath: string) => void
  onEnsureWorkspaceSelected: () => Promise<void>
  onOpenPath: (path: string) => void
  onOpenLesson: (lesson: LessonSummary) => void
  onOpenConversation: (conversationId: string) => void
}) {
  const { t } = useTranslation()
  const isDirectory = node.kind === 'directory'
  const isExpanded = expandedPaths.has(node.relativePath)
  const lesson = (workspace.lessons ?? []).find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const conversation = (workspace.conversations ?? []).find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const isSelected = Boolean(
    (lesson && lesson.absolutePath === selectedLessonPath) ||
    (conversation && conversation.id === activeConversationId)
  )
  const Icon = isDirectory
    ? isExpanded
      ? FolderOpen
      : Folder
    : conversation
      ? MessageSquare
      : FileText

  const handleOpen = async (): Promise<void> => {
    if (isDirectory) {
      onToggle(node.relativePath)
      return
    }
    await onEnsureWorkspaceSelected()
    if (lesson) {
      onOpenLesson(lesson)
      return
    }
    if (conversation) {
      onOpenConversation(conversation.id)
      return
    }
    onOpenPath(node.absolutePath)
  }

  return (
    <div className="workspace-node">
      <div
        className={`workspace-node-row ${isSelected ? 'is-selected' : ''} ${conversation ? 'is-conversation' : ''}`}
        style={{ paddingLeft: 4 + level * 12 }}
      >
        {isDirectory ? (
          <button
            className="workspace-node-toggle"
            type="button"
            aria-label={isExpanded ? t('sidebar.collapseFolder') : t('sidebar.expandFolder')}
            title={isExpanded ? t('sidebar.collapseFolder') : t('sidebar.expandFolder')}
            onClick={() => onToggle(node.relativePath)}
          >
            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="workspace-node-toggle-placeholder" />
        )}
        <button className="workspace-node-button" type="button" title={node.absolutePath} onClick={() => void handleOpen()}>
          <Icon size={13} />
          <span className="collapsible-label">{conversation?.title ?? lesson?.sessionName ?? node.name}</span>
        </button>
      </div>
      {isDirectory && isExpanded && node.children?.length ? (
        <div className="workspace-node-children">
          {node.children.map((child) => (
            <WorkspaceFileNodeRow
              key={child.relativePath}
              node={child}
              workspace={workspace}
              level={level + 1}
              expandedPaths={expandedPaths}
              selectedLessonPath={selectedLessonPath}
              activeConversationId={activeConversationId}
              onToggle={onToggle}
              onEnsureWorkspaceSelected={onEnsureWorkspaceSelected}
              onOpenPath={onOpenPath}
              onOpenLesson={onOpenLesson}
              onOpenConversation={onOpenConversation}
            />
          ))}
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

function ProjectFolderPicker() {
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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<TeachingGitBranchesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reload branches whenever the workspace changes (incl. right after an
  // import/select switches the active workspace) and on mount. The cancel
  // guard keeps a stale fetch from overwriting a newer one.
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setActing(null)
    if (!root) {
      setResult(null)
      setLoading(false)
      return
    }
    const api = window.teachingSystem
    if (!api) return
    let cancelled = false
    setLoading(true)
    api
      .listGitBranches(root)
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [root])

  // Refresh + focus when the dropdown opens.
  useEffect(() => {
    if (!open || !root) return
    const api = window.teachingSystem
    if (!api) return
    setLoading(true)
    api
      .listGitBranches(root)
      .then(setResult)
      .finally(() => setLoading(false))
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, root])

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
    : !result || loading
      ? t('overview.gitLoading')
      : result?.ok
        ? (currentBranch ?? t('overview.gitDetached'))
        : result?.reason === 'not_git_repo'
          ? t('overview.gitNotRepo')
          : result?.reason === 'git_unavailable'
            ? t('overview.gitUnavailable')
            : t('overview.gitError')

  const switchBranch = async (branch: string): Promise<void> => {
    const api = window.teachingSystem
    if (!api || !root || !branch || acting) return
    setActing(branch)
    try {
      const next = await api.switchGitBranch({ workspaceRoot: root, branch })
      setResult(next)
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
      setResult(next)
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
        {loading ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
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
    taskPrompt,
    setView,
    setSidebarCollapsed,
    setTaskPrompt,
    openSettings,
    updateSettings,
    pickDefaultRoot,
    initialize,
    createWorkspace,
    importWorkspace,
    updateMission,
    generateLesson,
    generateLessonStream,
    loadLesson,
    openPath,
    clearError
  } = useAppStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const active = appState.activeWorkspace
  const lessons = active?.lessons ?? []
  const courses = active?.courses ?? []
  const records = active?.records ?? []
  const selectedLesson = active?.lessons.find((lesson) => lesson.absolutePath === appState.selectedLessonPath) ?? active?.lessons[0] ?? null

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
    <main className="main-area" data-view={view}>
      <header className="topbar">
        <div className="crumb">
          <button
            className="icon-button"
            type="button"
            aria-label={sidebarCollapsed ? t('main.expandSidebar') : t('main.collapseSidebar')}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <PanelLeft size={17} />
          </button>
        </div>
      </header>

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
        <AgentChatPanel />
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
        <section className="composer-tool" aria-label={t('lessons.composerAria')}>
          <div className="composer-header">
            <div>
              <strong>{t('lessons.composerTitle')}</strong>
            </div>
            <button className="icon-button soft" type="button" aria-label={t('lessons.modelSettings')} onClick={() => openSettings('model')}>
              <Command size={16} />
            </button>
          </div>
          <textarea
            value={taskPrompt}
            aria-label={t('overview.taskAria')}
            placeholder={t('lessons.composerPlaceholder')}
            onChange={(event) => setTaskPrompt(event.target.value)}
          />
          <div className="composer-footer">
            <div className="tool-pills">
              <button type="button" onClick={() => active && void openPath(active.rootPath)} disabled={!active}>
                <FolderOpen size={15} />
                {t('lessons.rootDir')}
              </button>
              <button type="button" onClick={() => active && void openPath(active.missionPath)} disabled={!active}>
                <FileText size={15} />
                MISSION.md
              </button>
              <button
                className={settings.generator.structuredOutput ? 'is-active' : ''}
                type="button"
                onClick={() => void updateSettings({ generator: { structuredOutput: !settings.generator.structuredOutput } })}
              >
                <Zap size={15} />
                structured JSON
              </button>
            </div>
            <button className="send-button" type="button" aria-label={t('lessons.send')} onClick={settings.generator.streaming ? generateLessonStream : generateLesson} disabled={!active || generating}>
              {generating ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
            </button>
          </div>
        </section>
      )}

      {view === 'lessons' && (
      <section className="content-grid">
        <div className="lesson-column">
          <div className="section-title-row">
            <div>
              <span>{t('lessons.plan')}</span>
              <h2>{view === 'lessons' ? t('lessons.all') : t('lessons.next')}</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => active && void openPath(active.lessonsDir)} disabled={!active}>
              <ArrowUpRight size={16} />
              {t('lessons.openDir')}
            </button>
          </div>

          <div className="lesson-list">
            {lessons.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={t('lessons.emptyTitle')}
                detail={t('lessons.emptyDetail')}
                action={active ? { label: t('lessons.emptyAction'), onClick: generateLesson } : undefined}
              />
            ) : (
              courses.map((course) => (
                <section className="course-group" key={course.id}>
                  <div className="course-group-header">
                    <div className="course-group-title">
                      <BookCopy size={16} />
                      <strong>{course.name}</strong>
                    </div>
                    <span>{course.sessionCount} sessions</span>
                  </div>
                  {course.sessions.map((session) => {
                    const lesson = session.lesson
                    const isSelected = lesson.absolutePath === appState.selectedLessonPath
                    return (
                      <article className={`lesson-card ${isSelected ? 'is-selected' : ''}`} key={lesson.absolutePath} onClick={() => void loadLesson(lesson)}>
                        <div className="lesson-id">{lesson.id}</div>
                        <div className="lesson-icon">
                          <History size={18} />
                        </div>
                        <div className="lesson-body">
                          <h3>{session.name}</h3>
                          <p>{t('lessons.duration', { count: lesson.durationMinutes })} · {lesson.relativePath}</p>
                        </div>
                        <span className="state-chip">{isSelected ? t('lessons.chipPreviewing') : t('lessons.chipGenerated')}</span>
                      </article>
                    )
                  })}
                </section>
              ))
            )}
          </div>
        </div>

        <aside className="preview-panel" aria-label={t('lessons.previewAria')}>
          <div className="preview-toolbar">
            <div>
              <span>{selectedLesson?.relativePath ?? 'lessons/0001-lesson.html'}</span>
              <strong>{t('lessons.previewTitle')}</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={t('lessons.openPreview')}
              onClick={() => appState.selectedLessonPath && void openPath(appState.selectedLessonPath)}
              disabled={!appState.selectedLessonPath}
            >
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="lesson-preview">
            <iframe
              className="preview-frame"
              title="Lesson preview"
              sandbox="allow-scripts"
              srcDoc={appState.previewHtml}
            />
          </div>
        </aside>
      </section>
      )}

      {view === 'resources' && (
      <section className="resource-page">
        <div className="resource-panel resource-panel--tutorials">
          <div className="section-title-row compact">
            <div>
              <span>{t('resources.trusted')}</span>
              <h2>{t('resources.title')}</h2>
            </div>
          </div>
          <div className="tutorial-grid">
            {PRESET_TUTORIALS.map((tutorial) => {
              const Icon = tutorial.icon
              return (
                <article className="tutorial-card" key={tutorial.titleKey}>
                  <span className="tutorial-card-icon">
                    <Icon size={20} />
                  </span>
                  <div className="tutorial-card-body">
                    <h3>{t(tutorial.titleKey)}</h3>
                    <p>{t(tutorial.detailKey)}</p>
                  </div>
                  <span className="tutorial-tag">{t(tutorial.tagKey)}</span>
                </article>
              )
            })}
          </div>
        </div>

        <div className="resource-page-secondary">
        <div className="records-panel">
          <div className="section-title-row compact">
            <div>
              <span>{t('records.label')}</span>
              <h2>{t('records.title')}</h2>
            </div>
            <button className="icon-button" type="button" aria-label={t('records.open')} onClick={() => active && void openPath(active.recordsDir)} disabled={!active}>
              <History size={16} />
            </button>
          </div>
          <div className="record-list">
            {records.length === 0 ? (
              <EmptyState
                icon={History}
                title={t('records.emptyTitle')}
                detail={t('records.emptyDetail')}
              />
            ) : (
              records.map((record) => (
                <article className="record-row" key={record.absolutePath} onClick={() => void openPath(record.absolutePath)}>
                  <FileText size={17} />
                  <div>
                    <h3>{record.title}</h3>
                    <p>{record.date}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="runtime-panel">
          <div className="runtime-header">
            <BrainCircuit size={20} />
            <div>
              <span>{t('runtime.title')}</span>
              <strong>{runtimeProviderLabel(settings)}</strong>
            </div>
          </div>
          <div className="runtime-meter">
            <div style={{ width: runtimeMeterWidth(appState.runtime, active, generating) }} />
          </div>
          <div className="runtime-stats">
            <span>
              <Clock3 size={15} />
              {t('runtime.queued', { count: appState.runtime.queuedTasks })}
            </span>
            <span>
              {generating ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
              {appState.runtime.currentStep}
            </span>
            <span>
              <Star size={15} />
              {active?.referenceCount ?? 0} references
            </span>
          </div>
        </div>
        </div>
      </section>
      )}
    </main>
  )
}

// ================================================================
// Settings View
// ================================================================

function OverviewChat({ active }: { active: TeachingWorkspaceSummary | null }) {
  const { t } = useTranslation()
  const {
    settings,
    agentTurns,
    agentChatBusy,
    agentStatus,
    agentInput,
    setView,
    setAgentInput,
    openSettings,
    agentChat
  } = useAppStore()
  const canSendChat = Boolean(active && agentInput.trim() && !agentChatBusy)
  const hasConversation = agentTurns.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [agentTurns, agentStatus])
  const activeAssistantTurnId = agentChatBusy
    ? [...agentTurns].reverse().find((turn) => turn.role === 'assistant')?.id
    : null

  return (
    <section
      className={`overview-dialog-shell${hasConversation ? ' has-conversation' : ''}`}
      aria-label={t('overview.aria')}
    >
      {hasConversation ? (
        <div ref={scrollRef} className="overview-dialog-thread">
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
                <span>{turn.role === 'user' ? '你' : '助手'}</span>
                {turn.role === 'assistant' && <AgentProcessPanel turn={turn} busy={isBusyTurn} compact />}
                {content ? <MarkdownMessage content={content} tone={turn.role} compact /> : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <form
        className="overview-dialog-stack"
        aria-label={t('overview.formAria')}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSendChat) void agentChat()
        }}
      >
        <div className="overview-dialog-card">
          {!hasConversation ? (
            <div className="overview-dialog-hint">
              {active
                ? '先把你的背景、目标和当前困难告诉教学助手，它会逐步追问，再决定下一节课该怎么生成。'
                : t('overview.placeholderEmpty')}
            </div>
          ) : null}
          <textarea
            value={agentInput}
            aria-label={t('overview.taskAria')}
            placeholder={active ? '先说说你想学什么、你现在的水平，以及希望先解决什么问题…' : t('overview.placeholderEmpty')}
            onChange={(event) => setAgentInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (canSendChat) void agentChat()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <div className="overview-dialog-actions">
              <button className="overview-dialog-model" type="button" onClick={() => openSettings('model')}>
                <span>{runtimeProviderLabel(settings)}</span>
                <ChevronDown size={13} />
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setView('agent')}
                disabled={agentChatBusy}
              >
                <Bot size={15} />
                进入完整对话
              </button>
              <button className="send-button overview-dialog-send" type="submit" aria-label="发送消息" disabled={!canSendChat}>
                {agentChatBusy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
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
            {agentStatus ? <span className="overview-dialog-status-text">{agentStatus}</span> : null}
          </div>
        </div>
      </form>
    </section>
  )
}

function AgentChatPanel() {
  const {
    appState,
    agentTurns,
    agentChatBusy,
    agentStatus,
    agentInput,
    agentToolsSupported,
    settings,
    setAgentInput,
    clearAgentChat,
    agentChat,
    openSettings
  } = useAppStore()
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [agentTurns, agentStatus])
  const endpointFormat = settings.generator.endpointFormat
  const toolsSupported = endpointFormat === 'chat_completions' || endpointFormat === 'custom_endpoint'
  const active = appState.activeWorkspace
  const canSend = Boolean(active && agentInput.trim().length > 0 && !agentChatBusy)
  const activeAssistantTurnId = agentChatBusy
    ? [...agentTurns].reverse().find((turn) => turn.role === 'assistant')?.id
    : null
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSend) void agentChat()
  }
  return (
    <section className="composer-tool" aria-label="TeachOS Agent" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="composer-header">
        <div>
          <strong>TeachOS Agent</strong>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {agentToolsSupported === false && (
            <span style={{ fontSize: 11, color: '#b07b00', background: '#fff7e0', padding: '2px 8px', borderRadius: 8 }}>
              当前端点不支持工具调用，已降级为纯文本
            </span>
          )}
          <button className="icon-button soft" type="button" onClick={() => openSettings('tools')} aria-label="工具设置">
            <Wrench size={16} />
          </button>
          <button className="icon-button soft" type="button" onClick={clearAgentChat} aria-label="清空对话" disabled={agentChatBusy}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="agent-thread" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {agentTurns.length === 0 && (
          <div style={{ margin: 'auto', color: '#68778f', textAlign: 'center', maxWidth: 420, lineHeight: 1.7 }}>
            {active ? '向 TeachOS Agent 提问任意知识点。开启工具后，Agent 可调用 web_search 检索最新信息再作答。' : t('overview.placeholderEmpty')}
            {!toolsSupported && <div style={{ marginTop: 8, fontSize: 12, color: '#b07b00' }}>提示：当前模型端点格式不支持工具调用，将仅以纯文本对话。</div>}
          </div>
        )}
        {agentTurns.map((turn) => (
          <AgentTurnView key={turn.id} turn={turn} busy={activeAssistantTurnId === turn.id} />
        ))}
      </div>
      <form className="composer-footer" onSubmit={onSubmit} style={{ borderTop: '1px solid var(--ds-border, #e8edf5)', padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          value={agentInput}
          placeholder={active ? (t('overview.placeholderActive') || '向 Agent 提问…') : t('overview.placeholderEmpty')}
          onChange={(e) => setAgentInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canSend) void agentChat()
            }
          }}
          rows={2}
          style={{ flex: 1, resize: 'none', border: '1px solid var(--ds-border, #e8edf5)', borderRadius: 12, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14, outline: 'none' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button className="send-button" type="submit" disabled={!canSend} aria-label="发送">
            {agentChatBusy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
          </button>
          {agentStatus && <span style={{ fontSize: 11, color: '#68778f' }}>{agentStatus}</span>}
        </div>
      </form>
    </section>
  )
}

function AgentTurnView({ turn, busy }: { turn: AgentChatTurn; busy: boolean }) {
  const isUser = turn.role === 'user'
  const empty =
    !turn.content &&
    (!turn.toolCalls || turn.toolCalls.length === 0) &&
    (!turn.processEvents || turn.processEvents.length === 0)
  return (
    <div className={`agent-turn ${isUser ? 'is-user' : 'is-assistant'}`}>
      <div className="agent-turn-stack">
        {!isUser && <AgentProcessPanel turn={turn} busy={busy} />}
        {empty && !isUser && busy ? (
          <div className="agent-thinking-placeholder">正在生成…</div>
        ) : turn.content ? (
          <MarkdownMessage content={turn.content} tone={turn.role} />
        ) : null}
      </div>
    </div>
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
  if (events.length === 0 && toolCalls.length === 0) return null
  return (
    <div className={`agent-process-panel${compact ? ' is-compact' : ''}`}>
      <div className="agent-process-header">
        <BrainCircuit size={compact ? 13 : 14} />
        <strong>思考过程</strong>
        {busy ? <span>进行中</span> : <span>已记录</span>}
      </div>
      {events.length > 0 && (
        <div className="agent-process-list">
          {events.map((event, index) => (
            <AgentProcessEventRow
              key={event.id}
              event={event}
              active={busy && index === events.length - 1 && event.status !== 'done'}
            />
          ))}
        </div>
      )}
      {toolCalls.length > 0 && (
        <div className="agent-process-tools">
          {toolCalls.map((toolCall) => (
            <ToolCallCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentProcessEventRow({
  event,
  active
}: {
  event: AgentChatProcessEvent
  active: boolean
}) {
  return (
    <div className={`agent-process-event${event.isError ? ' is-error' : ''}${active ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon">
        <AgentProcessIcon event={event} active={active} />
      </span>
      <span className="agent-process-event-copy">
        <strong>{event.title}</strong>
        {event.detail ? <small>{event.detail}</small> : null}
      </span>
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

function SettingsView({
  section,
  settings,
  activeWorkspace,
  onClose,
  onSectionChange,
  onUpdateSettings,
  onPickDefaultRoot,
  onCreateWorkspace,
  onImportWorkspace,
  onOpenPath,
  onOpenExternal,
  onTestNotification,
  onProbeProvider,
  onListUpstreamModels,
  onListGitWorktrees,
  onRemoveGitWorktree,
  memoryRecords,
  memoryDiagnostics,
  onListMemory,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory,
  onLoadMemoryDiagnostics,
  onOpenLogFile,
  onOpenAppDataDir
}: {
  section: SettingsSection
  settings: TeachingSettingsV1
  activeWorkspace: TeachingWorkspaceSummary | null
  onClose: () => void
  onSectionChange: (section: SettingsSection) => void
  onUpdateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  onPickDefaultRoot: () => Promise<void>
  onCreateWorkspace: () => Promise<void>
  onImportWorkspace: () => Promise<void>
  onOpenPath: (path: string) => Promise<void>
  onOpenExternal: (url: string) => Promise<void>
  onTestNotification: () => Promise<void>
  onProbeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  onListUpstreamModels: (providerId: string) => Promise<ListUpstreamModelsResult>
  onListGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  onRemoveGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  memoryRecords: TeachingMemoryRecord[]
  memoryDiagnostics: TeachingMemoryDiagnostics | null
  onListMemory: (workspaceRoot?: string) => Promise<void>
  onCreateMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  onUpdateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  onDeleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  onLoadMemoryDiagnostics: () => Promise<void>
  onOpenLogFile: () => Promise<void>
  onOpenAppDataDir: () => Promise<void>
}) {
  const { t } = useTranslation()
  const worktreeRootPath = settings.worktree?.rootPath ?? ''
  const providersById = new Map(settings.provider.providers.map((provider) => [provider.id, provider]))
  const visibleModelProviders = modelSettingsProviderIds.map((id) => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === id)!
    return providersById.get(id) ?? { ...preset, apiKey: '' }
  })
  const activeProvider = activeModelProvider(settings)
  const activeModelSettingsProvider =
    visibleModelProviders.find((provider) => provider.id === activeProvider.id) ?? visibleModelProviders[0]!
  const [providerStatus, setProviderStatus] = useState<string>('')
  const [providerBusy, setProviderBusy] = useState(false)
  const [worktreeResult, setWorktreeResult] = useState<TeachingGitWorktreesResult | null>(null)
  const [worktreeBusyPath, setWorktreeBusyPath] = useState<string | null>(null)
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [memoryScopeFilter, setMemoryScopeFilter] = useState<'all' | TeachingMemoryScope>('all')
  const [memoryDialog, setMemoryDialog] = useState<null | { mode: 'create' } | { mode: 'edit' | 'view'; memory: TeachingMemoryRecord }>(null)
  const [memoryDraft, setMemoryDraft] = useState<{ content: string; scope: TeachingMemoryScope; tags: string; confidence: number }>({
    content: '',
    scope: 'workspace',
    tags: '',
    confidence: 1
  })

  useEffect(() => {
    if (section !== 'memory') return
    void onListMemory(activeWorkspace?.rootPath)
    void onLoadMemoryDiagnostics()
  }, [section, activeWorkspace?.rootPath, onListMemory, onLoadMemoryDiagnostics])

  useEffect(() => {
    if (section !== 'worktree') return
    if (!activeWorkspace?.rootPath) {
      setWorktreeResult(null)
      return
    }
    void refreshWorktrees()
  }, [section, activeWorkspace?.rootPath, worktreeRootPath])

  const probeActiveProvider = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus(t('model.statusConnecting'))
    const result = await onProbeProvider({
      baseUrl: activeModelSettingsProvider.baseUrl,
      apiKey: activeModelSettingsProvider.apiKey,
      endpointFormat: activeModelSettingsProvider.endpointFormat
    })
    setProviderBusy(false)
    setProviderStatus(result.ok ? t('model.statusOk', { latency: result.latencyMs, count: result.modelIds.length }) : result.message)
  }

  const pullActiveProviderModels = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus(t('model.statusPulling'))
    const result = await onListUpstreamModels(activeModelSettingsProvider.id)
    setProviderBusy(false)
    if (!result.ok) {
      setProviderStatus(result.message)
      return
    }
    updateProvider({ models: result.modelIds })
    if (settings.generator.providerId === activeModelSettingsProvider.id && result.modelIds.length > 0) {
      void onUpdateSettings({ generator: { model: result.modelIds[0] } })
    }
    setProviderStatus(t('model.statusSynced', { count: result.modelIds.length }))
  }

  const updateProvider = (patch: Partial<TeachingModelProviderProfile>): void => {
    const currentProvider = settings.provider.providers.find((provider) => provider.id === activeModelSettingsProvider.id)
    const providers = currentProvider
      ? settings.provider.providers.map((provider) =>
          provider.id === activeModelSettingsProvider.id ? { ...provider, ...patch } : provider
        )
      : [...settings.provider.providers, { ...activeModelSettingsProvider, ...patch }]
    void onUpdateSettings({
      provider: {
        providers
      }
    })
  }

  const selectProvider = (providerId: string): void => {
    const provider = settings.provider.providers.find((item) => item.id === providerId) ?? activeProvider
    void onUpdateSettings({
      provider: { activeProviderId: provider.id },
      generator: {
        providerId: provider.id,
        model: provider.models[0] ?? '',
        endpointFormat: provider.endpointFormat
      }
    })
  }

  const selectModelProvider = (providerId: string): void => {
    const provider = visibleModelProviders.find((item) => item.id === providerId) ?? activeModelSettingsProvider
    const hasProvider = settings.provider.providers.some((item) => item.id === provider.id)
    void onUpdateSettings({
      provider: {
        activeProviderId: provider.id,
        providers: hasProvider ? settings.provider.providers : [...settings.provider.providers, provider]
      },
      generator: {
        providerId: provider.id,
        model: provider.models[0] ?? '',
        endpointFormat: provider.endpointFormat
      }
    })
  }

  const resetActiveProviderToPreset = (): void => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === activeModelSettingsProvider.id)
    if (!preset) return
    updateProvider({ ...preset, apiKey: activeModelSettingsProvider.apiKey })
    void onUpdateSettings({
      generator: {
        providerId: preset.id,
        model: preset.models[0] ?? '',
        endpointFormat: preset.endpointFormat
      }
    })
  }

  const refreshWorktrees = async (): Promise<void> => {
    if (!activeWorkspace?.rootPath) return
    setWorktreeLoading(true)
    try {
      const result = await onListGitWorktrees(activeWorkspace.rootPath)
      setWorktreeResult(result)
    } finally {
      setWorktreeLoading(false)
    }
  }

  const removeWorktree = async (path: string): Promise<void> => {
    if (!activeWorkspace?.rootPath) return
    setWorktreeBusyPath(path)
    try {
      await onRemoveGitWorktree({ workspaceRoot: activeWorkspace.rootPath, worktreePath: path })
      await refreshWorktrees()
    } finally {
      setWorktreeBusyPath(null)
    }
  }

  const filteredMemoryRecords = memoryScopeFilter === 'all'
    ? memoryRecords
    : memoryRecords.filter((record) => record.scope === memoryScopeFilter)

  const beginCreateMemory = (): void => {
    setMemoryDraft({ content: '', scope: 'workspace', tags: '', confidence: 1 })
    setMemoryDialog({ mode: 'create' })
  }

  const beginEditMemory = (memory: TeachingMemoryRecord): void => {
    setMemoryDraft({
      content: memory.content,
      scope: memory.scope,
      tags: memory.tags.join(', '),
      confidence: memory.confidence ?? 1
    })
    setMemoryDialog({ mode: 'edit', memory })
  }

  const saveMemoryDraft = async (): Promise<void> => {
    const payload = {
      content: memoryDraft.content.trim(),
      scope: memoryDraft.scope,
      tags: memoryDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      confidence: memoryDraft.confidence,
      workspaceRoot: activeWorkspace?.rootPath
    } satisfies CreateTeachingMemoryPayload
    if (!payload.content) return
    const ok = memoryDialog?.mode === 'edit'
      ? await onUpdateMemory(memoryDialog.memory.id, payload)
      : await onCreateMemory(payload)
    if (ok) setMemoryDialog(null)
  }

  return (
    <div className="settings-floating-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="settings-view" aria-label={t('settings.aria')} role="dialog" aria-modal="true">
        <button className="settings-close-button" type="button" aria-label={t('settings.close')} onClick={onClose}>
          <X size={17} />
        </button>
        <aside className="settings-nav" aria-label={t('settings.navAria')}>
        <div className="settings-nav-heading">{t('settings.navHeading')}</div>
        {settingsNavItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`settings-nav-item ${section === item.id ? 'is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
            >
              <Icon size={17} />
              <span>
                <strong>{t(`settingsSection.${item.id}.label`)}</strong>
                <small>{t(`settingsSection.${item.id}.detail`)}</small>
              </span>
            </button>
          )
        })}
      </aside>

      <div className="settings-content">
        {section === 'general' && (
          <SettingsPanel
            title={t('general.title')}
            subtitle={t('general.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('general.theme.label')} detail={t('general.theme.detail')}>
                <SegmentedControl
                  value={settings.theme}
                  options={[
                    { value: 'system', label: t('general.theme.system'), icon: Monitor },
                    { value: 'light', label: t('general.theme.light'), icon: Sun },
                    { value: 'dark', label: t('general.theme.dark'), icon: Moon }
                  ]}
                  onChange={(theme) => void onUpdateSettings({ theme })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.language.label')} detail={t('general.language.detail')}>
                <SegmentedControl
                  value={settings.locale}
                  options={[
                    { value: 'zh-CN', label: t('general.language.zh') },
                    { value: 'en-US', label: t('general.language.en') }
                  ]}
                  onChange={(locale) => void onUpdateSettings({ locale })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.density.label')} detail={t('general.density.detail')}>
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: t('general.density.comfortable') },
                    { value: 'compact', label: t('general.density.compact') }
                  ]}
                  onChange={(density) => void onUpdateSettings({ density })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.fontScale.label')} detail={`${Math.round(settings.uiFontScale * 100)}%`}>
                <input
                  className="settings-range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  type="range"
                  value={settings.uiFontScale}
                  onChange={(event) => void onUpdateSettings({ uiFontScale: Number(event.target.value) })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.closeAction.label')} detail={settings.appBehavior.closeAction === 'tray' ? t('general.closeAction.detailTray') : t('general.closeAction.detailQuit')}>
                <SegmentedControl
                  value={settings.appBehavior.closeAction}
                  options={[
                    { value: 'quit', label: t('general.closeAction.quit') },
                    { value: 'tray', label: t('general.closeAction.tray') }
                  ]}
                  onChange={(closeAction) => void onUpdateSettings({ appBehavior: { closeAction, closeToTray: closeAction === 'tray' } })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.openAtLogin.label')} detail={t('general.openAtLogin.detail')}>
                <ToggleSwitch
                  checked={settings.appBehavior.openAtLogin}
                  onChange={(openAtLogin) => void onUpdateSettings({ appBehavior: { openAtLogin } })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.startMinimized.label')} detail={t('general.startMinimized.detail')}>
                <ToggleSwitch
                  checked={settings.appBehavior.startMinimized}
                  onChange={(startMinimized) => void onUpdateSettings({ appBehavior: { startMinimized } })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.log.label')} detail={t('general.log.detail', { state: settings.log.enabled ? t('general.log.enabled') : t('general.log.disabled'), days: settings.log.retentionDays })}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.log.enabled}
                    onChange={(enabled) => void onUpdateSettings({ log: { enabled } })}
                  />
                  <NumberInput
                    max={90}
                    min={1}
                    step={1}
                    value={settings.log.retentionDays}
                    onChange={(retentionDays) => void onUpdateSettings({ log: { retentionDays } })}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'appearance' && (
          <SettingsPanel
            title={t('appearance.title')}
            subtitle={t('appearance.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('general.theme.label')} detail={t('general.theme.detail')}>
                <SegmentedControl
                  value={settings.theme}
                  options={[
                    { value: 'system', label: t('general.theme.system'), icon: Monitor },
                    { value: 'light', label: t('general.theme.light'), icon: Sun },
                    { value: 'dark', label: t('general.theme.dark'), icon: Moon }
                  ]}
                  onChange={(theme) => void onUpdateSettings({ theme })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.density.label')} detail={settings.density === 'compact' ? t('general.density.compact') : t('general.density.comfortable')}>
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: t('general.density.comfortable') },
                    { value: 'compact', label: t('general.density.compact') }
                  ]}
                  onChange={(density) => void onUpdateSettings({ density })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.fontScale.label')} detail={`${Math.round(settings.uiFontScale * 100)}%`}>
                <input
                  className="settings-range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  type="range"
                  value={settings.uiFontScale}
                  onChange={(event) => void onUpdateSettings({ uiFontScale: Number(event.target.value) })}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'model' && (
          <SettingsPanel
            title={t('model.title')}
            subtitle={t('model.subtitle')}
          >
            <SettingsCard>
                <SettingsRow label="Provider">
                  <SettingsSelect
                    value={activeModelSettingsProvider.id}
                    options={visibleModelProviders.map((provider) => ({
                      value: provider.id,
                      label: provider.id === 'custom' ? 'Custom' : provider.name
                    }))}
                    onChange={selectModelProvider}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.apiKey.label')}>
                  <SettingsTextInput
                    type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                    value={activeModelSettingsProvider.apiKey}
                    placeholder={t('model.apiKey.placeholder')}
                    onChange={(apiKey) => updateProvider({ apiKey })}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.baseUrl')}>
                  <SettingsTextInput
                    value={activeModelSettingsProvider.baseUrl}
                    onChange={(baseUrl) => updateProvider({ baseUrl })}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.models.label')}>
                  <SettingsSelect
                    value={
                      activeModelSettingsProvider.models.includes(settings.generator.model)
                        ? settings.generator.model
                        : (activeModelSettingsProvider.models[0] ?? '')
                    }
                    options={activeModelSettingsProvider.models.map((model) => ({ value: model, label: model }))}
                    onChange={(model) => {
                      if (settings.generator.providerId === activeModelSettingsProvider.id) {
                        void onUpdateSettings({ generator: { model } })
                        return
                      }
                      updateProvider({
                        models: [
                          model,
                          ...activeModelSettingsProvider.models.filter((item) => item !== model)
                        ]
                      })
                    }}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.actions.label')}>
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" onClick={() => void probeActiveProvider()} disabled={providerBusy}>
                      {providerBusy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                      {t('model.actions.test')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void pullActiveProviderModels()} disabled={providerBusy || activeModelSettingsProvider.endpointFormat === 'custom_endpoint'}>
                      <RefreshCw size={15} />
                      {t('model.actions.pull')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeModelSettingsProvider.docsUrl)} disabled={!activeModelSettingsProvider.docsUrl}>
                      <ExternalLink size={15} />
                      {t('model.actions.docs')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeModelSettingsProvider.apiKeyUrl)} disabled={!activeModelSettingsProvider.apiKeyUrl}>
                      <KeyRound size={15} />
                      {t('model.actions.key')}
                    </button>
                    <button className="ghost-button" type="button" onClick={resetActiveProviderToPreset}>
                      <RefreshCw size={15} />
                      {t('model.actions.reset')}
                    </button>
                  </div>
                </SettingsRow>
              </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'generation' && (
          <SettingsPanel
            title={t('generation.title')}
            subtitle={t('generation.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('generation.provider')} detail={activeProvider.name}>
                <SettingsSelect
                  value={settings.generator.providerId}
                  options={settings.provider.providers.map((provider) => ({
                    value: provider.id,
                    label: provider.name
                  }))}
                  onChange={selectProvider}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.model.label')} detail={settings.generator.model || t('generation.model.none')}>
                <SettingsSelect
                  value={settings.generator.model}
                  options={activeProvider.models.map((model) => ({ value: model, label: model }))}
                  onChange={(model) => void onUpdateSettings({ generator: { model } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.temperature')} detail={settings.generator.temperature.toFixed(2)}>
                <NumberInput
                  max={2}
                  min={0}
                  step={0.05}
                  value={settings.generator.temperature}
                  onChange={(temperature) => void onUpdateSettings({ generator: { temperature } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.maxTokens')} detail={`${settings.generator.maxOutputTokens}`}>
                <NumberInput
                  max={32768}
                  min={512}
                  step={256}
                  value={settings.generator.maxOutputTokens}
                  onChange={(maxOutputTokens) => void onUpdateSettings({ generator: { maxOutputTokens } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.duration.label')} detail={t('generation.duration.detail', { count: settings.generator.lessonDurationMinutes })}>
                <NumberInput
                  max={60}
                  min={5}
                  step={1}
                  value={settings.generator.lessonDurationMinutes}
                  onChange={(lessonDurationMinutes) => void onUpdateSettings({ generator: { lessonDurationMinutes } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.retrieval.label')} detail={t('generation.retrieval.detail')}>
                <ToggleSwitch
                  checked={settings.generator.includeRetrievalPractice}
                  onChange={(includeRetrievalPractice) => void onUpdateSettings({ generator: { includeRetrievalPractice } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.reference.label')} detail={t('generation.reference.detail')}>
                <ToggleSwitch
                  checked={settings.generator.generateReference}
                  onChange={(generateReference) => void onUpdateSettings({ generator: { generateReference } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.learningRecord.label')} detail={t('generation.learningRecord.detail')}>
                <ToggleSwitch
                  checked={settings.generator.generateLearningRecord}
                  onChange={(generateLearningRecord) => void onUpdateSettings({ generator: { generateLearningRecord } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.structured.label')} detail={t('generation.structured.detail')}>
                <ToggleSwitch
                  checked={settings.generator.structuredOutput}
                  onChange={(structuredOutput) => void onUpdateSettings({ generator: { structuredOutput } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.streaming.label')} detail={t('generation.streaming.detail')}>
                <ToggleSwitch
                  checked={settings.generator.streaming}
                  onChange={(streaming) => void onUpdateSettings({ generator: { streaming } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.timeout.label')} detail={t('generation.timeout.detail', { seconds: Math.round(settings.generator.requestTimeoutMs / 1000) })}>
                <NumberInput
                  max={300000}
                  min={5000}
                  step={5000}
                  value={settings.generator.requestTimeoutMs}
                  onChange={(requestTimeoutMs) => void onUpdateSettings({ generator: { requestTimeoutMs } })}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'tools' && (
          <SettingsPanel
            title="工具调用"
            subtitle="允许 Agent 与课程生成调用 web 搜索等工具"
          >
            <SettingsCard>
              <SettingsRow label="启用工具调用" detail="开启后 Agent 与课程生成可调用工具">
                <ToggleSwitch
                  checked={settings.tools.enabled}
                  onChange={(enabled) => void onUpdateSettings({ tools: { enabled } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="web_search（DuckDuckGo）" detail="免费、无需 API Key；检索最新或课程外信息">
                <ToggleSwitch
                  checked={settings.tools.webSearch}
                  onChange={(webSearch) => void onUpdateSettings({ tools: { webSearch } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="web_fetch" detail="抓取指定 URL 正文（带 SSRF 防护）">
                <ToggleSwitch
                  checked={settings.tools.webFetch}
                  onChange={(webFetch) => void onUpdateSettings({ tools: { webFetch } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="最大工具调用轮数" detail={`默认 ${4}，控制单次任务的最大工具往返`}>
                <NumberInput
                  max={10}
                  min={1}
                  step={1}
                  value={settings.tools.maxIterations}
                  onChange={(maxIterations) => void onUpdateSettings({ tools: { maxIterations } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="端点格式支持" detail={
                settings.generator.endpointFormat === 'chat_completions' || settings.generator.endpointFormat === 'custom_endpoint'
                  ? `当前「${settings.generator.endpointFormat}」支持工具调用`
                  : `当前「${settings.generator.endpointFormat}」不支持工具调用，将降级为纯文本`
              }>
                <span style={{ fontSize: 13, color: '#68778f' }}>
                  {settings.generator.endpointFormat}
                </span>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'workspace' && (
          <SettingsPanel
            title={t('workspace.title')}
            subtitle={t('workspace.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('workspace.defaultRoot.label')} detail={settings.workspace.defaultRoot || t('workspace.defaultRoot.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onPickDefaultRoot()}>
                    <FolderOpen size={15} />
                    {t('workspace.defaultRoot.choose')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(settings.workspace.defaultRoot)} disabled={!settings.workspace.defaultRoot}>
                    <ArrowUpRight size={15} />
                    {t('workspace.defaultRoot.open')}
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label={t('workspace.confirm.label')} detail={t('workspace.confirm.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.confirmBeforeGenerating}
                  onChange={(confirmBeforeGenerating) => void onUpdateSettings({ workspace: { confirmBeforeGenerating } })}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.autoOpen.label')} detail={t('workspace.autoOpen.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.autoOpenGeneratedLesson}
                  onChange={(autoOpenGeneratedLesson) => void onUpdateSettings({ workspace: { autoOpenGeneratedLesson } })}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.current.label')} detail={activeWorkspace?.rootPath ?? t('workspace.current.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onCreateWorkspace()}>
                    <Plus size={15} />
                    {t('workspace.current.create')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onImportWorkspace()}>
                    <Upload size={15} />
                    {t('workspace.current.import')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                    <ArrowUpRight size={15} />
                    {t('workspace.current.open')}
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'worktree' && (
          <SettingsPanel
            title={t('worktree.title')}
            subtitle={t('worktree.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('worktree.root.label')} detail={worktreeRootPath || t('worktree.root.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(worktreeRootPath)} disabled={!worktreeRootPath}>
                    <ArrowUpRight size={15} />
                    {t('worktree.root.open')}
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label={t('worktree.current.label')} detail={activeWorkspace?.git?.repositoryRoot ?? t('worktree.current.none')}>
                <div className="settings-inline-group">
                  <span className="settings-status-badge">
                    {activeWorkspace?.git?.currentBranch ?? t('worktree.current.notGit')}
                  </span>
                  <button className="ghost-button" type="button" onClick={() => void refreshWorktrees()} disabled={!activeWorkspace || worktreeLoading}>
                    {worktreeLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                    {t('worktree.refresh')}
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              {worktreeResult?.ok === false ? (
                <div className="settings-empty-note">{worktreeResult.message}</div>
              ) : !worktreeResult?.ok || worktreeResult.worktrees.length === 0 ? (
                <div className="settings-empty-note">{t('worktree.empty')}</div>
              ) : (
                worktreeResult.worktrees.map((worktree) => (
                  <div className="settings-list-row" key={worktree.path}>
                    <div className="settings-list-copy">
                      <strong>{worktree.branch ?? t('worktree.detached')}</strong>
                      <span>{worktree.path}</span>
                      <span>
                        {worktree.isPrimary ? t('worktree.primary') : t('worktree.linked')}
                        {worktree.createdAt ? ` · ${new Date(worktree.createdAt).toLocaleString(settings.locale)}` : ''}
                      </span>
                    </div>
                    <div className="settings-row-control">
                      <button
                        className="ghost-button danger"
                        type="button"
                        disabled={worktree.isPrimary || worktreeBusyPath === worktree.path}
                        onClick={() => void removeWorktree(worktree.path)}
                      >
                        {worktreeBusyPath === worktree.path ? <Loader2 className="spin" size={15} /> : <X size={15} />}
                        {t('worktree.remove')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'memory' && (
          <SettingsPanel
            title={t('memory.title')}
            subtitle={t('memory.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('memory.enable.label')} detail={t('memory.enable.detail')}>
                <ToggleSwitch
                  checked={settings.memory.enabled}
                  onChange={(enabled) => void onUpdateSettings({ memory: { enabled } })}
                />
              </SettingsRow>
              <SettingsRow label={t('memory.maxInjected.label')} detail={t('memory.maxInjected.detail', { count: settings.memory.maxInjected })}>
                <NumberInput
                  min={1}
                  max={12}
                  step={1}
                  value={settings.memory.maxInjected}
                  onChange={(maxInjected) => void onUpdateSettings({ memory: { maxInjected } })}
                />
              </SettingsRow>
              <SettingsRow label={t('memory.diagnostics.label')} detail={memoryDiagnostics ? t('memory.diagnostics.detail', { active: memoryDiagnostics.activeCount, deleted: memoryDiagnostics.tombstoneCount }) : t('memory.diagnostics.loading')}>
                <button className="ghost-button" type="button" onClick={() => void onLoadMemoryDiagnostics()}>
                  <RefreshCw size={15} />
                  {t('memory.refresh')}
                </button>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              <div className="settings-toolbar">
                <div className="settings-filter-group">
                  {(['all', 'user', 'workspace', 'project'] as const).map((scope) => (
                    <button
                      key={scope}
                      className={memoryScopeFilter === scope ? 'is-active' : ''}
                      type="button"
                      onClick={() => setMemoryScopeFilter(scope)}
                    >
                      {t(`memory.scope.${scope}`)}
                    </button>
                  ))}
                </div>
                <button className="ghost-button strong" type="button" onClick={beginCreateMemory}>
                  <Plus size={15} />
                  {t('memory.create')}
                </button>
              </div>

              {filteredMemoryRecords.length === 0 ? (
                <div className="settings-empty-note">{t('memory.empty')}</div>
              ) : (
                filteredMemoryRecords.map((memory) => (
                  <div className="settings-list-row" key={memory.id}>
                    <div className="settings-list-copy">
                      <strong>{memory.content}</strong>
                      <span>{[memory.scope, ...(memory.tags ?? [])].join(' · ')}</span>
                      <span>{memory.disabledAt ? t('memory.disabled') : t('memory.confidence', { value: memory.confidence.toFixed(2) })}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-actions">
                        <button className="ghost-button" type="button" onClick={() => setMemoryDialog({ mode: 'view', memory })}>
                          <Info size={15} />
                          {t('memory.view')}
                        </button>
                        <button className="ghost-button" type="button" onClick={() => beginEditMemory(memory)}>
                          <FileCheck2 size={15} />
                          {t('memory.edit')}
                        </button>
                        <button className="ghost-button" type="button" disabled={Boolean(memory.disabledAt)} onClick={() => void onUpdateMemory(memory.id, { disabled: true, workspaceRoot: activeWorkspace?.rootPath })}>
                          <Minus size={15} />
                          {t('memory.disable')}
                        </button>
                        <button className="ghost-button danger" type="button" onClick={() => void onDeleteMemory(memory.id, activeWorkspace?.rootPath)}>
                          <X size={15} />
                          {t('memory.delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </SettingsCard>

            {memoryDialog && (
              <MemoryDialog
                dialog={memoryDialog}
                draft={memoryDraft}
                locale={settings.locale}
                onChange={setMemoryDraft}
                onClose={() => setMemoryDialog(null)}
                onSave={() => void saveMemoryDraft()}
                t={t}
              />
            )}
          </SettingsPanel>
        )}

        {section === 'notifications' && (
          <SettingsPanel
            title={t('notifications.title')}
            subtitle={t('notifications.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('notifications.enabled.label')} detail={settings.notifications.enabled ? t('notifications.enabled.on') : t('notifications.enabled.off')}>
                <ToggleSwitch
                  checked={settings.notifications.enabled}
                  onChange={(enabled) => void onUpdateSettings({ notifications: { enabled } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.lesson.label')} detail={t('notifications.lesson.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.lessonGenerated}
                  onChange={(lessonGenerated) => void onUpdateSettings({ notifications: { lessonGenerated } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.imported.label')} detail={t('notifications.imported.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.workspaceImported}
                  onChange={(workspaceImported) => void onUpdateSettings({ notifications: { workspaceImported } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.errors.label')} detail={t('notifications.errors.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.errors}
                  onChange={(errors) => void onUpdateSettings({ notifications: { errors } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.test.label')} detail={t('notifications.test.detail')}>
                <button className="ghost-button" type="button" onClick={() => void onTestNotification()}>
                  <Bell size={15} />
                  {t('notifications.test.button')}
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'privacy' && (
          <SettingsPanel
            title={t('privacy.title')}
            subtitle={t('privacy.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('privacy.maskKey.label')} detail={t('privacy.maskKey.detail')}>
                <ToggleSwitch
                  checked={settings.privacy.maskApiKeys}
                  onChange={(maskApiKeys) => void onUpdateSettings({ privacy: { maskApiKeys } })}
                />
              </SettingsRow>
              <SettingsRow label={t('privacy.externalLinks.label')} detail={t('privacy.externalLinks.detail')}>
                <ToggleSwitch
                  checked={settings.privacy.allowExternalLinks}
                  onChange={(allowExternalLinks) => void onUpdateSettings({ privacy: { allowExternalLinks } })}
                />
              </SettingsRow>
              <SettingsRow label={t('privacy.proxy.label')} detail={settings.provider.proxy.enabled ? (settings.provider.proxy.url || t('privacy.proxy.on')) : t('privacy.proxy.off')}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.provider.proxy.enabled}
                    onChange={(enabled) => void onUpdateSettings({ provider: { proxy: { enabled } } })}
                  />
                  <SettingsTextInput
                    value={settings.provider.proxy.url}
                    placeholder={t('privacy.proxy.placeholder')}
                    onChange={(url) => void onUpdateSettings({ provider: { proxy: { url } } })}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'about' && (
          <SettingsPanel
            title={t('about.title')}
            subtitle={t('about.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('about.runtime')} detail={runtimeProviderLabel(settings)}>
                <span className="settings-status-badge">{settings.generator.streaming ? t('about.streaming') : t('about.oneShot')}</span>
              </SettingsRow>
              <SettingsRow label={t('about.currentWorkspace.label')} detail={activeWorkspace?.rootPath ?? t('about.currentWorkspace.none')}>
                <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                  <FolderOpen size={15} />
                  {t('about.currentWorkspace.open')}
                </button>
              </SettingsRow>
              <SettingsRow label={t('about.logFile.label')} detail={t('about.logFile.detail', { days: settings.log.retentionDays })}>
                <button className="ghost-button" type="button" onClick={() => void onOpenLogFile()}>
                  <FileText size={15} />
                  {t('about.logFile.open')}
                </button>
              </SettingsRow>
              <SettingsRow label={t('about.appData.label')} detail={t('about.appData.detail')}>
                <button className="ghost-button" type="button" onClick={() => void onOpenAppDataDir()}>
                  <ArrowUpRight size={15} />
                  {t('about.appData.open')}
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}
      </div>
      </section>
    </div>
  )
}

function SettingsPanel({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="settings-panel-body">{children}</div>
    </div>
  )
}

function SettingsCard({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`settings-card ${className}`}>{children}</div>
}

function SettingsRow({
  label,
  detail,
  children
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className="toggle-switch"
      data-state={checked ? 'checked' : 'unchecked'}
      role="switch"
      aria-checked={checked}
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented-control">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            className={option.value === value ? 'is-active' : ''}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon size={14} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function SettingsTextInput({
  value,
  placeholder,
  type = 'text',
  onChange
}: {
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  onChange: (value: string) => void
}) {
  return (
    <input
      className="settings-input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function SettingsSelect<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    setHighlightedIndex(Math.max(0, options.findIndex((option) => option.value === value)))
  }, [options, value])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const toggleOpen = (): void => {
    if (!options.length) return
    setOpen((current) => !current)
  }

  const selectOption = (nextValue: T): void => {
    onChange(nextValue)
    setOpen(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!options.length) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        const option = options[highlightedIndex] ?? selectedOption
        if (option) selectOption(option.value)
        return
      }
      setOpen(true)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightedIndex((current) => {
        const baseIndex = current < 0 ? Math.max(0, options.findIndex((option) => option.value === value)) : current
        return (baseIndex + direction + options.length) % options.length
      })
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(Math.max(0, options.length - 1))
    }
  }

  return (
    <div className={`settings-select ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        className="settings-select-trigger"
        type="button"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
      >
        <span className="settings-select-trigger-copy">
          <span className="settings-select-trigger-value">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown className="settings-select-trigger-icon" size={15} />
      </button>

      {open && (
        <div className="settings-select-menu" id={listId} role="listbox" aria-activedescendant={`${listId}-${highlightedIndex}`}>
          {options.map((option, index) => {
            const selected = option.value === value
            const highlighted = index === highlightedIndex
            return (
              <button
                aria-selected={selected}
                className={`settings-select-option ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                id={`${listId}-${index}`}
                key={option.value}
                role="option"
                type="button"
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.value)}
              >
                <span>{option.label}</span>
                {selected && <CheckCircle2 size={14} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <input
      className="settings-number"
      max={max}
      min={min}
      step={step}
      type="number"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

function MemoryDialog({
  dialog,
  draft,
  locale,
  onChange,
  onClose,
  onSave,
  t
}: {
  dialog: { mode: 'create' } | { mode: 'edit' | 'view'; memory: TeachingMemoryRecord }
  draft: { content: string; scope: TeachingMemoryScope; tags: string; confidence: number }
  locale: string
  onChange: (draft: { content: string; scope: TeachingMemoryScope; tags: string; confidence: number }) => void
  onClose: () => void
  onSave: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const editable = dialog.mode !== 'view'
  const memory = dialog.mode === 'create' ? null : dialog.memory
  const title = dialog.mode === 'create'
    ? t('memory.dialog.create')
    : dialog.mode === 'edit'
      ? t('memory.dialog.edit')
      : t('memory.dialog.view')

  return (
    <div className="memory-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="memory-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="memory-dialog-header">
          <div>
            <strong>{title}</strong>
            {memory && (
              <span>
                {memory.scope} · {new Date(memory.updatedAt).toLocaleString(locale)}
              </span>
            )}
          </div>
          <button className="settings-close-button" type="button" onClick={onClose} aria-label={t('memory.dialog.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="memory-dialog-body">
          {editable ? (
            <>
              <textarea
                className="settings-textarea"
                value={draft.content}
                placeholder={t('memory.dialog.contentPlaceholder')}
                onChange={(event) => onChange({ ...draft, content: event.target.value })}
              />
              <div className="settings-inline-group">
                {dialog.mode === 'create' && (
                  <SettingsSelect
                    value={draft.scope}
                    options={[
                      { value: 'workspace', label: t('memory.scope.workspace') },
                      { value: 'project', label: t('memory.scope.project') },
                      { value: 'user', label: t('memory.scope.user') }
                    ]}
                    onChange={(scope) => onChange({ ...draft, scope })}
                  />
                )}
                <SettingsTextInput
                  value={draft.tags}
                  placeholder={t('memory.dialog.tagsPlaceholder')}
                  onChange={(tags) => onChange({ ...draft, tags })}
                />
                <NumberInput
                  min={0}
                  max={1}
                  step={0.1}
                  value={draft.confidence}
                  onChange={(confidence) => onChange({ ...draft, confidence })}
                />
              </div>
            </>
          ) : (
            <div className="memory-dialog-readonly">{memory?.content}</div>
          )}
        </div>
        <div className="memory-dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            {t('memory.dialog.cancel')}
          </button>
          {editable ? (
            <button className="ghost-button strong" type="button" onClick={onSave} disabled={!draft.content.trim()}>
              {t('memory.dialog.save')}
            </button>
          ) : null}
        </div>
      </section>
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

function agentStatusLabel(status: AgentChatStreamStatus['status']): string {
  const labels: Record<AgentChatStreamStatus['status'], string> = {
    thinking: '思考中…',
    tool_running: '调用工具…',
    tool_done: '工具调用完成',
    answering: '生成答复…',
    done: '完成',
    error: '出错'
  }
  return labels[status]
}

let agentProcessEventCounter = 0

function createAgentProcessEventId(prefix: string): string {
  agentProcessEventCounter += 1
  return `${prefix}-${Date.now()}-${agentProcessEventCounter}`
}

function createAgentStatusProcessEvent(
  status: AgentChatStreamStatus['status'],
  message?: string
): AgentChatProcessEvent {
  return {
    id: createAgentProcessEventId('status'),
    kind: 'status',
    status,
    title: agentProcessStatusTitle(status),
    detail: message,
    createdAt: new Date().toISOString()
  }
}

function createAgentToolCallProcessEvent(event: AgentChatStreamToolEvent): AgentChatProcessEvent {
  const name = event.toolCall.name || 'tool'
  return {
    id: createAgentProcessEventId('tool-call'),
    kind: 'tool_call',
    title: `调用工具：${name}`,
    detail: compactText(prettyJson(event.toolCall.arguments), 180),
    toolCallId: event.toolCall.id,
    toolName: name,
    createdAt: new Date().toISOString()
  }
}

function createAgentToolResultProcessEvent(event: AgentChatStreamToolEvent): AgentChatProcessEvent {
  const name = event.toolCall.name || 'tool'
  return {
    id: createAgentProcessEventId('tool-result'),
    kind: 'tool_result',
    title: event.isError ? `工具失败：${name}` : `工具完成：${name}`,
    detail: compactText(prettyJson(event.result ?? ''), 180),
    toolCallId: event.toolCall.id,
    toolName: name,
    isError: event.isError,
    createdAt: new Date().toISOString()
  }
}

function agentProcessStatusTitle(status: AgentChatStreamStatus['status']): string {
  const labels: Record<AgentChatStreamStatus['status'], string> = {
    thinking: '分析问题与上下文',
    tool_running: '准备调用外部工具',
    tool_done: '整理工具返回结果',
    answering: '生成最终答复',
    done: '答复完成',
    error: '过程出错'
  }
  return labels[status]
}

function appendAgentProcessEvent(
  events: AgentChatProcessEvent[] | undefined,
  event: AgentChatProcessEvent
): AgentChatProcessEvent[] {
  const current = events ?? []
  const last = current[current.length - 1]
  if (
    last?.kind === 'status' &&
    event.kind === 'status' &&
    last.status === event.status &&
    last.detail === event.detail
  ) {
    return current
  }
  return [...current, event]
}

function updateAgentAssistantTurn(
  turns: AgentChatTurn[],
  assistantId: string,
  updater: (turn: AgentChatTurn) => AgentChatTurn
): AgentChatTurn[] {
  return turns.map((turn) => (turn.id === assistantId ? updater(turn) : turn))
}

function reconcileAgentTurnsWithLocalProcess(
  serverTurns: AgentChatTurn[],
  localTurns: AgentChatTurn[]
): AgentChatTurn[] {
  const localAssistantTurns = localTurns.filter((turn) => turn.role === 'assistant')
  let assistantIndex = 0
  return serverTurns.map((turn) => {
    if (turn.role !== 'assistant') return turn
    const localTurn = localAssistantTurns[assistantIndex]
    assistantIndex += 1
    if (!localTurn?.processEvents?.length) return turn
    return { ...turn, processEvents: localTurn.processEvents }
  })
}

function prettyJson(value: string): string {
  if (!value) return ''
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
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
