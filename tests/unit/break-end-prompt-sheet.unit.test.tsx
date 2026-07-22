/**
 * BreakEndPromptSheet UI (STC-205 remainder / §10.3).
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BreakEndPromptSheet } from '@renderer/views/workbench/BreakEndPromptSheet'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'

function completedBreak(focusRoundInPlan = 1) {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({
    id: 'b1',
    nowMs: 1_000,
    plan,
    phase: 'short_break',
    focusRoundInPlan
  }).session!
  return {
    ...started,
    state: 'completed' as const,
    endedAtMs: 1_000 + 5 * 60_000,
    focusRoundInPlan
  }
}

describe('BreakEndPromptSheet UI (STC-205 remainder)', () => {
  it('offers start focus / wrap_up / later; Escape → later', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <BreakEndPromptSheet open completed={completedBreak()} onResolve={onResolve} />
    )

    expect(screen.getByRole('dialog', { name: /休息结束/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始第 2 轮专注/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始收尾/ })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ action: 'later' })
  })

  it('start_focus and wrap_up resolve', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const { rerender } = render(
      <BreakEndPromptSheet open completed={completedBreak(2)} onResolve={onResolve} />
    )
    await user.click(screen.getByRole('button', { name: /开始第 3 轮专注/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'start_focus' })

    onResolve.mockClear()
    rerender(
      <BreakEndPromptSheet open completed={completedBreak(2)} onResolve={onResolve} />
    )
    await user.click(screen.getByRole('button', { name: /开始收尾/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'wrap_up' })
  })

  it('hides wrap_up when plan wrapUpMinutes is 0', () => {
    const plan = createClassicPomodoroPlan({ wrapUpMinutes: 0 })
    const started = startTimerSession({
      id: 'b0',
      nowMs: 0,
      plan,
      phase: 'short_break'
    }).session!
    const completed = {
      ...started,
      state: 'completed' as const,
      endedAtMs: 1,
      planSnapshot: plan
    }
    const onResolve = vi.fn()
    render(<BreakEndPromptSheet open completed={completed} onResolve={onResolve} />)
    expect(screen.queryByRole('button', { name: /收尾/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始第/ })).toBeInTheDocument()
  })
})
