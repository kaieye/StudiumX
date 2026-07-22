/**
 * WorkbenchPomodoro timer-plan settings — simplified catalog nav + plan editor.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    // Left nav is the plan list (no single "专注方案" pseudo-nav); no 系统/默认 badges.
    expect(within(editor).getByRole('list', { name: '方案列表' })).toBeInTheDocument()
    expect(within(editor).queryByText('系统')).not.toBeInTheDocument()
    expect(within(editor).queryByText('默认')).not.toBeInTheDocument()
    expect(editor.querySelector('.settings-card')).not.toBeNull()
    expect(within(editor).getByRole('toolbar', { name: '方案操作' })).toBeInTheDocument()
    expect(within(editor).getByRole('list', { name: '方案列表' }).querySelector('.workbench-pomodoro-settings-nav-add-btn')).not.toBeNull()
    expect(within(editor).getByRole('button', { name: '添加方案' })).toBeInTheDocument()
    // Left list shows plan names only (no 25/5 分钟 style subtitle).
    expect(within(editor).getByRole('list', { name: '方案列表' }).querySelector('small')).toBeNull()
    expect(within(editor).queryByRole('button', { name: /复制为自定义|复制方案|保存方案|设为默认/ })).not.toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: '应用' })).toHaveClass('ghost-button')
    expect(within(editor).getByRole('button', { name: '应用' })).toHaveClass('workbench-pomodoro-apply-plan')
    expect(within(editor).queryByLabelText('长休息时间')).not.toBeInTheDocument()
    expect(within(editor).queryByLabelText('长休息间隔轮数')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '当前会话与下一段方案' })).not.toBeInTheDocument()

    const nameInput = within(editor).getByLabelText('方案名称')
    await user.type(nameInput, '论文深潜')
    fireEvent.change(within(editor).getByLabelText('专注时间'), { target: { value: '90' } })
    await user.click(within(editor).getByRole('button', { name: '应用' }))

    // Live applyOnly may fire for timer edits; final 应用 creates a new catalog plan.
    expect(callbacks.onSaveTimerPlan).toHaveBeenLastCalledWith({
      name: '论文深潜',
      focusMinutes: 90,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      longBreakMinutes: 15,
      longBreakEvery: 4,
      breakPolicy: 'ask',
      kind: 'pomodoro',
      clockMode: 'countdown',
      continuousTarget: undefined,
      rhythmSequence: undefined
    })
  })

  it('applies and removes saved plans from the left plan list', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))
    await user.click(screen.getByRole('button', { name: /^晨间冲刺/ }))
    await user.click(screen.getByRole('button', { name: '删除方案：晨间冲刺' }))

    expect(callbacks.onApplyTimerPlan).toHaveBeenCalledWith('morning-sprint')
    expect(callbacks.onRemoveTimerPlan).toHaveBeenCalledWith('morning-sprint')
  })

  it('applies a system plan from the left list and keeps focus/break as separate rows', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    // Builtins are always listed; clicking applies even when not yet in userPlans.
    await user.click(within(editor).getByRole('button', { name: /经典番茄/ }))
    expect(callbacks.onApplyTimerPlan).toHaveBeenCalledWith('classic_25_5')

    // 专注时间 / 休息时间 must be independent settings rows (not a single dual row).
    expect(within(editor).queryByRole('group', { name: '专注与休息时间' })).not.toBeInTheDocument()
    expect(within(editor).getByLabelText('专注时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('休息时间')).toBeInTheDocument()
  })

  it('saves auto-next-cycle toggle as breakPolicy automatic (default off)', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    await user.type(within(editor).getByLabelText('方案名称'), '休息策略方案')
    // Pomodoro no longer shows simulation window or break-policy select.
    expect(within(editor).queryByLabelText('模拟开始时间')).not.toBeInTheDocument()
    const autoNext = within(editor).getByRole('switch', { name: '自动开启下一循环' })
    expect(autoNext).toHaveAttribute('aria-checked', 'false')
    await user.click(autoNext)
    expect(autoNext).toHaveAttribute('aria-checked', 'true')
    await user.click(within(editor).getByRole('button', { name: '应用' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: '休息策略方案',
        longBreakMinutes: 15,
        longBreakEvery: 4,
        breakPolicy: 'automatic',
        kind: 'pomodoro'
      })
    )
  })

  it('allows pomodoro break minutes of 0', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    await user.type(within(editor).getByLabelText('方案名称'), '零休息')
    await user.clear(within(editor).getByLabelText('休息时间'))
    await user.type(within(editor).getByLabelText('休息时间'), '0')
    await user.click(within(editor).getByRole('button', { name: '应用' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: '零休息',
        breakMinutes: 0,
        kind: 'pomodoro',
        breakPolicy: 'ask'
      })
    )
  })


  it('saves continuous cycle plan with focus/break and total minutes (countup off by default)', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    await user.type(within(editor).getByLabelText('方案名称'), '连续深潜')
    // Kind select currently shows 番茄循环 (plan kind)
    await user.click(within(editor).getByRole('button', { name: '番茄循环' }))
    await user.click(await screen.findByRole('option', { name: '连续专注' }))
    // continuous sub-mode switch appears under 方案类型
    expect(within(editor).getByRole('button', { name: '考场模拟' })).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: '连续循环' })).toBeInTheDocument()
    // default continuous sub-mode = 连续循环: focus/break + total minutes, countup off, no break-policy select
    expect(within(editor).getByLabelText('专注时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('休息时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('总时长')).toBeInTheDocument()
    expect(within(editor).queryByLabelText('总时长开始时间')).not.toBeInTheDocument()
    expect(within(editor).queryByText('休息策略')).not.toBeInTheDocument()
    const countup = within(editor).getByRole('switch', { name: '正计时' })
    expect(countup).toHaveAttribute('aria-checked', 'false')
    fireEvent.change(within(editor).getByLabelText('专注时间'), { target: { value: '50' } })
    fireEvent.change(within(editor).getByLabelText('休息时间'), { target: { value: '10' } })
    fireEvent.change(within(editor).getByLabelText('总时长'), { target: { value: '120' } })
    await user.click(within(editor).getByRole('button', { name: '应用' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: '连续深潜',
        kind: 'continuous',
        clockMode: 'countdown',
        continuousTarget: false,
        focusMinutes: 50,
        breakMinutes: 10,
        simulationStartTime: '00:00',
        simulationEndTime: '02:00'
      })
    )
  })

  it('switches continuous fields between 考场模拟 and 连续循环', async () => {
    const user = userEvent.setup()
    const callbacks = renderPomodoro()

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    await user.type(within(editor).getByLabelText('方案名称'), '模考三小时')
    await user.click(within(editor).getByRole('button', { name: '番茄循环' }))
    await user.click(await screen.findByRole('option', { name: '连续专注' }))

    // continuous cycle: focus/break/total minutes + countup toggle; no exam duration field
    expect(within(editor).queryByLabelText('考试时长')).not.toBeInTheDocument()
    expect(within(editor).getByLabelText('专注时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('休息时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('总时长')).toBeInTheDocument()
    expect(within(editor).getByRole('switch', { name: '正计时' })).toBeInTheDocument()
    expect(within(editor).queryByText('休息策略')).not.toBeInTheDocument()

    await user.click(within(editor).getByRole('button', { name: '考场模拟' }))
    // Exam: time-range window (no 考试时长 / focus / break / countup / total minutes field)
    expect(within(editor).queryByLabelText('考试时长')).not.toBeInTheDocument()
    expect(within(editor).queryByLabelText('总时长')).not.toBeInTheDocument()
    expect(within(editor).getByLabelText('考试开始时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('考试结束时间')).toBeInTheDocument()
    expect(within(editor).queryByLabelText('休息时间')).not.toBeInTheDocument()
    expect(within(editor).queryByLabelText('专注时间')).not.toBeInTheDocument()
    expect(within(editor).queryByRole('switch', { name: '正计时' })).not.toBeInTheDocument()

    // switch back to continuous cycle before save (save resets draft shell)
    await user.click(within(editor).getByRole('button', { name: '连续循环' }))
    expect(within(editor).getByLabelText('专注时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('休息时间')).toBeInTheDocument()
    expect(within(editor).getByLabelText('总时长')).toBeInTheDocument()

    // re-enter exam mode and set a 3-hour window
    await user.click(within(editor).getByRole('button', { name: '考场模拟' }))
    fireEvent.change(within(editor).getByLabelText('考试开始时间'), { target: { value: '09:00' } })
    fireEvent.change(within(editor).getByLabelText('考试结束时间'), { target: { value: '12:00' } })
    await user.click(within(editor).getByRole('button', { name: '应用' }))

    expect(callbacks.onSaveTimerPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: '模考三小时',
        kind: 'continuous',
        continuousTarget: true,
        focusMinutes: 180,
        breakPolicy: 'none',
        simulationStartTime: '09:00',
        simulationEndTime: '12:00'
      })
    )
  })



  it('live-updates a custom plan with the same id and keeps the plan shell after apply', async () => {
    const user = userEvent.setup()
    const onSaveTimerPlan = vi.fn((input: { id?: string; kind?: string }) => input.id ?? 'new-plan-id')
    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerPlans: [{
            id: 'custom-pomodoro',
            name: '自定义番茄',
            focusMinutes: 30,
            breakMinutes: 5,
            simulationStartTime: '09:00',
            simulationEndTime: '11:00',
            kind: 'pomodoro',
            breakPolicy: 'ask'
          }]
        }}
        timerProgress={0}
        defaultTimerPlanId="custom-pomodoro"
        onToggleTimer={vi.fn()}
        onResetTimer={vi.fn()}
        onStartTimerInMode={vi.fn()}
        onSaveTimerPlan={onSaveTimerPlan}
        onApplyTimerPlan={vi.fn()}
        onRemoveTimerPlan={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))
    const editor = screen.getByRole('dialog', { name: '专注计时' })

    // Ensure custom plan is selected
    await user.click(within(editor).getByRole('button', { name: /^自定义番茄/ }))
    expect(within(editor).getByLabelText('方案名称')).toHaveValue('自定义番茄')
    expect(within(editor).getByRole('button', { name: '番茄循环' })).toBeInTheDocument()

    fireEvent.change(within(editor).getByLabelText('专注时间'), { target: { value: '40' } })
    // Immediate upsert with same id (not applyOnly)
    await vi.waitFor(() => {
      expect(onSaveTimerPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-pomodoro',
          name: '自定义番茄',
          focusMinutes: 40,
          kind: 'pomodoro'
        })
      )
    })
    // Still on pomodoro shell — not jumped to continuous
    expect(within(editor).getByRole('button', { name: '番茄循环' })).toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: '连续循环' })).not.toBeInTheDocument()

    await user.click(within(editor).getByRole('button', { name: '应用' }))
    expect(onSaveTimerPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'custom-pomodoro',
        focusMinutes: 40,
        kind: 'pomodoro'
      })
    )
    expect(within(editor).getByRole('button', { name: '番茄循环' })).toBeInTheDocument()
  })

  it('resets draft when adding a new plan and swaps primary CTA to 添加', async () => {
    const user = userEvent.setup()
    const onSaveTimerPlan = vi.fn(() => 'created-plan-1')
    render(
      <WorkbenchPomodoro
        snapshot={defaultStudySnapshot}
        timerProgress={20}
        onToggleTimer={vi.fn()}
        onResetTimer={vi.fn()}
        onStartTimerInMode={vi.fn()}
        onSaveTimerPlan={onSaveTimerPlan}
        onApplyTimerPlan={vi.fn()}
        onRemoveTimerPlan={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const editor = screen.getByRole('dialog', { name: '专注计时' })
    expect(within(editor).getByRole('button', { name: '应用' })).toBeInTheDocument()

    await user.click(within(editor).getByRole('button', { name: '添加方案' }))
    expect(within(editor).getByLabelText('方案名称')).toHaveValue('')
    expect(within(editor).getByLabelText('专注时间')).toHaveValue(25)
    expect(within(editor).getByRole('button', { name: '添加' })).toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: '应用' })).not.toBeInTheDocument()
    // New blank draft is always 番茄循环 — never jumps to continuous.
    expect(within(editor).getByRole('button', { name: '番茄循环' })).toBeInTheDocument()

    await user.type(within(editor).getByLabelText('方案名称'), '新建番茄')
    fireEvent.change(within(editor).getByLabelText('专注时间'), { target: { value: '35' } })
    // While adding, no live save until 添加
    expect(onSaveTimerPlan).not.toHaveBeenCalled()
    await user.click(within(editor).getByRole('button', { name: '添加' }))
    expect(onSaveTimerPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: '新建番茄',
        focusMinutes: 35,
        kind: 'pomodoro'
      })
    )
    expect(within(editor).getByRole('button', { name: '应用' })).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: '番茄循环' })).toBeInTheDocument()
  })

  it('renders empty-start category row when host wires category change', async () => {
    const user = userEvent.setup()
    const onEmptyStartCategoryIdChange = vi.fn()
    render(
      <WorkbenchPomodoro
        snapshot={defaultStudySnapshot}
        timerProgress={0}
        emptyStartCategoryId="other"
        emptyStartCategoryOptions={[
          { value: 'study', label: '学习' },
          { value: 'other', label: '其他' }
        ]}
        onEmptyStartCategoryIdChange={onEmptyStartCategoryIdChange}
        onToggleTimer={vi.fn()}
        onResetTimer={vi.fn()}
        onStartTimerInMode={vi.fn()}
        onSaveTimerPlan={vi.fn()}
        onApplyTimerPlan={vi.fn()}
        onRemoveTimerPlan={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))
    expect(screen.getByRole('region', { name: /空启动归类/ })).toBeInTheDocument()
    expect(screen.getByText('空启动归类')).toBeInTheDocument()
  })
})
