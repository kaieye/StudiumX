import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayKey } from '../../src/renderer/src/study-space/domain'
import {
  SyncApiError,
  type SyncApiClient,
  type SyncApiClientOptions,
  type SyncAnalyticsPeer
} from '../../src/renderer/src/sync/sync-api-client'
import {
  buildTodayAnalyticsSummary,
  getAnalyticsUploadBlocked,
  useTodayAnalyticsSync
} from '../../src/renderer/src/sync/today-analytics-sync'
import {
  clearSyncAuth,
  setSyncAuth
} from '../../src/renderer/src/sync/sync-store'

function createClientHarness() {
  const putAnalyticsSummary = vi.fn<SyncApiClient['putAnalyticsSummary']>()
  const getAnalyticsPeersToday = vi.fn<SyncApiClient['getAnalyticsPeersToday']>()
  const client = {
    putAnalyticsSummary,
    getAnalyticsPeersToday
  } as unknown as SyncApiClient
  const createClient = vi.fn(
    (_options: SyncApiClientOptions) => client
  ) as unknown as (options: SyncApiClientOptions) => SyncApiClient
  return { putAnalyticsSummary, getAnalyticsPeersToday, createClient }
}

function enableSync() {
  setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token', user: { id: 'alice' } })
}

const PEER: SyncAnalyticsPeer = { userId: 'bob', focusSeconds: 7200, updatedAtMs: 1 }

describe('buildTodayAnalyticsSummary', () => {
  it('builds the derived today payload with local dates and zero planned focus', () => {
    const body = buildTodayAnalyticsSummary({
      focusSecondsToday: 600,
      todaySessions: 2,
      localToday: '2026-08-01'
    })
    expect(body).toEqual({
      rangeKey: 'today',
      focusSeconds: 600,
      plannedFocusSeconds: 0,
      completedFocusSessions: 2,
      periodStartDate: '2026-08-01',
      periodEndDate: '2026-08-01'
    })
  })

  it('clamps and floors negative/fractional counters', () => {
    expect(
      buildTodayAnalyticsSummary({ focusSecondsToday: -5, todaySessions: 2.9, localToday: '2026-08-01' })
        .focusSeconds
    ).toBe(0)
    expect(
      buildTodayAnalyticsSummary({ focusSecondsToday: 60.9, todaySessions: -1, localToday: '2026-08-01' })
        .completedFocusSessions
    ).toBe(0)
  })
})

describe('useTodayAnalyticsSync', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSyncAuth()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays inert while the user is not logged in', async () => {
    const { putAnalyticsSummary, getAnalyticsPeersToday, createClient } = createClientHarness()

    const { result } = renderHook(() =>
      useTodayAnalyticsSync({ focusSecondsToday: 100, todaySessions: 2 }, createClient)
    )
    await act(async () => {})

    expect(createClient).not.toHaveBeenCalled()
    expect(putAnalyticsSummary).not.toHaveBeenCalled()
    expect(getAnalyticsPeersToday).not.toHaveBeenCalled()
    expect(result.current.peers).toEqual([])
  })

  it('syncs immediately after login, then once per hour while the user stays online', async () => {
    const { putAnalyticsSummary, getAnalyticsPeersToday, createClient } = createClientHarness()
    putAnalyticsSummary.mockResolvedValue({
      stored: true,
      summary: { id: 'alice:today', focusSeconds: 10, updatedAtMs: 1 }
    })
    getAnalyticsPeersToday.mockResolvedValue({ peers: [PEER], asOf: '2026-08-01T12:00:00.000Z' })
    setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token', user: { id: 'alice' } })

    const { result } = renderHook(() =>
      useTodayAnalyticsSync({ focusSecondsToday: 10, todaySessions: 2 }, createClient)
    )
    await act(async () => {})

    expect(putAnalyticsSummary).toHaveBeenCalledTimes(1)
    expect(getAnalyticsPeersToday).toHaveBeenCalledTimes(1)
    expect(putAnalyticsSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        rangeKey: 'today',
        focusSeconds: 10,
        completedFocusSessions: 2,
        periodStartDate: todayKey(new Date()),
        periodEndDate: todayKey(new Date())
      })
    )
    expect(result.current.peers).toEqual([PEER])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    })
    expect(putAnalyticsSummary).toHaveBeenCalledTimes(2)
    expect(getAnalyticsPeersToday).toHaveBeenCalledTimes(2)
  })

  it('does not upload a zero-day but still polls the leaderboard', async () => {
    const { putAnalyticsSummary, getAnalyticsPeersToday, createClient } = createClientHarness()
    getAnalyticsPeersToday.mockResolvedValue({ peers: [], asOf: '2026-08-01T12:00:00.000Z' })
    enableSync()

    renderHook(() => useTodayAnalyticsSync({ focusSecondsToday: 0, todaySessions: 0 }, createClient))
    await act(async () => {})

    expect(putAnalyticsSummary).not.toHaveBeenCalled()
    expect(getAnalyticsPeersToday).toHaveBeenCalledTimes(1)
  })

  it('retries a rejected upload at the next hourly sync', async () => {
    const { putAnalyticsSummary, getAnalyticsPeersToday, createClient } = createClientHarness()
    putAnalyticsSummary.mockRejectedValue(new SyncApiError(0, null, 'network error'))
    getAnalyticsPeersToday.mockResolvedValue({ peers: [], asOf: 'x' })
    setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token', user: { id: 'alice' } })

    renderHook(() => useTodayAnalyticsSync({ focusSecondsToday: 10, todaySessions: 2 }, createClient))
    await act(async () => {})

    expect(getAnalyticsUploadBlocked()).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    })
    expect(putAnalyticsSummary).toHaveBeenCalledTimes(2)
    expect(getAnalyticsPeersToday).toHaveBeenCalledTimes(2)
  })

  it('clears peers and stops the hourly loop when the user logs out', async () => {
    const { putAnalyticsSummary, getAnalyticsPeersToday, createClient } = createClientHarness()
    getAnalyticsPeersToday.mockResolvedValue({ peers: [PEER], asOf: '2026-08-01T12:00:00.000Z' })
    setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token', user: { id: 'alice' } })

    const { result } = renderHook(() =>
      useTodayAnalyticsSync({ focusSecondsToday: 10, todaySessions: 2 }, createClient)
    )
    await act(async () => {})
    expect(result.current.peers).toEqual([PEER])

    await act(async () => {
      clearSyncAuth()
    })
    await act(async () => {})
    expect(result.current.peers).toEqual([])
    const pollsBefore = getAnalyticsPeersToday.mock.calls.length
    const uploadsBefore = putAnalyticsSummary.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    })
    expect(getAnalyticsPeersToday.mock.calls.length).toBe(pollsBefore)
    expect(putAnalyticsSummary.mock.calls.length).toBe(uploadsBefore)
  })
})
