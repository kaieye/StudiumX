import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation
} from 'react-router-dom'
import {
  Activity, BarChart3, BookOpen, Bot, ChevronLeft, ChevronRight, CircleHelp,
  ClipboardList, FolderKanban, GraduationCap, LogOut, Monitor, Moon, Settings,
  Sparkles, Sun, Timer, Users, Wrench
} from 'lucide-react'
import appIcon from '../../src/renderer/src/assets/auth/app-icon-rounded.png'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { LoginView } from './views/LoginView'
import {
  DesktopOnlyChatDialogProvider,
  useDesktopOnlyChatDialog
} from './chat/DesktopOnlyChatDialog'

/**
 * Route-module contract (auto-discovered below):
 *
 *   // web/src/views/<feature>/route.tsx
 *   export const route = {
 *     path: string,         // absolute path, e.g. '/analytics'
 *     label?: string,       // nav label (falls back to `path`)
 *     element: ReactElement // rendered inside the protected layout <Outlet/>
 *   }
 *
 * Adding a feature route in a later phase = create a `route.tsx` under
 * `views/`; no edit to `App.tsx` is required.
 */
interface RouteModule {
  route: {
    path: string
    label?: string
    element: ReactElement
  }
}

// Auto-discover every feature route module. `eager` so routes are available
// synchronously for the first render (Phase 2 has no code-splitting yet).
const routeModules = import.meta.glob<RouteModule>('./views/**/route.tsx', {
  eager: true
})

const discoveredRoutes = Object.values(routeModules)
  .map((module) => module.route)
  .sort((a, b) => a.path.localeCompare(b.path))

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { openDesktopOnlyChatDialog } = useDesktopOnlyChatDialog()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [darkTheme, setDarkTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  )
  const toggleTheme = useCallback(() => {
    const nextDark = !darkTheme
    setDarkTheme(nextDark)
    const theme = nextDark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = theme
    document.documentElement.setAttribute('data-theme', theme)
    void window.teachingSystem.updateSettings({ theme }).catch(() => {
      // The visual toggle remains useful even when browser storage is unavailable.
    })
  }, [darkTheme])
  const displayName = user?.nickname?.trim() || (user ? '学习者' : '学习者')
  const initials = Array.from(displayName)[0]?.toUpperCase() ?? 'S'
  const routeFor = (path: string) => discoveredRoutes.find((route) => route.path === path)
  const primary = [
    { path: '/', label: '学习总览', icon: Bot, end: true },
    { path: '/planning', label: '学习计划', icon: ClipboardList },
    { path: '/study-room', label: '自习室', icon: Timer },
  ]
  const library = [
    { path: '/lessons', label: '课程资料', icon: BookOpen },
    { path: '/conversations', label: '对话记录', icon: Activity },
    { path: '/analytics', label: '学习分析', icon: BarChart3 },
    { path: '/devices', label: '设备同步', icon: Monitor },
  ]
  const currentLabel = useMemo(() => {
    if (location.pathname === '/') return '学习总览'
    return routeFor(location.pathname)?.label ?? '学习总览'
  }, [location.pathname])
  const navLink = (item: { path: string; label: string; icon: typeof Bot; end?: boolean }) => {
    const Icon = item.icon
    if (item.path === '/conversations') {
      return (
        <button
          key={item.path}
          type="button"
          title={collapsed ? item.label : '对话服务仅限桌面端'}
          className="web-nav-item web-nav-button"
          onClick={openDesktopOnlyChatDialog}
        >
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      )
    }
    return <NavLink
      key={item.path}
      to={item.path}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `web-nav-item${isActive ? ' is-active' : ''}`}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  }
  return (
    <div className={`web-app-shell${collapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className="web-sidebar" aria-label="主导航">
        <div className="web-sidebar-brand">
          <img src={appIcon} alt="" aria-hidden="true" />
          <span className="web-brand-copy"><strong>StudiumX</strong><small>学习伴侣</small></span>
        </div>
        <nav className="web-sidebar-nav">
          <div className="web-nav-group">工作区</div>
          {primary.map(navLink)}
          <div className="web-nav-group web-nav-group-spaced">资料与洞察</div>
          {library.map(navLink)}
        </nav>
        <div className="web-sidebar-bottom">
          <NavLink to="/settings" className={({ isActive }) => `web-nav-item${isActive ? ' is-active' : ''}`} title={collapsed ? '设置' : undefined}>
            <Settings size={17} strokeWidth={1.8} aria-hidden="true" /><span>设置</span>
          </NavLink>
          <a className="web-nav-item" href="mailto:support@studiumx.app" title={collapsed ? '帮助与反馈' : undefined}>
            <CircleHelp size={17} strokeWidth={1.8} aria-hidden="true" /><span>帮助与反馈</span>
          </a>
          <div className="web-sidebar-user">
            <span className="web-avatar" aria-hidden="true">{initials}</span>
            <span className="web-user-copy"><strong>{displayName}</strong><small>已同步</small></span>
            <button type="button" className="web-logout-button" onClick={() => void logout()} aria-label="退出登录" title="退出登录"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <section className="web-main-shell">
        <header className="web-topbar">
          <div className="web-topbar-leading">
            <button type="button" className="web-icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}>
              {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
            <span className="web-breadcrumb-muted">StudiumX</span><span className="web-breadcrumb-separator">/</span><strong>{currentLabel}</strong>
          </div>
          <div className="web-topbar-actions">
            <span className="web-sync-pill"><span className="web-sync-dot" />本地优先</span>
            <button
              type="button"
              className="web-icon-button"
              aria-label={darkTheme ? '切换为浅色主题' : '切换为深色主题'}
              aria-pressed={darkTheme}
              title={darkTheme ? '切换为浅色主题' : '切换为深色主题'}
              onClick={toggleTheme}
            >
              {darkTheme ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <NavLink to="/settings" className="web-icon-button" aria-label="打开设置" title="打开设置"><Wrench size={16} /></NavLink>
          </div>
        </header>
        <div className="web-content">{children}</div>
      </section>
    </div>
  )
}

function Home() {
  const { openDesktopOnlyChatDialog } = useDesktopOnlyChatDialog()
  return (
    <main className="web-home-page">
      <section className="web-home-hero">
        <div>
          <span className="web-eyebrow"><Sparkles size={14} /> 今日学习空间</span>
          <h1>准备好开始学习了吗？</h1>
          <p>从你的学习计划继续，或让 StudiumX 帮你整理下一步。</p>
          <div className="web-home-actions">
            <NavLink to="/planning" className="web-primary-button"><ClipboardList size={16} />打开学习计划</NavLink>
            <NavLink to="/lessons" className="web-secondary-button"><BookOpen size={16} />浏览课程</NavLink>
            <button type="button" className="web-secondary-button" onClick={openDesktopOnlyChatDialog}><Bot size={16} />打开学习助手</button>
          </div>
        </div>
        <div className="web-hero-orbit" aria-hidden="true"><GraduationCap size={42} strokeWidth={1.35} /></div>
      </section>
      <section className="web-home-grid">
        <article className="web-stat-card"><span className="web-stat-icon"><Timer size={17} /></span><div><small>今日专注</small><strong>0 分钟</strong><span>开始你的第一个专注时段</span></div></article>
        <article className="web-stat-card"><span className="web-stat-icon"><FolderKanban size={17} /></span><div><small>进行中的课程</small><strong>—</strong><span>从课程资料中选择一个课程</span></div></article>
        <article className="web-stat-card"><span className="web-stat-icon"><Users size={17} /></span><div><small>自习室状态</small><strong>准备就绪</strong><span>和其他学习者一起专注</span></div></article>
      </section>
      <section className="web-home-panel"><div><span className="web-eyebrow">学习助手</span><h2>你的学习数据只属于你</h2><p>Web 端显示由桌面端同步的只读数据，不会自动上传或修改教学事实。</p></div><NavLink to="/settings" className="web-secondary-button">查看同步设置</NavLink></section>
    </main>
  )
}

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        <span className="text-sm text-neutral-500">{label}</span>
      </div>
    </div>
  )
}

/**
 * Protected layout route: gates the dashboard on auth status. While restoring
 * a session it shows a spinner; when unauthenticated it redirects to /login
 * (remembering the attempted location); when authenticated it renders the app
 * shell with a nested <Outlet/> for feature routes.
 */
function ProtectedLayout() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullScreenSpinner label="正在加载…" />
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return (
    <DesktopOnlyChatDialogProvider>
      <Shell>
        <Outlet />
      </Shell>
    </DesktopOnlyChatDialogProvider>
  )
}

/**
 * Public-only wrapper for /login: bounces authenticated users back to the
 * dashboard (or the originally requested path) and shows a spinner while the
 * session is still being restored.
 */
function PublicOnlyRoute({ children }: { children: ReactElement }) {
  const { status } = useAuth()
  const location = useLocation()
  const from =
    (location.state as { from?: string } | null)?.from ?? '/'

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }
  if (status === 'loading') {
    return <FullScreenSpinner label="正在加载…" />
  }
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginView />
          </PublicOnlyRoute>
        }
      />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Home />} />
        {discoveredRoutes.map((route) => (
          <Route
            key={route.path}
            path={route.path.replace(/^\//, '')}
            element={route.element}
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
