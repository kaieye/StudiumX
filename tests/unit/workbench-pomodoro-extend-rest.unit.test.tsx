/**
 * WorkbenchPomodoro STC-205 mid-break extend control.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultStudySnapshot } from '@renderer/study-space/constants'
import { WorkbenchPomodoro } from '@renderer/views/workbench/WorkbenchPomodoro'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'

function baseCallbacks() {
  return {
    onToggleTimer: vi.fn(),
    onResetTimer: vi.fn(),
    onStartTimerInMode: vi.fn(),
    onSaveTimerPlan: vi.fn(),
    onApplyTimerPlan: vi.fn(),
    onRemoveTimerPlan: vi.fn()
  }
}

describe('WorkbenchPomodoro extend rest (STC-205)', () => {
  it('shows +1 min control when break session is active and host provides onExtendActiveTimer', async () => {
    const user = userEvent.setup()
    const onExtendActiveTimer = vi.fn()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'b-live',
      nowMs: 0,
      plan,
      phase: 'short_break',
      targetSeconds: 5 * 60
    }).session!
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerMode: 'break',
          timerState: 'running',
          remainingSeconds: 4 * 60
        }}
        timerProgress={20}
        activeTimerSession={started}
        onExtendActiveTimer={onExtendActiveTimer}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /休息计时|专注计时/ }))
    const extend = screen.getByRole('button', { name: /延长休息 1 分钟/ })
    await user.click(extend)
    expect(onExtendActiveTimer).toHaveBeenCalledWith(1)
  })

  it('hides extend control during focus session', async () => {
    const user = userEvent.setup()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'f-live',
      nowMs: 0,
      plan,
      phase: 'focus',
      taskId: 't1'
    }).session!
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerMode: 'focus',
          timerState: 'running'
        }}
        timerProgress={20}
        activeTimerSession={started}
        onExtendActiveTimer={vi.fn()}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(screen.queryByRole('button', { name: /延长休息/ })).not.toBeInTheDocument()
  })
})
