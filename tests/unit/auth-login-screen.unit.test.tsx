import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key })
}))

import { AuthLoginScreen } from '@renderer/ui/AuthLoginScreen'
import { renderUi } from '../helpers/render'

describe('study-room login panel', () => {
  it('uses a top-right icon-only close control instead of a cancel-login action', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onLogin = vi.fn()

    const { rerender } = renderUi(
      <AuthLoginScreen
        overlay
        hasChallenge={false}
        onLogin={onLogin}
        onCancel={vi.fn()}
        onClose={onClose}
      />
    )

    const closeButton = screen.getByRole('button', { name: '关闭登录' })
    expect(closeButton.textContent).toBe('')
    expect(closeButton.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消登录' })).not.toBeInTheDocument()

    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <AuthLoginScreen
        overlay
        hasChallenge
        challengeStage={<div>WeChat QR challenge</div>}
        onLogin={onLogin}
        onCancel={vi.fn()}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('button', { name: '刷新二维码' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消登录' })).not.toBeInTheDocument()

    const authStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/auth.css'), 'utf8')
    const closeRule = authStyles.match(/\.auth-screen-close\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(closeRule).toContain('border: 0;')
    expect(closeRule).toContain('background: transparent;')
    expect(closeRule).not.toContain('border-radius')
  })
})
