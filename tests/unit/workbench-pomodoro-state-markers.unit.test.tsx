/**
 * WorkbenchPomodoro STC-604 non-color state chip + reduced-motion class.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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

describe('WorkbenchPomodoro state markers (STC-604)', () => {
  let matchMediaImpl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    matchMediaImpl = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMediaImpl
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows non-color state chip for running focus', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'running',
          timerMode: 'focus',
          remainingSeconds: 12 * 60
        }}
        timerProgress={40}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    const chip = screen.getByTestId('workbench-pomodoro-state-chip')
    expect(chip).toHaveTextContent(/运行中/)
    expect(chip).toHaveTextContent(/专注/)
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveClass('is-state-running')
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveAttribute(
      'data-timer-state',
      'running'
    )
  })

  it('labels wrap_up session chip without relying on rest color alone', async () => {
    const user = userEvent.setup()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({
      id: 'w604',
      nowMs: 0,
      plan,
      phase: 'wrap_up',
      targetSeconds: 5 * 60
    }).session!
    const { container } = render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerMode: 'break',
          timerState: 'running',
          remainingSeconds: 60
        }}
        timerProgress={10}
        activeTimerSession={started}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /收尾计时/ }))
    const chip = screen.getByTestId('workbench-pomodoro-state-chip')
    expect(chip).toHaveTextContent(/运行中/)
    expect(chip).toHaveTextContent(/收尾/)
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveClass('is-wrap_up')
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveClass('is-state-running')
  })

  it('adds is-reduced-motion class when matchMedia prefers reduce', async () => {
    matchMediaImpl.mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
    const user = userEvent.setup()
    const { container } = render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'running',
          timerMode: 'focus'
        }}
        timerProgress={20}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveClass('is-reduced-motion')
    expect(container.querySelector('.workbench-pomodoro-card')).toHaveAttribute(
      'data-reduced-motion',
      'true'
    )
  })

  it('shows overtime text when remaining is 0 while running countdown', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'running',
          timerMode: 'focus',
          remainingSeconds: 0
        }}
        timerProgress={100}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(screen.getByTestId('workbench-pomodoro-state-chip')).toHaveTextContent(/已超时/)
  })
})
