import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const client = {
  studyRoomJoin: vi.fn(),
  studyRoomHeartbeat: vi.fn(),
  studyRoomLeave: vi.fn(),
  studyRoomMembers: vi.fn(),
  studyRoomAssignAndJoin: vi.fn(),
}

vi.mock('@renderer/sync/sync-api-client', () => ({
  createSyncApiClient: () => client,
}))

vi.mock('@renderer/sync/sync-store', () => ({
  clearSyncAuth: vi.fn(),
  getSyncAccessToken: () => 'access-token',
  getSyncState: () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', baseUrl: 'https://api.example.test' }),
  setSyncAuth: vi.fn(),
  useSyncState: () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', baseUrl: 'https://api.example.test', user: { id: 'user-1' } }),
}))

import { useStudyRoomPresence } from '@renderer/sync/study-room-presence'
import { AppStudyRoomPresenceProvider } from '@renderer/sync/app-study-room-presence'

describe('useStudyRoomPresence', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('joins a room on authenticated app entry without mounting the workbench', async () => {
    client.studyRoomAssignAndJoin.mockResolvedValue({ joined: true, roomId: 'LIVE1', seatIndex: 0 })
    client.studyRoomJoin.mockResolvedValue({ joined: true, roomId: 'LIVE1', seatIndex: 0 })
    client.studyRoomMembers.mockResolvedValue({ roomId: 'LIVE1', members: [{ userId: 'user-1', isSelf: true }] })
    client.studyRoomLeave.mockResolvedValue({ left: true })

    const { unmount } = render(
      <AppStudyRoomPresenceProvider>
        <div>Application shell</div>
      </AppStudyRoomPresenceProvider>
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(client.studyRoomAssignAndJoin).toHaveBeenCalledTimes(1)
    expect(client.studyRoomAssignAndJoin).toHaveBeenCalledWith(
      expect.not.objectContaining({ fallbackRoomId: expect.anything() })
    )
    unmount()
  })

  it('polls the roster after joining so peers who enter later become visible', async () => {
    vi.useFakeTimers()
    client.studyRoomJoin.mockResolvedValue({ joined: true, roomId: 'ROOM1' })
    client.studyRoomLeave.mockResolvedValue({ left: true })
    client.studyRoomMembers
      .mockResolvedValueOnce({ roomId: 'ROOM1', members: [{ userId: 'user-1', isSelf: true }] })
      .mockResolvedValueOnce({ roomId: 'ROOM1', members: [{ userId: 'user-1', isSelf: true }, { userId: 'user-2', isSelf: false }] })

    const { result } = renderHook(() => useStudyRoomPresence({
      roomId: 'ROOM1', active: true, nickname: 'Me', petAppearance: 'usagi'
    }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(client.studyRoomMembers).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

    expect(client.studyRoomMembers).toHaveBeenCalledTimes(2)
    expect(result.current.members).toHaveLength(2)
  })
})
