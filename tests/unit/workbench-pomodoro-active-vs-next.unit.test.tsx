/**
 * WorkbenchPomodoro STC-503 active-vs-next plan snapshot UI.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultStudySnapshot } from '@renderer/study-space/constants'
import { WorkbenchPomodoro } from '@renderer/views/workbench/WorkbenchPomodoro'
import {
  createClassicPomodoroPlan,
  startTimerSession
} from '../../src/shared/study-planning'

function renderWithActiveSession(diverges: boolean) {
  const plan = createClassicPomodoroPlan()
  const started = startTimerSession({ id: 'live-sess', nowMs: 0, plan, taskId: 't1' })
  if (!started.session) throw new Error('session')
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
      snapshot={{
        ...defaultStudySnapshot,
        timerPlans: [
          {
            id: plan.id,
            name: plan.name,
            focusMinutes: diverges ? 50 : 25,
            breakMinutes: diverges ? 10 : 5,
            simulationStartTime: '09:00',
            simulationEndTime: '12:00',
            breakPolicy: diverges ? 'automatic' : 'ask'
          }
        ]
      }}
      timerProgress={20}
      defaultTimerPlanId={plan.id}
      activeTimerSession={started.session}
      {...callbacks}
    />
  )
  return callbacks
}

describe('WorkbenchPomodoro active-vs-next plan (STC-503)', () => {
  it('shows active snapshot vs next plan and diverges cue when catalog differs', async () => {
    const user = userEvent.setup()
    renderWithActiveSession(true)

    await user.click(screen.getByRole('button', { name: /专注计时/ }))
    await user.click(screen.getByRole('button', { name: '计时设置' }))

    const strip = screen.getByRole('region', { name: '当前会话与下一段方案' })
    expect(strip).toHaveAttribute('data-diverges', 'true')
    expect(within(strip).getByText('当前会话方案快照')).toBeInTheDocument()
    expect(within(strip).getByText('下一段方案')).toBeInTheDocument()
    expect(within(strip).getByText(/当前会话保持冻结/)).toBeInTheDocument()
    // Frozen snapshot keeps 25; next catalog shows 50 (summaries are unique).
    expect(within(strip).getByText('25/5 · 长休 15 · 询问休息')).toBeInTheDocument()
    expect(within(strip).getByText('50/10 · 长休 15 · 自动休息')).toBeInTheDocument()
  })

  it('shows next plan without diverges when idle (no active session)', async () => {
    const user = userEvent.setup()
    render(
      <WorkbenchPomodoro
        snapshot={defaultStudySnapshot}
        timerProgress={0}
        defaultTimerPlanId="classic_25_5"
        activeTimerSession={null}
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

    const strip = screen.getByRole('region', { name: '当前会话与下一段方案' })
    expect(strip).toHaveAttribute('data-diverges', 'false')
    expect(within(strip).getAllByText(/开始计时后/).length).toBeGreaterThan(0)
    expect(within(strip).getByText('经典番茄 25/5')).toBeInTheDocument()
  })
})
