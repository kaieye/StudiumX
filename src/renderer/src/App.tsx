import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Command,
  Database,
  FileCheck2,
  FileText,
  FolderOpen,
  GraduationCap,
  History,
  Home,
  Info,
  LibraryBig,
  Loader2,
  Maximize2,
  Minus,
  PanelLeft,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Upload,
  X,
  Zap
} from 'lucide-react'
import type { ErrorInfo, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Component, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type {
  LessonSummary,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingWorkspaceSummary,
  WindowControlAction,
  WorkspaceView
} from '../../shared/teaching-types'

// ================================================================
// Types
// ================================================================

type WorkflowCard = {
  label: string
  status: string
  stepState: 'done' | 'active' | 'waiting' | 'error'
  icon: LucideIcon
  tone: 'green' | 'blue' | 'amber' | 'rose'
}

type ErrorSeverity = 'error' | 'warning' | 'info'

type UserError = {
  message: string
  severity: ErrorSeverity
  detail?: string
}

type StoreState = {
  view: WorkspaceView
  loading: boolean
  generating: boolean
  error: UserError | null
  searchQuery: string
  taskPrompt: string
  appState: TeachingAppState
  setView: (view: WorkspaceView) => void
  setSearchQuery: (query: string) => void
  setTaskPrompt: (prompt: string) => void
  clearError: () => void
  initialize: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: () => Promise<void>
  importWorkspace: () => Promise<void>
  updateMission: () => Promise<void>
  generateLesson: () => Promise<void>
  loadLesson: (lesson: LessonSummary) => Promise<void>
  openPath: (path: string) => Promise<void>
}

// ================================================================
// Constants
// ================================================================

const navItems = [
  { id: 'overview', label: '工作台', icon: Home },
  { id: 'lessons', label: '课程', icon: BookOpen },
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

const defaultPrompt =
  '我想先学习如何把 teach 技能包的 MISSION、RESOURCES 和 lessons 组织成一个 Electron 桌面应用的 MVP。'

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

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
  loading: true,
  generating: false,
  error: null,
  searchQuery: '',
  taskPrompt: defaultPrompt,
  appState: emptyAppState,
  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTaskPrompt: (taskPrompt) => set({ taskPrompt }),
  clearError: () => set({ error: null }),
  initialize: async () => {
    set({ loading: true, error: null })
    try {
      const state = await window.teachingSystem.getState()
      set({
        appState: state,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  selectWorkspace: async (workspaceId) => {
    set({ loading: true, error: null })
    try {
      const state = await window.teachingSystem.selectWorkspace(workspaceId)
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
    const name = window.prompt('工作区名称', 'learn')
    if (!name) return
    const prompt = window.prompt('学习使命', `我想学习 ${name}，并生成可复习的 HTML 课程。`)
    if (!prompt) return
    set({ loading: true, error: null })
    try {
      const state = await window.teachingSystem.createWorkspace({ name, prompt })
      set({ appState: state, taskPrompt: defaultPrompt, loading: false })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  importWorkspace: async () => {
    set({ loading: true, error: null })
    try {
      const result = await window.teachingSystem.importWorkspace()
      if (result.canceled || !result.state) {
        set({ loading: false })
        return
      }
      set({
        appState: result.state,
        taskPrompt: result.state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  updateMission: async () => {
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    const newPrompt = window.prompt('更新学习使命', workspace.missionExcerpt)
    if (!newPrompt) return
    set({ loading: true, error: null })
    try {
      const state = await window.teachingSystem.updateMission({ workspaceId: workspace.id, prompt: newPrompt })
      set({ appState: state, loading: false })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  generateLesson: async () => {
    const workspace = get().appState.activeWorkspace
    const prompt = get().taskPrompt.trim()
    if (!workspace || !prompt) return
    set({
      generating: true,
      error: null,
      appState: {
        ...get().appState,
        runtime: {
          status: 'working',
          currentStep: 'rendering lesson',
          queuedTasks: 1,
          providerLabel: 'Local structured generator'
        }
      }
    })
    try {
      const result = await window.teachingSystem.generateLesson({ workspaceId: workspace.id, prompt })
      set({
        appState: result.state,
        taskPrompt: nextPrompt,
        generating: false
      })
    } catch (error) {
      set({
        generating: false,
        error: toUserError(error),
        appState: { ...get().appState, runtime: { ...defaultRuntime, status: 'error' } }
      })
    }
  },
  loadLesson: async (lesson) => {
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
      const result = await window.teachingSystem.readLesson({
        workspaceId: workspace.id,
        lessonPath: lesson.absolutePath
      })
      set({ appState: { ...get().appState, selectedLessonPath: lesson.absolutePath, previewHtml: result.html } })
    } catch (error) {
      set({ error: toUserError(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace) } })
    }
  },
  openPath: async (path) => {
    try {
      const result = await window.teachingSystem.openPath(path)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? '无法打开路径。')) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  }
}))

// ================================================================
// Main App Component
// ================================================================

function App() {
  const platform = window.teachingSystem?.platform ?? 'win32'
  const isMac = platform === 'darwin'
  const showTitlebar = !isMac

  return (
    <AppErrorBoundary>
      <div className="app-frame">
        {showTitlebar && <WindowTitlebar />}
        <div className={`app-shell${isMac ? ' platform-darwin' : ''}`}>
          {isMac && <MacTrafficLights />}
          <Sidebar />
          <MainArea />
        </div>
      </div>
    </AppErrorBoundary>
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
      <div className="window-titlebar-brand">
        <div className="window-titlebar-icon" style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 18,
          height: 18,
          color: 'var(--accent)',
          borderRadius: 4,
          background: 'linear-gradient(180deg, #f8fbff, #edf4ff)',
          border: '1px solid #dce7ff'
        }}>
          <GraduationCap size={11} strokeWidth={2.2} />
        </div>
        <span className="window-titlebar-label">TeachOS</span>
      </div>
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
    loading,
    generating,
    searchQuery,
    appState,
    setView,
    setSearchQuery,
    selectWorkspace,
    createWorkspace,
    importWorkspace,
    openPath
  } = useAppStore()

  const active = appState.activeWorkspace

  return (
    <aside className="sidebar" aria-label="主导航">
      <div className="brand">
        <div className="brand-mark">
          <GraduationCap size={22} strokeWidth={2.1} />
        </div>
        <div>
          <p className="brand-title">TeachOS</p>
          <p className="brand-subtitle">AI 教学工作区</p>
        </div>
      </div>

      <label className="search-box">
        <Search size={16} />
        <input
          aria-label="搜索工作区"
          placeholder="搜索课程、资源、记录"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </label>

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
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-section">
        <div className="section-heading">
          <span>教学工作区</span>
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
          >
            <FolderOpen size={17} />
            <span>{workspace.name}</span>
            <small>{workspace.lessons.length} 课</small>
          </button>
        ))}
      </div>

      <div className="sidebar-section grow">
        <div className="section-heading">
          <span>产物</span>
          <ChevronDown size={15} />
        </div>
        <div className="artifact-list">
          <button type="button" onClick={() => active && void openPath(active.rootPath)}>
            <FileText size={15} />
            MISSION.md
          </button>
          <button type="button" onClick={() => active && void openPath(active.rootPath)}>
            <BookOpen size={15} />
            lessons/{active?.lessons.length ?? 0}
          </button>
          <button type="button" onClick={() => active && void openPath(active.rootPath)}>
            <History size={15} />
            learning-records
          </button>
        </div>
      </div>

      <div className="sidebar-footer">
        <button className="avatar-button" type="button">
          <span className="avatar">C</span>
          <span>本地设置</span>
        </button>
        <button className="icon-button" type="button" aria-label="通知">
          <Bell size={16} />
        </button>
        <button className="icon-button" type="button" aria-label="设置">
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
    loading,
    generating,
    error,
    searchQuery,
    taskPrompt,
    appState,
    setView,
    setSearchQuery,
    setTaskPrompt,
    initialize,
    selectWorkspace,
    createWorkspace,
    importWorkspace,
    updateMission,
    generateLesson,
    loadLesson,
    openPath,
    clearError
  } = useAppStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const active = appState.activeWorkspace
  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === view)?.label ?? '工作台',
    [view]
  )
  const query = searchQuery.trim().toLowerCase()
  const lessons = useMemo(
    () => filterLessons(active?.lessons ?? [], query),
    [active?.lessons, query]
  )
  const resources = useMemo(
    () => (active?.resources ?? []).filter((resource) => matchesQuery([resource.title, resource.detail, resource.tag], query)),
    [active?.resources, query]
  )
  const records = useMemo(
    () => (active?.records ?? []).filter((record) => matchesQuery([record.title, record.relativePath], query)),
    [active?.records, query]
  )
  const selectedLesson = active?.lessons.find((lesson) => lesson.absolutePath === appState.selectedLessonPath) ?? active?.lessons[0] ?? null
  const workflowSteps = useMemo(() => buildWorkflowSteps(active, generating), [active, generating])

  // Show skeleton during initial load
  if (loading && !active) {
    return (
      <main className="main-area">
        <div className="topbar">
          <div className="crumb">
            <span>TeachOS</span>
          </div>
        </div>
        <div style={{ maxWidth: 1100, margin: '48px auto', padding: '0 24px' }}>
          <div className="skeleton" style={{ width: '40%', height: 24, marginBottom: 16, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: '70%', height: 48, marginBottom: 28, borderRadius: 12 }} />
          <div className="skeleton" style={{ width: '100%', height: 180, marginBottom: 24, borderRadius: 20 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton" style={{ height: 72, borderRadius: 14 }} />
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="main-area">
      <header className="topbar">
        <div className="crumb">
          <button className="icon-button" type="button" aria-label="折叠侧边栏">
            <PanelLeft size={17} />
          </button>
          <span>{active?.name ?? 'workspace'}</span>
          <CircleDot size={9} />
          <span>{activeLabel}</span>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={importWorkspace} disabled={loading || generating}>
            <Upload size={16} />
            导入
          </button>
          <button className="primary-button" type="button" onClick={generateLesson} disabled={!active || generating}>
            {generating ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            生成第一课
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

      <section className="workspace-hero" aria-labelledby="workspace-title">
        <div className="hero-copy">
          <div className="assistant-badge">
            <Sparkles size={16} />
            本地 AI 教学编排
          </div>
          <h1 id="workspace-title">{active?.missionTitle ?? '加载教学工作区'}</h1>
          <p>{active?.missionExcerpt ?? '正在读取本地 TeachOS 工作区。'}</p>
        </div>
        <div className="mission-strip" aria-label="当前使命">
          <div className="mission-icon">
            <Target size={20} />
          </div>
          <div>
            <span>当前 Mission</span>
            <strong>{active?.missionTitle ?? '未选择工作区'}</strong>
          </div>
          <button className="icon-button" type="button" aria-label="编辑使命" onClick={updateMission} disabled={!active}>
            <PenLine size={16} />
          </button>
        </div>
      </section>

      <section className="composer-tool" aria-label="教学任务输入">
        <div className="composer-header">
          <div>
            <span>新教学任务</span>
            <strong>{selectedLesson ? '生成下一节可保存、可打印、可互动的 HTML 课程' : '生成第一节可保存、可打印、可互动的 HTML 课程'}</strong>
          </div>
          <button className="icon-button soft" type="button" aria-label="模型设置">
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
            <button type="button" onClick={() => active && void openPath(active.rootPath)}>
              <FolderOpen size={15} />
              {active?.name ?? 'workspace'}
            </button>
            <button type="button" onClick={() => active && void openPath(active.rootPath)}>
              <FileText size={15} />
              MISSION.md
            </button>
            <button type="button">
              <Zap size={15} />
              structured JSON
            </button>
          </div>
          <button className="send-button" type="button" aria-label="发送任务" onClick={generateLesson} disabled={!active || generating}>
            {generating ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
          </button>
        </div>
      </section>

      <section className="workflow-grid" aria-label="生成流程">
        {workflowSteps.map((step) => {
          const Icon = step.icon
          return (
            <div className={`workflow-card tone-${step.tone}`} data-status={step.stepState} key={step.label}>
              <div className="workflow-icon">
                <Icon size={18} />
              </div>
              <span>{step.label}</span>
              <strong>{step.status}</strong>
            </div>
          )
        })}
      </section>

      <section className="content-grid">
        <div className="lesson-column">
          <div className="section-title-row">
            <div>
              <span>课程计划</span>
              <h2>{view === 'lessons' ? '全部 lesson' : '下一组 lesson'}</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => active && void openPath(active.rootPath)} disabled={!active}>
              <ArrowUpRight size={16} />
              打开目录
            </button>
          </div>

          <div className="lesson-list">
            {lessons.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="暂无课程"
                detail="在上方输入教学任务，点击发送按钮生成第一节可复习的 HTML 课程。"
                action={active ? { label: '生成第一课', onClick: generateLesson } : undefined}
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

      <section className="lower-grid">
        <div className="resource-panel">
          <div className="section-title-row compact">
            <div>
              <span>可信资源</span>
              <h2>资源索引</h2>
            </div>
            <button className="icon-button" type="button" aria-label="打开资源" onClick={() => active && void openPath(active.rootPath)} disabled={!active}>
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
            <button className="icon-button" type="button" aria-label="查看记录" onClick={() => active && void openPath(active.rootPath)} disabled={!active}>
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
              <strong>{appState.runtime.providerLabel}</strong>
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
    </main>
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

function buildWorkflowSteps(active: TeachingWorkspaceSummary | null, generating: boolean): WorkflowCard[] {
  const hasMission = Boolean(active?.missionTitle && active.missionTitle !== active.name)
  const hasResources = Boolean(active?.resources.length && active.resources[0]?.title !== 'RESOURCES.md')
  const hasRecords = Boolean(active?.records.length)
  const hasLessons = Boolean(active?.lessons.length)

  return [
    {
      label: '目标对齐',
      status: hasMission ? '已完成' : '等待输入',
      stepState: hasMission ? 'done' : (active ? 'active' : 'waiting'),
      icon: Target,
      tone: 'green'
    },
    {
      label: '资源校验',
      status: hasResources ? '已完成' : '待补充',
      stepState: hasResources ? 'done' : (active ? 'active' : 'waiting'),
      icon: ShieldCheck,
      tone: 'blue'
    },
    {
      label: '结构输出',
      status: hasRecords ? '已完成' : generating ? '进行中' : '等待',
      stepState: hasRecords ? 'done' : generating ? 'active' : 'waiting',
      icon: Database,
      tone: 'amber'
    },
    {
      label: 'HTML 生成',
      status: hasLessons ? '已完成' : generating ? '进行中' : '等待',
      stepState: hasLessons ? 'done' : generating ? 'active' : 'waiting',
      icon: FileCheck2,
      tone: 'rose'
    }
  ]
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

function filterLessons(lessons: LessonSummary[], query: string): LessonSummary[] {
  if (!query) return lessons
  return lessons.filter((lesson) =>
    matchesQuery([lesson.title, lesson.objective, lesson.prompt, lesson.relativePath], query)
  )
}

function matchesQuery(values: string[], query: string): boolean {
  if (!query) return true
  return values.some((value) => value.toLowerCase().includes(query))
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
