import { type ReactElement, type ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation
} from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { LoginView } from './views/LoginView'

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
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
          <span className="text-base font-semibold">StudiumX Web</span>
          <span className="text-xs text-neutral-400">学习伴侣仪表盘</span>
          <nav aria-label="主导航" className="ml-4 flex flex-wrap gap-1">
            {discoveredRoutes.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) =>
                  'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
                  (isActive
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100')
                }
              >
                {route.label ?? route.path}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-neutral-500">
              {user?.nickname ?? (user ? '已登录' : '')}
            </span>
            <button
              type="button"
              onClick={() => {
                void logout()
              }}
              className="rounded-md border border-neutral-200 px-3 py-1 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              退出
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}

function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">
        StudiumX Web - 学习伴侣仪表盘
      </h1>
      <p className="mt-3 max-w-2xl text-neutral-600">
        登录成功。可查看学习分析、管理学习计划、参与自习室、浏览已归档的课程与对话。
        功能将在后续阶段逐步接入（plan §8 Phase 4+）。
      </p>
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
    <Shell>
      <Outlet />
    </Shell>
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
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
