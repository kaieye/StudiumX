/**
 * WorkbenchPomodoro STC-603 keyboard + non-ticking aria-live status.
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

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /专注计时|休息计时/ }))
  return screen.getByTestId('workbench-pomodoro-panel')
}

describe('WorkbenchPomodoro a11y (STC-603)', () => {
  it('exposes polite non-ticking status region with state/phase/mode', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'running',
          timerMode: 'focus',
          remainingSeconds: 12 * 60 + 34
        }}
        timerProgress={40}
        selectedTaskId="reading"
        {...baseCallbacks()}
      />
    )
    await openPanel(user)
    const live = screen.getByTestId('workbench-pomodoro-status-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveAttribute('role', 'status')
    expect(live.textContent).toContain('running')
    expect(live.textContent).toContain('focus')
    expect(live.textContent).toContain('countdown')
    expect(live.textContent).toContain('整理下一节课的重点')
    // Visual clock may tick; live region must not re-speak MM:SS.
    expect(live.textContent).not.toMatch(/\d+:\d+/)
    expect(live.textContent).not.toContain('12:34')
  })

  it('prefers active TimerSession fields in status label', async () => {
    const user = userEvent.setup()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'b-a11y',
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
          timerState: 'paused',
          remainingSeconds: 99
        }}
        timerProgress={10}
        activeTimerSession={started}
        {...baseCallbacks()}
      />
    )
    await openPanel(user)
    const live = screen.getByTestId('workbench-pomodoro-status-live')
    expect(live.textContent).toContain('short_break')
    expect(live.textContent).toContain('running')
    expect(live.textContent).not.toMatch(/\d+:\d+/)
  })

  it('Space toggles timer when panel is focused', async () => {
    const user = userEvent.setup()
    const callbacks = baseCallbacks()
    render(
      <WorkbenchPomodoro
        snapshot={{ ...defaultStudySnapshot, timerState: 'idle' }}
        timerProgress={0}
        {...callbacks}
      />
    )
    const panel = await openPanel(user)
    panel.focus()
    await user.keyboard(' ')
    expect(callbacks.onToggleTimer).toHaveBeenCalledTimes(1)
  })

  it('r resets and mode keys switch tabs', async () => {
    const user = userEvent.setup()
    const callbacks = baseCallbacks()
    render(
      <WorkbenchPomodoro
        snapshot={{ ...defaultStudySnapshot }}
        timerProgress={0}
        {...callbacks}
      />
    )
    const panel = await openPanel(user)
    panel.focus()
    await user.keyboard('r')
    expect(callbacks.onResetTimer).toHaveBeenCalledTimes(1)

    await user.keyboard('b')
    expect(screen.getByRole('tab', { name: '休息' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '专注' })).toHaveAttribute('aria-selected', 'true')
  })

  it('+ extends break only when extend control is available', async () => {
    const user = userEvent.setup()
    const onExtendActiveTimer = vi.fn()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'b-ext',
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
        onExtendActiveTimer={onExtendActiveTimer}
        {...baseCallbacks()}
      />
    )
    const panel = await openPanel(user)
    panel.focus()
    await user.keyboard('+')
    expect(onExtendActiveTimer).toHaveBeenCalledWith(1)
  })

  it('does not fire shortcuts while typing in settings inputs', async () => {
    const user = userEvent.setup()
    const callbacks = baseCallbacks()
    render(
      <WorkbenchPomodoro
        snapshot={{ ...defaultStudySnapshot }}
        timerProgress={0}
        {...callbacks}
      />
    )
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: '计时设置' }))
    const nameInput = screen.getByLabelText('方案名称')
    await user.click(nameInput)
    await user.keyboard('r')
    expect(callbacks.onResetTimer).not.toHaveBeenCalled()
    expect(nameInput).toHaveValue('r')
  })
})
