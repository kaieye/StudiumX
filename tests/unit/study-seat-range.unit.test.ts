import { describe, expect, it } from 'vitest'
import {
  defaultStudySeatIndex,
  findAvailableStudySeatIndex,
  normalizeStudySeatIndex,
  studyRoomSeatCount
} from '@renderer/study-space/domain'
import { STUDY_ROOM_CAPACITY, studyRooms } from '@renderer/study-space/constants'
import type { StudyRoomId } from '@renderer/study-space/types'

const ROOM_IDS = studyRooms.map((room) => room.id)

describe('study seat range (every room holds STUDY_ROOM_CAPACITY people)', () => {
  it('reports STUDY_ROOM_CAPACITY seats for every room', () => {
    expect(STUDY_ROOM_CAPACITY).toBe(12)
    for (const roomId of ROOM_IDS) {
      expect(studyRoomSeatCount(roomId)).toBe(STUDY_ROOM_CAPACITY)
    }
  })

  it('defaults seats inside the rendered desk range for any client and room', () => {
    const clientIds = ['client-a', 'studiumx-web-1234', 'some-longer-id-5678', '']
    for (const roomId of ROOM_IDS) {
      for (const clientId of clientIds) {
        const seat = defaultStudySeatIndex(clientId, roomId)
        expect(seat).toBeGreaterThanOrEqual(0)
        expect(seat).toBeLessThan(STUDY_ROOM_CAPACITY)
      }
    }
  })

  it('clamps persisted seats beyond the desk range back into [0, 12)', () => {
    // Historical sessions (36/24/18/30-seat rooms) may have persisted seats ≥ 12.
    for (const roomId of ROOM_IDS) {
      expect(normalizeStudySeatIndex(35, roomId, 'client-a')).toBe(STUDY_ROOM_CAPACITY - 1)
      expect(normalizeStudySeatIndex(20, roomId, 'client-a')).toBeLessThan(STUDY_ROOM_CAPACITY)
    }
    expect(normalizeStudySeatIndex(0, 'silent', 'client-a')).toBe(0)
    expect(normalizeStudySeatIndex(11, 'silent', 'client-a')).toBe(11)
  })

  it('falls back to an in-range deterministic seat for invalid input', () => {
    for (const roomId of ROOM_IDS) {
      const seat = normalizeStudySeatIndex(Number.NaN, roomId, 'client-a')
      expect(seat).toBeGreaterThanOrEqual(0)
      expect(seat).toBeLessThan(STUDY_ROOM_CAPACITY)
      expect(seat).toBe(defaultStudySeatIndex('client-a', roomId))
    }
  })

  it('finds only in-range seats and reports null when the room is full', () => {
    const occupiedAll = Array.from({ length: STUDY_ROOM_CAPACITY }, (_, index) => index)
    expect(
      findAvailableStudySeatIndex({
        preferredSeatIndex: 0,
        roomId: 'silent',
        clientId: 'client-a',
        occupiedSeatIndexes: occupiedAll
      })
    ).toBeNull()

    // Preferred index 20 normalizes to 11; with 11 free it stays there.
    const freeSeat = findAvailableStudySeatIndex({
      preferredSeatIndex: 20,
      roomId: 'silent',
      clientId: 'client-a',
      occupiedSeatIndexes: []
    })
    expect(freeSeat).toBe(STUDY_ROOM_CAPACITY - 1)

    // With 11 taken, the nearest free seat is in range and not occupied.
    const occupied = Array.from({ length: STUDY_ROOM_CAPACITY - 1 }, (_, index) => index)
    const next = findAvailableStudySeatIndex({
      preferredSeatIndex: 20,
      roomId: 'silent',
      clientId: 'client-a',
      occupiedSeatIndexes: occupied
    })
    expect(next).not.toBeNull()
    expect(next!).toBeGreaterThanOrEqual(0)
    expect(next!).toBeLessThan(STUDY_ROOM_CAPACITY)
    expect(occupied).not.toContain(next)
  })
})
