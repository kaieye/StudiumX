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
  it('replaces environment audio with settings, opens the centered plan editor, and saves a named plan', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    expect(editor).toHaveClass('workbench-pomodoro-settings-panel')
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
      simulationEndTime: '11:00',
      longBreakMinutes: 15,
      longBreakEvery: 4,
      breakPolicy: 'ask',
      kind: 'pomodoro',
      clockMode: 'countdown',
      continuousTarget: undefined
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

  it('saves advanced long break and breakPolicy fields', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    await user.type(within(editor).getByLabelText('方案名称'), '长休息方案')
    await user.clear(within(editor).getByLabelText('长休息时间'))
    await user.type(within(editor).getByLabelText('长休息时间'), '20')
    await user.clear(within(editor).getByLabelText('长休息间隔轮数'))
    await user.type(within(editor).getByLabelText('长休息间隔轮数'), '3')
    await user.selectOptions(within(editor).getByLabelText('休息策略'), 'automatic')
    await user.click(within(editor).getByRole('button', { name: '保存方案' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '长休息方案',
        longBreakMinutes: 20,
        longBreakEvery: 3,
        breakPolicy: 'automatic'
      })
    )
  })


  it('saves continuous open countup plan with freeze #6 break policy', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    await user.type(within(editor).getByLabelText('方案名称'), '连续深潜')
    await user.selectOptions(within(editor).getByLabelText('方案类型'), 'continuous')
    await user.selectOptions(within(editor).getByLabelText('连续专注休息策略'), 'none')
    await user.click(within(editor).getByRole('button', { name: '保存方案' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '连续深潜',
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: false,
        breakPolicy: 'none'
      })
    )
  })

})
