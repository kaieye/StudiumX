/**
 * WorkbenchPomodoro dial follows applied plan (no fixed 25/5 · window caption).
 * Exam: HH:MM + SS under; other plans: single-line MM:SS (e.g. 180:00).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultStudySnapshot } from '@renderer/study-space/constants'
import { WorkbenchPomodoro } from '@renderer/views/workbench/WorkbenchPomodoro'

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

describe('WorkbenchPomodoro face clock by plan', () => {
  it('does not render fixed 25/5 · 09:00 window chrome under the dial', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'idle',
          timerMode: 'focus',
          focusMinutes: 25,
          breakMinutes: 5,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00',
          remainingSeconds: 25 * 60
        }}
        timerProgress={0}
        defaultTimerPlanId="classic_25_5"
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(screen.queryByText(/25\s*\/\s*5\s*分钟/)).not.toBeInTheDocument()
    // Classic pomodoro uses single-line duration, not exam wall start.
    expect(screen.getAllByText('25:00').length).toBeGreaterThan(0)
    expect(screen.queryByText('09:00')).not.toBeInTheDocument()
  })

  it('shows non-exam duration as a single line (e.g. 180:00)', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'idle',
          timerMode: 'focus',
          focusMinutes: 180,
          breakMinutes: 10,
          remainingSeconds: 180 * 60,
          timerPlans: [
            {
              id: 'deep-long',
              name: '长时专注',
              focusMinutes: 180,
              breakMinutes: 10,
              simulationStartTime: '00:00',
              simulationEndTime: '03:00',
              kind: 'pomodoro',
              clockMode: 'countdown'
            }
          ]
        }}
        timerProgress={0}
        defaultTimerPlanId="deep-long"
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(screen.getAllByText('180:00').length).toBeGreaterThan(0)
    // No separate seconds line for non-exam (aria-hidden SS under HH:MM only for exam).
    expect(document.querySelector('.workbench-pomodoro-time__seconds')).toBeNull()
  })

  it('shows exam wall start as HH:MM with seconds under (not 180:00)', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'idle',
          timerMode: 'focus',
          focusMinutes: 180,
          breakMinutes: 0,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00',
          remainingSeconds: 0,
          timerPlans: [
            {
              id: 'exam-window',
              name: '上午考场',
              focusMinutes: 180,
              breakMinutes: 0,
              simulationStartTime: '09:00',
              simulationEndTime: '12:00',
              kind: 'continuous',
              clockMode: 'countup',
              continuousTarget: true
            }
          ]
        }}
        timerProgress={0}
        defaultTimerPlanId="exam-window"
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(screen.getAllByText('09:00').length).toBeGreaterThan(0)
    expect(document.querySelector('.workbench-pomodoro-time__seconds')?.textContent).toBe('00')
    expect(screen.queryByText('180:00')).not.toBeInTheDocument()
    expect(screen.queryByText('25:00')).not.toBeInTheDocument()
  })
})
