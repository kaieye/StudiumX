import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopOnlyChatDialog,
  DesktopOnlyChatDialogProvider,
  useDesktopOnlyChatDialog
} from '../../web/src/chat/DesktopOnlyChatDialog'

function Trigger() {
  const { openDesktopOnlyChatDialog } = useDesktopOnlyChatDialog()
  return <button type="button" onClick={openDesktopOnlyChatDialog}>打开对话</button>
}

describe('Web desktop-only chat guard', () => {
  it('shows an accessible desktop-only dialog and closes it', () => {
    render(
      <DesktopOnlyChatDialogProvider>
        <Trigger />
      </DesktopOnlyChatDialogProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '打开对话' }))

    expect(screen.getByRole('dialog', { name: '仅限桌面端可使用对话服务' })).toHaveTextContent(
      '请在 StudiumX Desktop 中打开对话服务'
    )
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('supports Escape and backdrop dismissal', () => {
    const onClose = vi.fn()
    render(<DesktopOnlyChatDialog open onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
