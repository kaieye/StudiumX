import { describe, expect, it } from 'vitest'
import { buildOfficeSceneOccupants } from '../../src/renderer/src/views/workbench/OfficeWorkbench'
import type { OfficeSceneSeatOccupant } from '../../src/renderer/src/views/workbench/office-scene-runtime'
import type {
  StudyPresencePeer,
  StudyTimerMode,
  StudyTimerState
} from '../../src/renderer/src/study-space/types'
import type { StudyRoomMember } from '../../src/renderer/src/study-space/viewModel'

const spaceCode = 'ABC12'

const selfOccupant: OfficeSceneSeatOccupant = {
  kind: 'self',
  name: '我',
  petAppearance: 'lulu-capybara',
  status: 'running',
  timerMode: 'focus',
  todayFocusSeconds: 1800
}

function relayPeer(
  clientId: string,
  nickname: string,
  petAppearance: OfficeSceneSeatOccupant['petAppearance'],
  seatIndex: number
): StudyPresencePeer {
  return {
    clientId,
    roomId: 'silent',
    spaceCode,
    nickname,
    petAppearance,
    signalId: 'practice',
    seatIndex,
    seatClaimedAt: 0,
    status: 'running' as StudyTimerState,
    timerMode: 'focus' as StudyTimerMode,
    focusMinutes: 25,
    todayFocusSeconds: 900,
    todaySessions: 1,
    streakDays: 0,
    updatedAt: Date.now()
  }
}

function serverMember(userId: string, nickname: string, isSelf: boolean): StudyRoomMember {
  return {
    clientId: `server:${userId}`,
    roomId: 'silent',
    spaceCode,
    nickname,
    petAppearance: selfOccupant.petAppearance,
    signalId: 'practice',
    seatIndex: -1,
    seatClaimedAt: 0,
    status: 'running' as StudyTimerState,
    timerMode: 'focus' as StudyTimerMode,
    focusMinutes: 25,
    todayFocusSeconds: 1200,
    todaySessions: 1,
    streakDays: 0,
    updatedAt: Date.now(),
    isSelf
  }
}

const seatCount = 12

describe('buildOfficeSceneOccupants', () => {
  it('draws one pet for self when the same account is also a relay peer and a server roster exists', () => {
    // Desktop + web of the same account: the web session announces as a relay
    // peer, but the server roster (deduplicated per account) only lists self.
    // The scene must follow the roster so the person gets exactly one pet.
    const webSession = relayPeer('web-session', '我', 'lulu-capybara', 2)
    const roster = [serverMember('u-1', '我', true)]

    const occupants = buildOfficeSceneOccupants({
      self: selfOccupant,
      userSeatConflict: false,
      workbenchUserSeatIndex: 0,
      relayPeersBySeat: new Map([[webSession.seatIndex, webSession]]),
      serverRosterAvailable: true,
      leaderboardMembers: roster,
      seatCount
    })

    expect(occupants.size).toBe(1)
    expect(occupants.get('desk-1')).toEqual(selfOccupant)
    expect(occupants.has('desk-3')).toBe(false)
  })

  it('falls back to relay peers while no server roster has been received', () => {
    const webSession = relayPeer('web-session', '我', 'lulu-capybara', 2)

    const occupants = buildOfficeSceneOccupants({
      self: selfOccupant,
      userSeatConflict: false,
      workbenchUserSeatIndex: 0,
      relayPeersBySeat: new Map([[webSession.seatIndex, webSession]]),
      serverRosterAvailable: false,
      leaderboardMembers: [],
      seatCount
    })

    expect(occupants.size).toBe(2)
    expect(occupants.get('desk-1')).toEqual(selfOccupant)
    expect(occupants.get('desk-3')?.name).toBe('我')
  })

  it('places other server users at free desks when the roster is available', () => {
    const webSession = relayPeer('web-session', '我', 'lulu-capybara', 2)
    const roster = [serverMember('u-1', '我', true), serverMember('u-2', '小明', false)]

    const occupants = buildOfficeSceneOccupants({
      self: selfOccupant,
      userSeatConflict: false,
      workbenchUserSeatIndex: 0,
      relayPeersBySeat: new Map([[webSession.seatIndex, webSession]]),
      serverRosterAvailable: true,
      leaderboardMembers: roster,
      seatCount
    })

    expect(occupants.size).toBe(2)
    expect(occupants.get('desk-1')).toEqual(selfOccupant)
    expect(occupants.get('desk-2')?.name).toBe('小明')
  })

  it('does not draw self when its seat is in conflict', () => {
    const roster = [serverMember('u-1', '我', true)]

    const occupants = buildOfficeSceneOccupants({
      self: selfOccupant,
      userSeatConflict: true,
      workbenchUserSeatIndex: 0,
      relayPeersBySeat: new Map(),
      serverRosterAvailable: true,
      leaderboardMembers: roster,
      seatCount
    })

    expect(occupants.size).toBe(0)
  })
})
