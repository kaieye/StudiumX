/**
 * WorkbenchPomodoro STC-205 wrap_up mid-run chrome.
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

describe('WorkbenchPomodoro wrap_up chrome (STC-205)', () => {
  it('shows 收尾计时 label and badge when active session phase is wrap_up', async () => {
    const user = userEvent.setup()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'wrap-ui',
      nowMs: 0,
      plan,
      phase: 'wrap_up',
      targetSeconds: 5 * 60
    }).session!

    const { container } = render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          // V1 shell still uses break for wrap_up analytics path.
          timerMode: 'break',
          timerState: 'running',
          remainingSeconds: 4 * 60
        }}
        timerProgress={20}
        activeTimerSession={started}
        {...baseCallbacks()}
      />
    )

    // Toggle label should say 收尾, not 休息.
    expect(screen.getByRole('button', { name: /收尾计时/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /休息计时/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /收尾计时/ }))
    expect(screen.getByTestId('workbench-pomodoro-wrap-up-badge')).toHaveTextContent(/收尾/)
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveClass('is-wrap_up')
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveAttribute(
      'data-timer-surface-phase',
      'wrap_up'
    )
    // Mode tabs disabled during wrap_up (not focus/break).
    expect(screen.getByRole('tab', { name: '专注' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: '休息' })).toBeDisabled()
  })

  it('keeps rest chrome for short_break sessions', async () => {
    const user = userEvent.setup()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'break-ui',
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
          timerState: 'running'
        }}
        timerProgress={20}
        activeTimerSession={started}
        {...baseCallbacks()}
      />
    )

    expect(screen.getByRole('button', { name: /休息计时/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /休息计时/ }))
    expect(screen.queryByTestId('workbench-pomodoro-wrap-up-badge')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '休息' })).not.toBeDisabled()
  })
})
