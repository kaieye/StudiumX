import {
  Archive,
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
  Layers3,
  LibraryBig,
  Loader2,
  MessageSquareText,
  PanelLeft,
  PenLine,
  Play,
  Plus,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Star,
  Target,
  Upload,
  Zap
} from 'lucide-react'
import { useMemo } from 'react'
import { create } from 'zustand'

type WorkspaceView = 'overview' | 'lessons' | 'resources'

type AppState = {
  view: WorkspaceView
  setView: (view: WorkspaceView) => void
}

const useAppStore = create<AppState>((set) => ({
  view: 'overview',
  setView: (view) => set({ view })
}))

const navItems = [
  { id: 'overview', label: '工作台', icon: Home },
  { id: 'lessons', label: '课程', icon: BookOpen },
  { id: 'resources', label: '资源', icon: LibraryBig }
] satisfies Array<{ id: WorkspaceView; label: string; icon: typeof Home }>

const workflowSteps = [
  {
    label: '目标对齐',
    status: '已完成',
    icon: Target,
    tone: 'green'
  },
  {
    label: '资源校验',
    status: '进行中',
    icon: ShieldCheck,
    tone: 'blue'
  },
  {
    label: '结构输出',
    status: '等待',
    icon: Database,
    tone: 'amber'
  },
  {
    label: 'HTML 生成',
    status: '等待',
    icon: FileCheck2,
    tone: 'rose'
  }
]

const lessonPlan = [
  {
    id: '0001',
    title: '把学习目标写成 MISSION.md',
    meta: '12 分钟 · 检索练习',
    state: '可生成',
    icon: Target
  },
  {
    id: '0002',
    title: '从资源清单提炼第一节课',
    meta: '18 分钟 · 引用校验',
    state: '草稿',
    icon: LibraryBig
  },
  {
    id: '0003',
    title: '把知识点压缩成速查页',
    meta: '10 分钟 · 打印优化',
    state: '待排期',
    icon: Archive
  }
]

const resourceRows = [
  {
    title: 'teach/SKILL.md',
    detail: '课程结构、记录、reference 与 assets 约定',
    tag: '本地规范'
  },
  {
    title: 'teaching-system-tech-stack.md',
    detail: 'Electron、React、Tailwind、SQLite 技术路线',
    tag: '架构'
  },
  {
    title: 'RESOURCES.md',
    detail: '等待首个工作区生成资源索引',
    tag: '待创建'
  }
]

const records = [
  {
    title: '学习资产以文件为真相来源',
    date: '今天',
    icon: FileText
  },
  {
    title: 'Lesson 输出应是静态 HTML',
    date: '今天',
    icon: BookOpen
  },
  {
    title: 'AI 先产 JSON，再由模板渲染',
    date: '今天',
    icon: SquareTerminal
  }
]

function App() {
  const { view, setView } = useAppStore()

  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === view)?.label ?? '工作台',
    [view]
  )

  return (
    <div className="app-shell">
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
          <input aria-label="搜索工作区" placeholder="搜索课程、资源、记录" />
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
            <button className="icon-button" type="button" aria-label="新建工作区">
              <Plus size={15} />
            </button>
          </div>
          <button className="workspace-item is-selected" type="button">
            <FolderOpen size={17} />
            <span>learn</span>
            <small>本地</small>
          </button>
          <button className="workspace-item" type="button">
            <Layers3 size={17} />
            <span>前端工程课</span>
            <small>草稿</small>
          </button>
        </div>

        <div className="sidebar-section grow">
          <div className="section-heading">
            <span>产物</span>
            <ChevronDown size={15} />
          </div>
          <div className="artifact-list">
            <span>
              <FileText size={15} />
              MISSION.md
            </span>
            <span>
              <BookOpen size={15} />
              lessons/*.html
            </span>
            <span>
              <History size={15} />
              learning-records
            </span>
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
            <span>learn</span>
            <CircleDot size={9} />
            <span>{activeLabel}</span>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button">
              <Upload size={16} />
              导入
            </button>
            <button className="primary-button" type="button">
              <Play size={16} />
              生成第一课
            </button>
          </div>
        </header>

        <section className="workspace-hero" aria-labelledby="workspace-title">
          <div className="hero-copy">
            <div className="assistant-badge">
              <Sparkles size={16} />
              本地 AI 教学编排
            </div>
            <h1 id="workspace-title">把一次对话变成可复习的课程资产</h1>
            <p>
              当前工作区会产出 MISSION、RESOURCES、lesson HTML、reference 和 learning records。
            </p>
          </div>
          <div className="mission-strip" aria-label="当前使命">
            <div className="mission-icon">
              <Target size={20} />
            </div>
            <div>
              <span>当前 Mission</span>
              <strong>搭建个人化 AI 教学系统的第一版工作流</strong>
            </div>
            <button className="icon-button" type="button" aria-label="编辑使命">
              <PenLine size={16} />
            </button>
          </div>
        </section>

        <section className="composer-tool" aria-label="教学任务输入">
          <div className="composer-header">
            <div>
              <span>新教学任务</span>
              <strong>生成一节可保存、可打印、可互动的 HTML 课程</strong>
            </div>
            <button className="icon-button soft" type="button" aria-label="模型设置">
              <Command size={16} />
            </button>
          </div>
          <textarea
            defaultValue="我想先学习如何把 teach 技能包的 MISSION、RESOURCES 和 lessons 组织成一个 Electron 桌面应用的 MVP。"
            aria-label="教学任务"
          />
          <div className="composer-footer">
            <div className="tool-pills">
              <button type="button">
                <FolderOpen size={15} />
                learn
              </button>
              <button type="button">
                <FileText size={15} />
                teach/SKILL.md
              </button>
              <button type="button">
                <Zap size={15} />
                structured JSON
              </button>
            </div>
            <button className="send-button" type="button" aria-label="发送任务">
              <SendHorizontal size={18} />
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
                <h2>下一组 lesson</h2>
              </div>
              <button className="ghost-button" type="button">
                <ArrowUpRight size={16} />
                打开目录
              </button>
            </div>

            <div className="lesson-list">
              {lessonPlan.map((lesson) => {
                const Icon = lesson.icon
                return (
                  <article className="lesson-card" key={lesson.id}>
                    <div className="lesson-id">{lesson.id}</div>
                    <div className="lesson-icon">
                      <Icon size={18} />
                    </div>
                    <div className="lesson-body">
                      <h3>{lesson.title}</h3>
                      <p>{lesson.meta}</p>
                    </div>
                    <span className="state-chip">{lesson.state}</span>
                  </article>
                )
              })}
            </div>
          </div>

          <aside className="preview-panel" aria-label="Lesson 预览">
            <div className="preview-toolbar">
              <div>
                <span>lessons/0001-mission.html</span>
                <strong>静态课程预览</strong>
              </div>
              <button className="icon-button" type="button" aria-label="打开预览">
                <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="lesson-preview">
              <div className="preview-paper">
                <span className="eyebrow">Lesson 0001</span>
                <h3>写出可执行的学习使命</h3>
                <p>
                  将模糊兴趣压缩成一段能驱动资源选择、练习设计和复习节奏的 Mission。
                </p>
                <div className="callout">
                  <CheckCircle2 size={16} />
                  <span>完成后得到 MISSION.md 初稿</span>
                </div>
                <div className="mini-quiz">
                  <span>快速检索</span>
                  <button type="button">目标</button>
                  <button type="button">约束</button>
                  <button type="button">动机</button>
                </div>
              </div>
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
              <button className="icon-button" type="button" aria-label="添加资源">
                <Plus size={16} />
              </button>
            </div>
            <div className="resource-list">
              {resourceRows.map((resource) => (
                <article className="resource-row" key={resource.title}>
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
              <button className="icon-button" type="button" aria-label="查看记录">
                <History size={16} />
              </button>
            </div>
            <div className="record-list">
              {records.map((record) => {
                const Icon = record.icon
                return (
                  <article className="record-row" key={record.title}>
                    <Icon size={17} />
                    <div>
                      <h3>{record.title}</h3>
                      <p>{record.date}</p>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>

          <div className="runtime-panel">
            <div className="runtime-header">
              <BrainCircuit size={20} />
              <div>
                <span>AI Runtime</span>
                <strong>DeepSeek · OpenAI-compatible · SSE</strong>
              </div>
            </div>
            <div className="runtime-meter">
              <div />
            </div>
            <div className="runtime-stats">
              <span>
                <Clock3 size={15} />
                4 个队列任务
              </span>
              <span>
                <Loader2 size={15} />
                校验中
              </span>
              <span>
                <Star size={15} />
                Zod schema
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export { App }
