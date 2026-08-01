import { describe, expect, it } from 'vitest'
import { buildLivePresenceSnapshot } from '@renderer/views/workbench/analytics/livePresenceAnalytics'

const CAPTURED_AT = '2026-08-01T12:00:00.000Z'

describe('buildLivePresenceSnapshot', () => {
  it('returns null when there are no peers (only the local user)', () => {
    expect(
      buildLivePresenceSnapshot({
        spaceCode: 'ROOM',
        myFocusSecondsToday: 1800,
        members: [{ focusSecondsToday: 1800, isSelf: true }],
        capturedAt: CAPTURED_AT
      })
    ).toBeNull()
  })

  it('returns null on an empty roster', () => {
    expect(
      buildLivePresenceSnapshot({
        spaceCode: 'ROOM',
        myFocusSecondsToday: 0,
        members: [],
        capturedAt: CAPTURED_AT
      })
    ).toBeNull()
  })

  it('computes the fraction of peers strictly below the local focus', () => {
    const result = buildLivePresenceSnapshot({
      spaceCode: 'ROOM',
      myFocusSecondsToday: 100,
      members: [
        { focusSecondsToday: 100, isSelf: true },
        { focusSecondsToday: 50 },
        { focusSecondsToday: 200 }
      ],
      capturedAt: CAPTURED_AT
    })
    expect(result).not.toBeNull()
    // 1 of 2 peers (50) is strictly below 100 → 0.5
    expect(result!.selfPercentile).toBeCloseTo(0.5)
  })

  it('is 1 when beating every peer and 0 when beating none', () => {
    const top = buildLivePresenceSnapshot({
      spaceCode: 'ROOM',
      myFocusSecondsToday: 300,
      members: [
        { focusSecondsToday: 300, isSelf: true },
        { focusSecondsToday: 100 },
        { focusSecondsToday: 50 }
      ],
      capturedAt: CAPTURED_AT
    })
    expect(top!.selfPercentile).toBe(1)

    const bottom = buildLivePresenceSnapshot({
      spaceCode: 'ROOM',
      myFocusSecondsToday: 10,
      members: [
        { focusSecondsToday: 10, isSelf: true },
        { focusSecondsToday: 100 },
        { focusSecondsToday: 50 }
      ],
      capturedAt: CAPTURED_AT
    })
    expect(bottom!.selfPercentile).toBe(0)
  })

  it('treats ties as not strictly below (percentile 0)', () => {
    const result = buildLivePresenceSnapshot({
      spaceCode: 'ROOM',
      myFocusSecondsToday: 100,
      members: [
        { focusSecondsToday: 100, isSelf: true },
        { focusSecondsToday: 100 },
        { focusSecondsToday: 100 }
      ],
      capturedAt: CAPTURED_AT
    })
    expect(result!.selfPercentile).toBe(0)
  })

  it('normalizes negative focus and aggregates peer focus as the mean', () => {
    const result = buildLivePresenceSnapshot({
      spaceCode: 'ROOM',
      myFocusSecondsToday: -10,
      members: [
        { focusSecondsToday: -10, isSelf: true },
        { focusSecondsToday: 100 },
        { focusSecondsToday: 200 },
        { focusSecondsToday: -5 }
      ],
      capturedAt: CAPTURED_AT
    })
    // myFocus clamps to 0 → beats no one
    expect(result!.selfPercentile).toBe(0)
    // peers mean = (100 + 200 + 0) / 3 = 100
    expect(result!.peerFocusSecondsToday).toBe(100)
  })

  it('reports online as the full roster size and keeps live metadata', () => {
    const result = buildLivePresenceSnapshot({
      spaceCode: 'ROOM',
      myFocusSecondsToday: 90,
      members: [
        { focusSecondsToday: 90, isSelf: true },
        { focusSecondsToday: 30 },
        { focusSecondsToday: 120 }
      ],
      capturedAt: CAPTURED_AT
    })
    expect(result!.online).toBe(3)
    expect(result!.spaceCode).toBe('ROOM')
    expect(result!.capturedAt).toBe(CAPTURED_AT)
    expect(result!.roomCapacityPercent).toBeNull()
    expect(result!.eventCounts).toEqual({})
  })
})
