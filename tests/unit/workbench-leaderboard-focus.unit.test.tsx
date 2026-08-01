import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchLeaderboard } from '@renderer/views/workbench/WorkbenchLeaderboard'
import type { StudyRoomMember } from '@renderer/study-space/viewModel'

const members: StudyRoomMember[] = [
  {
    clientId: 'self',
    roomId: 'quiet',
    spaceCode: 'VCA✓8',
    nickname: 'Chos1nz',
    signalId: 'reading',
    seatIndex: 0,
    seatClaimedAt: 0,
    status: 'idle',
    timerMode: 'focus',
    focusMinutes: 0,
    todayFocusSeconds: 24 * 60,
    todaySessions: 1,
    streakDays: 1,
    updatedAt: 0,
    isSelf: true
  }
]

describe('WorkbenchLeaderboard focus handling', () => {
  it('keeps the connection state as a status indicator rather than a page-entry spinner', () => {
    render(
      <WorkbenchLeaderboard
        members={members}
        presenceStatus="connecting"
        spaceCode="VCA✓8"
        onEnterRandomSpace={vi.fn()}
        onJoinSpace={vi.fn()}
      />
    )

    expect(screen.getByLabelText('心跳连接中')).toHaveClass('workbench-heartbeat-dot', 'is-connecting')
    expect(screen.queryByText('正在进入自习室')).not.toBeInTheDocument()
  })

  it('does not imperatively focus the toggle on pointer down', () => {
    const focus = vi.spyOn(HTMLButtonElement.prototype, 'focus')

    render(
      <WorkbenchLeaderboard
        members={members}
        presenceStatus="online"
        spaceCode="VCA✓8"
        onEnterRandomSpace={vi.fn()}
        onJoinSpace={vi.fn()}
      />
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: /^自习室榜单/ }))

    expect(focus).not.toHaveBeenCalled()
  })
})
