import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Command,
  Database,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderOpen,
  History,
  Home,
  Info,
  KeyRound,
  LibraryBig,
  Loader2,
  Lock,
  Maximize2,
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
  Zap
} from 'lucide-react'
import type { CSSProperties, ErrorInfo, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Component, useEffect, useState } from 'react'
import { create } from 'zustand'
import {
  MODEL_ENDPOINT_FORMATS,
  TEACHING_MODEL_PROVIDER_PRESETS,
  type LessonStreamChunk,
  type LessonStreamStatus,
  type LessonSummary,
  type ListUpstreamModelsResult,
  type ModelEndpointFormat,
  type ProgressSummary,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type ReviewCard,
  type SettingsSection,
  type TeachingModelProviderProfile,
  type TeachingAppState,
  type TeachingRuntimeState,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type WindowControlAction,
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
  loadReviewCards: () => Promise<void>
  recordProgress: (lessonId: string, results: Array<{ lessonId: string; question: string; correct: boolean }>) => Promise<void>
  reviewCards: ReviewCard[]
  progress: ProgressSummary | null
}

// ================================================================
// Constants
// ================================================================

const navItems = [
  { id: 'overview', label: '概览', icon: Home },
  { id: 'resources', label: '资源', icon: LibraryBig }
] satisfies Array<{ id: WorkspaceView; label: string; icon: LucideIcon }>

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

const defaultPrompt =
  '我想先学习如何把 teach 技能包的 MISSION、RESOURCES 和 lessons 组织成一个 Electron 桌面应用的 MVP。'

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

const settingsNavItems = [
  { id: 'general', label: '通用', detail: '应用行为、日志', icon: Settings },
  { id: 'appearance', label: '外观', detail: '主题、语言、密度、字体', icon: Palette },
  { id: 'model', label: '模型', detail: 'Provider 与密钥', icon: Bot },
  { id: 'generation', label: '生成', detail: '课程输出策略', icon: SlidersHorizontal },
  { id: 'workspace', label: '工作区', detail: '默认目录和文件行为', icon: FolderOpen },
  { id: 'notifications', label: '通知', detail: '桌面提醒', icon: Bell },
  { id: 'privacy', label: '隐私', detail: '链接和密钥显示', icon: Lock },
  { id: 'about', label: '关于', detail: '版本、日志、数据目录', icon: Info }
] satisfies Array<{ id: SettingsSection; label: string; detail: string; icon: LucideIcon }>

const endpointFormatLabels: Record<TeachingSettingsV1['generator']['endpointFormat'], string> = {
  chat_completions: 'OpenAI Chat Completions',
  responses: 'OpenAI Responses',
  messages: 'Anthropic Messages',
  custom_endpoint: 'Custom Endpoint'
}

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
  const model = settings.generator.model || 'auto'
  return `${provider?.name ?? 'Model provider'} · ${model}`
}

function applySettingsSideEffects(settings: TeachingSettingsV1): void {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.density = settings.density
  root.style.fontSize = `${settings.uiFontScale * 100}%`
}

// ================================================================
// Error Mapping — converts raw errors to user-friendly messages
// ================================================================

function toUserError(error: unknown): UserError {
  const raw = error instanceof Error ? error.message : String(error)

  // IPC validation errors
  if (raw.includes('IPC payload field')) {
    const field = raw.match(/"([^"]+)"/)?.[1] ?? '参数'
    return {
      message: `操作参数不完整`,
      severity: 'warning',
      detail: `缺少必要字段：${field}。请检查输入后重试。`
    }
  }

  if (raw.includes('IPC payload must be an object')) {
    return {
      message: '请求格式有误',
      severity: 'warning',
      detail: '内部通信数据格式异常，请刷新页面后重试。'
    }
  }

  if (raw.includes('Unsupported window control action')) {
    return {
      message: '窗口操作不支持',
      severity: 'info',
      detail: '该窗口操作在当前平台不可用。'
    }
  }

  // Workspace errors
  if (raw.includes('Workspace not found')) {
    return {
      message: '工作区未找到',
      severity: 'warning',
      detail: '该工作区可能已被移动或删除，请重新导入。'
    }
  }

  if (raw.includes('not a directory') || raw.includes('Selected path')) {
    return {
      message: '路径无效',
      severity: 'warning',
      detail: '请选择一个有效的文件夹作为教学工作区。'
    }
  }

  if (raw.includes('Mission prompt is required')) {
    return {
      message: '请输入学习使命',
      severity: 'info',
      detail: '学习使命不能为空，请简要描述你想学习的内容。'
    }
  }

  if (raw.includes('Lesson prompt is required')) {
    return {
      message: '请输入教学任务',
      severity: 'info',
      detail: '请在上方输入框中描述你想生成的课程主题。'
    }
  }

  if (raw.includes('outside the workspace lessons directory') || raw.includes('Path is outside')) {
    return {
      message: '路径访问受限',
      severity: 'warning',
      detail: '仅允许访问教学工作区内的文件。'
    }
  }

  // File system errors
  if (raw.includes('ENOENT') || raw.includes('no such file')) {
    return {
      message: '文件未找到',
      severity: 'warning',
      detail: '所选文件可能已被移动或删除。'
    }
  }

  if (raw.includes('EACCES') || raw.includes('permission denied')) {
    return {
      message: '文件访问被拒绝',
      severity: 'error',
      detail: '没有权限访问该文件，请检查文件权限设置。'
    }
  }

  // Generic fallback — don't expose raw stack traces
  if (raw.includes('Error:') || raw.includes('TypeError:') || raw.includes('at ')) {
    return {
      message: '操作未成功',
      severity: 'error',
      detail: '应用遇到意外错误。如果问题持续出现，请重启应用。'
    }
  }

  return {
    message: raw || '操作未成功',
    severity: 'error',
    detail: '请稍后重试。如果问题持续出现，请联系支持。'
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
            应用异常
          </div>
          <h2>{userError.message}</h2>
          <p>{userError.detail ?? '应用遇到了意外错误，请尝试重新加载。'}</p>
          <button type="button" onClick={this.handleReload}>
            <RefreshCw size={15} />
            重新加载
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
      const [state, settings] = await Promise.all([
        api.getState(),
        api.getSettings()
      ])
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
      const settings = await api.updateSettings(patch)
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
        loading: false
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  createWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return
    const name = window.prompt('工作区名称', 'learn')
    if (!name) return
    const prompt = window.prompt('学习使命', `我想学习 ${name}，并生成可复习的 HTML 课程。`)
    if (!prompt) return
    set({ loading: true, error: null })
    try {
      const state = await api.createWorkspace({ name, prompt })
      set({ appState: state, taskPrompt: defaultPrompt, loading: false })
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
        loading: false
      })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.workspaceImported) {
        void get().showNotification('工作区已导入', `${result.state.activeWorkspace?.name ?? '教学工作区'} 已加入 TeachOS。`)
      }
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification('导入失败', toUserError(error).message)
      }
    }
  },
  updateMission: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    const newPrompt = window.prompt('更新学习使命', workspace.missionExcerpt)
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
      !window.confirm('将根据当前任务生成 lesson、reference 和 learning record。继续吗？')
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
      const result = await api.generateLesson({ workspaceId: workspace.id, prompt })
      set({
        appState: result.state,
        taskPrompt: nextPrompt,
        generating: false
      })
      if (settings.workspace.autoOpenGeneratedLesson) {
        void get().openPath(result.lesson.absolutePath)
      }
      if (settings.notifications.enabled && settings.notifications.lessonGenerated) {
        const suffix = result.source === 'fallback' ? `（本地回退${result.reason ? `：${result.reason}` : ''}）` : ''
        void get().showNotification('课程已生成', `${result.lesson.title} 已保存到 ${result.lesson.relativePath}${suffix}`)
      }
    } catch (error) {
      const userError = toUserError(error)
      set({
        generating: false,
        error: userError,
        appState: { ...get().appState, runtime: { ...defaultRuntime, status: 'error' } }
      })
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification('生成失败', userError.message)
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
      !window.confirm('将根据当前任务生成 lesson、reference 和 learning record。继续吗？')
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
        { workspaceId: workspace.id, prompt },
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
          void get().showNotification('生成失败', userError.message)
        }
        return
      }
      if (!('error' in done)) {
        set({ appState: done.state, taskPrompt: nextPrompt, generating: false })
        if (settings.workspace.autoOpenGeneratedLesson) {
          void get().openPath(done.lesson.absolutePath)
        }
        if (settings.notifications.enabled && settings.notifications.lessonGenerated) {
          const suffix = done.source === 'fallback' ? `（本地回退${done.reason ? `：${done.reason}` : ''}）` : ''
          void get().showNotification('课程已生成', `${done.lesson.title} 已保存到 ${done.lesson.relativePath}${suffix}`)
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
        set({ error: toUserError(new Error(result.message ?? '无法打开路径。')) })
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
        set({ error: toUserError(new Error(result.message ?? '无法打开链接。')) })
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
      aria-label="调整侧边栏宽度"
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
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className="window-titlebar" role="group" aria-label="窗口控制">
      <div className="window-controls">
        <button
          className="window-control-btn"
          type="button"
          aria-label="最小化窗口"
          title="最小化窗口"
          onClick={() => controlWindow('minimize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="window-control-btn"
          type="button"
          aria-label="最大化或还原窗口"
          title="最大化或还原窗口"
          onClick={() => controlWindow('toggle-maximize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="window-control-btn window-control-btn--close"
          type="button"
          aria-label="关闭窗口"
          title="关闭窗口"
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
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className="mac-traffic-lights" role="group" aria-label="窗口控制">
      <button
        className="mac-traffic-light mac-traffic-light--close"
        type="button"
        aria-label="关闭窗口"
        title="关闭窗口"
        onClick={() => controlWindow('close')}
      />
      <button
        className="mac-traffic-light mac-traffic-light--minimize"
        type="button"
        aria-label="最小化窗口"
        title="最小化窗口"
        onClick={() => controlWindow('minimize')}
      />
      <button
        className="mac-traffic-light mac-traffic-light--maximize"
        type="button"
        aria-label="最大化或还原窗口"
        title="最大化或还原窗口"
        onClick={() => controlWindow('toggle-maximize')}
      />
    </div>
  )
}

// ================================================================
// Sidebar
// ================================================================

function Sidebar() {
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

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-label="主导航">
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
          <span className="collapsible-label">{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-section">
        <div className="section-heading">
          <span className="collapsible-label">工作区</span>
          <button className="icon-button" type="button" aria-label="新建工作区" onClick={createWorkspace}>
            <Plus size={15} />
          </button>
        </div>
        {appState.workspaces.map((workspace) => (
          <button
            className={`workspace-item ${workspace.id === active?.id ? 'is-selected' : ''}`}
            key={workspace.id}
            type="button"
            onClick={() => void selectWorkspace(workspace.id)}
            title={workspace.name}
          >
            <FolderOpen size={17} />
            <span className="collapsible-label">{workspace.name}</span>
            <small>{workspace.lessons.length} 课</small>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="avatar-button" type="button" onClick={() => openSettings('general')}>
          <span className="avatar">C</span>
        </button>
        <button
          className={`icon-button${settings.notifications.enabled ? '' : ' is-muted'}`}
          type="button"
          aria-label="通知"
          onClick={() => {
            openSettings('notifications')
            void showNotification('TeachOS 通知中心', settings.notifications.enabled ? '通知设置已打开。' : '通知已关闭，可在这里重新启用。')
          }}
          title="通知"
        >
          <Bell size={16} />
        </button>
        <button className="icon-button" type="button" aria-label="设置" onClick={() => openSettings('model')} title="设置">
          <Settings size={16} />
        </button>
      </div>
    </aside>
  )
}

// ================================================================
// Main Content Area
// ================================================================

function MainArea() {
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
  const resources = active?.resources ?? []
  const records = active?.records ?? []
  const selectedLesson = active?.lessons.find((lesson) => lesson.absolutePath === appState.selectedLessonPath) ?? active?.lessons[0] ?? null
  const canGenerate = Boolean(active && taskPrompt.trim() && !generating)
  const generateCurrentLesson = settings.generator.streaming ? generateLessonStream : generateLesson

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
    <main className="main-area">
      <header className="topbar">
        <div className="crumb">
          <button
            className="icon-button"
            type="button"
            aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
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
          <button className="alert-dismiss" type="button" aria-label="关闭提示" onClick={clearError}>
            <X size={14} />
          </button>
        </div>
      )}

      {view === 'overview' && (
        <section className="overview-dialog-shell" aria-label="概览">
          <form
            className="overview-dialog"
            aria-label="教学任务输入"
            onSubmit={(event) => {
              event.preventDefault()
              if (canGenerate) void generateCurrentLesson()
            }}
          >
            <textarea
              value={taskPrompt}
              aria-label="教学任务"
              placeholder={active ? '输入教学任务，生成下一节可复习课程...' : '先新建或导入教学工作区...'}
              onChange={(event) => setTaskPrompt(event.target.value)}
            />
            <div className="overview-dialog-footer">
              <div className="overview-dialog-tools">
                <button className="overview-dialog-icon" type="button" aria-label="新建工作区" title="新建工作区" onClick={createWorkspace}>
                  <Plus size={16} />
                </button>
                <button
                  className="overview-dialog-pill"
                  type="button"
                  onClick={() => active ? void openPath(active.rootPath) : void importWorkspace()}
                >
                  <FolderOpen size={15} />
                  <span>{active?.name ?? '选择工作区'}</span>
                  <ChevronDown size={13} />
                </button>
                <button
                  className={`overview-dialog-pill ${settings.generator.structuredOutput ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => void updateSettings({ generator: { structuredOutput: !settings.generator.structuredOutput } })}
                >
                  <Zap size={15} />
                  <span>Structured JSON</span>
                </button>
              </div>
              <div className="overview-dialog-actions">
                <button className="overview-dialog-model" type="button" onClick={() => openSettings('model')}>
                  <span>{runtimeProviderLabel(settings)}</span>
                  <ChevronDown size={13} />
                </button>
                <button className="send-button overview-dialog-send" type="submit" aria-label="生成课程" disabled={!canGenerate}>
                  {generating ? <Loader2 className="spin" size={17} /> : <SendHorizontal size={17} />}
                </button>
              </div>
            </div>
          </form>
        </section>
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
          onTestNotification={() => useAppStore.getState().showNotification('TeachOS 通知测试', '通知设置已正确连接。')}
          onProbeProvider={useAppStore.getState().probeProvider}
          onListUpstreamModels={useAppStore.getState().listUpstreamModels}
          onOpenLogFile={async () => {
            const result = await window.teachingSystem?.openLogFile()
            if (!result?.ok) throw new Error(result?.message ?? '无法打开日志文件。')
          }}
          onOpenAppDataDir={async () => {
            const result = await window.teachingSystem?.openAppDataDir()
            if (!result?.ok) throw new Error(result?.message ?? '无法打开应用数据目录。')
          }}
        />
      )}

      {view === 'lessons' && (
        <section className="composer-tool" aria-label="教学任务输入">
          <div className="composer-header">
            <div>
              <strong>教学任务</strong>
            </div>
            <button className="icon-button soft" type="button" aria-label="模型设置" onClick={() => openSettings('model')}>
              <Command size={16} />
            </button>
          </div>
          <textarea
            value={taskPrompt}
            aria-label="教学任务"
            placeholder="描述你想让 AI 生成的教学内容..."
            onChange={(event) => setTaskPrompt(event.target.value)}
          />
          <div className="composer-footer">
            <div className="tool-pills">
              <button type="button" onClick={() => active && void openPath(active.rootPath)} disabled={!active}>
                <FolderOpen size={15} />
                根目录
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
            <button className="send-button" type="button" aria-label="生成课程" onClick={settings.generator.streaming ? generateLessonStream : generateLesson} disabled={!active || generating}>
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
              <span>课程计划</span>
              <h2>{view === 'lessons' ? '全部 lesson' : '下一组 lesson'}</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => active && void openPath(active.lessonsDir)} disabled={!active}>
              <ArrowUpRight size={16} />
              打开目录
            </button>
          </div>

          <div className="lesson-list">
            {lessons.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="暂无课程"
                detail="在上方输入教学任务，点击生成按钮创建可复习的 HTML 课程。"
                action={active ? { label: '生成课程', onClick: generateLesson } : undefined}
              />
            ) : (
              lessons.map((lesson) => {
                const isSelected = lesson.absolutePath === appState.selectedLessonPath
                return (
                  <article className={`lesson-card ${isSelected ? 'is-selected' : ''}`} key={lesson.absolutePath} onClick={() => void loadLesson(lesson)}>
                    <div className="lesson-id">{lesson.id}</div>
                    <div className="lesson-icon">
                      <BookOpen size={18} />
                    </div>
                    <div className="lesson-body">
                      <h3>{lesson.title}</h3>
                      <p>{lesson.durationMinutes} 分钟 · {lesson.relativePath}</p>
                    </div>
                    <span className="state-chip">{isSelected ? '预览中' : '已生成'}</span>
                  </article>
                )
              })
            )}
          </div>
        </div>

        <aside className="preview-panel" aria-label="Lesson 预览">
          <div className="preview-toolbar">
            <div>
              <span>{selectedLesson?.relativePath ?? 'lessons/0001-lesson.html'}</span>
              <strong>静态课程预览</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="打开预览"
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
      <section className="lower-grid">
        <div className="resource-panel">
          <div className="section-title-row compact">
            <div>
              <span>可信资源</span>
              <h2>资源索引</h2>
            </div>
            <button className="icon-button" type="button" aria-label="打开 RESOURCES.md" onClick={() => active && void openPath(active.resourcesPath)} disabled={!active}>
              <Plus size={16} />
            </button>
          </div>
          <div className="resource-list">
            {resources.length === 0 ? (
              <EmptyState
                icon={LibraryBig}
                title="暂无资源"
                detail="在 RESOURCES.md 中添加可信学习来源后，会显示在这里。"
              />
            ) : (
              resources.map((resource) => (
                <article className="resource-row" key={`${resource.tag}-${resource.title}`}>
                  <div>
                    <h3>{resource.title}</h3>
                    <p>{resource.detail}</p>
                  </div>
                  <span>{resource.tag}</span>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="records-panel">
          <div className="section-title-row compact">
            <div>
              <span>学习记录</span>
              <h2>近期洞察</h2>
            </div>
            <button className="icon-button" type="button" aria-label="查看学习记录目录" onClick={() => active && void openPath(active.recordsDir)} disabled={!active}>
              <History size={16} />
            </button>
          </div>
          <div className="record-list">
            {records.length === 0 ? (
              <EmptyState
                icon={History}
                title="暂无记录"
                detail="生成 lesson 时会同步写入 learning-records/，下次查看时此处会显示最新记录。"
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
              <span>AI Runtime</span>
              <strong>{runtimeProviderLabel(settings)}</strong>
            </div>
          </div>
          <div className="runtime-meter">
            <div style={{ width: runtimeMeterWidth(appState.runtime, active, generating) }} />
          </div>
          <div className="runtime-stats">
            <span>
              <Clock3 size={15} />
              {appState.runtime.queuedTasks} 个队列任务
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
      </section>
      )}
    </main>
  )
}

// ================================================================
// Settings View
// ================================================================

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
  onOpenLogFile: () => Promise<void>
  onOpenAppDataDir: () => Promise<void>
}) {
  const activeProvider = activeModelProvider(settings)
  const [providerStatus, setProviderStatus] = useState<string>('')
  const [providerBusy, setProviderBusy] = useState(false)

  const probeActiveProvider = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus('正在连接 provider...')
    const result = await onProbeProvider({
      baseUrl: activeProvider.baseUrl,
      apiKey: activeProvider.apiKey,
      endpointFormat: activeProvider.endpointFormat
    })
    setProviderBusy(false)
    setProviderStatus(result.ok ? `连接成功：${result.latencyMs}ms，发现 ${result.modelIds.length} 个模型。` : result.message)
  }

  const pullActiveProviderModels = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus('正在拉取模型列表...')
    const result = await onListUpstreamModels(activeProvider.id)
    setProviderBusy(false)
    if (!result.ok) {
      setProviderStatus(result.message)
      return
    }
    updateProvider({ models: result.modelIds })
    setProviderStatus(`已同步 ${result.modelIds.length} 个模型。`)
  }

  const updateProvider = (patch: Partial<TeachingModelProviderProfile>): void => {
    void onUpdateSettings({
      provider: {
        providers: settings.provider.providers.map((provider) =>
          provider.id === activeProvider.id ? { ...provider, ...patch } : provider
        )
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

  const resetActiveProviderToPreset = (): void => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === activeProvider.id)
    if (!preset) return
    updateProvider({ ...preset, apiKey: activeProvider.apiKey })
    void onUpdateSettings({
      generator: {
        providerId: preset.id,
        model: preset.models[0] ?? '',
        endpointFormat: preset.endpointFormat
      }
    })
  }

  return (
    <div className="settings-floating-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="settings-view" aria-label="设置" role="dialog" aria-modal="true">
        <button className="settings-close-button" type="button" aria-label="关闭设置" onClick={onClose}>
          <X size={17} />
        </button>
        <aside className="settings-nav" aria-label="设置分类">
        <div className="settings-nav-heading">Settings</div>
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
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          )
        })}
      </aside>

      <div className="settings-content">
        {section === 'general' && (
          <SettingsPanel
            title="通用"
            subtitle="本地偏好会保存到 TeachOS 的应用数据目录。"
          >
            <SettingsCard>
              <SettingsRow label="主题" detail="跟随系统、浅色或深色。">
                <SegmentedControl
                  value={settings.theme}
                  options={[
                    { value: 'system', label: '系统', icon: Monitor },
                    { value: 'light', label: '浅色', icon: Sun },
                    { value: 'dark', label: '深色', icon: Moon }
                  ]}
                  onChange={(theme) => void onUpdateSettings({ theme })}
                />
              </SettingsRow>
              <SettingsRow label="语言" detail="当前界面默认使用中文内容。">
                <SegmentedControl
                  value={settings.locale}
                  options={[
                    { value: 'zh-CN', label: '中文' },
                    { value: 'en-US', label: 'English' }
                  ]}
                  onChange={(locale) => void onUpdateSettings({ locale })}
                />
              </SettingsRow>
              <SettingsRow label="界面密度" detail="紧凑模式会减少行高和面板间距。">
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: '舒适' },
                    { value: 'compact', label: '紧凑' }
                  ]}
                  onChange={(density) => void onUpdateSettings({ density })}
                />
              </SettingsRow>
              <SettingsRow label="字体缩放" detail={`${Math.round(settings.uiFontScale * 100)}%`}>
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
              <SettingsRow label="关闭行为" detail={settings.appBehavior.closeAction === 'tray' ? '关闭到托盘' : '直接退出'}>
                <SegmentedControl
                  value={settings.appBehavior.closeAction}
                  options={[
                    { value: 'quit', label: '退出' },
                    { value: 'tray', label: '托盘' }
                  ]}
                  onChange={(closeAction) => void onUpdateSettings({ appBehavior: { closeAction, closeToTray: closeAction === 'tray' } })}
                />
              </SettingsRow>
              <SettingsRow label="开机启动" detail="由 Electron login item 设置控制。">
                <ToggleSwitch
                  checked={settings.appBehavior.openAtLogin}
                  onChange={(openAtLogin) => void onUpdateSettings({ appBehavior: { openAtLogin } })}
                />
              </SettingsRow>
              <SettingsRow label="启动时最小化" detail="开机启动时仅显示托盘图标。">
                <ToggleSwitch
                  checked={settings.appBehavior.startMinimized}
                  onChange={(startMinimized) => void onUpdateSettings({ appBehavior: { startMinimized } })}
                />
              </SettingsRow>
              <SettingsRow label="日志" detail={`${settings.log.enabled ? '已启用' : '已关闭'} · 保留 ${settings.log.retentionDays} 天`}>
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
            title="外观"
            subtitle="Codex 风格的紧凑卡片布局会立即应用到当前窗口。"
          >
            <SettingsCard>
              <SettingsRow label="主题" detail="跟随系统、浅色或深色。">
                <SegmentedControl
                  value={settings.theme}
                  options={[
                    { value: 'system', label: '系统', icon: Monitor },
                    { value: 'light', label: '浅色', icon: Sun },
                    { value: 'dark', label: '深色', icon: Moon }
                  ]}
                  onChange={(theme) => void onUpdateSettings({ theme })}
                />
              </SettingsRow>
              <SettingsRow label="界面密度" detail={settings.density === 'compact' ? '紧凑' : '舒适'}>
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: '舒适' },
                    { value: 'compact', label: '紧凑' }
                  ]}
                  onChange={(density) => void onUpdateSettings({ density })}
                />
              </SettingsRow>
              <SettingsRow label="字体缩放" detail={`${Math.round(settings.uiFontScale * 100)}%`}>
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
            title="模型"
            subtitle="Provider 预设来自 Kun 的模型设置组织方式，字段会完整保存并供生成配置读取。"
          >
            <div className="provider-layout">
              <SettingsCard className="provider-list-card">
                {settings.provider.providers.map((provider) => (
                  <button
                    className={`provider-option ${provider.id === activeProvider.id ? 'is-active' : ''}`}
                    key={provider.id}
                    type="button"
                    onClick={() => selectProvider(provider.id)}
                  >
                    <Bot size={16} />
                    <span>
                      <strong>{provider.name}</strong>
                      <small>{provider.models[0] ?? provider.endpointFormat}</small>
                    </span>
                    {provider.apiKey.trim() && <CheckCircle2 size={15} />}
                  </button>
                ))}
              </SettingsCard>

              <SettingsCard>
                <SettingsRow label="Provider 名称" detail={activeProvider.id}>
                  <SettingsTextInput
                    value={activeProvider.name}
                    onChange={(name) => updateProvider({ name })}
                  />
                </SettingsRow>
                <SettingsRow label="API Key" detail={activeProvider.apiKey ? '已填写' : '未填写'}>
                  <SettingsTextInput
                    type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                    value={activeProvider.apiKey}
                    placeholder="sk-..."
                    onChange={(apiKey) => updateProvider({ apiKey })}
                  />
                </SettingsRow>
                <SettingsRow label="Base URL" detail={activeProvider.endpointFormat}>
                  <SettingsTextInput
                    value={activeProvider.baseUrl}
                    onChange={(baseUrl) => updateProvider({ baseUrl })}
                  />
                </SettingsRow>
                <SettingsRow label="Endpoint format" detail={endpointFormatLabels[activeProvider.endpointFormat]}>
                  <SettingsSelect
                    value={activeProvider.endpointFormat}
                    options={MODEL_ENDPOINT_FORMATS.map((format) => ({
                      value: format,
                      label: endpointFormatLabels[format]
                    }))}
                    onChange={(endpointFormat) => {
                      updateProvider({ endpointFormat })
                      if (settings.generator.providerId === activeProvider.id) {
                        void onUpdateSettings({ generator: { endpointFormat } })
                      }
                    }}
                  />
                </SettingsRow>
                <SettingsRow label="模型列表" detail={`${activeProvider.models.length} 个模型`}>
                  <textarea
                    className="settings-textarea"
                    value={activeProvider.models.join('\n')}
                    onChange={(event) => updateProvider({ models: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })}
                  />
                </SettingsRow>
                <SettingsRow label="Provider 操作" detail={providerStatus || '测试连接、同步模型列表、打开官方文档或恢复内置预设。'}>
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" onClick={() => void probeActiveProvider()} disabled={providerBusy}>
                      {providerBusy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                      测试
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void pullActiveProviderModels()} disabled={providerBusy || activeProvider.endpointFormat === 'custom_endpoint'}>
                      <RefreshCw size={15} />
                      拉取模型
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeProvider.docsUrl)} disabled={!activeProvider.docsUrl}>
                      <ExternalLink size={15} />
                      文档
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeProvider.apiKeyUrl)} disabled={!activeProvider.apiKeyUrl}>
                      <KeyRound size={15} />
                      Key
                    </button>
                    <button className="ghost-button" type="button" onClick={resetActiveProviderToPreset}>
                      <RefreshCw size={15} />
                      重置
                    </button>
                  </div>
                </SettingsRow>
              </SettingsCard>
            </div>
          </SettingsPanel>
        )}

        {section === 'generation' && (
          <SettingsPanel
            title="生成"
            subtitle="这些设置会直接影响后续 lesson 文件和伴随产物。"
          >
            <SettingsCard>
              <SettingsRow label="生成 Provider" detail={activeProvider.name}>
                <SettingsSelect
                  value={settings.generator.providerId}
                  options={settings.provider.providers.map((provider) => ({
                    value: provider.id,
                    label: provider.name
                  }))}
                  onChange={selectProvider}
                />
              </SettingsRow>
              <SettingsRow label="模型" detail={settings.generator.model || '未选择'}>
                <SettingsSelect
                  value={settings.generator.model}
                  options={activeProvider.models.map((model) => ({ value: model, label: model }))}
                  onChange={(model) => void onUpdateSettings({ generator: { model } })}
                />
              </SettingsRow>
              <SettingsRow label="Temperature" detail={settings.generator.temperature.toFixed(2)}>
                <NumberInput
                  max={2}
                  min={0}
                  step={0.05}
                  value={settings.generator.temperature}
                  onChange={(temperature) => void onUpdateSettings({ generator: { temperature } })}
                />
              </SettingsRow>
              <SettingsRow label="最大输出 Tokens" detail={`${settings.generator.maxOutputTokens}`}>
                <NumberInput
                  max={32768}
                  min={512}
                  step={256}
                  value={settings.generator.maxOutputTokens}
                  onChange={(maxOutputTokens) => void onUpdateSettings({ generator: { maxOutputTokens } })}
                />
              </SettingsRow>
              <SettingsRow label="课程时长" detail={`${settings.generator.lessonDurationMinutes} 分钟`}>
                <NumberInput
                  max={60}
                  min={5}
                  step={1}
                  value={settings.generator.lessonDurationMinutes}
                  onChange={(lessonDurationMinutes) => void onUpdateSettings({ generator: { lessonDurationMinutes } })}
                />
              </SettingsRow>
              <SettingsRow label="检索练习" detail="写入 lesson 内的交互练习。">
                <ToggleSwitch
                  checked={settings.generator.includeRetrievalPractice}
                  onChange={(includeRetrievalPractice) => void onUpdateSettings({ generator: { includeRetrievalPractice } })}
                />
              </SettingsRow>
              <SettingsRow label="Reference HTML" detail="生成 reference/*.html 速查材料。">
                <ToggleSwitch
                  checked={settings.generator.generateReference}
                  onChange={(generateReference) => void onUpdateSettings({ generator: { generateReference } })}
                />
              </SettingsRow>
              <SettingsRow label="Learning record" detail="生成 learning-records/*.md 学习记录。">
                <ToggleSwitch
                  checked={settings.generator.generateLearningRecord}
                  onChange={(generateLearningRecord) => void onUpdateSettings({ generator: { generateLearningRecord } })}
                />
              </SettingsRow>
              <SettingsRow label="Structured JSON" detail="在 lesson HTML 内嵌结构化元数据。">
                <ToggleSwitch
                  checked={settings.generator.structuredOutput}
                  onChange={(structuredOutput) => void onUpdateSettings({ generator: { structuredOutput } })}
                />
              </SettingsRow>
              <SettingsRow label="流式生成" detail="打开后使用 SSE/流式预览；失败会回退到非流式或本地计划。">
                <ToggleSwitch
                  checked={settings.generator.streaming}
                  onChange={(streaming) => void onUpdateSettings({ generator: { streaming } })}
                />
              </SettingsRow>
              <SettingsRow label="请求超时" detail={`${Math.round(settings.generator.requestTimeoutMs / 1000)} 秒`}>
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

        {section === 'workspace' && (
          <SettingsPanel
            title="工作区"
            subtitle="新建、导入和打开路径均走 Electron 主进程的受控文件访问。"
          >
            <SettingsCard>
              <SettingsRow label="默认工作区根目录" detail={settings.workspace.defaultRoot || '未设置'}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onPickDefaultRoot()}>
                    <FolderOpen size={15} />
                    选择
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(settings.workspace.defaultRoot)} disabled={!settings.workspace.defaultRoot}>
                    <ArrowUpRight size={15} />
                    打开
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label="生成前确认" detail="发送任务前要求二次确认。">
                <ToggleSwitch
                  checked={settings.workspace.confirmBeforeGenerating}
                  onChange={(confirmBeforeGenerating) => void onUpdateSettings({ workspace: { confirmBeforeGenerating } })}
                />
              </SettingsRow>
              <SettingsRow label="生成后打开 lesson" detail="生成完成后调用系统默认程序打开 HTML。">
                <ToggleSwitch
                  checked={settings.workspace.autoOpenGeneratedLesson}
                  onChange={(autoOpenGeneratedLesson) => void onUpdateSettings({ workspace: { autoOpenGeneratedLesson } })}
                />
              </SettingsRow>
              <SettingsRow label="当前工作区" detail={activeWorkspace?.rootPath ?? '未选择'}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onCreateWorkspace()}>
                    <Plus size={15} />
                    新建
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onImportWorkspace()}>
                    <Upload size={15} />
                    导入
                  </button>
                  <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                    <ArrowUpRight size={15} />
                    打开
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'notifications' && (
          <SettingsPanel
            title="通知"
            subtitle="通知通过 Electron 原生 Notification 发出。"
          >
            <SettingsCard>
              <SettingsRow label="启用通知" detail={settings.notifications.enabled ? '已启用' : '已关闭'}>
                <ToggleSwitch
                  checked={settings.notifications.enabled}
                  onChange={(enabled) => void onUpdateSettings({ notifications: { enabled } })}
                />
              </SettingsRow>
              <SettingsRow label="课程生成完成" detail="lesson 保存成功后提醒。">
                <ToggleSwitch
                  checked={settings.notifications.lessonGenerated}
                  onChange={(lessonGenerated) => void onUpdateSettings({ notifications: { lessonGenerated } })}
                />
              </SettingsRow>
              <SettingsRow label="工作区导入" detail="导入成功后提醒。">
                <ToggleSwitch
                  checked={settings.notifications.workspaceImported}
                  onChange={(workspaceImported) => void onUpdateSettings({ notifications: { workspaceImported } })}
                />
              </SettingsRow>
              <SettingsRow label="错误提醒" detail="生成或导入失败时提醒。">
                <ToggleSwitch
                  checked={settings.notifications.errors}
                  onChange={(errors) => void onUpdateSettings({ notifications: { errors } })}
                />
              </SettingsRow>
              <SettingsRow label="测试通知" detail="发送一条本地测试通知。">
                <button className="ghost-button" type="button" onClick={() => void onTestNotification()}>
                  <Bell size={15} />
                  发送测试
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'privacy' && (
          <SettingsPanel
            title="隐私"
            subtitle="TeachOS 默认本地优先，设置、工作区索引和课程文件都存放在本机。"
          >
            <SettingsCard>
              <SettingsRow label="隐藏 API Key" detail="设置页用密码输入框显示密钥。">
                <ToggleSwitch
                  checked={settings.privacy.maskApiKeys}
                  onChange={(maskApiKeys) => void onUpdateSettings({ privacy: { maskApiKeys } })}
                />
              </SettingsRow>
              <SettingsRow label="允许打开外部链接" detail="控制 provider 文档和 Key 页面按钮。">
                <ToggleSwitch
                  checked={settings.privacy.allowExternalLinks}
                  onChange={(allowExternalLinks) => void onUpdateSettings({ privacy: { allowExternalLinks } })}
                />
              </SettingsRow>
              <SettingsRow label="Provider Proxy" detail={settings.provider.proxy.enabled ? settings.provider.proxy.url || '已启用' : '未启用'}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.provider.proxy.enabled}
                    onChange={(enabled) => void onUpdateSettings({ provider: { proxy: { enabled } } })}
                  />
                  <SettingsTextInput
                    value={settings.provider.proxy.url}
                    placeholder="http://127.0.0.1:7890"
                    onChange={(url) => void onUpdateSettings({ provider: { proxy: { url } } })}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'about' && (
          <SettingsPanel
            title="关于 TeachOS"
            subtitle="诊断入口和当前运行时信息，便于检查迁移后的完整链路。"
          >
            <SettingsCard>
              <SettingsRow label="当前 Runtime" detail={runtimeProviderLabel(settings)}>
                <span className="settings-status-badge">{settings.generator.streaming ? 'Streaming' : 'One-shot'}</span>
              </SettingsRow>
              <SettingsRow label="当前工作区" detail={activeWorkspace?.rootPath ?? '未选择工作区'}>
                <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                  <FolderOpen size={15} />
                  打开
                </button>
              </SettingsRow>
              <SettingsRow label="日志文件" detail={`保留 ${settings.log.retentionDays} 天`}>
                <button className="ghost-button" type="button" onClick={() => void onOpenLogFile()}>
                  <FileText size={15} />
                  打开日志
                </button>
              </SettingsRow>
              <SettingsRow label="应用数据目录" detail="settings、workspace registry 和日志所在位置。">
                <button className="ghost-button" type="button" onClick={() => void onOpenAppDataDir()}>
                  <ArrowUpRight size={15} />
                  打开目录
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
  return (
    <select className="settings-select" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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

function streamingPreviewHtml(liveText: string, workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:760px;margin:0 auto;padding:38px 30px}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}pre{white-space:pre-wrap;line-height:1.7;color:#40506a;background:#f4f7fb;border:1px solid #e8edf5;border-radius:16px;padding:18px;min-height:180px}
</style></head><body><main><div class="badge">TeachOS · Streaming</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>正在接收模型输出，完成后会渲染为正式 lesson。</p><pre>${escapeHtml(liveText || '等待第一个 token...')}</pre></main></body></html>`
}

function emptyPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:680px;margin:0 auto;padding:46px 34px}p{color:#68778f;line-height:1.8}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}
</style></head><body><main><div class="badge">TeachOS</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(workspace.missionExcerpt)}</p><p>点击生成按钮后，第一节静态 HTML lesson 会保存到 lessons/ 并在这里预览。</p></main></body></html>`
}

function loadingPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{display:grid;place-items:center;min-height:360px;padding:34px}p{color:#68778f}
</style></head><body><main><div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>正在读取 lesson 预览。</p></div></main></body></html>`
}

export { App, AppErrorBoundary }
