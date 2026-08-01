import { App as DesktopApp, AppErrorBoundary } from '@renderer/App'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { useSyncState } from '@renderer/sync/sync-store'
import { LoginView } from './views/LoginView'

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="web-auth-loading" role="status" aria-live="polite">
      <div className="web-auth-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/**
 * The browser shell deliberately mounts the exact same renderer App component
 * used by Electron after authentication. This keeps navigation, workspace
 * layout, overview composer, dialogs, settings, and responsive behavior on a
 * single source of truth instead of maintaining a second Web dashboard.
 *
 * The Web TeachingSystem adapter remains installed by web/src/main.tsx. It
 * exposes only the read-only/browser-safe contract, so unsupported desktop
 * execution capabilities continue to fail closed while the UI stays 1:1.
 */
function AuthenticatedDesktopApp() {
  const { status } = useAuth()
  const syncState = useSyncState()

  if (status === 'loading') return <FullScreenSpinner label="正在加载…" />
  if (status === 'unauthenticated' || !syncState.accessToken) return <LoginView />
  return <DesktopApp />
}

export function App() {
  return (
    <AuthProvider>
      <AppErrorBoundary>
        <AuthenticatedDesktopApp />
      </AppErrorBoundary>
    </AuthProvider>
  )
}
