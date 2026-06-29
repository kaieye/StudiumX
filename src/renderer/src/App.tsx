import {
  AlertCircle,
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
  LibraryBig,
  Loader2,
  Maximize2,
  Minus,
  PanelLeft,
  PenLine,
  Play,
  Plus,
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
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type {
  LessonSummary,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingWorkspaceSummary,
  WindowControlAction,
  WorkspaceView
} from '../../shared/teaching-types'

type WorkflowCard = {
  label: string
  status: string
  icon: LucideIcon
  tone: 'green' | 'blue' | 'amber' | 'rose'
}

type StoreState = {
  view: WorkspaceView
  loading: boolean
  generating: boolean
  error: string | null
  searchQuery: string
  taskPrompt: string
  appState: TeachingAppState
  setView: (view: WorkspaceView) => void
  setSearchQuery: (query: string) => void
  setTaskPrompt: (prompt: string) => void
  initialize: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: () => Promise<void>
  importWorkspace: () => Promise<void>
  updateMission: () => Promise<void>
  generateLesson: () => Promise<void>
  loadLesson: (lesson: LessonSummary) => Promise<void>
  openPath: (path: string) => Promise<void>
}

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
      set({ loading: false, error: errorMessage(error) })
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
      set({ loading: false, error: errorMessage(error) })
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
      set({ loading: false, error: errorMessage(error) })
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
      set({ loading: false, error: errorMessage(error) })
    }
  },
  updateMission: async () => {
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    const prompt = window.prompt('更新学习使命', workspace.missionExcerpt)
    if (!prompt) return
    set({ loading: true, error: null })
    try {
      const state = await window.teachingSystem.updateMission({ workspaceId: workspace.id, prompt })
      set({ appState: state, loading: false })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
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
        error: errorMessage(error),
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
      set({ error: errorMessage(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace) } })
    }
  },
  openPath: async (path) => {
    try {
      const result = await window.teachingSystem.openPath(path)
      if (!result.ok) {
        set({ error: result.message ?? '无法打开路径。' })
      }
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  }
}))

function App() {
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
    openPath
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

  const platform = window.teachingSystem?.platform ?? 'win32'

  return (
    <div className={`app-shell platform-${platform}`}>
      <WindowChrome />
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
          <div className="inline-alert" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
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
              <div className={`workflow-card tone-${step.tone}`} key={step.label}>
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
                <EmptyState icon={BookOpen} title="暂无课程" detail="生成后会写入 lessons/ 并显示在这里。" />
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
              {resources.map((resource) => (
                <article className="resource-row" key={`${resource.tag}-${resource.title}`}>
                  <div>
                    <h3>{resource.title}</h3>
                    <p>{resource.detail}</p>
                  </div>
                  <span>{resource.tag}</span>
                </article>
              ))}
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
                <EmptyState icon={History} title="暂无记录" detail="生成 lesson 时会同步写入 learning-records/。" />
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
              <div style={{ width: active?.lessons.length ? '72%' : generating ? '48%' : '24%' }} />
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
    </div>
  )
}

function WindowChrome() {
  const platform = window.teachingSystem?.platform ?? 'win32'
  const isMac = platform === 'darwin'
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className={`window-chrome ${isMac ? 'is-mac' : 'is-desktop'}`} role="group" aria-label="窗口控制">
      {isMac ? (
        <div className="mac-window-lights">
          <button
            className="mac-window-light is-close"
            type="button"
            aria-label="关闭窗口"
            title="关闭窗口"
            onClick={() => controlWindow('close')}
          />
          <button
            className="mac-window-light is-minimize"
            type="button"
            aria-label="最小化窗口"
            title="最小化窗口"
            onClick={() => controlWindow('minimize')}
          />
          <button
            className="mac-window-light is-maximize"
            type="button"
            aria-label="最大化或还原窗口"
            title="最大化或还原窗口"
            onClick={() => controlWindow('toggle-maximize')}
          />
        </div>
      ) : (
        <div className="window-controls">
          <button
            className="window-control is-minimize"
            type="button"
            aria-label="最小化窗口"
            title="最小化窗口"
            onClick={() => controlWindow('minimize')}
          >
            <Minus size={15} strokeWidth={1.8} />
          </button>
          <button
            className="window-control is-maximize"
            type="button"
            aria-label="最大化或还原窗口"
            title="最大化或还原窗口"
            onClick={() => controlWindow('toggle-maximize')}
          >
            <Maximize2 size={13} strokeWidth={1.8} />
          </button>
          <button
            className="window-control is-close"
            type="button"
            aria-label="关闭窗口"
            title="关闭窗口"
            onClick={() => controlWindow('close')}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <Icon size={18} />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function buildWorkflowSteps(active: TeachingWorkspaceSummary | null, generating: boolean): WorkflowCard[] {
  return [
    {
      label: '目标对齐',
      status: active ? '已完成' : '等待',
      icon: Target,
      tone: 'green'
    },
    {
      label: '资源校验',
      status: active?.resources.length ? '已完成' : '待补充',
      icon: ShieldCheck,
      tone: 'blue'
    },
    {
      label: '结构输出',
      status: active?.records.length ? '已完成' : generating ? '进行中' : '等待',
      icon: Database,
      tone: 'amber'
    },
    {
      label: 'HTML 生成',
      status: active?.lessons.length ? '已完成' : generating ? '进行中' : '等待',
      icon: FileCheck2,
      tone: 'rose'
    }
  ]
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

export { App }
