import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PhasePromptSheet } from '@renderer/views/workbench/PhasePromptSheet'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'

function completedFocus(focusRoundInPlan = 1) {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({
    id: 'f1',
    nowMs: 1_000,
    plan,
    taskId: 't1'
  }).session!
  return {
    ...started,
    state: 'completed' as const,
    endedAtMs: 1_000 + 25 * 60_000,
    focusRoundInPlan
  }
}

describe('PhasePromptSheet UI (STC-205)', () => {
  it('offers start break / skip / later; Escape → later', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <PhasePromptSheet open completed={completedFocus()} onResolve={onResolve} />
    )

    expect(screen.getByRole('dialog', { name: /专注结束/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始短休息/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /跳过休息/ })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ action: 'later' })
  })

  it('start_break and skip_break resolve', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const { rerender } = render(
      <PhasePromptSheet open completed={completedFocus()} onResolve={onResolve} />
    )
    await user.click(screen.getByRole('button', { name: /开始短休息/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'start_break' })

    onResolve.mockClear()
    rerender(
      <PhasePromptSheet open completed={completedFocus(4)} onResolve={onResolve} />
    )
    expect(screen.getByRole('button', { name: /开始长休息/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /跳过休息/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'skip_break' })
  })


  it('extend_and_start presets resolve with minutes', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <PhasePromptSheet open completed={completedFocus()} onResolve={onResolve} />
    )
    await user.click(screen.getByRole('button', { name: /\+1 分钟/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'extend_and_start', extendMinutes: 1 })

    onResolve.mockClear()
    // re-open via second click path on same open sheet is fine after clear
    await user.click(screen.getByRole('button', { name: /\+5 分钟/ }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'extend_and_start', extendMinutes: 5 })
  })

})
