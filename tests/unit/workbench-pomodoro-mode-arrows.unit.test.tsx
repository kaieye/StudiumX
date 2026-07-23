/**
 * WorkbenchPomodoro: side arrows replace focus/break segmented switch;
 * task title sits at card top; dial no longer shows "已暂停 · 专注" chip.
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

describe('WorkbenchPomodoro mode arrows + task title', () => {
  it('shows selected task title at card top and toggles mode with side arrows', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'paused',
          timerMode: 'focus',
          remainingSeconds: 10 * 60,
          tasks: [
            {
              ...defaultStudySnapshot.tasks[0],
              id: 'task-focus-1',
              title: '高等数学第一章'
            }
          ]
        }}
        timerProgress={30}
        selectedTaskId="task-focus-1"
        {...baseCallbacks()}
      />
    )

    await user.click(screen.getByRole('button', { name: /专注计时/ }))

    expect(screen.getByTestId('workbench-pomodoro-title')).toHaveTextContent('高等数学第一章')
    expect(screen.queryByRole('tab', { name: '专注' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '休息' })).not.toBeInTheDocument()
    expect(screen.queryByText(/已暂停/)).not.toBeInTheDocument()

    await user.click(screen.getByTestId('workbench-pomodoro-mode-next'))
    expect(screen.getByTestId('workbench-pomodoro-title')).toHaveTextContent(/休息计时/)

    await user.click(screen.getByTestId('workbench-pomodoro-mode-prev'))
    expect(screen.getByTestId('workbench-pomodoro-title')).toHaveTextContent('高等数学第一章')
  })

  it('falls back to 未选择任务 when focus has no selected task', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerState: 'idle',
          timerMode: 'focus',
          tasks: []
        }}
        timerProgress={0}
        selectedTaskId={null}
        {...baseCallbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    expect(screen.getByTestId('workbench-pomodoro-title')).toHaveTextContent('未选择任务')
  })
})
