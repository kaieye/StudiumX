import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultStudySnapshot } from '@renderer/study-space/constants'
import { WorkbenchPomodoro } from '@renderer/views/workbench/WorkbenchPomodoro'

function renderPomodoro() {
  const callbacks = {
    onToggleTimer: vi.fn(),
    onResetTimer: vi.fn(),
    onStartTimerInMode: vi.fn(),
    onSaveTimerPlan: vi.fn(),
    onApplyTimerPlan: vi.fn(),
    onRemoveTimerPlan: vi.fn()
  }
  render(
    <WorkbenchPomodoro
      snapshot={{ ...defaultStudySnapshot, timerPlans: [{
        id: 'morning-sprint',
        name: '晨间冲刺',
        focusMinutes: 45,
        breakMinutes: 10,
        simulationStartTime: '08:30',
        simulationEndTime: '10:30'
      }] }}
      timerProgress={20}
      {...callbacks}
    />
  )
  return callbacks
}

describe('WorkbenchPomodoro timer-plan settings', () => {
  it('replaces environment audio with settings, opens the left-side plan editor, and saves a named plan', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('complementary', { name: '专注计时方案设置' })
    expect(editor).toHaveClass('workbench-pomodoro-settings-card')
    expect(screen.queryByLabelText(/环境音|白噪音/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重置番茄钟' })).toBeInTheDocument()

    const nameInput = within(editor).getByLabelText('方案名称')
    await user.type(nameInput, '论文深潜')
    await user.clear(within(editor).getByLabelText('专注时间'))
    await user.type(within(editor).getByLabelText('专注时间'), '90')
    await user.click(within(editor).getByRole('button', { name: '保存方案' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenCalledWith({
      name: '论文深潜',
      focusMinutes: 90,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '11:00'
    })
  })

  it('applies and removes saved plans from the settings card', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))
    await user.click(screen.getByRole('button', { name: /^晨间冲刺/ }))
    await user.click(screen.getByRole('button', { name: '删除方案：晨间冲刺' }))

    expect(callbacks.onApplyTimerPlan).toHaveBeenCalledWith('morning-sprint')
    expect(callbacks.onRemoveTimerPlan).toHaveBeenCalledWith('morning-sprint')
  })
})
