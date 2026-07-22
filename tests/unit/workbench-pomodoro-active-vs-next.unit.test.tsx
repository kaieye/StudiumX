/**
 * WorkbenchPomodoro: active-vs-next plan strip removed (product subtraction).
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

describe('WorkbenchPomodoro active-vs-next plan removed', () => {
  it('does not render current-session vs next-plan strip', async () => {
    const user = userEvent.setup()
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({ id: 'live-sess', nowMs: 0, plan, taskId: 't1' })
    if (!started.session) throw new Error('session')

    render(
      <WorkbenchPomodoro
        snapshot={{
          ...defaultStudySnapshot,
          timerPlans: [
            {
              id: plan.id,
              name: plan.name,
              focusMinutes: 50,
              breakMinutes: 10,
              simulationStartTime: '09:00',
              simulationEndTime: '12:00',
              breakPolicy: 'automatic'
            }
          ]
        }}
        timerProgress={20}
        defaultTimerPlanId={plan.id}
        activeTimerSession={started.session}
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

    expect(screen.queryByRole('region', { name: '当前会话与下一段方案' })).not.toBeInTheDocument()
    expect(screen.queryByText('当前会话方案快照')).not.toBeInTheDocument()
    expect(screen.queryByText('下一段方案')).not.toBeInTheDocument()
  })
})
