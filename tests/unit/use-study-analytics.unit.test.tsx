import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LearningAnalyticsBundle, LearningAnalyticsQuery } from '@shared/teaching-types/analytics'
import {
  AnalyticsApiUnavailableError,
  buildAnalyticsDateRange,
  buildLearningAnalyticsQuery,
  teachingSystemAnalyticsClient,
  useStudyAnalytics,
  validateCustomAnalyticsRange,
  type LearningAnalyticsClient
} from '@renderer/views/workbench/analytics/useStudyAnalytics'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function bundleFor(query: LearningAnalyticsQuery, generatedAt: string): LearningAnalyticsBundle {
  return { contractVersion: 1, generatedAt, query } as LearningAnalyticsBundle
}

describe('analytics query construction', () => {
  it('uses inclusive local calendar boundaries with Monday as week start', () => {
    expect(buildAnalyticsDateRange('today', '2026-07-13')).toMatchObject({
      from: '2026-07-13',
      to: '2026-07-13',
      fromInclusive: true,
      toInclusive: true,
      weekStartsOn: 1
    })
    expect(buildAnalyticsDateRange('week', '2026-07-13')).toMatchObject({
      from: '2026-07-13',
      to: '2026-07-13'
    })
    expect(buildAnalyticsDateRange('month', '2026-07-13')).toMatchObject({
      from: '2026-07-01',
      to: '2026-07-13'
    })
    expect(buildAnalyticsDateRange('90d', '2026-07-13')).toMatchObject({
      from: '2026-04-15',
      to: '2026-07-13'
    })
  })

  it('rejects incomplete, reversed, and future custom ranges', () => {
    expect(validateCustomAnalyticsRange({ from: '', to: '2026-07-01' }, '2026-07-13').valid).toBe(false)
    expect(validateCustomAnalyticsRange({ from: '2026-07-10', to: '2026-07-01' }, '2026-07-13')).toMatchObject({
      valid: false,
      code: 'from_after_to'
    })
    expect(validateCustomAnalyticsRange({ from: '2026-07-01', to: '2026-07-14' }, '2026-07-13')).toMatchObject({
      valid: false,
      code: 'future_date'
    })
    expect(validateCustomAnalyticsRange({ from: '2026-07-01', to: '2026-07-13' }, '2026-07-13')).toEqual({ valid: true })
  })

  it('keeps personal focus, teaching, and live presence scopes independent', () => {
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('week', '2026-07-13'),
      localToday: '2026-07-13',
      timeZone: 'Asia/Shanghai',
      personalClientId: 'client-1',
      teaching: { kind: 'workspace', workspaceId: 'workspace-1', workspaceName: '数学' },
      presenceSpaceCode: 'SPACE-1'
    })

    expect(query.scope).toEqual({
      personalFocus: { kind: 'personal', clientId: 'client-1' },
      teaching: { kind: 'workspace', workspaceId: 'workspace-1', workspaceName: '数学' },
      presence: { kind: 'live_space', spaceCode: 'SPACE-1' }
    })
  })
})

describe('useStudyAnalytics', () => {
  it('requests every analytics section from Main for the full Learning Analytics page', async () => {
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('week', '2026-07-13'),
      localToday: '2026-07-13',
      timeZone: 'Asia/Shanghai',
      personalClientId: 'client-1',
      teaching: { kind: 'none' }
    })
    const getLearningAnalytics = vi.fn(async () => bundleFor(query, '2026-07-13T10:00:00.000Z'))
    const originalSystem = window.teachingSystem
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      writable: true,
      value: { getLearningAnalytics }
    })

    try {
      await teachingSystemAnalyticsClient.getLearningAnalytics(query, new AbortController().signal)
      expect(getLearningAnalytics).toHaveBeenCalledWith(expect.objectContaining({
        query,
        sectionIds: ['hero', 'focus', 'tasks', 'tokens', 'workspace_assets', 'review', 'memory', 'platform', 'presence', 'insights']
      }))
      expect(getLearningAnalytics.mock.calls[0]?.[0]).not.toHaveProperty('refreshSectionIds')
    } finally {
      Object.defineProperty(window, 'teachingSystem', {
        configurable: true,
        writable: true,
        value: originalSystem
      })
    }
  })

  it('aborts superseded work and ignores a late response from the old query', async () => {
    const first = deferred<LearningAnalyticsBundle>()
    const second = deferred<LearningAnalyticsBundle>()
    const signals: AbortSignal[] = []
    let call = 0
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: (_query, signal) => {
        signals.push(signal)
        call += 1
        return call === 1 ? first.promise : second.promise
      }
    }
    const firstQuery = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('today', '2026-07-13'),
      localToday: '2026-07-13',
      timeZone: 'Asia/Shanghai',
      personalClientId: 'client-1',
      teaching: { kind: 'none' }
    })
    const secondQuery = {
      ...firstQuery,
      range: buildAnalyticsDateRange('month', '2026-07-13')
    }

    const { result, rerender } = renderHook(
      ({ query }) => useStudyAnalytics({ query, client }),
      { initialProps: { query: firstQuery } }
    )

    rerender({ query: secondQuery })
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      second.resolve(bundleFor(secondQuery, '2026-07-13T10:00:00.000Z'))
    })
    await waitFor(() => expect(result.current.bundle?.generatedAt).toBe('2026-07-13T10:00:00.000Z'))

    await act(async () => {
      first.resolve(bundleFor(firstQuery, '2026-07-13T09:00:00.000Z'))
    })
    expect(result.current.bundle?.generatedAt).toBe('2026-07-13T10:00:00.000Z')
  })

  it('keeps the previous bundle visible and marks it stale when refresh fails', async () => {
    const refreshRequest = deferred<LearningAnalyticsBundle>()
    let requestCount = 0
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('week', '2026-07-13'),
      localToday: '2026-07-13',
      timeZone: 'Asia/Shanghai',
      personalClientId: 'client-1',
      teaching: { kind: 'none' }
    })
    const initialBundle = bundleFor(query, '2026-07-13T10:00:00.000Z')
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async () => {
        requestCount += 1
        if (requestCount === 1) return initialBundle
        return refreshRequest.promise
      }
    }

    const { result } = renderHook(() => useStudyAnalytics({ query, client }))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.isRefreshing).toBe(true))
    expect(result.current.bundle).toBe(initialBundle)

    await act(async () => refreshRequest.reject(new Error('refresh failed')))
    await waitFor(() => expect(result.current.isRefreshing).toBe(false))

    expect(result.current.phase).toBe('ready')
    expect(result.current.bundle).toBe(initialBundle)
    expect(result.current.isStale).toBe(true)
    expect(result.current.issue).toMatchObject({ kind: 'error', retryable: true })
  })

  it('does not refetch when only the query object identity changes', async () => {
    let requestCount = 0
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async (requestQuery) => {
        requestCount += 1
        return bundleFor(requestQuery, '2026-07-13T10:00:00.000Z')
      }
    }
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('week', '2026-07-13'),
      localToday: '2026-07-13',
      timeZone: 'Asia/Shanghai',
      personalClientId: 'client-1',
      teaching: { kind: 'none' }
    })

    const { result, rerender } = renderHook(
      ({ requestQuery }) => useStudyAnalytics({ query: requestQuery, client }),
      { initialProps: { requestQuery: query } }
    )

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(requestCount).toBe(1)

    rerender({ requestQuery: structuredClone(query) })
    await act(async () => Promise.resolve())

    expect(requestCount).toBe(1)
  })

  it('distinguishes an unavailable analytics API from a request failure', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async () => {
        throw new AnalyticsApiUnavailableError()
      }
    }
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('week', '2026-07-13'),
      localToday: '2026-07-13',
      timeZone: 'Asia/Shanghai',
      personalClientId: 'client-1',
      teaching: { kind: 'none' }
    })

    const { result } = renderHook(() => useStudyAnalytics({ query, client }))
    await waitFor(() => expect(result.current.phase).toBe('unavailable'))
    expect(result.current.issue?.kind).toBe('unavailable')
  })
})
