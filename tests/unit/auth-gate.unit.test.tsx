import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key })
}))

vi.mock('../../src/renderer/src/sync/LoginScreen', () => ({
  LoginScreen: ({ overlay = false }: { overlay?: boolean }) => (
    <div data-testid="login-screen" data-overlay={overlay ? 'true' : 'false'}>
      login required
    </div>
  )
}))

vi.mock('../../src/renderer/src/sync/session-check', () => ({
  checkSyncSession: vi.fn().mockResolvedValue(undefined)
}))

import { AuthGate } from '../../src/renderer/src/sync/AuthGate'
import { clearSyncAuth, setSyncAuth } from '../../src/renderer/src/sync/sync-store'

describe('AuthGate', () => {
  beforeEach(() => {
    clearSyncAuth()
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: undefined
    })
  })

  it('requires login for a protected feature even if a legacy continue-local preference exists', () => {
    localStorage.setItem('studiumx.auth.continueLocal', '1')

    render(
      <AuthGate>
        <div>protected application</div>
      </AuthGate>
    )

    expect(screen.getByTestId('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('protected application')).not.toBeInTheDocument()
  })

  it('keeps the requested page as an inert backdrop when overlay presentation is used', () => {
    render(
      <AuthGate presentation="overlay">
        <div>protected application</div>
      </AuthGate>
    )

    const backdrop = screen.getByText('protected application').parentElement
    expect(backdrop).toHaveClass('auth-gate-content')
    expect(backdrop).toHaveAttribute('aria-hidden', 'true')
    expect(backdrop).toHaveAttribute('inert')
    expect(screen.getByTestId('login-screen')).toHaveAttribute('data-overlay', 'true')
  })

  it('renders the application only after an authenticated session exists', async () => {
    setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token' })

    render(
      <AuthGate presentation="overlay">
        <div>protected application</div>
      </AuthGate>
    )

    expect(await screen.findByText('protected application')).toBeInTheDocument()
    expect(screen.getByText('protected application').parentElement).not.toHaveAttribute('inert')
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument()
  })

  it('requires login for a protected feature on the web shell too', () => {
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { platform: 'web' }
    })

    render(
      <AuthGate>
        <div>protected application</div>
      </AuthGate>
    )

    expect(screen.getByTestId('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('protected application')).not.toBeInTheDocument()
  })
})
