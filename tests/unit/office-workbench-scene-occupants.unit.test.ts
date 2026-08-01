import { describe, expect, it } from 'vitest'
import { buildOfficeSceneOccupants } from '../../src/renderer/src/views/workbench/OfficeWorkbench'
import type { StudyTimerMode, StudyTimerState } from '../../src/renderer/src/study-space/types'
import type { StudyRoomMember } from '../../src/renderer/src/study-space/viewModel'

const spaceCode = 'ABC12'
const seatCount = 12

function serverMember(
  userId: string,
  nickname: string,
  seatIndex: number,
  isSelf: boolean,
  todayFocusSeconds = 1200
): StudyRoomMember {
  return {
    clientId: `server:${userId}`,
    roomId: 'silent',
    spaceCode,
    nickname,
    petAppearance: isSelf ? 'lulu-capybara' : 'usagi',
    signalId: 'practice',
    seatIndex,
    seatClaimedAt: 0,
    status: 'running' as StudyTimerState,
    timerMode: 'focus' as StudyTimerMode,
    focusMinutes: 25,
    todayFocusSeconds,
    todaySessions: 1,
    streakDays: 0,
    updatedAt: Date.now(),
    isSelf
  }
}

describe('buildOfficeSceneOccupants', () => {
  it('uses every server member’s assigned seat, including self', () => {
    const occupants = buildOfficeSceneOccupants({
      serverRosterAvailable: true,
      leaderboardMembers: [
        serverMember('alice', '我', 5, true),
        serverMember('bob', '小明', 1, false),
      ],
      seatCount,
    })

    expect(occupants.size).toBe(2)
    expect(occupants.get('desk-6')).toMatchObject({ kind: 'self', name: '我' })
    expect(occupants.get('desk-2')).toMatchObject({ kind: 'peer', name: '小明' })
  })

  it('keeps seat placement independent of leaderboard order and focus duration', () => {
    const roster = [
      serverMember('alice', '我', 8, true, 60),
      serverMember('bob', '小明', 2, false, 7200),
    ]

    const occupants = buildOfficeSceneOccupants({
      serverRosterAvailable: true,
      leaderboardMembers: [...roster].sort((left, right) => right.todayFocusSeconds - left.todayFocusSeconds),
      seatCount,
    })

    expect(occupants.get('desk-9')?.name).toBe('我')
    expect(occupants.get('desk-3')?.name).toBe('小明')
  })

  it('does not render a local or relay fallback before a server roster is received', () => {
    const occupants = buildOfficeSceneOccupants({
      serverRosterAvailable: false,
      leaderboardMembers: [serverMember('alice', '我', 0, true)],
      seatCount,
    })

    expect(occupants).toEqual(new Map())
  })
})
