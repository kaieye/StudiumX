import { App as DesktopApp, AppErrorBoundary } from '@renderer/App'
import { AuthProvider } from './auth/AuthContext'

/**
 * The browser shell deliberately mounts the exact same renderer App component
 * used by Electron. This keeps navigation, workspace
 * layout, overview composer, dialogs, settings, and responsive behavior on a
 * single source of truth instead of maintaining a second Web dashboard.
 *
 * The Web TeachingSystem adapter remains installed by web/src/main.tsx. It
 * exposes only the read-only/browser-safe contract, so unsupported desktop
 * execution capabilities continue to fail closed while the UI stays 1:1.
 */
function DesktopAppShell() {
  return <DesktopApp />
}

export function App() {
  return (
    <AuthProvider>
      <AppErrorBoundary>
        <DesktopAppShell />
      </AppErrorBoundary>
    </AuthProvider>
  )
}
