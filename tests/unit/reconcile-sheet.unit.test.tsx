import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReconcileSheet } from '@renderer/views/workbench/ReconcileSheet'
import {
  advanceTimerSession,
  createClassicPomodoroPlan,
  startTimerSession,
  TIMER_SESSION_SEED
} from '../../src/shared/study-planning'

const t0 = 3_000_000

function staleFocus() {
  const started = startTimerSession({
    id: 'ui-1',
    nowMs: t0,
    plan: createClassicPomodoroPlan(),
    taskId: 't1'
  }).session!
  const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 15) * 60_000
  return advanceTimerSession(started, t0 + gapMs).session!
}

describe('ReconcileSheet UI (STC-206)', () => {
  it('offers confirm / truncate / discard / later; Escape → later', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(<ReconcileSheet open session={staleFocus()} onResolve={onResolve} />)

    expect(screen.getByRole('dialog', { name: /中断/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /全部计入/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /只补到目标/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /不计入间隔/ })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ action: 'later' })
  })

  it('confirm_all and discard_gap resolve', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const { rerender } = render(
      <ReconcileSheet open session={staleFocus()} onResolve={onResolve} />
    )

    await user.click(screen.getByRole('button', { name: /全部计入/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'confirm_all' })

    onResolve.mockClear()
    rerender(<ReconcileSheet open session={staleFocus()} onResolve={onResolve} />)
    await user.click(screen.getByRole('button', { name: /不计入间隔/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'discard_gap' })
  })
})
