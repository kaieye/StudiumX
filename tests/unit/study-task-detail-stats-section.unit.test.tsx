import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduleBlock } from '@shared/study-planning'
import { StudyTaskDetailStatsSection } from '@renderer/views/workbench/StudyTaskDetailStatsSection'

const NOW = Date.UTC(2026, 6, 22, 12, 0, 0)

const futureBlock: ScheduleBlock = {
  id: 'b-fut',
  taskId: 't1',
  kind: 'focus',
  startAtMs: NOW + 3600_000,
  endAtMs: NOW + 7200_000,
  locked: false,
  source: 'manual',
  status: 'planned',
  revision: 1
}

describe('StudyTaskDetailStatsSection UI (STC-304)', () => {
  it('renders estimate/planned/actual labels and editable estimate', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <StudyTaskDetailStatsSection
        taskId="t1"
        scheduleBlocks={[futureBlock]}
        estimateMinutes={null}
        estimateDraft=""
        onEstimateDraftChange={onChange}
        nowMs={NOW}
      />
    )

    expect(screen.getByRole('region', { name: '任务详情统计' })).toBeInTheDocument()
    expect(screen.getByText('估时')).toBeInTheDocument()
    expect(screen.getByText('计划专注')).toBeInTheDocument()
    expect(screen.getByText('实际专注')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '未来时间块' })).toBeInTheDocument()

    const input = screen.getByLabelText('估时（分钟）')
    await user.type(input, '40')
    expect(onChange).toHaveBeenCalled()
  })

  it('shows non-zero actual focus from canonical timerSessions sole-read', () => {
    render(
      <StudyTaskDetailStatsSection
        taskId="t1"
        scheduleBlocks={[futureBlock]}
        timerSessions={[
          {
            id: 's1',
            taskId: 't1',
            scheduleBlockId: null,
            phase: 'focus',
            clockMode: 'countdown',
            state: 'completed',
            targetSeconds: 1500,
            startedAtMs: NOW - 2000_000,
            endedAtMs: NOW - 500_000,
            lastSampleWallMs: NOW - 500_000,
            accumulatedActiveSeconds: 1500,
            accumulatedFocusSeconds: 1500,
            planSnapshot: null,
            attributionReason: 'explicit',
            focusRoundInPlan: 1
          }
        ]}
        estimateMinutes={null}
        nowMs={NOW}
        readOnly
      />
    )
    // 1500s → 25m actual
    expect(screen.getByText('25m')).toBeInTheDocument()
  })
})
