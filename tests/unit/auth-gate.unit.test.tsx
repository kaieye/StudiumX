import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key })
}))

vi.mock('../../src/renderer/src/sync/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen">login required</div>
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

  it('requires login even if a legacy continue-local preference exists', () => {
    localStorage.setItem('studiumx.auth.continueLocal', '1')

    render(
      <AuthGate>
        <div>protected application</div>
      </AuthGate>
    )

    expect(screen.getByTestId('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('protected application')).not.toBeInTheDocument()
  })

  it('renders the application only after an authenticated session exists', async () => {
    setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token' })

    render(
      <AuthGate>
        <div>protected application</div>
      </AuthGate>
    )

    expect(await screen.findByText('protected application')).toBeInTheDocument()
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument()
  })

  it('delegates authentication to the web shell instead of showing the desktop gate', () => {
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { platform: 'web' }
    })

    render(
      <AuthGate>
        <div>protected application</div>
      </AuthGate>
    )

    expect(screen.getByText('protected application')).toBeInTheDocument()
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument()
  })
})
